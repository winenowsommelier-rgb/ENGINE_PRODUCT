#!/usr/bin/env python3
"""Propose normalized product names for supplier intake rows.

This step runs before human approval. It does not claim that a new product is
ready; it creates a structured name proposal and flags rows that need online
research or product_admin review.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from data.lib.product_naming import (
    clean_name,
    detect_website,
    normalize_bottle_size,
    normalize_vintage,
    strip_brand_prefix,
    to_seo_title,
    to_slug,
)


DESIGNATION_WORDS = {
    "aoc",
    "aop",
    "doc",
    "docg",
    "do",
    "dop",
    "igt",
    "igp",
    "grand cru",
    "premier cru",
    "1er cru",
    "cru bourgeois",
}


def title_preserving_known_caps(text: str) -> str:
    tokens = clean_name(text).split(" ")
    out = []
    for token in tokens:
        stripped = token.strip()
        if not stripped:
            continue
        upper = stripped.upper().strip(".,()")
        if upper in {"NV", "VSOP", "XO", "AOC", "AOP", "DOC", "DOCG", "DO", "DOP", "IGT", "IGP", "IPA", "RTD"}:
            out.append(stripped.upper())
        elif re.fullmatch(r"\d+%?", stripped):
            out.append(stripped)
        elif "'" in stripped:
            out.append("'".join(part.capitalize() for part in stripped.split("'")))
        else:
            out.append(stripped[:1].upper() + stripped[1:].lower())
    return clean_name(" ".join(out))


def normalize_supplier_product_name(raw_name: str, brand: str = "") -> str:
    name = clean_name(raw_name)
    name = name.replace("`", "'").replace("’", "'")
    name = re.sub(r"\bAcl\b", "Alc", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+,", ",", name)
    name = re.sub(r",(?=\S)", ", ", name)
    if brand:
        stripped = strip_brand_prefix(brand, name)
        if stripped:
            name = f"{clean_name(brand)} {stripped}"
    return title_preserving_known_caps(name)


def has_designation(name: str, country: str = "", region: str = "") -> bool:
    haystack = f"{name} {country} {region}".lower()
    return any(word in haystack for word in DESIGNATION_WORDS)


def review_reasons(row: dict[str, str], proposed_name: str) -> list[str]:
    reasons: list[str] = []
    if not clean_name(row.get("product_name") or row.get("name")):
        reasons.append("missing source product name")
    if not clean_name(row.get("brand")):
        reasons.append("missing brand")
    if not clean_name(row.get("country")):
        reasons.append("missing country")
    if not clean_name(row.get("volume_ml") or row.get("bottle_size")):
        reasons.append("missing bottle size")
    if len(proposed_name) < 6:
        reasons.append("proposed name too short")
    if not has_designation(proposed_name, row.get("country", ""), row.get("region", "")):
        reasons.append("appellation/designation not confirmed")
    if row.get("parse_confidence") in {"low", "medium"}:
        reasons.append(f"source parse confidence is {row.get('parse_confidence')}")
    if row.get("review_status") in {"new_product", "supplier_changed", "possible_duplicate", "probable_match"}:
        reasons.append(f"match status requires review: {row.get('review_status')}")
    return reasons


def propose_name(row: dict[str, str]) -> dict[str, str]:
    raw_name = clean_name(row.get("product_name") or row.get("name"))
    brand = clean_name(row.get("brand"))
    proposed_name = normalize_supplier_product_name(raw_name, brand)
    vintage = normalize_vintage(row.get("vintage", "")) or ""
    size = normalize_bottle_size(row.get("volume_ml") or row.get("bottle_size") or "")
    sku = clean_name(row.get("proposed_sku") or row.get("matched_sku") or row.get("sku"))
    website = detect_website(sku) if sku else None
    reasons = review_reasons(row, proposed_name)

    confidence = 90
    if "missing brand" in reasons:
        confidence -= 15
    if "appellation/designation not confirmed" in reasons:
        confidence -= 10
    if any(reason.startswith("source parse confidence") for reason in reasons):
        confidence -= 15
    if any(reason.startswith("match status requires review") for reason in reasons):
        confidence -= 10
    confidence = max(0, confidence)

    return {
        "raw_supplier_product_name": raw_name,
        "proposed_item_name": proposed_name,
        "proposed_seo_title": to_seo_title("", proposed_name, vintage, size or "", website),
        "proposed_slug": to_slug("", proposed_name, vintage, size or ""),
        "name_confidence_score": str(confidence),
        "name_review_status": "needs_online_research" if reasons else "ready_for_product_admin_review",
        "name_review_reasons": "; ".join(reasons),
        "online_research_query": build_research_query(row, proposed_name),
        "online_research_status": "required" if reasons else "optional",
        "approver_role": "product_admin",
    }


def build_research_query(row: dict[str, str], proposed_name: str) -> str:
    parts: Iterable[str] = [
        row.get("brand", ""),
        proposed_name,
        row.get("country", ""),
        row.get("region", ""),
        row.get("vintage", ""),
    ]
    return clean_name(" ".join(part for part in parts if clean_name(part)))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Add normalized product-name proposals to supplier intake rows.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    with open(args.input, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
        input_fields = list(rows[0].keys()) if rows else []

    output_rows = []
    for row in rows:
        next_row = dict(row)
        next_row.update(propose_name(row))
        output_rows.append(next_row)

    added_fields = [
        "raw_supplier_product_name",
        "proposed_item_name",
        "proposed_seo_title",
        "proposed_slug",
        "name_confidence_score",
        "name_review_status",
        "name_review_reasons",
        "online_research_query",
        "online_research_status",
        "approver_role",
    ]
    fieldnames = input_fields + [field for field in added_fields if field not in input_fields]
    with open(args.output, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(output_rows)
    print(f"wrote {len(output_rows)} name proposal rows to {args.output}")


if __name__ == "__main__":
    main()
