#!/usr/bin/env python3
"""Build supplier trade-term template for pricing rules and rebates."""

from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "data/supplier-intake/supplier_trade_reference_starter.csv"
OUTPUT = ROOT / "data/supplier-intake/supplier_trade_terms_template.csv"


FIELDNAMES = [
    "supplier_code",
    "supplier_name",
    "supplier_detail",
    "pricing_structure",
    "drive_supplier_folder_name",
    "master_sku_count",
    "avg_margin_pct_2026",
    "sales_qty_2026",
    "price_source_priority",
    "cost_basis",
    "cost_calculation_type",
    "base_markup_pct",
    "target_margin_pct",
    "fixed_margin_thb",
    "rounding_rule",
    "rsp_policy",
    "rebate_type",
    "rebate_pct",
    "rebate_amount_thb",
    "volume_rebate_rule",
    "cash_discount_pct",
    "payment_terms",
    "effective_from",
    "effective_to",
    "approval_status",
    "approved_by_role",
    "notes",
]


def default_price_source(pricing_structure: str) -> str:
    if pricing_structure == "rsp_price":
        return "supplier_rsp_then_formula"
    if pricing_structure == "no_rsp_price":
        return "formula_only"
    if pricing_structure == "retail_cash_store":
        return "cash_store_cost_then_formula"
    return "define_later"


def default_cost_basis(pricing_structure: str) -> str:
    if pricing_structure == "retail_cash_store":
        return "cost_ex_vat_or_cash_invoice"
    return "supplier_cost_or_wholesale"


def default_rsp_policy(pricing_structure: str) -> str:
    if pricing_structure == "rsp_price":
        return "use_supplier_rsp_if_agreed"
    return "ignore_rsp_or_not_provided"


def main() -> None:
    rows = []
    with open(REFERENCE, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if row.get("row_type") != "supplier_code":
                continue
            pricing_structure = row.get("drive_pricing_structure", "")
            rows.append({
                "supplier_code": row.get("supplier_code", ""),
                "supplier_name": row.get("supplier_name", ""),
                "supplier_detail": row.get("supplier_detail", ""),
                "pricing_structure": pricing_structure,
                "drive_supplier_folder_name": row.get("drive_supplier_folder_name", ""),
                "master_sku_count": row.get("product_count", ""),
                "avg_margin_pct_2026": row.get("avg_margin_pct_2026", ""),
                "sales_qty_2026": row.get("sales_qty_2026", ""),
                "price_source_priority": default_price_source(pricing_structure),
                "cost_basis": default_cost_basis(pricing_structure),
                "cost_calculation_type": "define_later",
                "base_markup_pct": "",
                "target_margin_pct": "",
                "fixed_margin_thb": "",
                "rounding_rule": "round_to_nearest_5_or_9_define_later",
                "rsp_policy": default_rsp_policy(pricing_structure),
                "rebate_type": "none_or_define_later",
                "rebate_pct": "",
                "rebate_amount_thb": "",
                "volume_rebate_rule": "",
                "cash_discount_pct": "",
                "payment_terms": "",
                "effective_from": "",
                "effective_to": "",
                "approval_status": "draft",
                "approved_by_role": "product_admin",
                "notes": "Fill trade term, formula, rebate, and special agreement before automated price approval.",
            })

    with open(OUTPUT, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {OUTPUT}")


if __name__ == "__main__":
    main()

