#!/usr/bin/env python3
"""Audit product geography against the generated explore taxonomy."""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.build_explore_taxonomy import normalize_country_name, normalize_text


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def product_key(product):
    return product.get("sku") or product.get("id") or product.get("name") or "unknown"


def top(counter: Counter, limit=25):
    return [{"key": key, "count": count} for key, count in counter.most_common(limit)]


def main():
    products = load_json(DATA / "live_products_export.json")
    taxonomy = load_json(DATA / "taxonomy" / "explore-taxonomy.json")

    region_names_by_country = defaultdict(set)
    subregion_names_by_country = defaultdict(set)
    region_names_global = set()
    subregion_names_global = set()

    countries_by_id = {country["id"]: country for country in taxonomy["countries"]}

    for region in taxonomy["regions"]:
        country = countries_by_id.get(region["parentId"])
        country_name = country["name"] if country else region.get("parentSlug", "")
        region_names_by_country[country_name].add(normalize_text(region["name"]))
        region_names_global.add(normalize_text(region["name"]))

    for subregion in taxonomy["subregions"]:
        country = countries_by_id.get(subregion["grandparentId"])
        country_name = country["name"] if country else subregion.get("grandparentSlug", "")
        subregion_names_by_country[country_name].add(normalize_text(subregion["name"]))
        subregion_names_global.add(normalize_text(subregion["name"]))

    country_equals_region = Counter()
    region_equals_subregion = Counter()
    region_is_subregion = Counter()
    subregion_is_region = Counter()
    samples = {
        "countryEqualsRegion": [],
        "regionEqualsSubregion": [],
        "regionAlsoSubregion": [],
        "subregionAlsoRegion": [],
    }

    for product in products:
        country = normalize_country_name((product.get("country") or "").strip())
        region = (product.get("region") or "").strip()
        subregion = (product.get("subregion") or "").strip()

        country_norm = normalize_text(country)
        region_norm = normalize_text(region)
        subregion_norm = normalize_text(subregion)
        path = f"{country or '(blank)'} > {region or '(blank)'} > {subregion or '(blank)'}"

        if country_norm and region_norm and country_norm == region_norm:
            country_equals_region[path] += 1
            if len(samples["countryEqualsRegion"]) < 20:
                samples["countryEqualsRegion"].append({"sku": product_key(product), "path": path})

        if region_norm and subregion_norm and region_norm == subregion_norm:
            region_equals_subregion[path] += 1
            if len(samples["regionEqualsSubregion"]) < 20:
                samples["regionEqualsSubregion"].append({"sku": product_key(product), "path": path})

        if region_norm and region_norm in subregion_names_by_country[country]:
            region_is_subregion[path] += 1
            if len(samples["regionAlsoSubregion"]) < 20:
                samples["regionAlsoSubregion"].append({"sku": product_key(product), "path": path})

        if subregion_norm and subregion_norm in region_names_by_country[country]:
            subregion_is_region[path] += 1
            if len(samples["subregionAlsoRegion"]) < 20:
                samples["subregionAlsoRegion"].append({"sku": product_key(product), "path": path})

    cross_level_taxonomy = []
    for country, names in region_names_by_country.items():
        overlap = sorted(names & subregion_names_by_country[country])
        for name in overlap:
            cross_level_taxonomy.append({"country": country, "name": name})

    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "productCount": len(products),
        "taxonomyCounts": taxonomy["_meta"]["counts"],
        "summary": {
            "countryEqualsRegionProducts": sum(country_equals_region.values()),
            "regionEqualsSubregionProducts": sum(region_equals_subregion.values()),
            "regionNameAlsoSubregionProducts": sum(region_is_subregion.values()),
            "subregionNameAlsoRegionProducts": sum(subregion_is_region.values()),
            "crossLevelTaxonomyNames": len(cross_level_taxonomy),
        },
        "topIssues": {
            "countryEqualsRegion": top(country_equals_region),
            "regionEqualsSubregion": top(region_equals_subregion),
            "regionAlsoSubregion": top(region_is_subregion),
            "subregionAlsoRegion": top(subregion_is_region),
        },
        "samples": samples,
        "crossLevelTaxonomy": cross_level_taxonomy,
    }

    json_path = DATA / "explore_geography_audit.json"
    md_path = DATA / "explore_geography_audit.md"
    json_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Explore Geography Audit",
        "",
        f"Generated: {report['generatedAt']}",
        f"Products scanned: {report['productCount']}",
        "",
        "## Summary",
    ]
    for key, value in report["summary"].items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Top Issues"])
    for group, rows in report["topIssues"].items():
        lines.append(f"### {group}")
        if not rows:
            lines.append("- None")
        for row in rows[:10]:
            lines.append(f"- {row['count']} × {row['key']}")
        lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"Saved {json_path}")
    print(f"Saved {md_path}")
    print(json.dumps(report["summary"], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
