#!/usr/bin/env python3
"""Match a normalized supplier CSV against the master SKU file."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MASTERFILE = ROOT / "data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB - MR2026MAR31.csv"


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_text(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", clean(value).lower()).strip()


def normalize_size(value: str | None) -> str:
    text = clean(value).lower().replace(" ", "")
    match = re.search(r"(\d+(?:\.\d+)?)(ml|cl|l)", text)
    if not match:
        return text
    qty = float(match.group(1))
    unit = match.group(2)
    if unit == "l":
        qty *= 1000
    elif unit == "cl":
        qty *= 10
    return str(int(qty)) if qty.is_integer() else str(qty)


def sku_supplier_suffix(sku: str) -> str:
    return clean(sku)[-2:].upper()


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def build_master_indexes() -> tuple[dict[str, list[dict[str, str]]], dict[str, list[dict[str, str]]], dict[str, list[dict[str, str]]]]:
    by_suffix: dict[str, list[dict[str, str]]] = defaultdict(list)
    by_supplier_item_code: dict[str, list[dict[str, str]]] = defaultdict(list)
    by_name_key: dict[str, list[dict[str, str]]] = defaultdict(list)

    for row in read_csv(MASTERFILE):
        sku = clean(row.get("sku"))
        suffix = sku_supplier_suffix(sku)
        supplier_item_code = normalize_text(row.get("supplier_code"))
        name_key = "|".join(
            [
                suffix,
                normalize_text(row.get("name")),
                normalize_size(row.get("bottle_size")),
                normalize_text(row.get("vintage")),
            ]
        )
        row["_supplier_suffix"] = suffix
        row["_name_key"] = name_key
        by_suffix[suffix].append(row)
        if supplier_item_code:
            by_supplier_item_code[f"{suffix}|{supplier_item_code}"].append(row)
        by_name_key[name_key].append(row)
    return by_suffix, by_supplier_item_code, by_name_key


def match_row(
    source: dict[str, str],
    by_supplier_item_code: dict[str, list[dict[str, str]]],
    by_name_key: dict[str, list[dict[str, str]]],
) -> tuple[str, str, str]:
    supplier_code = clean(source.get("supplier_code")).upper()
    supplier_item_code = normalize_text(source.get("supplier_item_code"))

    if supplier_item_code:
        exact_code_matches = by_supplier_item_code.get(f"{supplier_code}|{supplier_item_code}", [])
        if len(exact_code_matches) == 1:
            return "matched_exact_supplier_item_code", clean(exact_code_matches[0].get("sku")), ""
        if len(exact_code_matches) > 1:
            return "ambiguous_supplier_item_code", "", "; ".join(clean(r.get("sku")) for r in exact_code_matches[:10])

    name_key = "|".join(
        [
            supplier_code,
            normalize_text(source.get("product_name")),
            normalize_size(source.get("volume_ml") or source.get("bottle_size") or source.get("size")),
            normalize_text(source.get("vintage")),
        ]
    )
    name_matches = by_name_key.get(name_key, [])
    if len(name_matches) == 1:
        return "matched_exact_name_size_vintage", clean(name_matches[0].get("sku")), ""
    if len(name_matches) > 1:
        return "ambiguous_name_size_vintage", "", "; ".join(clean(r.get("sku")) for r in name_matches[:10])
    return "unmatched", "", ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Match normalized supplier rows to existing master SKUs.")
    parser.add_argument("--input", required=True, help="Normalized supplier CSV")
    parser.add_argument("--output", required=True, help="Matched output CSV")
    parser.add_argument("--summary-output", default="", help="Optional summary CSV path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows = read_csv(Path(args.input))
    _, by_supplier_item_code, by_name_key = build_master_indexes()

    output_rows: list[dict[str, str]] = []
    counts: Counter[str] = Counter()
    for row in rows:
        match_status, matched_sku, candidates = match_row(row, by_supplier_item_code, by_name_key)
        row = dict(row)
        row["match_status"] = match_status
        row["matched_sku"] = matched_sku
        row["match_candidates"] = candidates
        output_rows.append(row)
        counts[match_status] += 1

    fieldnames = list(output_rows[0].keys()) if output_rows else []
    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)

    total = len(output_rows)
    matched = sum(qty for status, qty in counts.items() if status.startswith("matched_"))
    pct = (matched / total * 100) if total else 0
    print(f"matched {matched}/{total} rows ({pct:.2f}%)")
    for status, qty in counts.most_common():
        print(f"{status}: {qty}")

    if args.summary_output:
        with open(args.summary_output, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["metric", "value"])
            writer.writeheader()
            writer.writerow({"metric": "total_rows", "value": total})
            writer.writerow({"metric": "matched_rows", "value": matched})
            writer.writerow({"metric": "matched_pct", "value": f"{pct:.2f}"})
            for status, qty in counts.most_common():
                writer.writerow({"metric": status, "value": qty})


if __name__ == "__main__":
    main()

