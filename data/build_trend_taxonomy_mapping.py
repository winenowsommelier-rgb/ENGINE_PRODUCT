from __future__ import annotations

import csv
import json
import re
from pathlib import Path


DATA_DIR = Path("/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data")
WORK_DIR = Path("/Users/admin/Documents/CODEX Projects/research_jobs")
OUTPUT_DIR = WORK_DIR / "progress_outputs"

TRENDS_CSV = DATA_DIR / "ga_category_selection_trends.csv"
TAXONOMY_LIB = DATA_DIR / "taxonomy_description_library.csv"

OUTPUT_CSV = OUTPUT_DIR / "ga_trend_taxonomy_mapping_candidates.csv"
OUTPUT_SUMMARY = OUTPUT_DIR / "ga_trend_taxonomy_mapping_summary.json"


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def normalize(text: str) -> str:
    text = (text or "").strip().lower()
    text = text.replace("&", " and ")
    text = re.sub(r"\b(category|brand page|collection|hub)\b", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def classification_aliases(name: str) -> list[str]:
    base = normalize(name)
    aliases = {base}
    replacements = {
        "red wine": "Red Wine",
        "white wine": "White Wine",
        "sparkling wine": "Sparkling Wine",
        "champagne": "Champagne",
        "single malt whisky": "Single Malt Whisky",
        "scotch whisky": "Scotch Whisky",
        "japanese whisky": "Japanese Whisky",
        "american whiskey": "American Whiskey",
        "brandy": "Brandy",
        "liqueur": "Liqueur",
        "gin": "Gin",
        "rum": "Rum",
        "tequila": "Tequila",
        "vodka": "Vodka",
        "sake shochu": "Sake / Shochu",
        "cigar": "Cigar",
        "barware": "Barware",
        "accessory": "Accessories",
    }
    for key in list(aliases):
        if key in replacements:
            aliases.add(normalize(replacements[key]))
    return [alias for alias in aliases if alias]


def build_indexes(taxonomy_rows: list[dict]):
    exact = {}
    by_type = {}
    for row in taxonomy_rows:
        entity_type = (row.get("entity_type") or "").strip()
        entity_name = (row.get("entity_name") or "").strip()
        if not entity_type or not entity_name:
            continue
        key = (entity_type, normalize(entity_name))
        exact[key] = row
        by_type.setdefault(entity_type, {})[normalize(entity_name)] = row
    return exact, by_type


def map_target(row: dict, by_type: dict) -> dict:
    target_type = (row.get("suggested_app_entity_type") or "").strip()
    target_name = (row.get("suggested_app_entity_name") or "").strip()
    reference_name = (row.get("reference_name") or "").strip()
    site = row.get("site") or ""

    mapping_status = "unmapped"
    mapping_confidence = "low"
    matched_entity_type = ""
    matched_entity_name = ""
    mapping_reason = "Needs manual taxonomy decision."

    if target_type == "classification":
        aliases = classification_aliases(target_name or reference_name)
        for alias in aliases:
            hit = by_type.get("classification", {}).get(alias)
            if hit:
                matched_entity_type = "classification"
                matched_entity_name = hit["entity_name"]
                mapping_status = "mapped_exact" if normalize(hit["entity_name"]) == normalize(target_name) else "mapped_alias"
                mapping_confidence = "high" if mapping_status == "mapped_exact" else "medium"
                mapping_reason = "Website category normalized to existing classification taxonomy."
                break
    elif target_type == "brand":
        key = normalize(target_name.replace("Brand Page", "").strip())
        hit = by_type.get("brand", {}).get(key)
        if hit:
            matched_entity_type = "brand"
            matched_entity_name = hit["entity_name"]
            mapping_status = "mapped_exact"
            mapping_confidence = "high"
            mapping_reason = "Website brand page matched existing brand taxonomy."
    elif target_type == "region":
        key = normalize(target_name)
        hit = by_type.get("region", {}).get(key) or by_type.get("subregion", {}).get(key)
        if hit:
            matched_entity_type = hit["entity_type"]
            matched_entity_name = hit["entity_name"]
            mapping_status = "mapped_exact"
            mapping_confidence = "high"
            mapping_reason = "Website region page matched existing regional taxonomy."
    elif target_type in {"navigation_hub", "collection_theme"}:
        mapping_status = "reference_only"
        mapping_confidence = "medium"
        mapping_reason = "Website hub/collection should guide priority and landing copy, not be forced into canonical taxonomy."

    return {
        "site": site,
        "trend_rank": row.get("trend_rank", ""),
        "trend_type": row.get("trend_type", ""),
        "reference_name": reference_name,
        "page_path": row.get("page_path", ""),
        "pageviews": row.get("pageviews", ""),
        "users": row.get("users", ""),
        "suggested_app_entity_type": target_type,
        "suggested_app_entity_name": target_name,
        "matched_entity_type": matched_entity_type,
        "matched_entity_name": matched_entity_name,
        "mapping_status": mapping_status,
        "mapping_confidence": mapping_confidence,
        "trend_score": row.get("trend_score", ""),
        "trend_band": row.get("trend_band", ""),
        "mapping_reason": mapping_reason,
    }


def main() -> None:
    trends = read_csv(TRENDS_CSV)
    taxonomy = read_csv(TAXONOMY_LIB)
    _, by_type = build_indexes(taxonomy)

    mapped_rows = [map_target(row, by_type) for row in trends]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(mapped_rows[0].keys()))
        writer.writeheader()
        writer.writerows(mapped_rows)

    summary = {
        "total_rows": len(mapped_rows),
        "mapped_exact": sum(1 for row in mapped_rows if row["mapping_status"] == "mapped_exact"),
        "mapped_alias": sum(1 for row in mapped_rows if row["mapping_status"] == "mapped_alias"),
        "reference_only": sum(1 for row in mapped_rows if row["mapping_status"] == "reference_only"),
        "unmapped": sum(1 for row in mapped_rows if row["mapping_status"] == "unmapped"),
        "top_examples": mapped_rows[:12],
    }
    OUTPUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
