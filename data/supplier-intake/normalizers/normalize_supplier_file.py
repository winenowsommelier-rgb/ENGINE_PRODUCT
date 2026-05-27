#!/usr/bin/env python3
"""Starter supplier-file normalizer.

This is intentionally conservative. It can normalize simple exported CSV files
now, and gives us stable hooks for XLSX/PDF parsers once Drive download/export
is wired into the app.
"""

from __future__ import annotations

import argparse
import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path


CANONICAL_COLUMNS = [
    "intake_batch_id",
    "supplier_code",
    "supplier_name",
    "pricing_structure",
    "drive_bucket",
    "drive_supplier_folder_name",
    "source_file_name",
    "source_file_id",
    "source_sheet",
    "source_row_number",
    "source_line_number",
    "supplier_item_code",
    "barcode",
    "product_name",
    "brand",
    "category",
    "sub_category",
    "origin",
    "country",
    "region",
    "grape",
    "volume_ml",
    "pack_size",
    "vintage",
    "alcohol_pct",
    "cost_ex_vat",
    "cost_inc_vat",
    "supplier_cost",
    "rsp_price",
    "currency",
    "vat_status",
    "discount_pct",
    "raw_price_text",
    "match_key",
    "match_status",
    "matched_sku",
    "proposed_sku",
    "price_rule_id",
    "proposed_selling_price",
    "parse_confidence",
    "needs_human_review",
    "validation_errors",
    "notes",
]


def clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def parse_decimal(value: str | None) -> Decimal | None:
    text = clean_text(value).replace(",", "").replace("%", "")
    if not text or text in {"-", "N/A", "n/a"}:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def decimal_to_text(value: Decimal | None) -> str:
    if value is None:
        return ""
    return format(value.quantize(Decimal("0.01")), "f")


def match_key(name: str, volume_ml: str = "", vintage: str = "") -> str:
    raw = " ".join(part for part in [name, volume_ml, vintage] if part)
    return re.sub(r"[^a-z0-9]+", " ", raw.lower()).strip()


def empty_row(args: argparse.Namespace, source_row_number: int) -> dict[str, str]:
    row = {column: "" for column in CANONICAL_COLUMNS}
    row.update(
        {
            "intake_batch_id": args.intake_batch_id,
            "supplier_code": args.supplier_code,
            "supplier_name": args.supplier_name,
            "pricing_structure": args.pricing_structure,
            "drive_bucket": args.drive_bucket,
            "drive_supplier_folder_name": args.drive_supplier_folder_name,
            "source_file_name": args.source_file_name or Path(args.input).name,
            "source_file_id": args.source_file_id,
            "source_sheet": args.source_sheet,
            "source_row_number": str(source_row_number),
            "currency": "THB",
            "match_status": "unmatched",
        }
    )
    return row


def normalize_bb_and_b_simple_discount(args: argparse.Namespace) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with open(args.input, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for line_number, source in enumerate(reader, start=2):
            product_name = clean_text(source.get("Product"))
            if not product_name:
                continue

            normal_price = parse_decimal(source.get("Normal Price"))
            discount = parse_decimal(source.get("Discount")) or Decimal("0")
            if discount > 1:
                discount = discount / Decimal("100")
            supplier_cost = None
            if normal_price is not None:
                supplier_cost = normal_price * (Decimal("1") - discount)

            output = empty_row(args, line_number)
            output.update(
                {
                    "supplier_item_code": clean_text(source.get("Code")),
                    "product_name": product_name,
                    "supplier_cost": decimal_to_text(supplier_cost),
                    "discount_pct": decimal_to_text(discount * Decimal("100")),
                    "raw_price_text": clean_text(source.get("Normal Price")),
                    "match_key": match_key(product_name),
                    "parse_confidence": "high",
                    "needs_human_review": "false",
                    "notes": "Cost calculated from Normal Price less Discount.",
                }
            )
            rows.append(output)
    return rows


def normalize_unimplemented(args: argparse.Namespace) -> list[dict[str, str]]:
    output = empty_row(args, 0)
    output.update(
        {
            "parse_confidence": "low",
            "needs_human_review": "true",
            "validation_errors": f"Profile {args.profile} is not implemented in this starter script yet.",
        }
    )
    return [output]


NORMALIZERS = {
    "ambrose_pdf_winenow_table": normalize_unimplemented,
    "bb_and_b_simple_discount": normalize_bb_and_b_simple_discount,
    "gfour_pdf_trade_proposal_draft": normalize_unimplemented,
    "great_wine_tabular_rsp": normalize_unimplemented,
    "italasia_repeated_headers": normalize_unimplemented,
    "iws_pdf_code_table_draft": normalize_unimplemented,
    "sk_liquor_pdf_catalog_draft": normalize_unimplemented,
    "surawong_pdf_table_draft": normalize_unimplemented,
    "universal_pdf_catalog_draft": normalize_unimplemented,
    "united_beverage_thai_quote": normalize_unimplemented,
    "vanichwathana_repeated_headers": normalize_unimplemented,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize a supplier source file into the canonical intake CSV.")
    parser.add_argument("--profile", required=True, choices=sorted(NORMALIZERS))
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--intake-batch-id", default="")
    parser.add_argument("--supplier-code", required=True)
    parser.add_argument("--supplier-name", default="")
    parser.add_argument("--pricing-structure", default="")
    parser.add_argument("--drive-bucket", default="")
    parser.add_argument("--drive-supplier-folder-name", default="")
    parser.add_argument("--source-file-name", default="")
    parser.add_argument("--source-file-id", default="")
    parser.add_argument("--source-sheet", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = NORMALIZERS[args.profile](args)
    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CANONICAL_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} normalized row(s) to {args.output}")


if __name__ == "__main__":
    main()
