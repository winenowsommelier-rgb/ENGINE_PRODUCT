from __future__ import annotations

import csv
import json
from pathlib import Path


DATA_DIR = Path("/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data")
WORK_DIR = Path("/Users/admin/Documents/CODEX Projects/research_jobs")
OUTPUT_DIR = WORK_DIR / "progress_outputs"

FAST_LANE_CSV = DATA_DIR / "next_fast_lane_queue.csv"
PRODUCTS_JSON = DATA_DIR / "db" / "products.json"
OUTPUT_CSV = OUTPUT_DIR / "product_engine_queue_metadata_updates.csv"
OUTPUT_SUMMARY = OUTPUT_DIR / "product_engine_queue_metadata_updates_summary.json"


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_int(value) -> int:
    if value in (None, ""):
        return 0
    return int(float(str(value).replace(",", "").strip()))


def map_enrichment_priority(priority_band: str) -> int:
    band = (priority_band or "").strip()
    if band in {"ga_publish_fast_lane", "publish_fast_lane"}:
        return 1
    if band in {"ga_brand_cluster", "ga_taxonomy_lane"}:
        return 2
    if band == "high_value_cluster":
        return 3
    return 5


def build_note(row: dict) -> str:
    reasons = (row.get("why_now") or "").strip()
    band = (row.get("priority_band") or "").strip()
    ga_brand = (row.get("ga_brand_rank") or "").strip()
    ga_tax = (row.get("ga_taxonomy_rank") or "").strip()
    bits = [f"Codex queue band: {band}"]
    if ga_brand:
        bits.append(f"GA brand rank: {ga_brand}")
    if ga_tax:
        bits.append(f"GA taxonomy rank: {ga_tax}")
    if reasons:
        bits.append(f"Why now: {reasons}")
    return " | ".join(bits)


def main() -> None:
    fast_lane = read_csv(FAST_LANE_CSV)
    products = read_json(PRODUCTS_JSON)
    product_ids = {row.get("sku"): row.get("id") for row in products if row.get("sku") and row.get("id")}

    update_rows = []
    for row in fast_lane:
        sku = row.get("sku", "")
        product_id = product_ids.get(sku)
        if not product_id:
            continue
        queue_priority = parse_int(row.get("score"))
        enrichment_priority = map_enrichment_priority(row.get("priority_band", ""))
        update_rows.append(
            {
                "id": product_id,
                "sku": sku,
                "name": row.get("name", ""),
                "queue_priority": str(queue_priority),
                "enrichment_priority": str(enrichment_priority),
                "validation_status": "needs_review",
                "enrichment_source": "codex_fast_lane",
                "enrichment_note": build_note(row),
                "priority_band": row.get("priority_band", ""),
                "ga_brand_rank": row.get("ga_brand_rank", ""),
                "ga_taxonomy_rank": row.get("ga_taxonomy_rank", ""),
            }
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(update_rows[0].keys()))
        writer.writeheader()
        writer.writerows(update_rows)

    summary = {
        "total_fast_lane_rows": len(fast_lane),
        "live_rows_with_ids": len(update_rows),
        "priority_bands": {},
        "top_10": update_rows[:10],
    }
    for row in update_rows:
        band = row["priority_band"]
        summary["priority_bands"][band] = summary["priority_bands"].get(band, 0) + 1

    OUTPUT_SUMMARY.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
