#!/usr/bin/env python3
"""Build product_admin review queue from normalized supplier intake rows."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from product_identity_matcher import MASTERFILE, ProductIdentityMatcher, read_csv  # noqa: E402
from product_name_normalizer import propose_name  # noqa: E402


REVIEW_FIELDS = [
    "review_queue_id",
    "review_status",
    "approval_required",
    "approver_role",
    "supplier_code",
    "supplier_name",
    "supplier_item_code",
    "source_file_name",
    "source_file_id",
    "source_sheet",
    "source_row_number",
    "raw_supplier_product_name",
    "proposed_item_name",
    "proposed_seo_title",
    "proposed_slug",
    "name_confidence_score",
    "name_review_status",
    "name_review_reasons",
    "online_research_status",
    "online_research_query",
    "matched_sku",
    "matched_product_identity_id",
    "sku_action",
    "proposed_sku",
    "inactive_sku",
    "candidate_skus",
    "confidence_score",
    "decision_reason",
    "brand",
    "category",
    "country",
    "region",
    "volume_ml",
    "vintage",
    "supplier_cost",
    "rsp_price",
    "currency",
    "vat_status",
    "parse_confidence",
    "validation_errors",
    "product_admin_decision",
    "product_admin_notes",
]


def clean(value: str | None) -> str:
    return (value or "").strip()


def review_queue_id(row: dict[str, str], index: int) -> str:
    supplier = clean(row.get("supplier_code")) or "SUP"
    source = clean(row.get("source_file_id")) or clean(row.get("source_file_name")) or "source"
    row_no = clean(row.get("source_row_number")) or str(index)
    digest = hashlib.sha1(f"{supplier}|{source}|{row_no}".encode("utf-8")).hexdigest()[:10]
    return f"rq_{supplier}_{digest}"


def approval_required(row: dict[str, str]) -> str:
    if row.get("review_status") != "exact_match":
        return "true"
    if row.get("name_review_status") != "ready_for_product_admin_review":
        return "true"
    if row.get("parse_confidence") in {"low", "medium"}:
        return "true"
    if clean(row.get("validation_errors")):
        return "true"
    return "false"


def build_review_rows(normalized_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    matcher = ProductIdentityMatcher(read_csv(MASTERFILE))
    review_rows: list[dict[str, str]] = []

    for index, source in enumerate(normalized_rows, start=1):
        row = dict(source)
        row.update(matcher.match(row))
        row.update(propose_name(row))
        row["approval_required"] = approval_required(row)
        row["review_queue_id"] = review_queue_id(row, index)
        row["product_admin_decision"] = ""
        row["product_admin_notes"] = ""
        review_rows.append({field: row.get(field, "") for field in REVIEW_FIELDS})

    return review_rows


def write_summary(rows: list[dict[str, str]], output: Path) -> None:
    counts = {
        "review_status": Counter(row["review_status"] for row in rows),
        "name_review_status": Counter(row["name_review_status"] for row in rows),
        "online_research_status": Counter(row["online_research_status"] for row in rows),
        "approval_required": Counter(row["approval_required"] for row in rows),
    }
    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_rows": len(rows),
        "counts": {key: dict(value) for key, value in counts.items()},
    }
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build product_admin review queue from normalized supplier rows.")
    parser.add_argument("--input", required=True, help="Normalized supplier CSV")
    parser.add_argument("--output", required=True, help="Product admin review CSV")
    parser.add_argument("--summary-output", default="", help="Optional summary JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = read_csv(Path(args.input))
    review_rows = build_review_rows(rows)

    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
        writer.writeheader()
        writer.writerows(review_rows)

    print(f"wrote {len(review_rows)} review rows to {args.output}")
    if args.summary_output:
        write_summary(review_rows, Path(args.summary_output))
        print(f"wrote review summary to {args.summary_output}")


if __name__ == "__main__":
    main()
