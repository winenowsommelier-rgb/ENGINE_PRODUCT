#!/usr/bin/env python3
"""Compute per-SKU reputation signals and write to products.db.

Phases:
  0 — Backup DB + run DDL
  1 — Per-axis scores → reputation_signals table
  2 — Rollup composite + tier + summary → products table
  3 — Verify output + run refresh_live_export.py
"""
from __future__ import annotations

import logging
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve as _resolve

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_PATH  = REPO_ROOT / "data" / "db" / "products.db"
SCRIPT   = REPO_ROOT / "scripts" / "refresh_live_export.py"

BEVERAGE_GROUPS = {"Wine", "Spirits", "Beer & RTD", "Whisky", "Liqueur", "Sake & Asian"}
STILL_WINE_TYPES = {"Red Wine", "White Wine", "Rosé"}

VALID_TIERS = {"iconic", "premium", "established", "everyday", "unrated"}

# Designation base scores.
# Keys are exact values as they appear in the products.designation column.
# Gran Reserva is NOT listed here — handled separately via _gran_reserva_base().
# Brut / Extra Brut deliberately excluded — dosage level, not prestige designation.
DESIGNATION_TABLE: dict[str, int] = {
    "Grand Cru":        95,
    "Premier Cru":      88,
    "1er Cru":          88,
    "Cru Classé":       82,
    "DOCG":             82,
    "Reserva Especial": 74,
    "Reserva Privada":  74,
    "XO":               75,
    "DOC":              70,
    "Reserva":          70,
    "Single Malt":      68,
    "VSOP":             62,
    "Blanc de Blancs":  60,
    "Blanc de Noirs":   58,
    "Villages":         52,
}

PRICE_BONUS_TABLE = [
    (50_000, 52),
    (10_000, 38),
    (2_000,  22),
    (500,     8),
    (0,       0),
]

AXIS_WEIGHTS = {
    "acclaim":    0.35,
    "prestige":   0.35,
    "popularity": 0.20,
    "producer":   0.10,
}


# ---------------------------------------------------------------------------
# Prestige helpers
# ---------------------------------------------------------------------------

def _price_bonus(price: float | None) -> int:
    if not price:
        return 0
    for threshold, bonus in PRICE_BONUS_TABLE:
        if price >= threshold:
            return bonus
    return 0


def _gran_reserva_base(sku: str, country: str | None) -> int:
    """Return 82 for Spain/Argentina still wine, 75 for everything else."""
    tax = _resolve({"sku": sku})
    is_regulated = (
        tax["group"] == "Wine"
        and tax.get("type") in STILL_WINE_TYPES
        and country in ("Spain", "Argentina")
    )
    return 82 if is_regulated else 75


def _designation_base(designation: str | None, sku: str, country: str | None) -> int:
    if not designation:
        return 20
    if designation == "Gran Reserva":
        return _gran_reserva_base(sku, country)
    return DESIGNATION_TABLE.get(designation, 20)


def prestige_score(
    designation: str | None,
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
) -> int:
    base = _designation_base(designation, sku, country)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_score_multi(
    designations: list[str],
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
) -> int:
    """Take the MAX base score across multiple designations, then add bonuses once."""
    if not designations:
        base = 20
    else:
        base = max(_designation_base(d, sku, country) for d in designations)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_confidence(designation: str | None, appellation: str | None) -> float:
    if designation:
        return 0.9
    if appellation:
        return 0.6
    return 0.4


# ---------------------------------------------------------------------------
# Acclaim helpers
# ---------------------------------------------------------------------------

def acclaim_score_for_sku(
    sku: str,
    critic_rows: list[dict],
) -> tuple[float | None, float, str]:
    """
    Returns (score, confidence, source_note).

    critic_rows must be pre-filtered to this SKU and must include keys:
      critic, score, pct  (where pct is within-critic percentile 0–100).

    Aggregates per (sku, critic) with MAX(score) — uses the pct of the
    max-score row — before averaging across critics.
    """
    if not critic_rows:
        return None, 0.0, ""

    # Deduplicate per critic: keep row with max score
    best_per_critic: dict[str, dict] = {}
    for row in critic_rows:
        critic = row["critic"]
        if critic not in best_per_critic or row["score"] > best_per_critic[critic]["score"]:
            best_per_critic[critic] = row

    num_critics = len(best_per_critic)
    avg_pct = sum(r["pct"] for r in best_per_critic.values()) / num_critics
    confidence = min(1.0, num_critics / 3)

    # Build source note from highest-pct critic
    best = max(best_per_critic.values(), key=lambda r: r["pct"])
    pct_display = max(1, round(100 - best["pct"]))  # "top X%" = 100 - percentile; floor at 1
    source_note = (
        f"Rated {int(best['score'])}/100 by {best['critic']} "
        f"(top {pct_display}% of their reviews)."
    )
    return avg_pct, confidence, source_note


# ---------------------------------------------------------------------------
# Popularity helpers
# ---------------------------------------------------------------------------

def _demand(sold_qty, sold_orders) -> int:
    return (sold_qty or 0) + ((sold_orders or 0) * 2)


def popularity_percentile(skus: list[dict]) -> dict[str, dict]:
    """
    Returns {sku: {score, confidence, source_note}} for all input SKUs.

    Groups by 3-char prefix; falls back to 1-char prefix family for groups < 3.
    """
    from collections import defaultdict

    # Group by 3-char prefix
    by_prefix3: dict[str, list[dict]] = defaultdict(list)
    for s in skus:
        by_prefix3[str(s["sku"]).upper()[:3]].append(s)

    # For thin groups (< 3), merge into 1-char family group
    by_letter: dict[str, list[dict]] = defaultdict(list)
    for prefix, members in by_prefix3.items():
        if len(members) < 3:
            letter = prefix[:1]
            by_letter[letter].extend(members)

    def _percentile_rank(items: list[dict]) -> dict[str, float]:
        n = len(items)
        if n == 1:
            return {items[0]["sku"]: 50.0}
        sorted_items = sorted(items, key=lambda s: _demand(s["sold_qty"], s["sold_orders"]))
        return {
            s["sku"]: (i / (n - 1)) * 100
            for i, s in enumerate(sorted_items)
        }

    result: dict[str, dict] = {}

    # Score thin-group SKUs using letter-family ranking
    for letter, members in by_letter.items():
        ranks = _percentile_rank(members)
        for s in members:
            sku = s["sku"]
            score = ranks[sku]
            conf = 0.8 if _demand(s["sold_qty"], s["sold_orders"]) > 0 else 0.3
            pct_display = max(1, round(100 - score))
            note = f"Top {pct_display}% by sales in its broader category." if conf == 0.8 else ""
            result[sku] = {"score": score, "confidence": conf, "source_note": note}

    # Score normal groups (≥ 3 members)
    for prefix, members in by_prefix3.items():
        if len(members) < 3:
            continue
        ranks = _percentile_rank(members)
        for s in members:
            sku = s["sku"]
            score = ranks[sku]
            conf = 0.8 if _demand(s["sold_qty"], s["sold_orders"]) > 0 else 0.3
            pct_display = max(1, round(100 - score))
            note = f"Top {pct_display}% by sales in its category." if conf == 0.8 else ""
            result[sku] = {"score": score, "confidence": conf, "source_note": note}

    return result


# ---------------------------------------------------------------------------
# Composite + tier + summary
# ---------------------------------------------------------------------------

def composite_score(axes: dict[str, dict]) -> float | None:
    """Weighted confidence composite. Returns None if denominator is 0."""
    numerator = 0.0
    denominator = 0.0
    for axis, weight in AXIS_WEIGHTS.items():
        ax = axes.get(axis, {})
        score = ax.get("score")
        conf  = ax.get("confidence", 0.0)
        if score is not None:
            numerator   += score * weight * conf
        denominator += weight * conf
    if denominator == 0:
        return None
    return numerator / denominator


def tier_for_composite(
    score: float | None,
    confidence: float,
    override: str | None = None,
) -> str:
    if override is not None:
        if override in VALID_TIERS:
            return override
        else:
            log.warning("Invalid reputation_override value %r — ignoring", override)
    if score is None or confidence < 0.3:
        return "unrated"
    if score >= 85:
        return "iconic"
    if score >= 65:
        return "premium"
    if score >= 40:
        return "established"
    return "everyday"


def _weighted_confidence(axes: dict[str, dict]) -> float:
    numerator = denominator = 0.0
    for axis, weight in AXIS_WEIGHTS.items():
        conf = axes.get(axis, {}).get("confidence", 0.0)
        numerator   += conf * weight
        denominator += weight
    return numerator / denominator if denominator else 0.0


def reputation_summary(axes: dict[str, dict]) -> str | None:
    """Template-based one-sentence copy. Returns None (not '') when no signal qualifies."""
    acclaim = axes.get("acclaim", {})
    prestige = axes.get("prestige", {})
    popularity = axes.get("popularity", {})
    producer = axes.get("producer", {})

    if (acclaim.get("score") or 0) >= 70 and (acclaim.get("confidence") or 0) >= 0.5:
        return acclaim.get("source_note") or None
    if prestige.get("source_note"):
        return prestige["source_note"]
    if (popularity.get("score") or 0) >= 70:
        return popularity.get("source_note") or None
    if (producer.get("confidence") or 0) >= 0.7:
        return producer.get("source_note") or None
    return None


# ---------------------------------------------------------------------------
# Phase 0 — Backup + DDL
# ---------------------------------------------------------------------------

DDL_SIGNALS = """
CREATE TABLE IF NOT EXISTS reputation_signals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sku          TEXT NOT NULL,
  axis         TEXT NOT NULL,
  score        REAL NOT NULL,
  confidence   REAL NOT NULL,
  method       TEXT NOT NULL,
  source_note  TEXT,
  computed_at  TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sku, axis) ON CONFLICT REPLACE
);
CREATE INDEX IF NOT EXISTS idx_rep_sig_sku ON reputation_signals(sku);
"""

DDL_PRODUCTS_COLS = [
    "ALTER TABLE products ADD COLUMN reputation_tier       TEXT",
    "ALTER TABLE products ADD COLUMN reputation_composite  REAL",
    "ALTER TABLE products ADD COLUMN reputation_confidence REAL",
    "ALTER TABLE products ADD COLUMN reputation_summary    TEXT",
    "ALTER TABLE products ADD COLUMN reputation_override   TEXT",
    "ALTER TABLE products ADD COLUMN reputation_computed_at TEXT",
]


def phase0_backup_and_ddl(db_path: Path) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup = db_path.parent / f"products.db.backup-reputation-{ts}.db"
    log.info("Phase 0: backing up DB → %s", backup)
    shutil.copy2(db_path, backup)

    src_size = db_path.stat().st_size
    if not backup.exists() or backup.stat().st_size != src_size:
        log.error("Phase 0: backup verification FAILED (src=%d, backup=%s) — aborting.",
                  src_size, backup.stat().st_size if backup.exists() else "missing")
        sys.exit(1)
    log.info("Phase 0: backup verified (%d bytes).", src_size)

    conn = sqlite3.connect(db_path)
    conn.executescript(DDL_SIGNALS)

    # Validate table and index were actually created (executescript silently continues on errors)
    tbl = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reputation_signals'"
    ).fetchone()
    if not tbl:
        log.error("Phase 0: reputation_signals table creation failed")
        sys.exit(1)
    idx = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_rep_sig_sku'"
    ).fetchone()
    if not idx:
        log.warning("Phase 0: index idx_rep_sig_sku was not created; query performance may degrade")

    existing = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    for stmt in DDL_PRODUCTS_COLS:
        col_match = re.search(r'ADD COLUMN\s+(\w+)', stmt)
        if not col_match:
            log.error("Phase 0: could not extract column name from DDL: %s", stmt)
            sys.exit(1)
        col = col_match.group(1)
        if col not in existing:
            conn.execute(stmt)
            log.info("Phase 0: added column %s", col)
        else:
            log.info("Phase 0: column %s already exists, skipping", col)
    conn.commit()
    conn.close()
    log.info("Phase 0 complete.")


# ---------------------------------------------------------------------------
# Phase 1 — Per-axis scores
# ---------------------------------------------------------------------------

def _compute_critic_percentiles(conn: sqlite3.Connection) -> dict[str, list[dict]]:
    """
    Returns {sku: [{"critic", "score", "pct"}, ...]} for all SKU-bound rows.
    Steps: filter WHERE sku IS NOT NULL; per critic compute within-critic percentile
    rank; aggregate per (sku, critic) by MAX(score) before percentile lookup.
    """
    rows = conn.execute("""
        SELECT sku, critic, score
        FROM critic_scores
        WHERE sku IS NOT NULL AND score IS NOT NULL
    """).fetchall()

    from collections import defaultdict

    by_critic: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        by_critic[r["critic"]].append(r["score"])

    sorted_per_critic: dict[str, list[float]] = {
        critic: sorted(scores) for critic, scores in by_critic.items()
    }

    def _pct(critic: str, score: float) -> float:
        s = sorted_per_critic[critic]
        n = len(s)
        if n == 1:
            return 50.0
        import bisect
        pos = bisect.bisect_right(s, score) - 1
        return (pos / (n - 1)) * 100

    best: dict[tuple, float] = {}
    for r in rows:
        key = (r["sku"], r["critic"])
        if key not in best or r["score"] > best[key]:
            best[key] = r["score"]

    by_sku: dict[str, list[dict]] = defaultdict(list)
    for (sku, critic), score in best.items():
        by_sku[sku].append({
            "sku": sku, "critic": critic, "score": score,
            "pct": _pct(critic, score),
        })
    return dict(by_sku)


def _prestige_source_note(designation: str | None, appellation: str | None) -> str:
    parts = []
    if designation:
        parts.append(designation)
    if appellation:
        parts.append(appellation)
    return (", ".join(parts) + ".") if parts else ""


def _compute_producer_signals(skus: list[dict], signals: list[dict], now: str) -> None:
    """Aggregate brand-level acclaim + prestige → producer signal per SKU."""
    from collections import defaultdict

    pres_by_sku: dict[str, float] = {}
    acc_by_sku: dict[str, float | None] = {}
    for sig in signals:
        if sig["axis"] == "prestige":
            pres_by_sku[sig["sku"]] = sig["score"]
        elif sig["axis"] == "acclaim":
            acc_by_sku[sig["sku"]] = sig["score"]

    by_brand: dict[str, list[dict]] = defaultdict(list)
    for s in skus:
        by_brand[s["brand"]].append(s)

    for brand, brand_skus in by_brand.items():
        pres_scores = [pres_by_sku[s["sku"]] for s in brand_skus if s["sku"] in pres_by_sku]
        acc_scores  = [acc_by_sku[s["sku"]] for s in brand_skus
                       if acc_by_sku.get(s["sku"]) is not None]

        avg_pres = sum(pres_scores) / len(pres_scores) if pres_scores else 0.0
        avg_acc  = sum(acc_scores)  / len(acc_scores)  if acc_scores  else None

        if avg_acc is not None:
            brand_score = (avg_acc * 0.5 + avg_pres * 0.5)
        else:
            brand_score = avg_pres

        n = len(brand_skus)
        if n >= 10:
            conf = 0.9
        elif n >= 5:
            conf = 0.7
        elif n >= 2:
            conf = 0.5
        else:
            conf = 0.3

        note = (
            f"{brand}: {n} SKUs, "
            + (f"avg acclaim {round(avg_acc, 1)}, " if avg_acc is not None else "")
            + f"avg prestige {round(avg_pres, 1)}."
        )

        for s in brand_skus:
            signals.append({
                "sku": s["sku"], "axis": "producer",
                "score": brand_score, "confidence": conf,
                "method": "brand-avg-acclaim-prestige",
                "source_note": note, "computed_at": now,
            })


def phase1_per_axis_scores(conn: sqlite3.Connection) -> None:
    """Compute acclaim + prestige + popularity per SKU; producer per brand."""
    log.info("Phase 1: loading active beverage SKUs …")
    rows = conn.execute("""
        SELECT sku, name, brand, designation, appellation, country,
               price, sold_qty, sold_orders
        FROM products
        WHERE is_in_stock IN ('1', 1)
    """).fetchall()

    skus = []
    for r in rows:
        tax = _resolve({"sku": r["sku"], "name": r["name"]})
        if tax["group"] in BEVERAGE_GROUPS:
            skus.append(dict(r))
    log.info("Phase 1: %d active beverage SKUs", len(skus))

    critic_map = _compute_critic_percentiles(conn)

    signals: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()

    for s in skus:
        sku = s["sku"]
        critic_rows = critic_map.get(sku, [])
        acc_score, acc_conf, acc_note = acclaim_score_for_sku(sku, critic_rows)

        pres_score = prestige_score(
            s["designation"], s["appellation"], s["price"], s["country"], sku
        )
        pres_conf = prestige_confidence(s["designation"], s["appellation"])
        pres_note = _prestige_source_note(s["designation"], s["appellation"])

        if acc_score is not None:
            signals.append({
                "sku": sku, "axis": "acclaim",
                "score": acc_score, "confidence": acc_conf,
                "method": "per-critic-percentile-rank",
                "source_note": acc_note, "computed_at": now,
            })
        signals.append({
            "sku": sku, "axis": "prestige",
            "score": pres_score, "confidence": pres_conf,
            "method": "designation-appellation-price-rule",
            "source_note": pres_note, "computed_at": now,
        })

    pop_result = popularity_percentile(skus)
    for sku, pdd in pop_result.items():
        signals.append({
            "sku": sku, "axis": "popularity",
            "score": pdd["score"], "confidence": pdd["confidence"],
            "method": "sold-qty-orders-prefix-percentile",
            "source_note": pdd["source_note"], "computed_at": now,
        })

    _compute_producer_signals(skus, signals, now)

    conn.executemany("""
        INSERT OR REPLACE INTO reputation_signals
          (sku, axis, score, confidence, method, source_note, computed_at)
        VALUES
          (:sku, :axis, :score, :confidence, :method, :source_note, :computed_at)
    """, signals)
    conn.commit()
    log.info("Phase 1: wrote %d signal rows", len(signals))


# ---------------------------------------------------------------------------
# Phase 2 — Rollup
# ---------------------------------------------------------------------------

def phase2_rollup(conn: sqlite3.Connection) -> None:
    """Read reputation_signals, compute composite + tier + summary, write to products."""
    log.info("Phase 2: rolling up composite scores …")

    sig_rows = conn.execute("""
        SELECT sku, axis, score, confidence, source_note
        FROM reputation_signals
    """).fetchall()

    from collections import defaultdict
    by_sku: dict[str, dict] = defaultdict(dict)
    for r in sig_rows:
        by_sku[r["sku"]][r["axis"]] = {
            "score": r["score"], "confidence": r["confidence"],
            "source_note": r["source_note"] or "",
        }

    overrides = {
        r["sku"]: r["reputation_override"]
        for r in conn.execute(
            "SELECT sku, reputation_override FROM products WHERE reputation_override IS NOT NULL"
        ).fetchall()
    }

    now = datetime.now(timezone.utc).isoformat()
    updates = []
    for sku, axes in by_sku.items():
        comp = composite_score(axes)
        conf = _weighted_confidence(axes)
        override = overrides.get(sku)
        tier = tier_for_composite(comp, conf, override)
        if override and override in VALID_TIERS:
            computed_tier = tier_for_composite(comp, conf, override=None)
            tier_order = ["everyday", "established", "premium", "iconic"]
            if computed_tier in tier_order and override in tier_order:
                diff = abs(tier_order.index(override) - tier_order.index(computed_tier))
                if diff > 1:
                    log.warning(
                        "SKU %s override=%r but computed=%r (diff=%d levels)",
                        sku, override, computed_tier, diff,
                    )
        summary = reputation_summary(axes)
        updates.append({
            "sku": sku,
            "reputation_tier": tier,
            "reputation_composite": round(comp, 2) if comp is not None else None,
            "reputation_confidence": round(conf, 3),
            "reputation_summary": summary,
            "reputation_computed_at": now,
        })

    conn.executemany("""
        UPDATE products SET
          reputation_tier        = :reputation_tier,
          reputation_composite   = :reputation_composite,
          reputation_confidence  = :reputation_confidence,
          reputation_summary     = :reputation_summary,
          reputation_computed_at = :reputation_computed_at
        WHERE sku = :sku
    """, updates)
    conn.commit()
    log.info("Phase 2: updated %d SKUs", len(updates))


# ---------------------------------------------------------------------------
# Phase 3 — Verify + export
# ---------------------------------------------------------------------------

EXPORT_REQUIRED_COLS = {
    "reputation_tier", "reputation_composite",
    "reputation_confidence", "reputation_summary",
}


def phase3_verify_and_export(conn: sqlite3.Connection) -> None:
    """Print tier distribution, cross-checks, then run refresh_live_export.py."""
    log.info("Phase 3: verifying results …")

    tiers = conn.execute("""
        SELECT reputation_tier, COUNT(*) as cnt
        FROM products
        WHERE is_in_stock IN ('1', 1)
        GROUP BY reputation_tier
        ORDER BY cnt DESC
    """).fetchall()
    total = sum(r["cnt"] for r in tiers)
    print("\nTier distribution:")
    for r in tiers:
        tier = r["reputation_tier"] or "NULL"
        pct = (r["cnt"] / total * 100) if total else 0
        print(f"  {tier:<15}{r['cnt']:>6} SKUs  ({pct:.1f}%)")
    print()

    prefix_avgs = conn.execute("""
        SELECT SUBSTR(sku, 1, 3) as prefix,
               ROUND(AVG(reputation_composite), 1) as avg_comp,
               COUNT(*) as n
        FROM products
        WHERE reputation_composite IS NOT NULL
        GROUP BY prefix
        ORDER BY avg_comp DESC
        LIMIT 20
    """).fetchall()
    print("Avg composite by prefix (top 20):")
    for r in prefix_avgs:
        print(f"  {r['prefix']}  avg={r['avg_comp']}  n={r['n']}")
    print()

    print("Top 20 by price — check for missing designation/appellation:")
    top_wines = conn.execute("""
        SELECT sku, name, price, designation, appellation, reputation_tier
        FROM products
        WHERE is_in_stock IN ('1', 1) AND price IS NOT NULL
        ORDER BY price DESC
        LIMIT 20
    """).fetchall()
    missing_data = 0
    for r in top_wines:
        flag = ""
        if not r["designation"] and not r["appellation"]:
            flag = "  ← NO designation/appellation"
            missing_data += 1
        print(f"  {r['sku']:<12} ฿{r['price']:<10.0f} {(r['reputation_tier'] or 'NULL'):<15} "
              f"{r['designation'] or '—':<20} {r['appellation'] or '—':<15} "
              f"{(r['name'] or '')[:30]}{flag}")
    if missing_data:
        print(f"\n  ⚠ {missing_data} SKU(s) in top-20 by price have no designation/appellation "
              f"— prestige is price-only. Consider enrichment before publishing reputation copy.")
    print()

    print("Top 20 spirits by price — check for missing designation/appellation:")
    top_spirits = conn.execute("""
        SELECT sku, name, price, designation, appellation, reputation_tier
        FROM products
        WHERE is_in_stock IN ('1', 1)
          AND price IS NOT NULL
          AND SUBSTR(sku,1,1) = 'L'
        ORDER BY price DESC
        LIMIT 20
    """).fetchall()
    missing_spirits = 0
    for r in top_spirits:
        flag = ""
        if not r["designation"] and not r["appellation"]:
            flag = "  ← NO designation/appellation"
            missing_spirits += 1
        print(f"  {r['sku']:<12} ฿{r['price']:<10.0f} {(r['reputation_tier'] or 'NULL'):<15} "
              f"{r['designation'] or '—':<20} {r['appellation'] or '—':<15} "
              f"{(r['name'] or '')[:30]}{flag}")
    if missing_spirits:
        print(f"\n  ⚠ {missing_spirits} spirit(s) in top-20 by price have no designation/appellation.")
    print()

    spot = conn.execute("""
        SELECT sku, reputation_tier, reputation_composite
        FROM products
        WHERE reputation_tier IS NOT NULL
        LIMIT 5
    """).fetchall()
    print("Spot-check (5 rows with tier set):")
    for r in spot:
        print(f"  {r['sku']}  tier={r['reputation_tier']}  composite={r['reputation_composite']}")
    print()

    # Precondition: refuse to run the export if the allowlist is missing reputation cols.
    _assert_export_cols()

    log.info("Phase 3: running refresh_live_export.py …")
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        log.error("refresh_live_export.py failed:\n%s", result.stderr)
        sys.exit(1)
    log.info("Phase 3: live export updated.")

    print("\nLive export updated: data/live_products_export.json")
    print("Phase 3 complete — reputation signals verified.")


def _assert_export_cols() -> None:
    """Read refresh_live_export.py and assert all 4 reputation cols are present."""
    content = (REPO_ROOT / "scripts" / "refresh_live_export.py").read_text()
    missing = [col for col in EXPORT_REQUIRED_COLS if col not in content]
    if missing:
        print(
            f"\nERROR: EXPORT_COLS missing: {missing} — "
            f"add to scripts/refresh_live_export.py before running.",
            file=sys.stderr
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    db = DB_PATH
    if not db.exists():
        log.error("DB not found: %s", db)
        sys.exit(1)

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    log.info("=== compute_reputation.py ===")
    log.info("DB: %s", db)

    phase0_backup_and_ddl(db)
    # Re-connect after DDL so row_factory sees new columns
    conn.close()
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    phase1_per_axis_scores(conn)
    phase2_rollup(conn)
    conn.close()

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    phase3_verify_and_export(conn)
    conn.close()


if __name__ == "__main__":
    main()
