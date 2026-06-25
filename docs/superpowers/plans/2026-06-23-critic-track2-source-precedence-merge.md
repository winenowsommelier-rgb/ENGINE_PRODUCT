# Critic Scores — Track 2: Source-Precedence Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `score_max`/`score_summary` computation out of the CSV loader into a standalone, all-sources merge that applies §16 source precedence (curated beats scraped), so supplier/scraper feeds (Tracks 3–4) are purely additive and can never silently erase each other's contribution.

**Architecture:** New module `lib/critic_reviews/refresh_products_summary.py` reads **all** `critic_scores` rows from `products.db`, groups by `sku`, applies §16 precedence to collapse multi-source duplicates, then full-re-derives `products.score_max` + `products.score_summary` for **every** SKU that has ≥1 critic_scores row (self-healing). The CSV loader (`scripts/load_critic_scores_from_csv.py`) stops computing the summary itself and calls this module after writing rows. Every future feed does the same.

**Tech Stack:** Python 3.9 (`from __future__ import annotations`), stdlib `sqlite3`/`json`, pytest. Pure-local, **$0 API spend**.

**Spec authority:** `docs/superpowers/specs/2026-06-16-critic-score-harvester-scrapy-design.md` §16 (precedence), §15 (rich schema — already applied), §11 (verification). Build sequence §18.2.

---

## Context the implementer must know (verified 2026-06-23)

- **Canonical DB is `data/db/products.db`** (NOT root `products.db`, which is 0 bytes). Always pass `--db` explicitly; the shared DB can be reverted by a parallel process between turns ([[feedback_shared_db_reverts_between_turns]]) — re-verify schema before trusting it.
- **The §15 rich schema is applied:** `critic_scores` has `source, score_native, score_scale, signal_class, signal_tier, confidence, supporting_text, producer, cuvee, fetched_at`; `sku` is nullable. 3,144 rows, all `source='magento_csv'`, tier 1, conf 1.0. 1,550 products badged.
- **Today's merge lives at** `scripts/load_critic_scores_from_csv.py::build_summary` (lines 54–77) and the write loop (lines 165–173). It recomputes from the CSV's in-memory rows only — it never reads the table. This is the coupling Track 2 removes.
- **`score_summary` JSON shape consumers depend on** (do NOT change keys):
  ```json
  {"critics":[{"abbr":"JS","critic":"James Suckling","score_native":"91","score_value":91.0}],
   "community":[],"medals":[],"primary_source":"magento_csv","rows_total":2,"computed_at":"...Z"}
  ```
- **Two consumers read it:**
  1. `lib/curation/scoring_engine.py::_web_freshness` — reads `score_max`; falls back to `max(float(c["score_native"]) for c in critics)`. **85-pt floor**, weight 0.2. `score_native` is a STRING.
  2. The catalog UI via the live export (`score_summary` column passed through `refresh_live_export.py`).
- **Rule 9:** after any DB write, `score_summary`/`score_max` only reach the UI after `scripts/refresh_live_export.py` runs. `score_summary` IS in that script's EXPORT_COLS (it's live today), so no allowlist change needed — but VERIFY ([[project_export_cols_allowlist]]).
- **Rule 1:** the destination that counts is the **live export** (Layer 3), not `critic_scores` row count, not the DB column.

## §16 precedence rules (the spec, restated precisely)

For one SKU, multiple `critic_scores` rows may exist for the same `(critic, score_scale)`. Collapse to ONE winning row per `(critic, score_scale)`:
1. **Higher `confidence` wins** → curated (1.0) always beats scraped (≤0.7).
2. Tie on confidence → **most recent `fetched_at`** wins.
3. Still tied → **lower `signal_tier`**, then **higher `score` (score_value)**.

Then build the §6 critics list from the winning rows: sort by `score_value` desc, cap at 5, `score_max = max(score_value)` over rows that are **tier ≤ 2 AND numeric scale** (matches the existing scoring-engine expectation; spec §16 "score_max from tier≤2 numeric"). Rows with `confidence < 0.5` are **excluded from the badge** entirely (spec §16).

After the precedence collapse, apply the **§6 rule-2 second dedup** on `(critic, score_native)` (spec §16: "Precedence runs first … then §6 rule 2 dedups the resulting list"). It is latent for current CSV-only data (verified 2026-06-23: zero same-`(sku,critic,score_scale)` duplicates), but Tracks 3/4 can add a second scale for the same critic, so implement it now rather than leave a known §16 gap.

## CRITICAL: preserve EXACT current JSON content (verified 2026-06-23)

The plan-review caught that a naive rebuild silently corrupts all 1,550 live badges. These facts are now ground truth and MUST be honored — the verification (Task 5) diffs full JSON content, not just the SKU set, to enforce them:

- **`abbr` is NOT a column** in `critic_scores`. The canonical map is the loader's `CRITICS` table (`scripts/load_critic_scores_from_csv.py:31-36`): `{"Wine Enthusiast":"WE","Wine Advocate":"WA","Wine Spectator":"WS","James Suckling":"JS"}`. **Never derive abbr from `critic[:2]`** (that yields "WI"/"WI"/"WI"/"JA"). Use the map; for an unknown future critic, fall back to **first letter of each capitalized word** (`"James Suckling"`→`"JS"`), never the first two chars.
- **`primary_source` today is `magento_csv_2026-06-15`** = the `added_by`/`SOURCE_TAG`, NOT the `source` column (`magento_csv`). To keep 1,550 summaries byte-identical, `refresh_all` must select `added_by` and `build_summary` must prefer it for `primary_source` (fall back to `source` only when `added_by` is NULL — e.g. future scraper rows).
- **`rows_total` today = count of that SKU's critic rows.** Keep it = number of critic entries that made it into the summary's `critics` list (post-merge, pre-cap winners that are badge-eligible), which equals the current value for CSV-only data (≤4 critics, no dupes). Document the meaning in the docstring.

## File Structure

- **Create:** `lib/critic_reviews/__init__.py` (empty package marker)
- **Create:** `lib/critic_reviews/refresh_products_summary.py` — the all-sources merge. Pure functions (`merge_for_sku`, `build_summary`) + a `refresh_all(conn)` driver + `__main__` CLI.
- **Create:** `tests/critic_reviews/unit/test_refresh_products_summary.py` — unit tests for precedence + summary shape (no DB).
- **Create:** `tests/critic_reviews/integration/test_refresh_products_summary_db.py` — round-trip against a temp copy of the schema.
- **Modify:** `scripts/load_critic_scores_from_csv.py` — delete `build_summary`, delete the write loop; after insert, call `refresh_products_summary.refresh_all(conn)`.
- **Reuse (do not modify):** `tests/critic_reviews/integration/test_critic_db_invariants.py` (Rule 6 guard — must still pass).

---

## Task 1: Package scaffold + pure precedence function (TDD)

**Files:**
- Create: `lib/critic_reviews/__init__.py`
- Create: `lib/critic_reviews/refresh_products_summary.py`
- Test: `tests/critic_reviews/unit/test_refresh_products_summary.py`

- [ ] **Step 1: Write the failing test for §16 precedence (curated beats scraped)**

```python
# tests/critic_reviews/unit/test_refresh_products_summary.py
from lib.critic_reviews.refresh_products_summary import merge_for_sku

# NOTE: rows have NO abbr key — abbr is derived in build_summary from the canonical
# map, never carried on the row (mirrors reality: critic_scores has no abbr column).
def _row(critic, score, conf, tier=1, scale="100pt", native=None,
         fetched="2026-01-01T00:00:00Z", source="magento_csv", added_by="magento_csv_2026-06-15"):
    return {"critic": critic, "score": score, "confidence": conf, "signal_tier": tier,
            "score_scale": scale, "score_native": native or str(int(score)),
            "fetched_at": fetched, "source": source, "added_by": added_by}

def test_curated_beats_scraped_same_critic_scale():
    rows = [_row("Wine Spectator", 90.0, 1.0, native="90"),
            _row("Wine Spectator", 93.0, 0.6, native="93")]  # scraped, higher score
    winners = merge_for_sku(rows)
    assert len(winners) == 1
    assert winners[0]["score"] == 90.0  # curated wins despite lower score

def test_tie_confidence_recency_wins():
    rows = [_row("WineAlign", 88.0, 1.0, fetched="2026-01-01T00:00:00Z"),
            _row("WineAlign", 91.0, 1.0, fetched="2026-06-01T00:00:00Z")]
    winners = merge_for_sku(rows)
    assert winners[0]["score"] == 91.0  # most recent

def test_low_confidence_excluded_from_badge():
    rows = [_row("Distiller", 92.0, 0.4)]  # below 0.5 threshold
    winners = merge_for_sku(rows)
    assert winners == []

def test_distinct_critics_all_kept():
    rows = [_row("James Suckling", 91.0, 1.0), _row("Wine Spectator", 90.0, 1.0)]
    winners = merge_for_sku(rows)
    assert {w["critic"] for w in winners} == {"James Suckling", "Wine Spectator"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/critic_reviews/unit/test_refresh_products_summary.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'lib.critic_reviews'`

- [ ] **Step 3: Create the package marker and implement `merge_for_sku`**

```python
# lib/critic_reviews/__init__.py  -> empty file
```

```python
# lib/critic_reviews/refresh_products_summary.py
"""All-sources merge: critic_scores -> products.score_max/score_summary (spec §16).

Reads EVERY critic_scores row, applies source precedence (curated beats scraped),
and full-re-derives the denormalized fields for every SKU with >=1 row. Pure-local,
NO API spend. Per Rule 9 the caller must run scripts/refresh_live_export.py after.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

BADGE_CONFIDENCE_FLOOR = 0.5   # spec §16: confidence < 0.5 excluded from badge
MAX_CRITICS = 5                # spec §6: 5-entry cap
SCORE_MAX_TIERS = {1, 2}       # spec §16: score_max from tier<=2 numeric only

# Canonical critic -> abbr (source of truth = loader CRITICS table). abbr is NOT a
# column on critic_scores, so it MUST be derived here, never from critic[:2].
CRITIC_ABBR = {
    "Wine Enthusiast": "WE",
    "Wine Advocate":   "WA",
    "Wine Spectator":  "WS",
    "James Suckling":  "JS",
}


def abbr_for(critic: str) -> str:
    """Canonical abbr; for an unknown future critic, first letter of each
    capitalized word (e.g. 'James Suckling' -> 'JS'), NEVER critic[:2]."""
    if critic in CRITIC_ABBR:
        return CRITIC_ABBR[critic]
    initials = "".join(w[0] for w in critic.split() if w and w[0].isupper())
    return (initials or critic[:2]).upper()


def _precedence_key(r: dict) -> tuple:
    # higher confidence, then more recent fetched_at, then lower tier, then higher score
    return (
        r.get("confidence") or 0.0,
        r.get("fetched_at") or "",
        -(r.get("signal_tier") or 99),
        r.get("score") or 0.0,
    )


def merge_for_sku(rows: list[dict]) -> list[dict]:
    """Collapse multi-source rows to one winner per (critic, score_scale), drop
    confidence < 0.5, then apply the §6 second dedup on (critic, score_native).
    Returns the winning rows (unsorted)."""
    eligible = [r for r in rows if (r.get("confidence") or 0.0) >= BADGE_CONFIDENCE_FLOOR]
    # step 1: §16 precedence collapse per (critic, score_scale)
    by_scale: dict[tuple, dict] = {}
    for r in eligible:
        key = (r["critic"], r.get("score_scale"))
        cur = by_scale.get(key)
        if cur is None or _precedence_key(r) > _precedence_key(cur):
            by_scale[key] = r
    # step 2: §6 rule-2 dedup on (critic, score_native) — keep highest-precedence
    by_native: dict[tuple, dict] = {}
    for r in by_scale.values():
        key = (r["critic"], r.get("score_native"))
        cur = by_native.get(key)
        if cur is None or _precedence_key(r) > _precedence_key(cur):
            by_native[key] = r
    return list(by_native.values())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/critic_reviews/unit/test_refresh_products_summary.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add lib/critic_reviews/__init__.py lib/critic_reviews/refresh_products_summary.py tests/critic_reviews/unit/test_refresh_products_summary.py
git commit -m "feat(critic-reviews): §16 source-precedence merge_for_sku (curated beats scraped)"
```

---

## Task 2: `build_summary` producing the consumer-compatible JSON shape (TDD)

**Files:**
- Modify: `lib/critic_reviews/refresh_products_summary.py`
- Test: `tests/critic_reviews/unit/test_refresh_products_summary.py`

- [ ] **Step 1: Write the failing test asserting the EXACT shape consumers expect**

```python
import json
from lib.critic_reviews.refresh_products_summary import build_summary, abbr_for

def test_abbr_map_canonical_and_fallback():
    assert abbr_for("Wine Enthusiast") == "WE"
    assert abbr_for("Wine Advocate") == "WA"
    assert abbr_for("Wine Spectator") == "WS"
    assert abbr_for("James Suckling") == "JS"
    # unknown future critic -> initials of capitalized words, NOT critic[:2]
    assert abbr_for("Natalie MacLean") == "NM"
    assert abbr_for("The Real Review") == "TRR"

def test_build_summary_shape_and_score_max():
    winners = [_row("James Suckling", 91.0, 1.0, native="91"),
               _row("Wine Spectator", 90.0, 1.0, native="90")]
    score_max, summary_json = build_summary(winners)
    assert score_max == 91.0
    data = json.loads(summary_json)
    assert [c["abbr"] for c in data["critics"]] == ["JS", "WS"]  # sorted desc by score
    assert data["critics"][0] == {"abbr": "JS", "critic": "James Suckling",
                                  "score_native": "91", "score_value": 91.0}
    assert data["community"] == [] and data["medals"] == []
    # primary_source comes from added_by (the dated tag), NOT the source column
    assert data["primary_source"] == "magento_csv_2026-06-15"
    assert data["rows_total"] == 2
    assert "computed_at" in data

def test_primary_source_falls_back_to_source_when_no_added_by():
    # future scraper rows have no added_by -> use the source column
    winners = [_row("Distiller", 92.0, 0.6, source="distiller", added_by=None)]
    _, summary_json = build_summary(winners)
    assert json.loads(summary_json)["primary_source"] == "distiller"

def test_score_max_excludes_tier3_plus():
    # a tier-3 community score of 95 must NOT raise score_max above the tier<=2 max
    winners = [_row("Wine Spectator", 90.0, 1.0, tier=1, native="90"),
               _row("CommunityAvg", 95.0, 0.7, tier=3, scale="community", native="95")]
    score_max, _ = build_summary(winners)
    assert score_max == 90.0

def test_caps_at_five_critics():
    winners = [_row(f"Critic{i}", 80.0 + i, 1.0) for i in range(8)]
    _, summary_json = build_summary(winners)
    assert len(json.loads(summary_json)["critics"]) == 5

def test_empty_winners_returns_none():
    assert build_summary([]) == (None, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/critic_reviews/unit/test_refresh_products_summary.py -k build_summary -v`
Expected: FAIL — `ImportError: cannot import name 'build_summary'`

- [ ] **Step 3: Implement `build_summary`**

```python
def _primary_source(winners: list[dict]) -> str | None:
    """The dated added_by tag preserves the current value (magento_csv_2026-06-15);
    fall back to the source column for feeds with no added_by (scraper rows)."""
    tags = [w.get("added_by") for w in winners if w.get("added_by")]
    if tags:
        return sorted(tags)[0]
    sources = [w.get("source") for w in winners if w.get("source")]
    return sorted(sources)[0] if sources else None


def build_summary(winners: list[dict]) -> tuple[float | None, str | None]:
    """From precedence winners, build (score_max, score_summary_json) in the shape
    consumers expect. abbr is derived from the canonical map (NEVER critic[:2]).
    rows_total = number of badge entries in the critics list (post-merge, pre-cap).
    Returns (None, None) when there are no badge-eligible rows."""
    if not winners:
        return None, None
    critics = sorted(
        ({"abbr": abbr_for(w["critic"]),
          "critic": w["critic"],
          "score_native": w.get("score_native") or "",
          "score_value": float(w["score"])}
         for w in winners),
        key=lambda c: -c["score_value"],
    )[:MAX_CRITICS]
    numeric_tier12 = [
        w["score"] for w in winners
        if (w.get("signal_tier") in SCORE_MAX_TIERS)
        and (w.get("score_scale") or "").endswith("pt")
    ]
    score_max = max(numeric_tier12) if numeric_tier12 else None
    summary = {
        "critics": critics,
        "community": [],
        "medals": [],
        "primary_source": _primary_source(winners),
        "rows_total": len(winners),
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    return score_max, json.dumps(summary, ensure_ascii=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/critic_reviews/unit/test_refresh_products_summary.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add lib/critic_reviews/refresh_products_summary.py tests/critic_reviews/unit/test_refresh_products_summary.py
git commit -m "feat(critic-reviews): build_summary emits consumer-compatible score_summary JSON"
```

---

## Task 3: `refresh_all(conn)` driver + CLI — full re-derive over the table (TDD)

**Files:**
- Modify: `lib/critic_reviews/refresh_products_summary.py`
- Test: `tests/critic_reviews/integration/test_refresh_products_summary_db.py`

- [ ] **Step 1: Write the failing integration test (temp DB, real schema)**

```python
# tests/critic_reviews/integration/test_refresh_products_summary_db.py
import sqlite3, json, uuid
import pytest
from lib.critic_reviews.refresh_products_summary import refresh_all

SCHEMA = """
CREATE TABLE products (sku TEXT PRIMARY KEY, score_max REAL, score_summary TEXT);
CREATE TABLE critic_scores (
  id TEXT PRIMARY KEY, sku TEXT, critic TEXT NOT NULL, score REAL NOT NULL,
  score_max REAL DEFAULT 100, vintage TEXT, tasting_year INTEGER, source_url TEXT,
  notes TEXT, added_by TEXT, source TEXT, score_native TEXT, score_scale TEXT,
  signal_class TEXT, signal_tier INTEGER, confidence REAL, supporting_text TEXT,
  producer TEXT, cuvee TEXT, fetched_at TEXT
);
"""

def _conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA)
    return c

def _ins(c, **kw):
    kw.setdefault("id", str(uuid.uuid4()))
    cols = ",".join(kw); ph = ",".join("?" for _ in kw)
    c.execute(f"INSERT INTO critic_scores ({cols}) VALUES ({ph})", tuple(kw.values()))

def test_refresh_writes_score_max_and_summary():
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku="SKU1", critic="James Suckling", score=91.0, source="magento_csv",
         added_by="magento_csv_2026-06-15", score_native="91", score_scale="100pt",
         signal_tier=1, confidence=1.0, fetched_at="2026-01-01T00:00:00Z")
    n = refresh_all(c)
    row = c.execute("SELECT score_max, score_summary FROM products WHERE sku='SKU1'").fetchone()
    assert row[0] == 91.0
    data = json.loads(row[1])
    assert data["critics"][0]["abbr"] == "JS"            # canonical abbr, not "JA"
    assert data["primary_source"] == "magento_csv_2026-06-15"  # added_by, not source col
    assert n == 1

def test_curated_beats_scraped_endtoend():
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku="SKU1", critic="Wine Spectator", score=90.0, source="magento_csv",
         score_native="90", score_scale="100pt", signal_tier=1, confidence=1.0,
         fetched_at="2026-01-01T00:00:00Z")
    _ins(c, sku="SKU1", critic="Wine Spectator", score=93.0, source="wine_enthusiast",
         score_native="93", score_scale="100pt", signal_tier=2, confidence=0.6,
         fetched_at="2026-06-01T00:00:00Z")
    refresh_all(c)
    summ = json.loads(c.execute("SELECT score_summary FROM products WHERE sku='SKU1'").fetchone()[0])
    ws = [x for x in summ["critics"] if x["critic"] == "Wine Spectator"]
    assert len(ws) == 1 and ws[0]["score_value"] == 90.0  # curated kept, scraped dropped

def test_self_healing_clears_orphaned_summary():
    # a product with a summary but NO critic_scores rows must be reset to NULL
    c = _conn()
    c.execute("INSERT INTO products(sku, score_max, score_summary) VALUES ('STALE', 88.0, '{\"x\":1}')")
    refresh_all(c)
    row = c.execute("SELECT score_max, score_summary FROM products WHERE sku='STALE'").fetchone()
    assert row == (None, None)

def test_nullable_sku_rows_ignored_for_product_update():
    # scraped rows that haven't bound to a SKU (sku IS NULL) must not crash refresh
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku=None, critic="Distiller", score=92.0, source="distiller",
         score_native="92", score_scale="100pt", signal_tier=2, confidence=0.6,
         fetched_at="2026-06-01T00:00:00Z")
    n = refresh_all(c)  # must not raise; SKU1 has no rows -> NULL
    assert c.execute("SELECT score_summary FROM products WHERE sku='SKU1'").fetchone()[0] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration/test_refresh_products_summary_db.py -v`
Expected: FAIL — `ImportError: cannot import name 'refresh_all'`

- [ ] **Step 3: Implement `refresh_all` + CLI**

```python
_SELECT_ALL = """
SELECT sku, critic, score, source, score_native, score_scale,
       signal_class, signal_tier, confidence, fetched_at, added_by
FROM critic_scores
WHERE sku IS NOT NULL AND sku != ''
"""

def refresh_all(conn: sqlite3.Connection) -> int:
    """Full re-derive: for every SKU with >=1 bound critic_scores row, recompute
    score_max/score_summary via §16 precedence; reset SKUs with no rows to NULL.
    Self-healing. Returns the number of SKUs written with a non-NULL summary."""
    rows_by_sku: dict[str, list[dict]] = {}
    for r in conn.execute(_SELECT_ALL):
        d = {"sku": r[0], "critic": r[1], "score": r[2], "source": r[3],
             "score_native": r[4], "score_scale": r[5], "signal_class": r[6],
             "signal_tier": r[7], "confidence": r[8], "fetched_at": r[9],
             "added_by": r[10]}
        rows_by_sku.setdefault(r[0], []).append(d)

    written = 0
    # 1) reset every product that currently has a summary but no rows (self-heal)
    conn.execute(
        "UPDATE products SET score_max = NULL, score_summary = NULL "
        "WHERE (score_summary IS NOT NULL OR score_max IS NOT NULL) "
        "AND sku NOT IN (SELECT DISTINCT sku FROM critic_scores WHERE sku IS NOT NULL AND sku != '')"
    )
    # 2) recompute for every SKU that has rows
    for sku, rows in rows_by_sku.items():
        winners = merge_for_sku(rows)
        score_max, summary = build_summary(winners)
        conn.execute(
            "UPDATE products SET score_max = ?, score_summary = ? WHERE sku = ?",
            (score_max, summary, sku),
        )
        if summary is not None:
            written += 1
    conn.commit()
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Re-derive products.score_max/score_summary from all critic_scores sources (§16).")
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = ap.parse_args(argv)
    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(args.db)
    n = refresh_all(conn)
    print(f"Re-derived score_max/score_summary for {n} products with badge-eligible critic scores.")
    print("Rule 9: now run  .venv/bin/python scripts/refresh_live_export.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration/test_refresh_products_summary_db.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add lib/critic_reviews/refresh_products_summary.py tests/critic_reviews/integration/test_refresh_products_summary_db.py
git commit -m "feat(critic-reviews): refresh_all full re-derive over all sources (self-healing)"
```

---

## Task 4: Refactor the CSV loader to call the shared merge (TDD via existing invariant)

**Files:**
- Modify: `scripts/load_critic_scores_from_csv.py` (delete `build_summary` lines 54–77; replace write loop lines 165–173)
- Verify: `tests/critic_reviews/integration/test_critic_db_invariants.py` (must still pass)

- [ ] **Step 1: Confirm the Rule-6 invariant is green BEFORE the refactor (baseline)**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration/test_critic_db_invariants.py -v`
Expected: PASS (5 passed) — this is the regression guard for the refactor.

- [ ] **Step 2: Edit the loader — import the shared merge, delete the embedded summary**

In `scripts/load_critic_scores_from_csv.py`:
- Add near the top imports: `from lib.critic_reviews import refresh_products_summary`
- DELETE the `build_summary` function (lines 54–77).
- REPLACE the write loop (lines 165–173, the `for sku in binding_skus:` block) with:

```python
    conn.commit()  # ensure inserted critic_scores rows are visible to the merge
    updated = refresh_products_summary.refresh_all(conn)
```

- Update the final print to read `updated` (now = SKUs with a non-NULL summary across ALL sources, not just this CSV's binding SKUs). Adjust the message so it doesn't claim CSV-only semantics.

> Make sure `lib` is importable when the script runs from repo root: the script is invoked as `.venv/bin/python scripts/load_critic_scores_from_csv.py`; add `sys.path.insert(0, str(ROOT))` after `ROOT` is defined if `lib` isn't already on the path. Verify with Step 4.

- [ ] **Step 3: Add a loader regression test asserting it delegates (no embedded build_summary)**

```python
# in tests/critic_reviews/integration/test_refresh_products_summary_db.py (or a loader test)
def test_loader_no_longer_defines_build_summary():
    import scripts.load_critic_scores_from_csv as loader
    assert not hasattr(loader, "build_summary"), "build_summary must be removed; merge is shared now"
```

- [ ] **Step 4: Run the loader against a temp COPY of the real DB, verify badges preserved**

```bash
cp data/db/products.db /tmp/t2_test.db
# re-run the existing CSV load against the copy (find the CSV the loader expects):
.venv/bin/python scripts/load_critic_scores_from_csv.py <path-to-magento-score.csv> --db /tmp/t2_test.db
.venv/bin/python3 -c "import sqlite3; c=sqlite3.connect('/tmp/t2_test.db'); print('badges:', c.execute(\"SELECT count(*) FROM products WHERE score_summary IS NOT NULL AND score_summary!=''\").fetchone()[0])"
```
Expected: `badges: 1550` (unchanged — the refactor is behavior-preserving for the CSV-only case).

> If the original CSV path is unknown, instead drive `refresh_all` directly on the copy and assert 1,550 — see Step 5. The invariant test (Step 6) is the load-bearing check either way.

- [ ] **Step 5: Run `refresh_all` standalone on a copy and confirm 1,550 (no CSV needed)**

```bash
cp data/db/products.db /tmp/t2_refresh.db
.venv/bin/python -m lib.critic_reviews.refresh_products_summary --db /tmp/t2_refresh.db
.venv/bin/python3 -c "import sqlite3; c=sqlite3.connect('/tmp/t2_refresh.db'); print('badges:', c.execute(\"SELECT count(*) FROM products WHERE score_summary IS NOT NULL AND score_summary!=''\").fetchone()[0])"
```
Expected: `badges: 1550` — proves the all-sources merge reproduces the current badge set exactly from the live table.

- [ ] **Step 6: Run alllll critic tests + scoring-engine regression**

Run: `.venv/bin/python -m pytest tests/critic_reviews/ tests/curation/test_scoring_engine.py -v`
Expected: PASS (invariant 5 + new unit/integration + scoring engine 9).

- [ ] **Step 7: Commit**

```bash
git add scripts/load_critic_scores_from_csv.py tests/critic_reviews/
git commit -m "refactor(critic-reviews): CSV loader delegates merge to refresh_products_summary (all-sources)"
```

---

## Task 5: Apply on the real DB + Rule 1/9 destination verification

**Files:** none (operational). High-risk: writes the canonical `products.db` and live export.

- [ ] **Step 1: Rule 10 backup**

```bash
cp data/db/products.db "data/db/products.db.bak-pre-track2-$(date +%Y%m%d)"
ls -la data/db/products.db.bak-pre-track2-*
```

- [ ] **Step 2: W5 guard — confirm score_max is critic-exclusive before the self-healing reset**

```bash
sqlite3 data/db/products.db "SELECT count(*) FROM products WHERE (score_summary IS NOT NULL OR score_max IS NOT NULL) AND sku NOT IN (SELECT sku FROM critic_scores WHERE sku IS NOT NULL AND sku != '');"
```
Expected: `0`. **If this is > 0, STOP** — another pipeline populates `score_max`/`score_summary` and the self-healing UPDATE would erase it. Reconcile before running (verified 0 on 2026-06-23).

- [ ] **Step 3: Snapshot full badge JSON content BEFORE (sku + summary, not just the SKU set)**

```bash
sqlite3 data/db/products.db "SELECT sku||'|'||score_summary FROM products WHERE score_summary IS NOT NULL AND score_summary!='' ORDER BY sku;" > /tmp/t2_content_pre.txt
wc -l /tmp/t2_content_pre.txt   # expect 1550
```

- [ ] **Step 4: Run the standalone refresh on the real DB**

```bash
.venv/bin/python -m lib.critic_reviews.refresh_products_summary --db data/db/products.db
```

- [ ] **Step 4b: Assert badge JSON content IDENTICAL except the volatile `computed_at` (W1 — content, not just SKU set)**

```bash
sqlite3 data/db/products.db "SELECT sku||'|'||score_summary FROM products WHERE score_summary IS NOT NULL AND score_summary!='' ORDER BY sku;" > /tmp/t2_content_post.txt
# computed_at is regenerated each run by design — strip it before diffing so only
# real content changes (abbr, primary_source, critics, score_max) surface.
# NOTE the ': *' — json.dumps emits a space after the colon ("computed_at": "...");
# a no-space pattern would match nothing and make this check always (falsely) fail.
sed -E 's/"computed_at": *"[^"]*"//' /tmp/t2_content_pre.txt  > /tmp/t2_content_pre.norm
sed -E 's/"computed_at": *"[^"]*"//' /tmp/t2_content_post.txt > /tmp/t2_content_post.norm
diff /tmp/t2_content_pre.norm /tmp/t2_content_post.norm && echo "CONTENT IDENTICAL ✓"
```
Expected: `CONTENT IDENTICAL ✓`. This is the check that catches the abbr/primary_source corruption the plan-review found — a SKU-set diff alone would pass even if every label were rewritten. Row count must also still be 1,550.

- [ ] **Step 5: Rule 9 — refresh live export + Layer-3 probe (the number that matters)**

```bash
.venv/bin/python scripts/refresh_live_export.py
.venv/bin/python3 -c "import json;print('layer3 score_summary:', sum(1 for p in json.load(open('data/live_products_export.json')) if p.get('score_summary')))"
```
Expected: `layer3 score_summary: 1550`.

- [ ] **Step 6: Re-run the Rule-6 invariant against the live DB**

Run: `.venv/bin/python -m pytest tests/critic_reviews/integration/test_critic_db_invariants.py -v`
Expected: PASS (5).

- [ ] **Step 7: Verify commit scope (worktree-isolation lesson) and commit/PR**

```bash
git status --short        # confirm ONLY critic-review files staged, no stray parallel-process files
git log --oneline -6
```
Then follow superpowers:finishing-a-development-branch.

---

## Verification summary (maps to CLAUDE.md rules)

- **Rule 1 (verify at destination):** Task 5 Step 5 — Layer-3 live-export count = 1,550, not a `critic_scores` row count.
- **Rule 4 (what shipped):** the CLI prints SKUs with badge-eligible scores; Track 2 ships 0 net-new (structural change), 1,550 preserved. $0 spend.
- **Rule 6 (invariant):** `test_critic_db_invariants.py` green before AND after the refactor (Task 4 Step 1, Task 5 Step 6).
- **Rule 9 (export refresh):** Task 5 Step 5 runs `refresh_live_export.py`.
- **Rule 10 (backup/canary):** Task 5 Step 1 backup; Tasks 4 Steps 4–5 run on temp DB copies first (canary).
- **§16 correctness:** Tasks 1–3 unit + integration tests prove curated-beats-scraped, recency tiebreak, <0.5 exclusion, tier-≤2 score_max, self-healing, nullable-sku safety.

## Out of scope (deliberately, per §18 sequencing)

- Writing any scraped or supplier rows (Tracks 3/4) — Track 2 only changes HOW the merge runs, with the table still containing CSV-only rows. The curated-beats-scraped path is proven by unit/integration tests using synthetic scraped rows, not by writing real ones.
- Changing `score_summary` JSON keys, the scoring engine, or the catalog UI.
