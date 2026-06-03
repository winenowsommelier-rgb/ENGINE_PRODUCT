#!/usr/bin/env python3
"""Product identity matching for supplier intake.

This matcher is conservative by design. It creates review decisions rather than
silently importing supplier rows into the masterfile.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MASTERFILE = ROOT / "data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB - MR2026MAR31.csv"


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_text(value: str | None) -> str:
    text = clean(value).lower()
    replacements = {
        "&": " and ",
        "’": "'",
        "`": "'",
        " ml": "ml",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


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


def sku_suffix(sku: str) -> str:
    return clean(sku)[-2:].upper()


def replace_sku_suffix(sku: str, supplier_code: str) -> str:
    sku = clean(sku)
    supplier_code = clean(supplier_code).upper()
    if len(sku) < 2 or len(supplier_code) != 2:
        return ""
    return sku[:-2] + supplier_code


def stable_id(parts: list[str]) -> str:
    raw = "|".join(parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def identity_parts(row: dict[str, str]) -> list[str]:
    return [
        normalize_text(row.get("brand") or row.get("manufacturer")),
        normalize_text(row.get("product_name") or row.get("name")),
        normalize_text(row.get("category") or row.get("Type") or row.get("type")),
        normalize_size(row.get("volume_ml") or row.get("bottle_size")),
        normalize_text(row.get("vintage")),
        normalize_text(row.get("country")),
        normalize_text(row.get("region") or row.get("region_wine")),
    ]


def product_identity_id(row: dict[str, str]) -> str:
    return "pid_" + stable_id(identity_parts(row))


def identity_key(row: dict[str, str]) -> str:
    return "|".join(identity_parts(row))


def name_tokens(row: dict[str, str]) -> str:
    parts = [
        row.get("brand") or row.get("manufacturer") or "",
        row.get("product_name") or row.get("name") or "",
        row.get("vintage") or "",
        row.get("volume_ml") or row.get("bottle_size") or "",
    ]
    return normalize_text(" ".join(parts))


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


class ProductIdentityMatcher:
    def __init__(self, master_rows: list[dict[str, str]]):
        self.master_rows = master_rows
        self.by_supplier_item_code: dict[str, list[dict[str, str]]] = defaultdict(list)
        self.by_identity_key: dict[str, list[dict[str, str]]] = defaultdict(list)
        self.by_suffix: dict[str, list[dict[str, str]]] = defaultdict(list)

        for row in master_rows:
            sku = clean(row.get("sku"))
            suffix = sku_suffix(sku)
            row["_supplier_suffix"] = suffix
            row["_product_identity_id"] = product_identity_id(row)
            row["_identity_key"] = identity_key(row)
            row["_name_tokens"] = name_tokens(row)
            supplier_item_code = normalize_text(row.get("supplier_code"))
            if supplier_item_code:
                self.by_supplier_item_code[f"{suffix}|{supplier_item_code}"].append(row)
            self.by_identity_key[row["_identity_key"]].append(row)
            self.by_suffix[suffix].append(row)

    def match(self, supplier_row: dict[str, str]) -> dict[str, str]:
        supplier_code = clean(supplier_row.get("supplier_code")).upper()
        supplier_item_code = normalize_text(supplier_row.get("supplier_item_code"))
        incoming_identity = identity_key(supplier_row)
        incoming_tokens = name_tokens(supplier_row)

        if supplier_item_code:
            code_matches = self.by_supplier_item_code.get(f"{supplier_code}|{supplier_item_code}", [])
            if len(code_matches) == 1:
                return self._decision("exact_match", code_matches[0], 100, "supplier item code matched within supplier suffix", supplier_code)
            if len(code_matches) > 1:
                return self._ambiguous("possible_duplicate", code_matches, 92, "supplier item code matched multiple SKUs")

        exact_identity_matches = self.by_identity_key.get(incoming_identity, [])
        same_supplier = [row for row in exact_identity_matches if row["_supplier_suffix"] == supplier_code]
        other_supplier = [row for row in exact_identity_matches if row["_supplier_suffix"] != supplier_code]
        if len(same_supplier) == 1:
            return self._decision("probable_match", same_supplier[0], 91, "exact identity matched within supplier suffix", supplier_code)
        if len(same_supplier) > 1:
            return self._ambiguous("possible_duplicate", same_supplier, 88, "exact identity matched multiple SKUs in supplier suffix")
        if len(other_supplier) == 1:
            return self._decision("supplier_changed", other_supplier[0], 90, "same product identity exists under a different supplier suffix", supplier_code)
        if len(other_supplier) > 1:
            return self._ambiguous("possible_duplicate", other_supplier, 86, "same identity exists under multiple other supplier suffixes")

        best_row: dict[str, str] | None = None
        best_score = 0.0
        for row in self.by_suffix.get(supplier_code, []):
            score = SequenceMatcher(None, incoming_tokens, row["_name_tokens"]).ratio()
            if score > best_score:
                best_score = score
                best_row = row
        if best_row and best_score >= 0.88:
            return self._decision("probable_match", best_row, round(best_score * 100), "high text similarity within supplier suffix", supplier_code)
        if best_row and best_score >= 0.78:
            return self._decision("possible_duplicate", best_row, round(best_score * 100), "medium text similarity needs review", supplier_code)

        return {
            "review_status": "new_product",
            "matched_sku": "",
            "matched_product_identity_id": "",
            "sku_action": "propose_new_sku",
            "proposed_sku": "",
            "inactive_sku": "",
            "approver_role": "product_admin",
            "confidence_score": "0",
            "decision_reason": "no supplier code, identity, or strong text match found",
            "candidate_skus": "",
        }

    def _decision(self, status: str, row: dict[str, str], confidence: int, reason: str, supplier_code: str) -> dict[str, str]:
        matched_sku = clean(row.get("sku"))
        proposed_sku = replace_sku_suffix(matched_sku, supplier_code) if status == "supplier_changed" else ""
        return {
            "review_status": status,
            "matched_sku": matched_sku,
            "matched_product_identity_id": row["_product_identity_id"],
            "sku_action": "change_supplier_suffix_and_inactivate_old" if status == "supplier_changed" else "update_existing_sku",
            "proposed_sku": proposed_sku,
            "inactive_sku": matched_sku if status == "supplier_changed" else "",
            "approver_role": "product_admin",
            "confidence_score": str(confidence),
            "decision_reason": reason,
            "candidate_skus": matched_sku,
        }

    def _ambiguous(self, status: str, rows: list[dict[str, str]], confidence: int, reason: str) -> dict[str, str]:
        return {
            "review_status": status,
            "matched_sku": "",
            "matched_product_identity_id": "",
            "sku_action": "manual_review",
            "proposed_sku": "",
            "inactive_sku": "",
            "approver_role": "product_admin",
            "confidence_score": str(confidence),
            "decision_reason": reason,
            "candidate_skus": "; ".join(clean(row.get("sku")) for row in rows[:10]),
        }


def run_self_test() -> None:
    master = [
        {
            "sku": "WRW0001AA",
            "supplier_code": "WBT-002S",
            "brand": "Batasiolo",
            "name": "Batasiolo Moscato Spumante Dolce",
            "bottle_size": "750 ml",
            "vintage": "NV",
            "Type": "WDW",
            "country": "Italy",
            "region_wine": "Piedmont",
        },
        {
            "sku": "WRW0999GE",
            "supplier_code": "",
            "brand": "The Blind Pig",
            "name": "The Blind Pig Merlot",
            "bottle_size": "750 ml",
            "vintage": "2024",
            "Type": "Wine",
            "country": "Australia",
            "region_wine": "South Eastern Australia",
        },
    ]
    matcher = ProductIdentityMatcher(master)
    exact = matcher.match({"supplier_code": "AA", "supplier_item_code": "WBT-002S", "product_name": "Wrong typo"})
    changed = matcher.match({
        "supplier_code": "AB",
        "product_name": "Batasiolo Moscato Spumante Dolce",
        "brand": "Batasiolo",
        "volume_ml": "750 ml",
        "vintage": "NV",
        "category": "WDW",
        "country": "Italy",
        "region": "Piedmont",
    })
    probable = matcher.match({
        "supplier_code": "GE",
        "product_name": "The Blind Pig Merlot",
        "brand": "The Blind Pig",
        "volume_ml": "750ml",
        "vintage": "2024",
        "category": "Wine",
        "country": "Australia",
        "region": "South Eastern Australia",
    })
    assert exact["review_status"] == "exact_match", exact
    assert changed["review_status"] == "supplier_changed", changed
    assert changed["proposed_sku"] == "WRW0001AB", changed
    assert changed["inactive_sku"] == "WRW0001AA", changed
    assert probable["review_status"] == "probable_match", probable
    print("self-test passed")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Match normalized supplier rows to product identities.")
    parser.add_argument("--input", help="Normalized supplier CSV")
    parser.add_argument("--output", help="Matched review CSV")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.self_test:
        run_self_test()
        return
    if not args.input or not args.output:
        raise SystemExit("--input and --output are required unless --self-test is used")

    matcher = ProductIdentityMatcher(read_csv(MASTERFILE))
    rows = read_csv(Path(args.input))
    output_rows: list[dict[str, str]] = []
    for row in rows:
        decision = matcher.match(row)
        row = dict(row)
        row.update(decision)
        output_rows.append(row)

    fieldnames = list(output_rows[0].keys()) if output_rows else []
    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)
    print(f"wrote {len(output_rows)} review rows to {args.output}")


if __name__ == "__main__":
    main()
