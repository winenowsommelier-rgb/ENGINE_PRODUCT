#!/usr/bin/env python3
"""Apply T3 chunks 3 & 5 brand-research results to products.json.

For each product, find a matching brand+country (and region, if research record provides it):
- single-region scope -> fill empty region/subregion (only if matches taxonomy)
- multi-region scope  -> fill producer_notes only (leave region/subregion intact)
- unknown scope       -> producer_notes only (or skip)
Auto-add new subregions to taxonomy when needed (under existing region for that country).
Backup products + changelog before mutation; emit changelog rows for every fill.
"""
import json, datetime, sys, unicodedata
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / "data" / "db" / "products.json"
CHANGELOG = ROOT / "data" / "db" / "product-changelog.json"
COUNTRIES = ROOT / "data" / "taxonomy" / "countries.json"
REGIONS = ROOT / "data" / "taxonomy" / "regions.json"
SUBREGIONS = ROOT / "data" / "taxonomy" / "subregions.json"
BACKUPS = ROOT / "data" / "db" / "backups"

CHUNK_FILES = [
    ROOT / "data" / "taxonomy_validation_report" / "t3_chunk_3_results.json",
    ROOT / "data" / "taxonomy_validation_report" / "t3_chunk_5_results.json",
]

def norm(s):
    if s is None:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    return "".join(c for c in s if not unicodedata.combining(c)).strip().lower()

def load_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)

def save_json(p, data):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def main():
    ts = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    products = load_json(PRODUCTS)
    changelog = load_json(CHANGELOG)
    countries = load_json(COUNTRIES)
    regions = load_json(REGIONS)
    subregions = load_json(SUBREGIONS)

    # Backup
    BACKUPS.mkdir(exist_ok=True)
    save_json(BACKUPS / f"products_{ts}_pre_t3_chunks_3_5_apply.json", products)
    save_json(BACKUPS / f"product-changelog_{ts}_pre_t3_chunks_3_5_apply.json", changelog)

    countries_rows = countries["data"] if isinstance(countries, dict) else countries
    regions_rows = regions["data"] if isinstance(regions, dict) else regions
    subregions_rows = subregions["data"] if isinstance(subregions, dict) else subregions

    country_by_norm = {norm(c["name"]): c for c in countries_rows}
    # region by (country_id, norm name) -> region row
    regions_by_key = {(r["country_id"], norm(r["name"])): r for r in regions_rows}
    # subregion by (region_id, norm name)
    subregions_by_key = {(s["region_id"], norm(s["name"])): s for s in subregions_rows}

    # Load chunk results
    records = []
    for cf in CHUNK_FILES:
        records.extend(load_json(cf))
    print(f"loaded {len(records)} brand records")

    # Build lookup: (brand_norm, country_norm) -> list of records
    # When multiple records exist for same brand/country, we'll match by region too
    bcr_lookup = defaultdict(list)
    for rec in records:
        key = (norm(rec["brand"]), norm(rec["country"]))
        bcr_lookup[key].append(rec)

    # Tracking
    new_subregions = []
    fills = {"region": 0, "subregion": 0, "notes": 0}
    skipped = {"region_invalid": 0, "subregion_invalid": 0, "no_country_match": 0}
    new_changelog = []

    for p in products:
        brand_n = norm(p.get("brand"))
        country_n = norm(p.get("country"))
        if not brand_n:
            continue
        recs = bcr_lookup.get((brand_n, country_n), [])
        if not recs:
            continue
        # Pick best matching record by region if product already has region
        prod_region_n = norm(p.get("region"))
        chosen = None
        if prod_region_n:
            for r in recs:
                if norm(r.get("region")) == prod_region_n:
                    chosen = r
                    break
        if chosen is None:
            # If product has no region: prefer record with empty region (negociant note)
            for r in recs:
                if not r.get("region"):
                    chosen = r
                    break
        if chosen is None:
            chosen = recs[0]

        scope = chosen.get("scope", "unknown")
        rec_region = chosen.get("region", "").strip()
        rec_sub = chosen.get("subregion", "").strip()
        rec_note = chosen.get("producer_note", "").strip()

        country_row = country_by_norm.get(country_n)
        if not country_row:
            skipped["no_country_match"] += 1
            continue
        country_id = country_row["id"]

        changes = {}

        # Region fill (single-region only, only if product region empty)
        if scope == "single-region" and rec_region and not p.get("region"):
            region_row = regions_by_key.get((country_id, norm(rec_region)))
            if region_row:
                changes["region"] = rec_region
            else:
                skipped["region_invalid"] += 1

        # Subregion fill (single-region only, only if product subregion empty)
        if scope == "single-region" and rec_sub and not (p.get("subregion") or "").strip():
            # Determine the effective region after potential change
            eff_region = changes.get("region") or p.get("region") or rec_region
            eff_region_n = norm(eff_region)
            region_row = regions_by_key.get((country_id, eff_region_n))
            if region_row:
                sub_row = subregions_by_key.get((region_row["id"], norm(rec_sub)))
                if sub_row:
                    changes["subregion"] = rec_sub
                else:
                    # Add new subregion
                    new_id = max(s["id"] for s in subregions_rows) + 1
                    new_row = {
                        "id": new_id,
                        "region_id": region_row["id"],
                        "name": rec_sub,
                        "subregion_type": "subregion",
                    }
                    subregions_rows.append(new_row)
                    subregions_by_key[(region_row["id"], norm(rec_sub))] = new_row
                    new_subregions.append(f"{rec_sub} (region={eff_region}, country={p.get('country')})")
                    changes["subregion"] = rec_sub
            else:
                skipped["subregion_invalid"] += 1

        # Producer notes fill (any scope, only if empty)
        existing_notes = (p.get("producer_notes") or "").strip()
        if rec_note and not existing_notes:
            changes["producer_notes"] = rec_note

        if not changes:
            continue

        for field, val in changes.items():
            old = p.get(field, "")
            p[field] = val
            if field in fills:
                fills[field] += 1
            elif field == "producer_notes":
                fills["notes"] += 1
            new_changelog.append({
                "id": f"chg-{ts}-{p['sku']}-{field}",
                "sku": p["sku"],
                "field": field,
                "old_value": old,
                "new_value": val,
                "source": "t3_chunks_3_5_brand_research",
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "scope": scope,
                "brand": p.get("brand"),
            })
        p["updated_at"] = datetime.datetime.utcnow().isoformat() + "Z"

    # Write taxonomies if subregions added
    if new_subregions:
        if isinstance(subregions, dict):
            subregions["data"] = subregions_rows
            save_json(SUBREGIONS, subregions)
        else:
            save_json(SUBREGIONS, subregions_rows)

    save_json(PRODUCTS, products)
    changelog.extend(new_changelog)
    save_json(CHANGELOG, changelog)

    print(f"\nbackup: {BACKUPS / f'products_{ts}_pre_t3_chunks_3_5_apply.json'}")
    print(f"applied: region={fills['region']}, subregion={fills['subregion']}, notes={fills['notes']}")
    print(f"skipped: {skipped}")
    print(f"new subregions: {len(new_subregions)}")
    for s in new_subregions[:20]:
        print(f"  + {s}")
    if len(new_subregions) > 20:
        print(f"  ... {len(new_subregions)-20} more")
    print(f"changelog rows: {len(new_changelog)}")

if __name__ == "__main__":
    main()
