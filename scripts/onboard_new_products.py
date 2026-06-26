#!/usr/bin/env python3
"""Onboard in-stock mf-only beverages as sellable products. See spec 2026-06-25."""
from __future__ import annotations
import re
import sys
import csv
import json
import shutil
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
IMAGE_CSV = ("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
             "export_path_images_all_media_no_null_base_images.csv")
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
            # b2b_discount_pct is the ONE pct field production stores at 1 decimal
            # (verified 3965/4000 rows 1dp, 0 are 2dp). pct_str() is 2dp and
            # would mismatch ~3365/4000 rows. The other 4 pct fields stay 2dp.
            out["b2b_discount_pct"] = f"{round((price - b2b_price) / price * 100, 1)}"
    return out


def _existing_skus(db_path: str) -> set[str]:
    """Read-only fetch of the SKUs already present in products. Plain connection
    that only SELECTs (never writes) — mode=ro URI cannot open a WAL DB whose
    -wal/-shm sidecars are absent (plain cp/.backup copies), so we rely on the
    SELECT-only access pattern for write-safety, not connection flags (Rule 1/9)."""
    con = sqlite3.connect(db_path)
    try:
        return {r[0] for r in con.execute("SELECT sku FROM products")}
    finally:
        con.close()


def _load_image_map(image_csv: str = IMAGE_CSV) -> dict[str, str]:
    """sku (UPPER as in CSV) -> base_image_url. Read-only. Missing file = {}."""
    path = Path(image_csv)
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    with path.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            sku = (row.get("sku") or "").strip()
            url = (row.get("base_image_url") or "").strip()
            if sku and url:
                out[sku] = url
    return out


def _image_for_sku(sku: str, image_map: dict[str, str]) -> str | None:
    """Return the image URL ONLY IF its filename references THIS sku.

    HTTP 200 != right bottle: a filename pointing at a DIFFERENT sku is the
    cross-sku 'wrong bottle' bug we keep fixing. We hold (return None) unless
    the filename (segment after the last '/') contains the own sku lowercased.
    """
    url = image_map.get(sku)
    if not url:
        return None
    fname = url.rsplit("/", 1)[-1].lower()
    return url if sku.lower() in fname else None


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
    image_map = _load_image_map()

    candidates: list[dict] = []
    report = {
        "unknown_prefix": [],
        "price_parse_failures": [],
        "negative_margin": [],
        "missing_cost_or_price": [],
        "dup_skus": dup_skus,
        "image_cross_sku_held": [],
        "image_set": 0,
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

        image_url = _image_for_sku(sku, image_map)
        if image_url:
            report["image_set"] += 1
        elif image_map.get(sku):
            # URL existed but referenced a different sku — held, not set.
            report["image_cross_sku_held"].append(sku)

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
            "image_url": image_url,
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


# Real products columns the insert writes. Built from the candidate dict MINUS
# any internal underscore-prefixed key (e.g. '_resolver_type'). Kept explicit so
# a candidate-dict change can never silently widen/narrow the INSERT (payment-path).
INSERT_COLS = [
    "id", "sku", "name", "brand", "country", "manufacturer", "bottle_size",
    "vintage", "desc_en_short", "full_description", "cost", "price",
    "special_price", "b2b_price", "margin_thb", "margin_pct", "sp_discount_pct",
    "b2b_margin_thb", "b2b_margin_pct", "b2b_discount_pct", "image_url",
    "currency", "is_in_stock", "is_active", "classification", "enrichment_source",
    "created_at", "updated_at",
]


def _backup_db(db_path: str) -> str:
    """Checkpoint the WAL into the main file, then copy it to a timestamped .bak
    NEXT TO the db (Rule 10). Returns the backup path."""
    con = sqlite3.connect(db_path)
    try:
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    bak = f"{db_path}.bak-pre-onboard-{ts}"
    shutil.copy(db_path, bak)
    return bak


def _insert_candidates(db_path: str, candidates: list[dict]) -> int:
    """Single all-or-nothing transaction. INSERT every candidate whose sku is
    not already in products (idempotent). Strips internal underscore keys.
    On ANY exception: rollback and re-raise (caller exits non-zero). Returns the
    number of rows inserted.
    """
    placeholders = ",".join("?" * len(INSERT_COLS))
    collist = ",".join(INSERT_COLS)
    sql = f"INSERT INTO products ({collist}) VALUES ({placeholders})"

    con = sqlite3.connect(db_path)
    try:
        existing = {r[0] for r in con.execute("SELECT sku FROM products")}
        con.execute("BEGIN")
        inserted = 0
        for cand in candidates:
            if cand["sku"] in existing:
                continue                      # idempotent — already onboarded
            # Build the row strictly from INSERT_COLS; any '_'-prefixed internal
            # key (e.g. '_resolver_type') is never referenced, so it cannot leak.
            con.execute(sql, [cand.get(col) for col in INSERT_COLS])
            inserted += 1
        con.commit()
        return inserted
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _verify_insert(db_path: str, before_count: int, inserted: int) -> None:
    """In-process post-commit verification (Rule 1/4): COUNT rose by `inserted`,
    and a 10-row sample of onboarded rows has margin_thb == round(price-cost,2)."""
    con = sqlite3.connect(db_path)  # plain conn, SELECT-only (mode=ro fails on WAL DB w/o sidecars)
    try:
        after = con.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        if after - before_count != inserted:
            raise RuntimeError(
                f"VERIFY FAILED: count delta {after - before_count} != inserted {inserted}")
        sample = con.execute(
            "SELECT sku, price, cost, margin_thb FROM products "
            "WHERE enrichment_source=? LIMIT 10", (ENRICHMENT_SOURCE,)).fetchall()
        for sku, price, cost, mthb in sample:
            if round(price - cost, 2) != mthb:
                raise RuntimeError(
                    f"VERIFY FAILED: {sku} margin_thb {mthb} != round(price-cost,2) "
                    f"{round(price - cost, 2)}")
    finally:
        con.close()
    print(f"verified: row count rose by {inserted}; "
          f"{len(sample)} sampled onboarded rows pass margin invariant")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    ap.add_argument("--dry-run", action="store_true",
                    help="select candidates + write read-only pre-flight report; "
                         "writes NOTHING to the DB")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the pre-insert DB backup (tests use a throwaway db copy)")
    args = ap.parse_args(argv)

    if args.dry_run:
        candidates, report = select_candidates(db_path=args.db, csv_path=args.csv)
        _write_preflight(candidates, report)
        _print_dry_run(args.db, report)
        return 0

    # --- Real insert path (all-or-nothing single transaction) ---
    if not args.no_backup:
        bak = _backup_db(args.db)
        print(f"backup created: {bak}")

    candidates, report = select_candidates(db_path=args.db, csv_path=args.csv)

    before = sqlite3.connect(args.db).execute(  # plain conn, SELECT-only (mode=ro fails on WAL DB w/o sidecars)
        "SELECT COUNT(*) FROM products").fetchone()[0]
    try:
        inserted = _insert_candidates(args.db, candidates)
    except Exception as exc:                       # noqa: BLE001 — top-level guard
        print(f"INSERT FAILED, rolled back (DB unchanged): {exc}", file=sys.stderr)
        return 1

    held = len(report["image_cross_sku_held"])
    print(f"inserted {inserted} (images set {report['image_set']}, held {held})")
    _verify_insert(args.db, before, inserted)
    return 0


def _print_dry_run(db_path: str, report: dict) -> None:
    print(f"[dry-run] DB NOT modified ({db_path} opened read-only)")
    print(f"candidates (n)        : {report['n']}")
    print(f"unknown_prefix        : {len(report['unknown_prefix'])}")
    print(f"price_parse_failures  : {len(report['price_parse_failures'])}")
    print(f"missing_cost_or_price : {len(report['missing_cost_or_price'])}")
    print(f"negative_margin (kept): {len(report['negative_margin'])}")
    print(f"dup_skus              : {len(report['dup_skus'])}")
    print(f"image_set             : {report['image_set']}")
    print(f"image_cross_sku_held  : {len(report['image_cross_sku_held'])}")
    print(f"wrote {PREFLIGHT_JSON} and {PREFLIGHT_MD}")


if __name__ == "__main__":
    raise SystemExit(main())
