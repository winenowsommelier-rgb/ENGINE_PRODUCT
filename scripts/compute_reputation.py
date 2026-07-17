#!/usr/bin/env python3
"""Compute per-SKU reputation signals and write to products.db.

Phases:
  0 — Backup DB + run DDL
  1 — Per-axis scores → reputation_signals table
  2 — Rollup composite + tier + summary → products table
  3 — Verify output + run refresh_live_export.py
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve as _resolve

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_PATH  = REPO_ROOT / "data" / "db" / "products.db"
SCRIPT   = REPO_ROOT / "scripts" / "refresh_live_export.py"
PRODUCER_PRESTIGE_PATH = REPO_ROOT / "data" / "taxonomy" / "producer_prestige.json"

# tier -> base score. Mirrors data/taxonomy/producer_prestige.json's "_tiers"
# block; kept as a Python constant (rather than reading "_tiers" from the
# JSON at runtime) so a typo'd tier name in the curated file fails loudly
# (KeyError) instead of silently defaulting.
PRODUCER_PRESTIGE_TIER_SCORES = {
    "reference": 97,
    "first_growth": 95,
    "grande_marque": 92,
    "benchmark": 88,
    "notable": 78,
}

BEVERAGE_GROUPS = {"Wine", "Spirits", "Beer & RTD", "Whisky", "Liqueur", "Sake & Asian"}
STILL_WINE_TYPES = {"Red Wine", "White Wine", "Rosé"}
# "Gran Reserva" is a legitimate designation for still wine (Spain/Argentina
# regulated) and aged rum (Ron Matusalem, Bacardi Gran Reserva Diez — real
# product lines verified in DB). Not valid for Whisky/Sake & Asian, where
# any occurrence is leaked wine-category text.
GRAN_RESERVA_GROUPS = {"Wine", "Spirits"}

VALID_TIERS = {"iconic", "premium", "established", "everyday", "unrated"}

# Designation base scores.
# Keys are exact values as they appear in the products.designation column.
# Gran Reserva is NOT listed here — handled separately via _gran_reserva_base().
# Grand Cru is NOT listed here — handled separately via _grand_cru_base()
# (Burgundy's apex tier and Saint-Émilion's baseline appellation share the
# same designation string; they are not the same rank).
# Brut / Extra Brut deliberately excluded — dosage level, not prestige designation.
#
# Each entry is GATED to the wine groups it is meaningful for (`groups`).
# A designation token appearing on a SKU outside its gated groups (e.g. a
# whisky whose name contains stray wine-cask-finish text) is IGNORED rather
# than scored — this is what let a "Grand Cru Burgundy Cask Finish" whisky
# become "iconic". See _designation_base().
DESIGNATION_TABLE: dict[str, dict] = {
    "Premier Cru":      {"score": 88, "groups": {"Wine"}},
    "1er Cru":          {"score": 88, "groups": {"Wine"}},
    "Cru Classé":       {"score": 96, "groups": {"Wine"}},  # Bordeaux classed growth — above plain Grand Cru
    "DOCG":             {"score": 82, "groups": {"Wine"}},
    "Reserva Especial": {"score": 74, "groups": {"Wine"}},
    "Reserva Privada":  {"score": 74, "groups": {"Wine"}},
    "XO":               {"score": 75, "groups": {"Spirits", "Whisky", "Liqueur"}},
    "DOC":              {"score": 70, "groups": {"Wine"}},
    "Reserva":          {"score": 70, "groups": {"Wine"}},
    "Single Malt":      {"score": 55, "groups": {"Whisky", "Spirits"}},  # production method, not a rank — low base
    "VSOP":             {"score": 62, "groups": {"Spirits", "Whisky", "Liqueur"}},
    "Blanc de Blancs":  {"score": 60, "groups": {"Wine"}},
    "Blanc de Noirs":   {"score": 58, "groups": {"Wine"}},
    "Villages":         {"score": 52, "groups": {"Wine"}},
}

# Whisky age-statement bands (years -> base score). Matched against product
# name, e.g. "18 Year Old", "21 Years Old". Calibrated against live catalog
# price ladder 2026-07-09 (Yamazaki 25YO ฿349,999 down to 12YO entry tier).
AGE_STATEMENT_BANDS = [
    (25, 90),
    (21, 84),
    (18, 78),
    (15, 68),
    (12, 58),
]
_AGE_RE = re.compile(r"\b(\d{1,2})\s*Y(?:ears?)?\.?\s*O(?:ld)?\b", re.I)

# Sake grades, highest to lowest (Junmai Daiginjo is the apex classification —
# ≤50% rice polishing ratio, no added alcohol). Matched against product name.
SAKE_GRADE_BANDS = [
    (re.compile(r"junmai\s+daiginjo", re.I), 85),
    (re.compile(r"daiginjo", re.I),          78),
    (re.compile(r"junmai\s+ginjo", re.I),    68),
    (re.compile(r"ginjo", re.I),             62),
    (re.compile(r"junmai", re.I),            55),
]

# Champagne prestige cuvées — hand-identified flagship bottlings that carry
# house-level prestige not captured by any structured field. Matched against
# product name (case-insensitive substring).
CHAMPAGNE_CUVEE_TERMS = {
    "grande cuvee": 88, "grande cuvée": 88,
    "dom perignon": 92, "dom pérignon": 92,
    "cristal": 92,
    "la grande dame": 90,
    "comtes de champagne": 90,
    "sir winston churchill": 90,
    "clos du mesnil": 94,
    "clos des goisses": 88,
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


_ST_EMILION_RE = re.compile(r"st[.\s-]?emil?lion", re.I)


def _grand_cru_base(
    sku: str, country: str | None, appellation: str | None, name: str | None = None,
) -> int:
    """Burgundy Grand Cru (apex of a 5-tier ladder) scores well above a
    Saint-Émilion Grand Cru (that appellation's entry-level classification —
    below Grand Cru Classé and Premier Grand Cru Classé). Distinguish by
    appellation/name text; appellation is often blank in this catalog so
    "St.Emillion"/"Saint Emilion" in the product NAME is the primary signal
    (verified: WRW3496BN/WRW3497BN carry it only in name). Default to the
    Burgundy (higher) reading only when the wine is French and neither
    signal indicates Saint-Émilion, since "Grand Cru" alone is far more
    often used as the Burgundy apex term across the catalog's vocabulary."""
    appellation_l = (appellation or "").lower()
    is_st_emilion = bool(_ST_EMILION_RE.search(appellation_l)) or bool(_ST_EMILION_RE.search(name or ""))
    if is_st_emilion:
        return 65
    tax = _resolve({"sku": sku})
    if tax["group"] == "Wine" and country == "France":
        return 95
    return 80


def _name_based_designation(name: str | None, group: str) -> int | None:
    """Fallback prestige lookup over free-text `name` for categories the
    structured `designation` column has no vocabulary for: whisky age
    statements, sake grades, champagne prestige cuvées. Returns None if
    nothing matches (caller falls through to the no-designation base)."""
    n = name or ""
    nl = n.lower()

    if group in ("Whisky", "Spirits"):
        m = _AGE_RE.search(n)
        if m:
            years = int(m.group(1))
            for threshold, score in AGE_STATEMENT_BANDS:
                if years >= threshold:
                    return score

    if group == "Sake & Asian":
        for pattern, score in SAKE_GRADE_BANDS:
            if pattern.search(n):
                return score

    if group == "Wine":
        for term, score in CHAMPAGNE_CUVEE_TERMS.items():
            if term in nl:
                return score

    return None


def _designation_base(
    designation: str | None,
    sku: str,
    country: str | None,
    name: str | None = None,
    appellation: str | None = None,
) -> int:
    tax = _resolve({"sku": sku})
    group = tax["group"]

    if designation == "Gran Reserva" and group not in GRAN_RESERVA_GROUPS:
        # "Gran Reserva" is a genuine aged-rum designation (Ron Matusalem,
        # Bacardi Gran Reserva Diez are real product lines — verified in
        # DB), so it's valid for Wine and Spirits. Not valid for Whisky/Sake.
        designation = None
    elif designation == "Grand Cru" and group != "Wine":
        # Unlike Gran Reserva, "Grand Cru" has no legitimate non-wine usage
        # in this catalog — every non-wine occurrence found was leaked wine
        # marketing text (e.g. LWH1034DG "Grand Cru Burgundy Cask Finish"
        # whisky, which scored iconic/94.24 before this gate). Ignore it.
        designation = None
    elif designation == "Gran Reserva":
        return _gran_reserva_base(sku, country)
    elif designation == "Grand Cru":
        return _grand_cru_base(sku, country, appellation, name)
    if designation:
        entry = DESIGNATION_TABLE.get(designation)
        if entry is not None:
            if group in entry["groups"]:
                return entry["score"]
            # Designation token present but doesn't apply to this product's
            # category (e.g. wine-cask-finish text on a whisky) — ignore it
            # rather than scoring it, and fall through to name-based lookup.
        else:
            return 20

    name_based = _name_based_designation(name, group)
    if name_based is not None:
        return name_based

    return 20


def prestige_score(
    designation: str | None,
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
    name: str | None = None,
) -> int:
    base = _designation_base(designation, sku, country, name, appellation)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_score_multi(
    designations: list[str],
    appellation: str | None,
    price: float | None,
    country: str | None,
    sku: str,
    name: str | None = None,
) -> int:
    """Take the MAX base score across multiple designations, then add bonuses once."""
    if not designations:
        base = _name_based_designation(name, _resolve({"sku": sku})["group"]) or 20
    else:
        base = max(_designation_base(d, sku, country, name, appellation) for d in designations)
    appellation_bonus = 5 if appellation else 0
    return min(100, base + appellation_bonus + _price_bonus(price))


def prestige_confidence(
    designation: str | None,
    appellation: str | None,
    name: str | None = None,
    sku: str | None = None,
) -> float:
    group = _resolve({"sku": sku})["group"] if sku is not None else None
    gated_out = (
        designation in ("Gran Reserva", "Grand Cru") and group is not None and group != "Wine"
    )
    if designation and not gated_out:
        return 0.9
    if appellation:
        return 0.6
    if sku is not None and _name_based_designation(name, group) is not None:
        return 0.7  # name-derived (age statement / sake grade / cuvée) — solid but not structured-field level
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


# Below this many demand units, a SKU is indistinguishable from "no sales
# history" for confidence/copy purposes — a single 1-2 bottle sale must not
# unlock "Top X% by sales" language. Tuned against live data 2026-07-09:
# 91% of active beverage SKUs have zero demand, so any nonzero threshold
# below this let 428 products show false "Top 4%" copy off 1-2 bottles sold.
DEMAND_FLOOR = 5


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
        """Mid-rank (fractional) percentile: tied demand values share the
        SAME score — the midpoint of their rank span — instead of being
        split apart by insertion order. Fixes the bug where 91% zero-demand
        SKUs got arbitrary scores 0-100 based on DB row order."""
        n = len(items)
        if n == 1:
            return {items[0]["sku"]: 50.0}
        demand_by_sku = {
            s["sku"]: _demand(s["sold_qty"], s["sold_orders"]) for s in items
        }
        by_demand: dict[int, list[str]] = defaultdict(list)
        for sku, d in demand_by_sku.items():
            by_demand[d].append(sku)
        sorted_items = sorted(items, key=lambda s: demand_by_sku[s["sku"]])
        ranks: dict[str, float] = {}
        i = 0
        for s in sorted_items:
            d = demand_by_sku[s["sku"]]
            tied = by_demand[d]
            if tied[0] in ranks:
                continue
            span = list(range(i, i + len(tied)))
            mid_rank = sum(span) / len(span)
            score = (mid_rank / (n - 1)) * 100
            for sku in tied:
                ranks[sku] = score
            i += len(tied)
        return ranks

    result: dict[str, dict] = {}

    def _score_group(members: list[dict], broader: bool) -> None:
        ranks = _percentile_rank(members)
        for s in members:
            sku = s["sku"]
            score = ranks[sku]
            demand = _demand(s["sold_qty"], s["sold_orders"])
            conf = 0.8 if demand >= DEMAND_FLOOR else 0.3
            pct_display = max(1, round(100 - score))
            scope = "broader category" if broader else "category"
            note = f"Top {pct_display}% by sales in its {scope}." if conf == 0.8 else ""
            result[sku] = {"score": score, "confidence": conf, "source_note": note}

    # Score thin-group SKUs using letter-family ranking
    for letter, members in by_letter.items():
        _score_group(members, broader=True)

    # Score normal groups (≥ 3 members)
    for prefix, members in by_prefix3.items():
        if len(members) < 3:
            continue
        _score_group(members, broader=False)

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
    has_acclaim: bool = True,
) -> str:
    if override is not None:
        if override in VALID_TIERS:
            return override
        else:
            log.warning("Invalid reputation_override value %r — ignoring", override)
    if score is None or confidence < 0.3:
        return "unrated"
    if score >= 85:
        # "Iconic" implies independent critical corroboration, not just a
        # designation token + price. 181/199 iconic SKUs had zero acclaim
        # signal (e.g. a ฿900 Gran Reserva with 2 bottles sold, 0 reviews).
        # Without acclaim, cap at premium regardless of prestige score.
        return "iconic" if has_acclaim else "premium"
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


def _prestige_source_note(
    designation: str | None,
    appellation: str | None,
    name: str | None = None,
    sku: str | None = None,
) -> str:
    group = _resolve({"sku": sku})["group"] if sku is not None else None
    gated_out = (
        designation in ("Gran Reserva", "Grand Cru") and group is not None and group != "Wine"
    )
    parts = []
    if designation and not gated_out:
        parts.append(designation)
    if appellation:
        parts.append(appellation)
    if parts:
        return ", ".join(parts) + "."
    if sku is not None:
        n = name or ""
        nl = n.lower()
        if group in ("Whisky", "Spirits"):
            m = _AGE_RE.search(n)
            if m:
                return f"{m.group(1)} Year Old."
        if group == "Sake & Asian":
            for pattern, _ in SAKE_GRADE_BANDS:
                m = pattern.search(n)
                if m:
                    return f"{m.group(0)}."
        if group == "Wine":
            for term in CHAMPAGNE_CUVEE_TERMS:
                if term in nl:
                    return f"{term.title()}."
    return ""


@lru_cache(maxsize=1)
def _load_producer_prestige() -> dict[str, dict]:
    """Load the curated brand->tier overrides (data/taxonomy/producer_prestige.json).

    Returns {} if the file is absent (curated list is optional — the pipeline
    falls back to brand-average for every brand, same as before this existed).
    Keys starting with '_' (schema doc, tier table) are metadata, not brands.
    Raises KeyError loudly if an entry's tier isn't in
    PRODUCER_PRESTIGE_TIER_SCORES — a typo'd tier name should fail the run,
    not silently produce a wrong/default score.
    """
    if not PRODUCER_PRESTIGE_PATH.exists():
        return {}
    data = json.loads(PRODUCER_PRESTIGE_PATH.read_text())
    out = {}
    for brand, entry in data.items():
        if brand.startswith("_"):
            continue
        tier = entry["tier"]
        if tier not in PRODUCER_PRESTIGE_TIER_SCORES:
            raise KeyError(
                f"producer_prestige.json: brand {brand!r} has unknown tier {tier!r} "
                f"— must be one of {sorted(PRODUCER_PRESTIGE_TIER_SCORES)}"
            )
        out[brand] = entry
    return out


def _compute_producer_signals(skus: list[dict], signals: list[dict], now: str) -> None:
    """Aggregate brand-level acclaim + prestige → producer signal per SKU.

    Brands in the curated prestige list (data/taxonomy/producer_prestige.json)
    use their curated tier score directly — this is the fix for the circular
    self-average bug: a single-SKU brand like Krug or The Macallan no longer
    just echoes its own acclaim/prestige score back at 10% weight, it gets an
    independent, human-verified reputation signal. Confidence is fixed at 0.85
    for curated brands (high — hand-verified — but not 1.0, since it's still
    a house-level generalization applied to a specific SKU). Brands NOT in the
    curated list keep the original brand-average behavior unchanged.
    """
    from collections import defaultdict

    pres_by_sku: dict[str, float] = {}
    acc_by_sku: dict[str, float | None] = {}
    for sig in signals:
        if sig["axis"] == "prestige":
            pres_by_sku[sig["sku"]] = sig["score"]
        elif sig["axis"] == "acclaim":
            acc_by_sku[sig["sku"]] = sig["score"]

    curated = _load_producer_prestige()

    by_brand: dict[str, list[dict]] = defaultdict(list)
    for s in skus:
        by_brand[s["brand"]].append(s)

    for brand, brand_skus in by_brand.items():
        curated_entry = curated.get(brand)
        if curated_entry is not None:
            brand_score = PRODUCER_PRESTIGE_TIER_SCORES[curated_entry["tier"]]
            conf = 0.85
            note_extra = curated_entry.get("note")
            note = (
                f"{brand}: curated {curated_entry['tier'].replace('_', ' ')} producer"
                + (f" — {note_extra}." if note_extra else ".")
            )
            for s in brand_skus:
                signals.append({
                    "sku": s["sku"], "axis": "producer",
                    "score": brand_score, "confidence": conf,
                    "method": "curated-producer-prestige",
                    "source_note": note, "computed_at": now,
                })
            continue

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
            s["designation"], s["appellation"], s["price"], s["country"], sku, s["name"]
        )
        pres_conf = prestige_confidence(s["designation"], s["appellation"], s["name"], sku)
        pres_note = _prestige_source_note(s["designation"], s["appellation"], s["name"], sku)

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
        has_acclaim = axes.get("acclaim", {}).get("score") is not None
        tier = tier_for_composite(comp, conf, override, has_acclaim=has_acclaim)
        if override and override in VALID_TIERS:
            computed_tier = tier_for_composite(comp, conf, override=None, has_acclaim=has_acclaim)
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


def phase3_verify_and_export(
    conn: sqlite3.Connection,
    db_path: Path = DB_PATH,
    export_out: Path | None = None,
    skip_export: bool = False,
) -> None:
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

    if skip_export:
        log.info("Phase 3: skip_export=True — not running refresh_live_export.py")
        print("\nPhase 3 complete — reputation signals verified (export skipped).")
        return

    log.info("Phase 3: running refresh_live_export.py …")
    export_cmd = [sys.executable, str(SCRIPT), "--db", str(db_path)]
    if export_out is not None:
        export_cmd += ["--out", str(export_out)]
    result = subprocess.run(export_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log.error("refresh_live_export.py failed:\n%s", result.stderr)
        sys.exit(1)
    log.info("Phase 3: live export updated.")

    print(f"\nLive export updated: {export_out or 'data/live_products_export.json'}")
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

def main(argv: list[str] | None = None) -> None:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DB_PATH)
    ap.add_argument("--export-out", type=Path, default=None,
                     help="live export destination (default: refresh_live_export.py's own default)")
    ap.add_argument("--skip-export", action="store_true",
                     help="compute + write products.db but don't run refresh_live_export.py "
                          "(tests use this against a throwaway db copy)")
    ap.add_argument("--no-backup", action="store_true",
                     help="skip the Phase 0 DB backup (tests use a throwaway db copy)")
    args = ap.parse_args(argv)

    db = args.db
    if not db.exists():
        log.error("DB not found: %s", db)
        sys.exit(1)

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    log.info("=== compute_reputation.py ===")
    log.info("DB: %s", db)

    if not args.no_backup:
        phase0_backup_and_ddl(db)
    else:
        # Tests still need the DDL (new columns/table) applied — just skip the copy.
        conn2 = sqlite3.connect(db)
        conn2.executescript(DDL_SIGNALS)
        existing = {r[1] for r in conn2.execute("PRAGMA table_info(products)")}
        for stmt in DDL_PRODUCTS_COLS:
            col = re.search(r'ADD COLUMN\s+(\w+)', stmt).group(1)
            if col not in existing:
                conn2.execute(stmt)
        conn2.commit()
        conn2.close()
    # Re-connect after DDL so row_factory sees new columns
    conn.close()
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    phase1_per_axis_scores(conn)
    phase2_rollup(conn)
    conn.close()

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    phase3_verify_and_export(conn, db_path=db, export_out=args.export_out, skip_export=args.skip_export)
    conn.close()


if __name__ == "__main__":
    main()
