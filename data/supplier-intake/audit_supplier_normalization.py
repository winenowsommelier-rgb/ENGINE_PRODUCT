#!/usr/bin/env python3
"""Build supplier normalization audit reports.

The reports are intentionally conservative:
- "match coverage" is only measurable after supplier rows are normalized.
- suppliers without a learned parser are listed as profiling blockers.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MASTERFILE = ROOT / "data/data mastefile WNLQ9/DATA_ Master_Product_Data_Enable SKU 2026FEB - MR2026MAR31.csv"
REFERENCE = ROOT / "data/supplier-intake/supplier_trade_reference_starter.csv"
PROFILES = ROOT / "data/supplier-intake/supplier_file_profiles.csv"
STATUS_OUTPUT = ROOT / "data/supplier-intake/supplier_normalization_status.csv"
PROBLEM_OUTPUT = ROOT / "data/supplier-intake/supplier_folder_problem_list.csv"
SUMMARY_OUTPUT = ROOT / "data/supplier-intake/supplier_intake_dashboard_summary.json"


def base_supplier_code(code: str) -> str:
    match = re.match(r"([A-Z]{2})", (code or "").strip().upper())
    return match.group(1) if match else (code or "").strip().upper()


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def master_metrics() -> dict[str, dict[str, str]]:
    counts: Counter[str] = Counter()
    samples: dict[str, list[str]] = defaultdict(list)
    brands: dict[str, Counter[str]] = defaultdict(Counter)

    for row in read_csv(MASTERFILE):
        sku = (row.get("sku") or "").strip()
        metric_code = sku[-2:] if len(sku) >= 2 else ""
        metric_code = base_supplier_code(metric_code)
        if not metric_code:
            continue
        counts[metric_code] += 1
        if sku and len(samples[metric_code]) < 6:
            samples[metric_code].append(sku)
        brand = (row.get("brand") or row.get("manufacturer") or "").strip()
        if brand:
            brands[metric_code][brand] += 1

    output: dict[str, dict[str, str]] = {}
    for code, count in counts.items():
        output[code] = {
            "master_sku_count": str(count),
            "sample_skus": "; ".join(samples[code]),
            "top_brands": "; ".join(f"{name} ({qty})" for name, qty in brands[code].most_common(5)),
        }
    return output


def solution_for(profile: dict[str, str] | None, reference_row: dict[str, str]) -> tuple[str, str, str]:
    if not reference_row.get("drive_supplier_folder_name"):
        return (
            "blocked",
            "Supplier code is not mapped to a confirmed Drive folder.",
            "Map supplier code to the correct Drive supplier folder, then profile latest file.",
        )

    if profile is None:
        return (
            "needs_profile",
            "Drive folder is mapped but no file parser profile has been learned yet.",
            "Inspect latest month folder, fetch representative file text, identify headers, then add profile row.",
        )

    status = profile.get("profile_status", "")
    file_type = profile.get("input_file_type", "")
    confidence = profile.get("automation_confidence", "")
    strategy = profile.get("normalization_strategy", "")

    if status == "pending_profile":
        return (
            "needs_profile",
            "Folder is known but file content has not been profiled.",
            "Inspect latest supplier file and decide spreadsheet parser vs PDF draft extractor.",
        )
    if file_type == "pdf" and confidence in {"low", "medium"}:
        return (
            "draft_extract_then_review",
            "PDF extraction is not deterministic enough for direct database update.",
            strategy or "Use PDF/OCR extraction to create draft normalized CSV, then require human approval.",
        )
    if "shared" in status:
        return (
            "normalizable_with_rules",
            "Supplier code shares one Drive folder/parser with related supplier variants.",
            strategy or "Use shared parser plus category/brand rules to split rows to the correct supplier code.",
        )
    if confidence == "high":
        return (
            "normalizable",
            "File shape is learned and suitable for automated normalized CSV generation.",
            strategy or "Use configured parser and validation rules.",
        )
    return (
        "normalizable_with_review",
        "File shape is learned but needs validation rules before full automation.",
        strategy or "Normalize to CSV and route uncertain rows to human review.",
    )


def main() -> None:
    metrics = master_metrics()
    reference_rows = [r for r in read_csv(REFERENCE) if r.get("row_type") == "supplier_code"]
    profiles = read_csv(PROFILES)

    profile_by_code = {p["supplier_code"]: p for p in profiles}
    profile_by_folder = {
        p["drive_supplier_folder_name"]: p
        for p in profiles
        if p.get("drive_supplier_folder_name") and p.get("profile_status") in {"profiled", "profiled_pdf"}
    }

    status_rows: list[dict[str, str]] = []
    problem_rows: list[dict[str, str]] = []

    for row in reference_rows:
        supplier_code = row["supplier_code"]
        folder = row.get("drive_supplier_folder_name", "")
        profile = profile_by_code.get(supplier_code) or profile_by_folder.get(folder)
        readiness, blocker, solution = solution_for(profile, row)
        metric_code = base_supplier_code(row.get("sku_metric_code_used") or supplier_code)
        metric = metrics.get(metric_code, {})
        match_measurable = "yes" if readiness == "normalizable" else "after_normalized_csv"

        output = {
            "supplier_code": supplier_code,
            "supplier_name": row.get("supplier_name", ""),
            "supplier_detail": row.get("supplier_detail", ""),
            "pricing_structure": row.get("drive_pricing_structure", ""),
            "drive_bucket_name": row.get("drive_bucket_name", ""),
            "drive_supplier_folder_name": folder,
            "drive_supplier_folder_url": row.get("drive_supplier_folder_url", ""),
            "profile_status": profile.get("profile_status", "") if profile else "",
            "input_file_type": profile.get("input_file_type", "") if profile else "",
            "latest_sample_file": profile.get("latest_sample_file", "") if profile else "",
            "automation_confidence": profile.get("automation_confidence", "") if profile else "",
            "normalization_readiness": readiness,
            "blocker_or_risk": blocker,
            "recommended_solution": solution,
            "master_sku_metric_code": metric_code,
            "master_sku_count": metric.get("master_sku_count", "0"),
            "master_top_brands": metric.get("top_brands", ""),
            "sample_skus": metric.get("sample_skus", ""),
            "match_coverage_status": match_measurable,
            "match_coverage_pct": "",
            "match_coverage_note": "Requires extracted normalized supplier rows." if match_measurable != "yes" else "Run matcher after parser output is generated.",
        }
        status_rows.append(output)
        if readiness != "normalizable":
            problem_rows.append(output)

    status_rows.sort(key=lambda r: (r["normalization_readiness"], r["supplier_code"]))
    problem_rows.sort(key=lambda r: (r["normalization_readiness"], r["supplier_code"]))

    fieldnames = list(status_rows[0].keys()) if status_rows else []
    for path, rows in [(STATUS_OUTPUT, status_rows), (PROBLEM_OUTPUT, problem_rows)]:
        with open(path, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"wrote {len(rows)} rows to {path}")

    readiness_counts = Counter(row["normalization_readiness"] for row in status_rows)
    total_master_skus = sum(int(row.get("master_sku_count") or 0) for row in status_rows)
    summary = {
        "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "total_supplier_codes": len(status_rows),
        "problem_supplier_codes": len(problem_rows),
        "readiness_counts": dict(sorted(readiness_counts.items())),
        "profiled_supplier_codes": sum(1 for row in status_rows if row.get("profile_status")),
        "mapped_folder_supplier_codes": sum(1 for row in status_rows if row.get("drive_supplier_folder_name")),
        "master_sku_rows_represented": total_master_skus,
        "top_problem_suppliers": [
            {
                "supplier_code": row["supplier_code"],
                "supplier_name": row["supplier_name"],
                "drive_supplier_folder_name": row["drive_supplier_folder_name"],
                "normalization_readiness": row["normalization_readiness"],
                "blocker_or_risk": row["blocker_or_risk"],
                "recommended_solution": row["recommended_solution"],
                "master_sku_count": row["master_sku_count"],
            }
            for row in sorted(problem_rows, key=lambda item: int(item.get("master_sku_count") or 0), reverse=True)[:20]
        ],
        "ready_supplier_codes": [
            {
                "supplier_code": row["supplier_code"],
                "supplier_name": row["supplier_name"],
                "drive_supplier_folder_name": row["drive_supplier_folder_name"],
                "normalization_readiness": row["normalization_readiness"],
                "master_sku_count": row["master_sku_count"],
            }
            for row in status_rows
            if row["normalization_readiness"] in {"normalizable", "normalizable_with_rules"}
        ],
    }
    with open(SUMMARY_OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    print(f"wrote dashboard summary to {SUMMARY_OUTPUT}")


if __name__ == "__main__":
    main()
