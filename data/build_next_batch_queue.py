from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


WORK_DIR = Path("/Users/admin/Documents/CODEX Projects/research_jobs")
PROGRESS_DIR = WORK_DIR / "progress_outputs"
DATA_DIR = Path("/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data")

BACKLOG_CSV = WORK_DIR / "master_research_backlog.csv"
MASTER_PROGRESS = PROGRESS_DIR / "master_item_reference_with_descriptions_status_in_progress.csv"
PRODUCTS_JSON = DATA_DIR / "db" / "products.json"
PRODUCER_LIBRARY = WORK_DIR / "producer_evidence_library.csv"
GA_PRODUCTS = DATA_DIR / "ga_priority_products.csv"
GA_BRANDS = DATA_DIR / "ga_priority_brands.csv"
GA_TAXONOMY = DATA_DIR / "ga_priority_taxonomy.csv"

FIELDS = [
    "priority_rank",
    "sku",
    "name",
    "source_files",
    "task_types",
    "classification",
    "country",
    "region",
    "producer_inferred",
    "category_bucket",
    "has_live_record",
    "ga_product_rank",
    "ga_brand_rank",
    "ga_taxonomy_rank",
    "producer_repeat_count",
    "task_count",
    "priority_band",
    "score",
    "why_now",
]


def load_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_int(value) -> int:
    if value in (None, ""):
        return 0
    return int(float(str(value).replace(",", "").strip()))


def best_taxonomy_rank(names: list[str], rank_map: dict[str, int], type_map: dict[str, str]):
    candidates = []
    for name in [n.strip().lower() for n in names if n]:
        if name in rank_map:
            candidates.append((rank_map[name], f"{name} ({type_map.get(name, 'taxonomy')})"))
            continue
        for tax_name, rank in rank_map.items():
            if name == tax_name:
                candidates.append((rank, f"{tax_name} ({type_map.get(tax_name, 'taxonomy')})"))
                break
            if name and (name in tax_name or tax_name in name):
                candidates.append((rank, f"{tax_name} ({type_map.get(tax_name, 'taxonomy')})"))
    return min(candidates, default=(0, ""))


def main() -> None:
    backlog = load_csv(BACKLOG_CSV)
    master = load_csv(MASTER_PROGRESS)
    products = load_json(PRODUCTS_JSON)
    producer_rows = load_csv(PRODUCER_LIBRARY)
    ga_product_rows = load_csv(GA_PRODUCTS)
    ga_brand_rows = load_csv(GA_BRANDS)
    ga_taxonomy_rows = load_csv(GA_TAXONOMY)
    product_brand_by_sku = {row.get("sku"): row.get("brand", "") for row in products if row.get("sku")}

    live_skus = {row.get("sku") for row in products if row.get("sku")}
    done_skus = {row.get("sku") for row in master if row.get("research_status") == "in_progress_done"}
    master_by_sku = {row.get("sku"): row for row in master if row.get("sku")}
    producer_count_map = {
        row.get("producer_inferred", ""): int((row.get("sku_count") or "0").strip() or "0")
        for row in producer_rows
    }
    ga_product_rank = {
        row.get("sku", ""): parse_int(row.get("priority_rank"))
        for row in ga_product_rows
        if row.get("sku")
    }
    ga_brand_rank = {
        row.get("brand", ""): parse_int(row.get("priority_rank"))
        for row in ga_brand_rows
        if row.get("brand")
    }
    ga_taxonomy_rank = {
        (row.get("taxonomy_name") or "").lower().strip(): parse_int(row.get("priority_rank"))
        for row in ga_taxonomy_rows
        if row.get("taxonomy_name")
    }
    ga_taxonomy_type = {
        (row.get("taxonomy_name") or "").lower().strip(): row.get("taxonomy_type", "")
        for row in ga_taxonomy_rows
        if row.get("taxonomy_name")
    }

    backlog_meta = {}
    for row in backlog:
        sku = row.get("sku")
        if not sku:
            continue
        entry = backlog_meta.setdefault(sku, {})
        for field in ["name", "producer_inferred", "classification", "country", "region", "category_bucket"]:
            if not entry.get(field) and row.get(field):
                entry[field] = row.get(field)

    sku_meta = {}
    for row in master:
        sku = row.get("sku")
        if not sku or sku in done_skus:
            continue
        merged = dict(backlog_meta.get(sku, {}))
        merged.update({k: v for k, v in row.items() if v})
        sku_meta[sku] = merged

    tasks_by_sku = defaultdict(set)
    files_by_sku = defaultdict(set)
    for row in backlog:
        sku = row.get("sku")
        if not sku or sku in done_skus:
            continue
        tasks_by_sku[sku].add(row.get("task_type", ""))
        files_by_sku[sku].add(row.get("source_file", ""))

    queue_rows = []
    for sku, row in sku_meta.items():
        master_row = master_by_sku.get(sku, {})
        producer = row.get("producer_inferred", "")
        producer_repeat = producer_count_map.get(producer, 0)
        has_live = sku in live_skus
        task_count = len(tasks_by_sku.get(sku, set()))
        source_files = sorted(files_by_sku.get(sku, set()))
        validation = (master_row.get("validation") or "").strip()
        confidence = (master_row.get("confidence_level") or "").strip()
        existing_sources = (master_row.get("sources") or "").strip()
        brand_name = (product_brand_by_sku.get(sku) or "").strip()
        if not brand_name:
            brand_name = (row.get("style_or_brand") or "").strip()
        if not brand_name and sku in master_by_sku:
            brand_name = (master_by_sku[sku].get("style_or_brand") or "").strip()
        category_name = (row.get("classification") or "").strip().lower()
        region_name = (row.get("region") or "").strip().lower()
        country_name = (row.get("country") or "").strip().lower()
        ga_sku_rank = ga_product_rank.get(sku, 0)
        ga_brand = brand_name if brand_name in ga_brand_rank else producer
        ga_brand_pos = ga_brand_rank.get(ga_brand, 0)
        taxonomy_candidates = [category_name, region_name, country_name]
        ga_tax_rank, ga_tax_label = best_taxonomy_rank(taxonomy_candidates, ga_taxonomy_rank, ga_taxonomy_type)

        score = 0
        score += 30 if has_live else 0
        score += min(producer_repeat, 15)
        score += task_count * 10
        score += 14 if "ai_research_flavor_t2.txt" in source_files else 0
        score += 6 if row.get("category_bucket") in {"wine", "sparkling_wine", "gin", "liqueur", "brandy_and_grappa"} else 0
        score += 4 if row.get("country") in {"France", "Italy", "Japan", "Australia", "USA", "Chile"} else 0
        score += 8 if producer_repeat >= 5 else 0
        score += 6 if task_count >= 2 else 0
        score += 4 if confidence == "A" else 0
        score += 2 if confidence == "B" else 0
        score += 3 if validation == "partially_verified" and existing_sources else 0
        if ga_sku_rank:
            score += max(36 - ga_sku_rank, 8)
        if ga_brand_pos:
            score += max(24 - ga_brand_pos, 4)
        if ga_tax_rank:
            score += max(18 - ga_tax_rank, 3)

        reasons = []
        if has_live:
            reasons.append("live Product Engine record")
        if ga_sku_rank:
            reasons.append(f"top GA product rank #{ga_sku_rank}")
        if ga_brand_pos:
            reasons.append(f"top GA brand rank #{ga_brand_pos}")
        if ga_tax_rank and ga_tax_label:
            reasons.append(f"top GA taxonomy signal: {ga_tax_label}")
        if producer_repeat >= 3:
            reasons.append(f"repeated producer ({producer_repeat} SKUs)")
        if task_count > 1:
            reasons.append(f"appears in {task_count} task queues")
        if "ai_research_flavor_t2.txt" in source_files:
            reasons.append("current priority TXT file")
        if producer_repeat >= 5:
            reasons.append("strong producer reuse")
        if row.get("country") in {"France", "Italy", "Japan", "Australia", "USA", "Chile"}:
            reasons.append("high-frequency country")
        if not reasons:
            reasons.append("fills uncovered backlog")

        if ga_sku_rank and has_live:
            priority_band = "ga_publish_fast_lane"
        elif has_live and task_count >= 2:
            priority_band = "publish_fast_lane"
        elif ga_brand_pos and ga_brand_pos <= 10:
            priority_band = "ga_brand_cluster"
        elif ga_tax_rank and ga_tax_rank <= 12:
            priority_band = "ga_taxonomy_lane"
        elif has_live or producer_repeat >= 5:
            priority_band = "high_value_cluster"
        else:
            priority_band = "coverage_lane"

        queue_rows.append(
            {
                "sku": sku,
                "name": row.get("name", ""),
                "source_files": ", ".join(source_files),
                "task_types": ", ".join(sorted(tasks_by_sku.get(sku, set()))),
                "classification": row.get("classification", ""),
                "country": row.get("country", ""),
                "region": row.get("region", ""),
                "producer_inferred": producer,
                "category_bucket": row.get("category_bucket", ""),
                "has_live_record": "yes" if has_live else "no",
                "ga_product_rank": str(ga_sku_rank) if ga_sku_rank else "",
                "ga_brand_rank": str(ga_brand_pos) if ga_brand_pos else "",
                "ga_taxonomy_rank": str(ga_tax_rank) if ga_tax_rank else "",
                "producer_repeat_count": str(producer_repeat),
                "task_count": str(task_count),
                "priority_band": priority_band,
                "score": str(score),
                "why_now": "; ".join(reasons),
            }
        )

    queue_rows.sort(key=lambda r: (-int(r["score"]), r["sku"]))
    for index, row in enumerate(queue_rows, start=1):
        row["priority_rank"] = str(index)

    out_csv = PROGRESS_DIR / "next_best_batch_queue.csv"
    with out_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(queue_rows)

    fast_lane = [
        row
        for row in queue_rows
        if row["priority_band"] in {"ga_publish_fast_lane", "publish_fast_lane", "ga_brand_cluster", "ga_taxonomy_lane"}
    ][:150]
    fast_lane_path = PROGRESS_DIR / "next_fast_lane_queue.csv"
    with fast_lane_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(fast_lane)

    top20 = queue_rows[:20]
    summary = {
        "pending_unique_skus": len(queue_rows),
        "fast_lane_rows": len(fast_lane),
        "top_20_live_records": sum(1 for row in top20 if row["has_live_record"] == "yes"),
        "top_20_repeated_producers": sum(1 for row in top20 if int(row["producer_repeat_count"]) >= 3),
        "top_20_ga_products": sum(1 for row in top20 if row["ga_product_rank"]),
        "top_20_ga_brands": sum(1 for row in top20 if row["ga_brand_rank"]),
        "top_20_ga_taxonomy": sum(1 for row in top20 if row["ga_taxonomy_rank"]),
        "top_20_priority_bands": dict(Counter(row["priority_band"] for row in top20)),
        "top_20_task_mix": dict(Counter(task for row in top20 for task in row["task_types"].split(", ") if task)),
    }
    summary_path = PROGRESS_DIR / "next_best_batch_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
