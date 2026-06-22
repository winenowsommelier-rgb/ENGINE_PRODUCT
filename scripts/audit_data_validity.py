#!/usr/bin/env python3
"""Read-only data-validity audit for the product database.

Runs a battery of checks across four dimensions and prints a categorized report
with counts + sample offenders. NO API spend, NO writes. One-off diagnostic.

Dimensions
----------
  STRUCTURAL   — nulls, dups, mixed-type columns, malformed JSON, bad formats
  COMPLETENESS — per-category fill rate of the user-facing attributes
  PRICING      — numeric price/cost sanity, real (not string-quirk) margin issues
  ATTRIBUTE    — values that don't make sense for the product (whisky w/ a wine
                 region & grape, ABV out of range, country/region disagreeing
                 with the name, SKU-group vs classification mismatch)
  DRIFT        — does live_products_export.json faithfully reflect products.db?

Usage:  .venv/bin/python scripts/audit_data_validity.py [--db PATH] [--export PATH]
        add --samples N to change how many example offenders print (default 5).
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_EXPORT = REPO_ROOT / "data" / "live_products_export.json"

# Optional helpers — degrade gracefully if unavailable (audit must still run).
try:
    from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_cat
except Exception:  # noqa: BLE001
    _resolve_cat = None
try:
    from data.lib.name_inference.rules import infer_from_name as _infer
except Exception:  # noqa: BLE001
    _infer = None

# Attributes that are user-facing per category (what the catalog/finder show).
# Used for fill-rate. Keyed by category_group; "*" applies to all.
USER_FIELDS = {
    "*": ["name", "price", "image_url", "country", "desc_en_short"],
    "Wine": ["region", "grape_variety", "wine_color", "wine_body", "food_matching",
             "flavor_tags", "taste_profile"],
    "Whisky": ["region", "flavor_tags", "taste_profile"],
    "Spirits": ["flavor_tags"],
    "Sake & Asian": ["flavor_tags"],
}
# Hard spirits should NOT carry wine-only attributes.
WINE_ONLY_ATTRS = ["grape_variety", "wine_color", "wine_body", "wine_acidity", "wine_tannin"]
JSON_COLS = ["taste_profile", "flavor_tags", "food_matching"]

SEP = "=" * 72


def _num(v):
    """Coerce to float if it's a real number (or numeric string); else None."""
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and v.strip():
        try:
            return float(v.replace(",", ""))
        except ValueError:
            return None
    return None


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


class Report:
    """Accumulates findings so the summary can rank by severity at the end."""
    def __init__(self, samples: int):
        self.samples = samples
        self.findings: list[tuple[str, str, int, list]] = []  # (sev, label, count, examples)

    def add(self, sev: str, label: str, count: int, examples=None):
        self.findings.append((sev, label, count, list(examples or [])[: self.samples]))

    def section(self, title: str):
        print(f"\n{SEP}\n  {title}\n{SEP}")

    def line(self, sev: str, label: str, count: int, examples=None, total: int | None = None):
        self.add(sev, label, count, examples)
        pct = f" ({count / total * 100:.1f}%)" if total else ""
        flag = {"CRITICAL": "🔴", "WARNING": "🟠", "INFO": "🔵", "OK": "🟢"}.get(sev, "  ")
        print(f"  {flag} [{sev:8}] {label:48} {count:>6}{pct}")
        for ex in (examples or [])[: self.samples]:
            print(f"               · {ex}")

    def summary(self):
        print(f"\n{SEP}\n  SUMMARY (by severity)\n{SEP}")
        for sev in ["CRITICAL", "WARNING", "INFO"]:
            rows = [f for f in self.findings if f[0] == sev and f[2] > 0]
            if not rows:
                continue
            print(f"\n  {sev}:")
            for _, label, count, _ex in sorted(rows, key=lambda r: -r[2]):
                print(f"    - {label}: {count}")
        print(f"\n  → {self.n_critical()} CRITICAL issue type(s), "
              f"{sum(1 for f in self.findings if f[0] == 'WARNING' and f[2] > 0)} "
              f"WARNING issue type(s).")

    def n_critical(self) -> int:
        """Number of CRITICAL finding TYPES with a non-zero count. Used by the
        pipeline guard (--strict) to decide whether to fail."""
        return sum(1 for f in self.findings if f[0] == "CRITICAL" and f[2] > 0)


def load_db(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cols = [r[1] for r in conn.execute("PRAGMA table_info(products)")]
    rows = [dict(r) for r in conn.execute(f"SELECT * FROM products")]
    conn.close()
    return rows, cols


def check_structural(rows, cols, rep: Report):
    rep.section("1. STRUCTURAL INTEGRITY")
    n = len(rows)
    # Duplicate / blank SKUs
    skus = [r.get("sku") for r in rows]
    blank_sku = [r for r in rows if _blank(r.get("sku"))]
    dups = [s for s, c in collections.Counter(skus).items() if c > 1 and s]
    rep.line("CRITICAL" if blank_sku else "OK", "blank/null SKU", len(blank_sku),
             [r.get("name") for r in blank_sku])
    rep.line("CRITICAL" if dups else "OK", "duplicate SKU", len(dups), dups)
    rep.line("CRITICAL" if any(_blank(r.get("name")) for r in rows) else "OK",
             "blank/null name", sum(1 for r in rows if _blank(r.get("name"))))

    # Mixed-type columns: a numeric column polluted with empty-string '' (the
    # cost-column trap — SQL comparisons silently misbehave). Flag any numeric
    # field that has BOTH real numbers and non-empty-but-nonnumeric strings, OR
    # empty strings mixed with numbers.
    numeric_cols = ["price", "cost", "alcohol", "margin_pct", "b2b_margin_pct",
                    "quantity_in_stock", "popularity_score", "score_max"]
    for c in [c for c in numeric_cols if c in cols]:
        empties = sum(1 for r in rows if r.get(c) == "")
        nums = sum(1 for r in rows if isinstance(r.get(c), (int, float)))
        if empties and nums:
            rep.line("WARNING", f"mixed-type column '{c}' (''+numbers)", empties,
                     total=n)

    # Malformed JSON columns
    for c in [c for c in JSON_COLS if c in cols]:
        bad = []
        for r in rows:
            v = r.get(c)
            if isinstance(v, str) and v.strip() and v.strip()[0] in "[{":
                try:
                    json.loads(v)
                except (ValueError, TypeError):
                    bad.append(r.get("sku"))
        rep.line("WARNING" if bad else "OK", f"malformed JSON in '{c}'", len(bad), bad)

    # Bottle size / vintage format sanity (cheap format checks)
    bad_alc = [r.get("sku") for r in rows
               if (a := _num(r.get("alcohol"))) is not None and not (0 <= a <= 100)]
    rep.line("WARNING" if bad_alc else "OK", "alcohol % out of [0,100]", len(bad_alc), bad_alc)


def check_completeness(rows, rep: Report):
    rep.section("2. COMPLETENESS / FILL-RATE (by category_group)")
    by_group = collections.defaultdict(list)
    for r in rows:
        g = r.get("category_group")
        if not g and _resolve_cat:
            g = _resolve_cat(r).get("group")
        by_group[g or "Unknown"].append(r)
    for g in sorted(by_group, key=lambda k: -len(by_group[k])):
        grp_rows = by_group[g]
        fields = list(dict.fromkeys(USER_FIELDS["*"] + USER_FIELDS.get(g, [])))
        print(f"\n  {g}  (n={len(grp_rows)})")
        for f in fields:
            filled = sum(1 for r in grp_rows if not _blank(r.get(f)))
            pct = filled / len(grp_rows) * 100
            sev = "  " if pct >= 90 else ("🟠" if pct >= 50 else "🔴")
            print(f"      {sev} {f:20} {filled:>6}/{len(grp_rows):<6} {pct:5.1f}%")


def check_pricing(rows, rep: Report):
    rep.section("3. PRICING / BUSINESS-LOGIC")
    n = len(rows)
    # REAL price<cost — only when cost is a genuine number > 0 (not the '' trap).
    real_leak = [r.get("sku") for r in rows
                 if (c := _num(r.get("cost"))) and c > 0
                 and (p := _num(r.get("price"))) is not None and p < c]
    rep.line("CRITICAL" if real_leak else "OK", "REAL price < cost (numeric)", len(real_leak), real_leak)
    # Negative / zero price
    badp = [r.get("sku") for r in rows
            if (p := _num(r.get("price"))) is not None and p <= 0]
    rep.line("CRITICAL" if badp else "OK", "price <= 0", len(badp), badp)
    # Negative margin where margin is populated numerically
    negm = [r.get("sku") for r in rows
            if (m := _num(r.get("margin_pct"))) is not None and m < 0]
    rep.line("WARNING" if negm else "OK", "negative margin_pct", len(negm), negm)
    # is_in_stock string gotcha — should be "0"/"1"/None, never anything else.
    bad_stock = [r.get("sku") for r in rows
                 if r.get("is_in_stock") not in (None, "", "0", "1", 0, 1)]
    rep.line("WARNING" if bad_stock else "OK", "is_in_stock not in {0,1,null}",
             len(bad_stock), [f"{r}" for r in
                              {str(x.get('is_in_stock')) for x in rows
                               if x.get('is_in_stock') not in (None, '', '0', '1', 0, 1)}])


def check_attributes(rows, rep: Report):
    rep.section("4. ATTRIBUTE CORRECTNESS")
    n = len(rows)
    # Resolve group for each row (prefer stored, else SKU).
    def group(r):
        g = r.get("category_group")
        if not g and _resolve_cat:
            g = _resolve_cat(r).get("group")
        return g or "Unknown"

    # 4a. Hard spirits carrying wine-only attributes (grape, body, tannin...).
    spirit_with_wine_attr = []
    for r in rows:
        if group(r) in ("Whisky", "Spirits"):
            present = [a for a in WINE_ONLY_ATTRS if not _blank(r.get(a))]
            if present:
                spirit_with_wine_attr.append(f"{r.get('sku')} {group(r)} has {present}")
    rep.line("WARNING" if spirit_with_wine_attr else "OK",
             "spirit/whisky with wine-only attrs", len(spirit_with_wine_attr),
             spirit_with_wine_attr)

    # 4b. classification == 'Wine product' (known junk bucket; advisory).
    junk = [r.get("sku") for r in rows if (r.get("classification") or "") == "Wine product"]
    rep.line("INFO", "classification = 'Wine product' (junk bucket)", len(junk), junk)

    # 4c. SKU-derived group vs Magento classification family disagreement.
    #     Advisory only (code trusts SKU; this is a human cleanup list).
    if _resolve_cat:
        # Map a few obvious classification families to expected groups.
        WINEY = {"red wine", "white wine", "rose wine", "sparkling wine", "wine"}
        mismatch = []
        for r in rows:
            cls = (r.get("classification") or "").strip().lower()
            g = group(r)
            if cls in WINEY and g not in ("Wine",):
                mismatch.append(f"{r.get('sku')} class='{r.get('classification')}' but group={g}")
        rep.line("WARNING" if mismatch else "OK",
                 "classification says Wine but SKU-group isn't", len(mismatch), mismatch)

    # 4d. country/region disagrees with what the NAME implies (uses name-inference).
    if _infer:
        conflicts = []
        checked = 0
        for r in rows:
            name = r.get("name") or ""
            cls = r.get("classification") or ""
            inf = _infer(name, cls)
            if inf.get("suppressed") or inf.get("confidence", 0) < 0.8:
                continue
            checked += 1
            ic, rc = inf.get("country", ""), r.get("country") or ""
            if ic and rc and ic.lower() != rc.lower():
                conflicts.append(f"{r.get('sku')} name→{ic}, stored→{rc} | {name[:40]}")
        rep.line("WARNING" if conflicts else "OK",
                 f"country contradicts name (hi-conf, of {checked} checked)",
                 len(conflicts), conflicts)


def check_drift(db_rows, export_path: Path, rep: Report):
    rep.section("5. DB ↔ EXPORT DRIFT")
    if not export_path.exists():
        rep.line("WARNING", "export file missing", 1, [str(export_path)])
        return
    exp = json.loads(export_path.read_text())
    db_by_sku = {r.get("sku"): r for r in db_rows}
    exp_by_sku = {r.get("sku"): r for r in exp}
    rep.line("INFO", "rows in DB", len(db_rows))
    rep.line("INFO", "rows in export", len(exp))
    only_db = set(db_by_sku) - set(exp_by_sku)
    only_exp = set(exp_by_sku) - set(db_by_sku)
    rep.line("WARNING" if only_db else "OK", "SKUs in DB but NOT export", len(only_db), list(only_db))
    rep.line("WARNING" if only_exp else "OK", "SKUs in export but NOT DB", len(only_exp), list(only_exp))
    # Field-level drift on shared SKUs for a few load-bearing fields.
    fields = ["name", "price", "country", "region", "is_in_stock"]
    drift = collections.Counter()
    examples = collections.defaultdict(list)
    for sku in set(db_by_sku) & set(exp_by_sku):
        d, e = db_by_sku[sku], exp_by_sku[sku]
        for f in fields:
            dv, ev = d.get(f), e.get(f)
            # Normalize blank-ish for comparison
            if _blank(dv) and _blank(ev):
                continue
            if str(dv) != str(ev) and not (_num(dv) is not None and _num(dv) == _num(ev)):
                drift[f] += 1
                if len(examples[f]) < rep.samples:
                    examples[f].append(f"{sku}: db={dv!r} exp={ev!r}")
    for f in fields:
        # region drift is EXPECTED if sku_overrides clears/changes it; flag as INFO.
        sev = "INFO" if f == "region" else ("WARNING" if drift[f] else "OK")
        rep.line(sev, f"drift in '{f}'", drift[f], examples[f])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--export", type=Path, default=DEFAULT_EXPORT)
    ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--strict", action="store_true",
                    help="exit non-zero if any CRITICAL issue type is found "
                         "(for use as a pipeline guard after a bulk write)")
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    print(f"{SEP}\n  DATA VALIDITY AUDIT\n  db={args.db}\n  export={args.export}\n{SEP}")
    rows, cols = load_db(args.db)
    print(f"  loaded {len(rows)} rows, {len(cols)} columns")
    print(f"  helpers: sku_taxonomy={'yes' if _resolve_cat else 'NO'}, "
          f"name_inference={'yes' if _infer else 'NO'}")

    rep = Report(args.samples)
    check_structural(rows, cols, rep)
    check_completeness(rows, rep)
    check_pricing(rows, rep)
    check_attributes(rows, rep)
    check_drift(rows, args.export, rep)
    rep.summary()
    print(f"\n{SEP}\n  Read-only audit complete. No data was modified.\n{SEP}")
    if args.strict and rep.n_critical() > 0:
        print(f"  STRICT: {rep.n_critical()} CRITICAL issue type(s) — failing.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
