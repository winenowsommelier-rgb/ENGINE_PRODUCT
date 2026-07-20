#!/usr/bin/env python3
"""Build a product detail/refiner upload package.

Rules:
- category_group/category_type come from SKU taxonomy, never from classification
- classification is treated as legacy/stale type text and is not overwritten here
- expert refiners are split from browse geography
- low-confidence appellation signals go to review, not the upload patch
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import sys
import unicodedata
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data/db/products.db"
OUT_DIR = ROOT / "outputs/product-refiner-attributes-2026-06-27"

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402
from scripts.backfill_designation import designation_for_name  # noqa: E402


ORIGIN_SYSTEMS = [
    "DOCG",
    "DOCa",
    "DOC",
    "AOC",
    "AOP",
    "AVA",
    "IGT",
    "DOP",
    "IGP",
    "DO",
    "GI",
]

MATERIAL_PATTERNS = [
    ("Crystal", re.compile(r"\bcrystal\b", re.I)),
    ("Glass", re.compile(r"\bglass(?:ware)?\b", re.I)),
    ("Stainless Steel", re.compile(r"\bstainless\s+steel\b|\bsteel\b", re.I)),
    ("Wood", re.compile(r"\bwood(?:en)?\b|\boak\b", re.I)),
    ("Leather", re.compile(r"\bleather\b", re.I)),
    ("Acrylic", re.compile(r"\bacrylic\b", re.I)),
    ("Silicone", re.compile(r"\bsilicone\b", re.I)),
    ("Ceramic", re.compile(r"\bceramic\b", re.I)),
    ("Plastic", re.compile(r"\bplastic\b", re.I)),
]

ACCESSORY_PATTERNS = [
    ("Wine Glass", re.compile(r"\b(red|white|wine)\s+glass(?:es)?\b|\bglass(?:es)?\b", re.I)),
    ("Champagne Glass", re.compile(r"\bchampagne\s+glass(?:es)?\b|\bflute(?:s)?\b", re.I)),
    ("Decanter", re.compile(r"\bdecanter\b", re.I)),
    ("Corkscrew", re.compile(r"\bcorkscrew\b|\bwaiter'?s?\s+friend\b", re.I)),
    ("Bottle Opener", re.compile(r"\bbottle\s+opener\b|\bopener\b", re.I)),
    ("Stopper", re.compile(r"\bstopper\b", re.I)),
    ("Cooler", re.compile(r"\bcooler\b|\bchiller\b|\bice\s+bucket\b", re.I)),
    ("Wine Fridge", re.compile(r"\bfridge\b|\bcabinet\b|\bcellar\b", re.I)),
    ("Gift Box", re.compile(r"\bgift\s+box\b|\bbox\b", re.I)),
    ("Pourer", re.compile(r"\bpourer\b|\baerator\b", re.I)),
    ("Preserver", re.compile(r"\bpreserver\b|\bvacuum\b|\bcoravin\b", re.I)),
]


def clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def norm(value: object) -> str:
    text = clean(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower().replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def load_products() -> list[dict[str, object]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        select sku, name, brand, country, region, subregion, appellation,
               classification, wine_classification, liquor_main_type, variety,
               blend_type, production_style, color, body, acidity, tannin,
               sweetness, intensity, smokiness, finish, designation
        from products
        order by sku
        """
    )
    return [dict(row) for row in rows]


def existing_columns() -> set[str]:
    conn = sqlite3.connect(DB_PATH)
    return {row[1] for row in conn.execute("pragma table_info(products)")}


def load_appellations() -> list[dict[str, str]]:
    path = ROOT / "data/lib/enrichment/taxonomy/wikidata_appellations.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    return sorted(rows, key=lambda r: len(clean(r.get("name"))), reverse=True)


def load_wine_classifications() -> list[str]:
    path = ROOT / "data/taxonomy/classification_master.json"
    rows = json.loads(path.read_text(encoding="utf-8"))["data"]
    allowed_groups = {"wine_classification", "wine_quality"}
    values = [
        clean(row.get("classification"))
        for row in sorted(rows, key=lambda r: (r.get("priority", 999), -len(clean(r.get("classification")))))
        if clean(row.get("category_scope")) == "wine" and clean(row.get("classification"))
        and clean(row.get("classification_group")) in allowed_groups
    ]
    return values


def contains_phrase(haystack: str, phrase: str) -> bool:
    if not phrase:
        return False
    return re.search(rf"(?<![A-Za-z0-9]){re.escape(phrase)}(?![A-Za-z0-9])", haystack, re.I) is not None


def product_name_tail(name: str) -> str:
    parts = re.split(r"\s{2,}", name or "", maxsplit=1)
    return parts[1] if len(parts) > 1 and parts[1].strip() else name


def detect_origin_system(name: str, designation: str) -> str:
    for value in ORIGIN_SYSTEMS:
        if norm(designation) == norm(value):
            return value
    for value in ORIGIN_SYSTEMS:
        if re.search(rf"\b{re.escape(value)}\b", name, re.I):
            return value
    return ""


def validated_appellation(product: dict[str, object], appellations: list[dict[str, str]]) -> tuple[str, str]:
    name = clean(product.get("name"))
    searchable_name = product_name_tail(name)
    country = clean(product.get("country"))
    region = clean(product.get("region"))
    subregion = clean(product.get("subregion"))
    for row in appellations:
        app = clean(row.get("name"))
        if not app or not contains_phrase(searchable_name, app):
            continue
        if clean(row.get("country")) and norm(row.get("country")) != norm(country):
            continue
        row_region = clean(row.get("region"))
        row_subregion = clean(row.get("subregion"))
        if row_region and region and norm(row_region) != norm(region):
            continue
        if row_subregion and subregion and norm(row_subregion) != norm(subregion):
            continue
        if row_subregion and not subregion and norm(row_subregion) not in {norm(region), norm(app)}:
            continue
        canonical = row_subregion or app
        return canonical, "wikidata_appellation_taxonomy"
    return "", ""


def low_confidence_appellation_candidate(name: str) -> str:
    pattern = re.compile(
        r"\b([A-Z][A-Za-z'\u00C0-\u024F-]+(?:\s+(?:d'|de|del|della|du|des|di|la|le|les|[A-Z][A-Za-z'\u00C0-\u024F-]+)){0,4})\s+"
        r"(DOCG|DOCa|DOC|AOC|AOP|AVA|IGT|DOP|IGP|DO|GI)\b"
    )
    matches = [m.group(1).strip() for m in pattern.finditer(name or "")]
    noise = {"Prosecco", "Extra Dry", "Brut", "Reserva", "Reserve", "Rosso", "Bianco"}
    matches = [m for m in matches if m not in noise and len(m) > 3]
    return matches[-1] if matches else ""


def detect_wine_classification(name: str, values: list[str]) -> str:
    for value in values:
        if contains_phrase(name, value):
            return value
    return ""


def detect_material(name: str) -> str:
    for value, pattern in MATERIAL_PATTERNS:
        if pattern.search(name or ""):
            return value
    return ""


def detect_accessory_type(name: str, category_type: str) -> str:
    for value, pattern in ACCESSORY_PATTERNS:
        if pattern.search(name or ""):
            return value
    if category_type in {"Glassware", "Wine Coolers & Fridges", "Bar Tools & Gifts"}:
        return category_type
    return ""


def compatible_use(category_group: str, category_type: str, name: str) -> str:
    text = f"{category_group} {category_type} {name}".lower()
    if "champagne" in text or "sparkling" in text or "flute" in text:
        return "Sparkling/Champagne"
    if "wine" in text or category_group == "Wine":
        return "Wine"
    if category_group in {"Whisky", "Spirits", "Liqueur"}:
        return "Spirits"
    if category_group == "Sake & Asian":
        return "Sake/Shochu"
    if category_group == "Beer & RTD":
        return "Beer/RTD"
    return ""


def make_rows() -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], dict[str, object]]:
    products = load_products()
    columns = existing_columns()
    appellations = load_appellations()
    wine_classes = load_wine_classifications()

    baseline: list[dict[str, object]] = []
    patch: list[dict[str, object]] = []
    review: list[dict[str, object]] = []

    proposed_new_columns = [
        "category_group",
        "category_type",
        "origin_system",
        "accessory_type",
        "material",
        "compatible_use",
        "attribute_confidence",
        "attribute_source",
        "attribute_review_status",
    ]
    missing_schema = [col for col in proposed_new_columns if col not in columns]

    for product in products:
        sku = clean(product.get("sku"))
        name = clean(product.get("name"))
        taxonomy = resolve(product)
        category_group = clean(taxonomy["group"])
        category_type = clean(taxonomy["type"])
        current_designation = clean(product.get("designation"))
        detected_designation = designation_for_name(name) or ""
        final_designation = current_designation or detected_designation
        origin_system = detect_origin_system(name, final_designation)
        app, app_source = ("", "")
        if category_group == "Wine":
            app, app_source = validated_appellation(product, appellations)
        final_appellation = clean(product.get("appellation")) or app
        wine_class = clean(product.get("wine_classification"))
        if not wine_class and category_group == "Wine":
            wine_class = detect_wine_classification(name, wine_classes)
        accessory_type = ""
        material = ""
        use = ""
        if category_group == "Accessories":
            accessory_type = detect_accessory_type(name, category_type)
            material = detect_material(name)
            use = compatible_use(category_group, category_type, name)

        reasons = ["category_from_sku_taxonomy"]
        db_updates = []
        if not clean(product.get("designation")) and final_designation:
            db_updates.append("designation")
            reasons.append("designation_detected_from_name")
        if not clean(product.get("appellation")) and final_appellation:
            db_updates.append("appellation")
            reasons.append(f"appellation_validated:{app_source}")
        if not clean(product.get("wine_classification")) and wine_class:
            db_updates.append("wine_classification")
            reasons.append("wine_classification_detected_from_taxonomy_phrase")
        if missing_schema:
            reasons.append("schema_columns_required:" + ",".join(missing_schema))

        confidence = 0.95
        if final_appellation and app_source:
            confidence = min(confidence, 0.9)
        if category_group == "Accessories" and not accessory_type:
            confidence = min(confidence, 0.75)

        row = {
            "sku": sku,
            "name": name,
            "category_group": category_group,
            "category_type": category_type,
            "designation": final_designation,
            "origin_system": origin_system,
            "appellation": final_appellation,
            "wine_classification": wine_class,
            "variety": clean(product.get("variety")),
            "blend_type": clean(product.get("blend_type")),
            "production_style": clean(product.get("production_style")),
            "body": clean(product.get("body")).title(),
            "acidity": clean(product.get("acidity")).title(),
            "tannin": clean(product.get("tannin")).title(),
            "sweetness": clean(product.get("sweetness")).title(),
            "intensity": clean(product.get("intensity")).title(),
            "smokiness": clean(product.get("smokiness")).title(),
            "finish": clean(product.get("finish")).title(),
            "liquor_main_type": clean(product.get("liquor_main_type")),
            "accessory_type": accessory_type,
            "material": material,
            "compatible_use": use,
            "attribute_confidence": f"{confidence:.2f}",
            "attribute_source": "sku_taxonomy+current_db+local_taxonomy_rules",
            "attribute_review_status": "validated" if confidence >= 0.9 else "review_recommended",
            "upload_action": "upsert_refiner_attributes" if (db_updates or missing_schema) else "baseline_only",
            "update_existing_db_fields": ",".join(db_updates),
            "reason": ";".join(reasons),
            "current_classification_legacy": clean(product.get("classification")),
            "current_appellation": clean(product.get("appellation")),
            "current_wine_classification": clean(product.get("wine_classification")),
            "current_designation": clean(product.get("designation")),
        }
        baseline.append(row)
        if row["upload_action"] == "upsert_refiner_attributes":
            patch.append(row)

        review_reasons = []
        if category_group == "Unknown" or category_type == "Unknown":
            review_reasons.append("sku_taxonomy_unknown")
        if clean(product.get("classification")) and norm(product.get("classification")) != norm(category_type):
            review_reasons.append("legacy_classification_differs_from_sku_category")
        if category_group == "Accessories" and not accessory_type:
            review_reasons.append("accessory_type_not_detected")
        low_app = low_confidence_appellation_candidate(name) if category_group == "Wine" else ""
        if low_app and not final_appellation:
            review_reasons.append(f"possible_appellation_needs_validation:{low_app}")
        if review_reasons:
            review.append({**row, "review_reason": ";".join(review_reasons)})

    summary = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "source_db": str(DB_PATH),
        "baseline_rows": len(baseline),
        "patch_rows": len(patch),
        "review_rows": len(review),
        "missing_schema_columns": missing_schema,
        "category_group_counts": dict(Counter(row["category_group"] for row in baseline)),
        "category_type_counts": dict(Counter(row["category_type"] for row in baseline).most_common()),
        "patch_update_existing_db_fields_counts": dict(
            Counter(
                field
                for row in patch
                for field in clean(row["update_existing_db_fields"]).split(",")
                if field
            )
        ),
        "review_reason_counts": dict(Counter(r["review_reason"] for r in review)),
    }
    return baseline, patch, review, summary


def write_csv(path: Path, rows: list[dict[str, object]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    out = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        out.append("| " + " | ".join(clean(v).replace("|", "/") for v in row) + " |")
    return "\n".join(out)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    baseline, patch, review, summary = make_rows()

    fields = [
        "sku",
        "name",
        "category_group",
        "category_type",
        "designation",
        "origin_system",
        "appellation",
        "wine_classification",
        "variety",
        "blend_type",
        "production_style",
        "body",
        "acidity",
        "tannin",
        "sweetness",
        "intensity",
        "smokiness",
        "finish",
        "liquor_main_type",
        "accessory_type",
        "material",
        "compatible_use",
        "attribute_confidence",
        "attribute_source",
        "attribute_review_status",
        "upload_action",
        "update_existing_db_fields",
        "reason",
        "current_classification_legacy",
        "current_appellation",
        "current_wine_classification",
        "current_designation",
    ]
    write_csv(OUT_DIR / "product_refiner_validated_baseline.csv", baseline, fields)
    write_csv(OUT_DIR / "product_refiner_upload_patch.csv", patch, fields)
    write_csv(OUT_DIR / "product_refiner_review_exclusions.csv", review, fields + ["review_reason"])
    (OUT_DIR / "product_refiner_upload_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    schema_lines = [
        "-- Product refiner schema proposal generated 2026-06-27",
        "-- Run before parsing product_refiner_upload_patch.csv if these columns are still missing.",
    ]
    for col in summary["missing_schema_columns"]:
        col_type = "REAL" if col == "attribute_confidence" else "TEXT"
        schema_lines.append(f"ALTER TABLE products ADD COLUMN {col} {col_type};")
    (OUT_DIR / "product_refiner_schema_proposal.sql").write_text("\n".join(schema_lines) + "\n")

    report = [
        "# Product Detail / Refiner Attribute Upload Package",
        "",
        f"Generated: {summary['generated_at']}",
        "",
        "## Verdict",
        "",
        "Use this as the next enrichment upload package after the region/subregion patch. Category is SKU-derived (`category_group` / `category_type`) and `classification` is not used as category/type.",
        "",
        "## Files",
        "",
        "- `product_refiner_validated_baseline.csv`: full refiner baseline for all current DB products.",
        "- `product_refiner_upload_patch.csv`: rows with schema-backed or existing-field updates.",
        "- `product_refiner_review_exclusions.csv`: rows that need operator review before trusting all refiners.",
        "- `product_refiner_schema_proposal.sql`: missing columns needed for the clean refiner model.",
        "- `product_refiner_upload_summary.json`: machine-readable counts.",
        "",
        "## Counts",
        "",
        md_table(
            ["Metric", "Count"],
            [
                ["Baseline rows", summary["baseline_rows"]],
                ["Patch rows", summary["patch_rows"]],
                ["Review rows", summary["review_rows"]],
                ["Missing schema columns", ", ".join(summary["missing_schema_columns"])],
            ],
        ),
        "",
        "## Category Counts",
        "",
        md_table(
            ["Category group", "Rows"],
            [[k, v] for k, v in Counter(summary["category_group_counts"]).most_common()],
        ),
        "",
        "## Existing DB Field Updates In Patch",
        "",
        md_table(
            ["Field", "Rows"],
            [[k, v] for k, v in Counter(summary["patch_update_existing_db_fields_counts"]).most_common()],
        ),
        "",
        "## Policy",
        "",
        "- `category_group` and `category_type` come from SKU taxonomy only.",
        "- `classification` is treated as legacy text and is included only for audit comparison.",
        "- `designation` is product class/designation such as DOCG, AOC, Grand Cru, Reserva, XO, VSOP, Brut, Single Malt.",
        "- `origin_system` separates systems such as AVA, DOC, DOCG, AOC/AOP, IGT, DO, GI from shopper category.",
        "- Appellation is only uploaded when matched against the local validated appellation taxonomy; regex-only candidates are sent to review.",
        "- Accessory refiners are category-specific and should not appear in wine geography navigation.",
        "",
        "## Parser Rule",
        "",
        "Apply `product_refiner_schema_proposal.sql` first if the target DB is missing those columns. Then parse `product_refiner_upload_patch.csv` by SKU. For existing DB fields, update only the comma-separated fields in `update_existing_db_fields`. For proposed columns, set the corresponding CSV values when present.",
    ]
    (OUT_DIR / "product_refiner_attribute_report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"wrote {OUT_DIR}")


if __name__ == "__main__":
    main()
