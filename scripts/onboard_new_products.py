#!/usr/bin/env python3
"""Onboard in-stock mf-only beverages as sellable products. See spec 2026-06-25."""
from __future__ import annotations
import re
import sys
import json
import datetime
import sqlite3
import argparse
from pathlib import Path
from collections import Counter

# Repo root so `scripts.*` and `data.lib.*` imports resolve when run as a script.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

DEFAULT_DB = "data/db/products.db"
DEFAULT_CSV = ("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
               "Masterfile Data WNLQ9 - MReport Masterfile.csv")
PREFLIGHT_JSON = "data/onboard_preflight_report.json"
PREFLIGHT_MD = "data/onboard_preflight_report.md"
ENRICHMENT_SOURCE = "masterfile_onboard_2026-06-25"

# Resolver TYPE values that are NOT sellable beverages — excluded silently.
ACCESSORY_TYPES = {
    "Bar Tools & Gifts", "Glassware", "Cigar", "Wine Coolers & Fridges",
    "Event", "Wine Set", "Mixer / Soft", "Tonic / Mineral Water",
}


def parse_money(v) -> float | None:
    if v is None:
        return None
    s = re.sub(r"[^\d.\-]", "", str(v))          # strip ฿, commas, spaces
    if s in ("", "-", ".", "--"):
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f


def pct_str(ratio: float | None) -> str | None:
    """Format a ratio as production's pct column does.

    VERIFIED 2026-06-25 against data/db/products.db (11,298 non-null margin_pct
    rows, 3000-row sample): production stores margin_pct / b2b_margin_pct /
    sp_discount_pct as a BARE 2-decimal percent NUMBER stored as TEXT — e.g.
    '31.43', '30.0', '20.4' — NOT an integer 'NN%' string and NOT a '0.31' float.
    `str(round(ratio*100, 2))` reproduced all 3000 sampled rows exactly (0
    mismatches). Only 36/11,298 rows carry a literal '%' and are legacy junk.

    The original task-spec format ('27%') disagreed with the live DB; this
    helper writes a payment-path field, so production format wins (CLAUDE.md
    Rule 1 verify-don't-infer, Rule 5 don't-lock-in-a-bug). The
    test_recompute_matches_existing_db_row invariant guards this.

    Rounding mode = round() (banker's / half-to-even); it matched production
    exactly, so no ROUND_HALF_UP override was needed.
    """
    if ratio is None:
        return None
    return str(round(ratio * 100, 2))


def recompute_margins(cost, price, special_price, b2b_price) -> dict:
    """All derived from INPUT cost/price/b2b. File's own margin cells are ignored."""
    out = {"margin_thb": None, "margin_pct": None, "sp_discount_pct": None,
           "b2b_margin_thb": None, "b2b_margin_pct": None, "b2b_discount_pct": None}
    if cost is not None and price:
        out["margin_thb"] = round(price - cost, 2)
        out["margin_pct"] = pct_str((price - cost) / price) if price > 0 else None
    if special_price and price and price > 0:
        out["sp_discount_pct"] = pct_str((price - special_price) / price)
    if b2b_price and cost is not None:
        out["b2b_margin_thb"] = round(b2b_price - cost, 2)
        out["b2b_margin_pct"] = pct_str((b2b_price - cost) / b2b_price) if b2b_price > 0 else None
        if price and price > 0:
            out["b2b_discount_pct"] = pct_str((price - b2b_price) / price)
    return out


def _existing_skus(db_path: str) -> set[str]:
    """Read-only fetch of the SKUs already present in products. URI ro mode so
    a candidate-selection run can NEVER mutate the canonical DB (Rule 1/9)."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return {r[0] for r in con.execute("SELECT sku FROM products")}
    finally:
        con.close()


def select_candidates(db_path: str = DEFAULT_DB, csv_path: str = DEFAULT_CSV):
    """Select in-stock, mf-only, sellable beverages. Reads ONLY (DB ro + CSV).

    Returns (candidates, report). Writes nothing. A candidate is a masterfile
    row whose SKU is NOT already in products, is_in_stock=='1', resolver TYPE is
    a real beverage (not an accessory, not Unknown), and both cost+price parse.
    """
    from scripts.masterfile_lib import load_masterfile, is_empty_cell
    sys.path.insert(0, str(_REPO_ROOT / "data" / "lib" / "taxonomy"))
    import sku_taxonomy

    existing = _existing_skus(db_path)
    rows, dup_skus = load_masterfile(csv_path)

    candidates: list[dict] = []
    report = {
        "unknown_prefix": [],
        "price_parse_failures": [],
        "negative_margin": [],
        "missing_cost_or_price": [],
        "dup_skus": dup_skus,
    }
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    for r in rows:
        sku = (r.get("sku") or "").strip()
        if not sku or sku in existing:
            continue
        if (r.get("is_in_stock") or "").strip() != "1":
            continue

        rtype = sku_taxonomy.type_for(sku)
        if rtype in ACCESSORY_TYPES:
            continue                       # accessory — silently excluded
        if rtype == "Unknown":
            report["unknown_prefix"].append(sku)
            continue

        cost_raw, price_raw = r.get("cost"), r.get("price")
        cost = parse_money(cost_raw)
        price = parse_money(price_raw)
        if cost is None or price is None:
            # Distinguish "they tried to give a value we couldn't parse" from
            # "the cell was blank" — only the former is a data-quality red flag.
            bad_nonempty = ((cost is None and not is_empty_cell(cost_raw)) or
                            (price is None and not is_empty_cell(price_raw)))
            if bad_nonempty:
                report["price_parse_failures"].append(sku)
            else:
                report["missing_cost_or_price"].append(sku)
            continue

        if cost > price:
            report["negative_margin"].append(sku)   # KEEP — flag, don't drop

        sp = parse_money(r.get("special_price"))
        b2b = parse_money(r.get("B2B"))
        margins = recompute_margins(cost, price, sp, b2b)

        cand = {
            "id": f"onboard-{sku}",
            "sku": sku,
            "name": (r.get("name") or "").strip() or None,
            "brand": (r.get("brand") or "").strip() or None,
            "country": (r.get("country") or "").strip() or None,
            "manufacturer": (r.get("manufacturer") or "").strip() or None,
            "bottle_size": (r.get("bottle_size") or "").strip() or None,
            "vintage": (r.get("vintage") or "").strip() or None,
            "desc_en_short": (r.get("short_description") or "").strip() or None,
            "full_description": (r.get("description") or "").strip() or None,
            "cost": cost,
            "price": price,
            "special_price": sp,
            "b2b_price": b2b,
            **margins,
            "currency": "THB",
            "is_in_stock": "1",
            "is_active": 1,
            "classification": None,             # Rule 12 — leave NULL
            "enrichment_source": ENRICHMENT_SOURCE,
            "created_at": now,
            "updated_at": now,
            "_resolver_type": rtype,            # internal, for report only
        }
        candidates.append(cand)

    report["n"] = len(candidates)
    report["type_distribution"] = dict(
        Counter(c["_resolver_type"] for c in candidates))
    return candidates, report


def _write_preflight(candidates: list[dict], report: dict) -> None:
    """Write the read-only pre-flight artefacts (JSON + human MD). DB untouched."""
    Path(PREFLIGHT_JSON).write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    dist = report["type_distribution"]
    dist_lines = "\n".join(
        f"| {t} | {n} |" for t, n in sorted(dist.items(), key=lambda x: -x[1]))

    def _sample(cands):
        rows = []
        for c in cands[:10]:
            rows.append(
                f"| {c['sku']} | {(c['name'] or '')[:42]} | {c['_resolver_type']} "
                f"| {c['cost']} | {c['price']} | {c['margin_pct']} |")
        return "\n".join(rows)

    md = f"""# New-Product Onboarding — Pre-flight Report

**READ-ONLY.** This run wrote nothing to `products.db`. It selects the in-stock,
masterfile-only beverages that would be inserted, and is the Rule-10 sign-off
gate. No insert happens until you approve these numbers.

- Generated (UTC): {datetime.datetime.now(datetime.timezone.utc).isoformat()}
- Source CSV: `{DEFAULT_CSV}`
- Target DB: `{DEFAULT_DB}` (opened read-only, mode=ro)
- enrichment_source stamp: `{ENRICHMENT_SOURCE}`

## Headline

**{report['n']} candidate products** would be inserted.

## Selection rule

A candidate = SKU **not already** in `products` AND `is_in_stock == '1'` AND
resolver TYPE is a real beverage (not an accessory, not `Unknown`) AND both
`cost` and `price` parse to a number. Accessories are excluded silently;
everything else that is skipped is reported below.

## Report sections (counts)

| Section | Count | Meaning |
|---|---|---|
| candidates (n) | {report['n']} | would be inserted |
| unknown_prefix | {len(report['unknown_prefix'])} | resolver TYPE = Unknown → skipped (need a SKU-prefix mapping first) |
| price_parse_failures | {len(report['price_parse_failures'])} | cost/price cell present but unparseable → skipped |
| missing_cost_or_price | {len(report['missing_cost_or_price'])} | cost/price cell blank → skipped |
| negative_margin | {len(report['negative_margin'])} | cost > price → **KEPT** as candidate, flagged for review |
| dup_skus | {len(report['dup_skus'])} | duplicate SKU rows in the CSV (last row won) |

## Candidate composition (resolver TYPE)

| TYPE | Candidates |
|---|---|
{dist_lines}

## Skipped — Unknown prefix ({len(report['unknown_prefix'])})

{', '.join(report['unknown_prefix']) or '_none_'}

## Skipped — price parse failures ({len(report['price_parse_failures'])})

{', '.join(report['price_parse_failures']) or '_none_'}

## Skipped — missing cost or price ({len(report['missing_cost_or_price'])})

{', '.join(report['missing_cost_or_price']) or '_none_'}

## Flagged — negative margin (cost > price), KEPT ({len(report['negative_margin'])})

{', '.join(report['negative_margin']) or '_none_'}

## Duplicate SKUs in CSV ({len(report['dup_skus'])})

{', '.join(report['dup_skus']) or '_none_'}

## Sample candidates (first 10)

| SKU | Name | TYPE | cost | price | margin_pct |
|---|---|---|---|---|---|
{_sample(candidates)}

---

_Next step (Task 4): on your sign-off, the insert path writes these
{report['n']} rows to `products.db`, then refreshes `live_products_export.json`._
"""
    Path(PREFLIGHT_MD).write_text(md, encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true",
                    help="select candidates + write read-only pre-flight report; "
                         "writes NOTHING to the DB")
    args = ap.parse_args(argv)

    if not args.dry_run:
        print("insert not yet implemented — run with --dry-run for the "
              "read-only pre-flight report (Task 4 = insert path).")
        return 0

    candidates, report = select_candidates(db_path=args.db, csv_path=args.csv)
    _write_preflight(candidates, report)

    print(f"[dry-run] DB NOT modified ({args.db} opened read-only)")
    print(f"candidates (n)        : {report['n']}")
    print(f"unknown_prefix        : {len(report['unknown_prefix'])}")
    print(f"price_parse_failures  : {len(report['price_parse_failures'])}")
    print(f"missing_cost_or_price : {len(report['missing_cost_or_price'])}")
    print(f"negative_margin (kept): {len(report['negative_margin'])}")
    print(f"dup_skus              : {len(report['dup_skus'])}")
    print(f"wrote {PREFLIGHT_JSON} and {PREFLIGHT_MD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
