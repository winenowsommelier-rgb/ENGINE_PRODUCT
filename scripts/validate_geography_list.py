#!/usr/bin/env python3
"""Validate a list of items against the canonical geography taxonomy.

Given a list of items (CSV or JSON) that each carry a country / region /
sub-region, this checks every value against the master taxonomy
(data/taxonomy/{countries,regions,subregions}.json) and the live product
database (data/db/products.json), then writes a validated .csv you can
process further.

What it checks, per level, in hierarchy order:
  - country    : is it a known country? (accent/case-insensitive + aliases)
  - region     : is it a known region AND does it belong to the stated country?
  - subregion  : is it a known subregion AND does it belong to the stated region?

Each value gets a status:
  valid        - exact match to the canonical name
  corrected    - matched after fixing case/accents/alias (canonical name filled in)
  wrong_parent - the value exists in the taxonomy but under a different parent
  unknown      - no match anywhere in the taxonomy
  blank        - nothing supplied

The row's overall_status is the "worst" status across the levels present.

Usage:
  python3 scripts/validate_geography_list.py INPUT [-o OUTPUT]

  INPUT  : .csv or .json list of items. Column/key names are auto-detected
           (country, region, sub_region/subregion/"sub region", plus an
           optional id column: sku / id / name).
  OUTPUT : path for the validated .csv (default: <input>.validated.csv)

Examples:
  python3 scripts/validate_geography_list.py my_items.csv
  python3 scripts/validate_geography_list.py my_items.json -o validated.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TAXONOMY_DIR = REPO_ROOT / "data" / "taxonomy"
PRODUCTS_PATH = REPO_ROOT / "data" / "db" / "products.json"

# ── Known aliases (lower-cased) → canonical country name in the taxonomy ──────
# Extend as new variants surface. Keys are matched after accent/case folding.
COUNTRY_ALIASES: dict[str, str] = {
    "usa": "USA",
    "u.s.a.": "USA",
    "us": "USA",
    "u.s.": "USA",
    "united states": "USA",
    "united states of america": "USA",
    "america": "USA",
    "uk": "England",
    "united kingdom": "England",
    "great britain": "England",
    "england": "England",
    "scotland": "Scotland",
    "holland": "Netherlands",
    "the netherlands": "Netherlands",
    "czech": "Czech Republic",
    "czechia": "Czech Republic",
    "macedonia": "North Macedonia",
}

# Known region aliases (lower-cased) → canonical region name.
REGION_ALIASES: dict[str, str] = {
    "napa": "Napa Valley",
    "marlboro": "Marlborough",
    "willamette": "Willamette Valley",
    "rhone": "Rhône Valley",
    "rhone valley": "Rhône Valley",
    "cote du rhone": "Rhône Valley",
}


def fold(value) -> str:
    """Accent-strip + lower-case + collapse whitespace for matching."""
    s = "" if value is None else str(value)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return " ".join(s.lower().split())


# ── Load canonical taxonomy ───────────────────────────────────────────────────
def load_taxonomy():
    countries = json.loads((TAXONOMY_DIR / "countries.json").read_text())["data"]
    regions = json.loads((TAXONOMY_DIR / "regions.json").read_text())["data"]
    subregions = json.loads((TAXONOMY_DIR / "subregions.json").read_text())["data"]

    tax = {
        "country_by_id": {c["id"]: c for c in countries},
        "region_by_id": {r["id"]: r for r in regions},
        # fold(name) -> country record
        "country_lookup": {},
        "country_by_iso": {},
        # fold(name) -> list of region records (a name can repeat across countries)
        "region_lookup": {},
        # fold(name) -> list of subregion records
        "subregion_lookup": {},
    }
    for c in countries:
        tax["country_lookup"].setdefault(fold(c["name"]), c)
        if c.get("iso"):
            tax["country_by_iso"].setdefault(fold(c["iso"]), c)
    for r in regions:
        tax["region_lookup"].setdefault(fold(r["name"]), []).append(r)
    for s in subregions:
        tax["subregion_lookup"].setdefault(fold(s["name"]), []).append(s)
    return tax


# ── Load the live database combos (cross-check that a combo actually ships) ────
def load_db_combos():
    if not PRODUCTS_PATH.exists():
        return set()
    products = json.loads(PRODUCTS_PATH.read_text())
    combos = set()
    for p in products:
        combos.add(
            (
                fold(p.get("country")),
                fold(p.get("region")),
                fold(p.get("subregion")),
            )
        )
    return combos


# ── Per-level validators ──────────────────────────────────────────────────────
def validate_country(raw, tax):
    """Return (status, canonical_name, country_id)."""
    key = fold(raw)
    if not key:
        return "blank", "", None
    rec = tax["country_lookup"].get(key)
    if rec is None and key in COUNTRY_ALIASES:
        rec = tax["country_lookup"].get(fold(COUNTRY_ALIASES[key]))
    if rec is None:
        rec = tax["country_by_iso"].get(key)  # e.g. "FR"
    if rec is None:
        return "unknown", "", None
    status = "valid" if str(raw).strip() == rec["name"] else "corrected"
    return status, rec["name"], rec["id"]


def validate_region(raw, country_id, tax):
    """Return (status, canonical_name, region_id, resolved_country_id)."""
    key = fold(raw)
    if not key:
        return "blank", "", None, country_id
    candidates = tax["region_lookup"].get(key)
    if not candidates and key in REGION_ALIASES:
        candidates = tax["region_lookup"].get(fold(REGION_ALIASES[key]))
    if not candidates:
        return "unknown", "", None, country_id

    # Prefer a candidate under the stated country.
    match = None
    if country_id is not None:
        match = next((r for r in candidates if r["country_id"] == country_id), None)
    if match is not None:
        status = "valid" if str(raw).strip() == match["name"] else "corrected"
        return status, match["name"], match["id"], country_id

    # Region exists, but not under the stated country (or country was blank).
    rec = candidates[0]
    if country_id is None:
        status = "valid" if str(raw).strip() == rec["name"] else "corrected"
        return status, rec["name"], rec["id"], rec["country_id"]
    return "wrong_parent", rec["name"], rec["id"], rec["country_id"]


def validate_subregion(raw, region_id, tax):
    """Return (status, canonical_name, subregion_id, resolved_region_id)."""
    key = fold(raw)
    if not key:
        return "blank", "", None, region_id
    candidates = tax["subregion_lookup"].get(key)
    if not candidates:
        return "unknown", "", None, region_id

    match = None
    if region_id is not None:
        match = next((s for s in candidates if s["region_id"] == region_id), None)
    if match is not None:
        status = "valid" if str(raw).strip() == match["name"] else "corrected"
        return status, match["name"], match["id"], region_id

    rec = candidates[0]
    if region_id is None:
        status = "valid" if str(raw).strip() == rec["name"] else "corrected"
        return status, rec["name"], rec["id"], rec["region_id"]
    return "wrong_parent", rec["name"], rec["id"], rec["region_id"]


# worst-first severity ranking for the overall row status
SEVERITY = {
    "unknown": 4,
    "wrong_parent": 3,
    "corrected": 2,
    "valid": 1,
    "blank": 0,
}


def overall_status(*statuses):
    present = [s for s in statuses if s != "blank"]
    if not present:
        return "blank"
    worst = max(present, key=lambda s: SEVERITY[s])
    if worst in ("unknown", "wrong_parent"):
        return "invalid"
    if worst == "corrected":
        return "corrected"
    return "valid"


# ── Input reading with flexible column detection ──────────────────────────────
COLUMN_ALIASES = {
    "country": {"country", "country_name", "origin_country", "nation"},
    "region": {"region", "region_name", "wine_region", "province"},
    "subregion": {
        "subregion", "sub_region", "sub region", "sub-region",
        "subregion_name", "sub_zone", "subzone",
    },
    "id": {"sku", "id", "name", "item", "product", "title"},
}


def norm_header(h):
    return " ".join(str(h).strip().lower().replace("-", " ").replace("_", " ").split())


def detect_columns(headers):
    """Map logical fields -> actual header name found in the input."""
    mapping = {}
    normed = {norm_header(h): h for h in headers}
    for field, aliases in COLUMN_ALIASES.items():
        alias_norms = {norm_header(a) for a in aliases}
        for nh, original in normed.items():
            if nh in alias_norms or nh.replace(" ", "") in {a.replace(" ", "") for a in alias_norms}:
                mapping[field] = original
                break
    return mapping


def read_items(path: Path):
    if path.suffix.lower() == ".json":
        data = json.loads(path.read_text())
        if isinstance(data, dict):
            data = data.get("data") or data.get("items") or []
        rows = [dict(r) for r in data]
        headers = list(rows[0].keys()) if rows else []
        return rows, headers
    # default: CSV
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = [dict(r) for r in reader]
        headers = reader.fieldnames or []
    return rows, headers


# ── Main ──────────────────────────────────────────────────────────────────────
OUTPUT_FIELDS = [
    "row",
    "item",
    "input_country", "input_region", "input_subregion",
    "country", "region", "subregion",
    "country_status", "region_status", "subregion_status",
    "country_id", "region_id", "subregion_id",
    "in_database",
    "overall_status",
    "notes",
]


def build_notes(cs, rs, ss, resolved_country, input_country):
    notes = []
    if cs == "unknown":
        notes.append("country not in taxonomy")
    if rs == "unknown":
        notes.append("region not in taxonomy")
    if rs == "wrong_parent":
        notes.append(f"region belongs to {resolved_country!r}, not {input_country!r}")
    if ss == "unknown":
        notes.append("subregion not in taxonomy")
    if ss == "wrong_parent":
        notes.append("subregion belongs to a different region")
    if cs == "corrected" or rs == "corrected" or ss == "corrected":
        notes.append("normalized to canonical spelling")
    return "; ".join(notes)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="Input list of items (.csv or .json)")
    ap.add_argument("-o", "--output", type=Path, default=None, help="Output validated .csv path")
    args = ap.parse_args(argv)

    if not args.input.exists():
        ap.error(f"input file not found: {args.input}")

    output = args.output or args.input.with_suffix("").with_name(args.input.stem + ".validated.csv")

    tax = load_taxonomy()
    db_combos = load_db_combos()
    rows, headers = read_items(args.input)
    cols = detect_columns(headers)

    if not any(k in cols for k in ("country", "region", "subregion")):
        ap.error(
            "Could not find country/region/subregion columns in the input. "
            f"Detected headers: {headers}"
        )

    def get(row, field):
        col = cols.get(field)
        return row.get(col, "") if col else ""

    out_rows = []
    counters = {
        "overall": Counter(),
        "country": Counter(),
        "region": Counter(),
        "subregion": Counter(),
    }

    for i, row in enumerate(rows, start=1):
        in_country = get(row, "country")
        in_region = get(row, "region")
        in_subregion = get(row, "subregion")
        item = get(row, "id")

        cs, country, country_id = validate_country(in_country, tax)
        rs, region, region_id, resolved_country_id = validate_region(in_region, country_id, tax)
        ss, subregion, subregion_id, _ = validate_subregion(in_subregion, region_id, tax)

        resolved_country = ""
        if resolved_country_id is not None:
            rc = tax["country_by_id"].get(resolved_country_id)
            resolved_country = rc["name"] if rc else ""

        ov = overall_status(cs, rs, ss)
        in_db = (fold(country or in_country), fold(region or in_region), fold(subregion or in_subregion)) in db_combos

        out_rows.append({
            "row": i,
            "item": item,
            "input_country": in_country,
            "input_region": in_region,
            "input_subregion": in_subregion,
            "country": country,
            "region": region,
            "subregion": subregion,
            "country_status": cs,
            "region_status": rs,
            "subregion_status": ss,
            "country_id": country_id if country_id is not None else "",
            "region_id": region_id if region_id is not None else "",
            "subregion_id": subregion_id if subregion_id is not None else "",
            "in_database": "yes" if in_db else "no",
            "overall_status": ov,
            "notes": build_notes(cs, rs, ss, resolved_country, in_country),
        })

        counters["overall"][ov] += 1
        counters["country"][cs] += 1
        counters["region"][rs] += 1
        counters["subregion"][ss] += 1

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUTPUT_FIELDS)
        w.writeheader()
        w.writerows(out_rows)

    # ── Console summary ──
    print(f"Validated {len(out_rows)} items  ->  {output}")
    print(f"  detected columns: {cols}")
    print(f"\n  overall:    " + ", ".join(f"{k}={v}" for k, v in counters['overall'].most_common()))
    for level in ("country", "region", "subregion"):
        print(f"  {level:<10}: " + ", ".join(f"{k}={v}" for k, v in counters[level].most_common()))

    invalid = [r for r in out_rows if r["overall_status"] == "invalid"]
    if invalid:
        print(f"\n  {len(invalid)} item(s) need attention (overall_status=invalid):")
        for r in invalid[:15]:
            ident = r["item"] or f"row {r['row']}"
            print(f"    - {ident}: {r['notes']}")
        if len(invalid) > 15:
            print(f"    ... and {len(invalid) - 15} more (see {output.name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
