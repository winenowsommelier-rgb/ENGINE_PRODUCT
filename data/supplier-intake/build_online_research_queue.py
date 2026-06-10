#!/usr/bin/env python3
"""Create an online-research queue from product_admin review rows."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path


RESEARCH_FIELDS = [
    "research_queue_id",
    "review_queue_id",
    "supplier_code",
    "supplier_name",
    "supplier_item_code",
    "raw_supplier_product_name",
    "proposed_item_name",
    "brand",
    "category",
    "country",
    "region",
    "volume_ml",
    "vintage",
    "online_research_query",
    "online_research_status",
    "research_priority",
    "required_evidence",
    "source_file_name",
    "source_file_id",
    "source_row_number",
    "product_admin_notes",
]


def clean(value: str | None) -> str:
    return (value or "").strip()


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def needs_research(row: dict[str, str]) -> bool:
    return clean(row.get("online_research_status")) == "required"


def priority(row: dict[str, str]) -> str:
    if clean(row.get("review_status")) == "new_product":
        return "high"
    if clean(row.get("review_status")) == "supplier_changed":
        return "high"
    if clean(row.get("name_review_status")) == "needs_online_research":
        return "medium"
    return "low"


def required_evidence(row: dict[str, str]) -> str:
    parts = [
        "official producer/importer page when available",
        "bottle size",
        "vintage or non-vintage status",
        "country/region/appellation",
    ]
    if clean(row.get("review_status")) == "supplier_changed":
        parts.append("evidence that item is same product as inactive SKU candidate")
    return "; ".join(parts)


def build_rows(review_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    research_rows: list[dict[str, str]] = []
    for row in review_rows:
        if not needs_research(row):
            continue
        output = dict(row)
        output["research_queue_id"] = f"research_{clean(row.get('review_queue_id'))}"
        output["research_priority"] = priority(row)
        output["required_evidence"] = required_evidence(row)
        research_rows.append({field: output.get(field, "") for field in RESEARCH_FIELDS})
    return research_rows


def write_summary(rows: list[dict[str, str]], output: Path) -> None:
    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_rows": len(rows),
        "priority_counts": dict(Counter(row["research_priority"] for row in rows)),
        "supplier_counts": dict(Counter(row["supplier_code"] for row in rows)),
    }
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build online product-name research queue from review rows.")
    parser.add_argument("--input", required=True, help="Product admin review CSV")
    parser.add_argument("--output", required=True, help="Online research queue CSV")
    parser.add_argument("--summary-output", default="", help="Optional summary JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = build_rows(read_csv(Path(args.input)))

    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=RESEARCH_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"wrote {len(rows)} online research rows to {args.output}")
    if args.summary_output:
        write_summary(rows, Path(args.summary_output))
        print(f"wrote online research summary to {args.summary_output}")


if __name__ == "__main__":
    main()
