from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path


WORK_DIR = Path("/Users/admin/Documents/CODEX Projects/research_jobs")
PROGRESS_DIR = WORK_DIR / "progress_outputs"
DATA_DIR = Path("/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data")

MASTER_PROGRESS = PROGRESS_DIR / "master_item_reference_with_descriptions_status_in_progress.csv"
COUNTRY_LIBRARY = DATA_DIR / "country_description_library.csv"
LIVE_UPLOAD = DATA_DIR / "product_engine_upload_live_records_only.csv"

QC_FIELDS = [
    "scope",
    "key",
    "severity",
    "issue_type",
    "details",
    "recommendation",
]

TEMPLATE_PHRASES = [
    "the story here is",
    "the available evidence",
    "range-level",
    "appears in the assortment",
    "represented most strongly through",
    "core origin in the",
    "from a merchandising perspective",
    "should be read as",
]


def load_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def add_issue(issues: list[dict[str, str]], scope: str, key: str, severity: str, issue_type: str, details: str, recommendation: str) -> None:
    issues.append(
        {
            "scope": scope,
            "key": key,
            "severity": severity,
            "issue_type": issue_type,
            "details": details,
            "recommendation": recommendation,
        }
    )


def check_master_progress(issues: list[dict[str, str]]) -> dict[str, int]:
    rows = load_csv(MASTER_PROGRESS)
    completed = [row for row in rows if (row.get("research_status") or "").strip() == "in_progress_done"]
    counters = Counter()

    for row in completed:
        sku = row.get("sku", "")
        short_desc = (row.get("short_description") or "").strip()
        full_desc = (row.get("full_description") or "").strip()
        sources = (row.get("sources") or "").strip()
        validation = (row.get("validation") or "").strip()
        review_notes = (row.get("review_notes") or "").strip()

        if len(short_desc) > 150:
            counters["short_length"] += 1
            add_issue(issues, "product", sku, "medium", "length_violation_short", f"Short description is {len(short_desc)} characters.", "Tighten the lead sentence and keep the story hook concise.")

        if len(full_desc) > 500:
            counters["full_length"] += 1
            add_issue(issues, "product", sku, "medium", "length_violation_full", f"Full description is {len(full_desc)} characters.", "Trim repetition and keep the product narrative within the target band.")

        lowered = f"{short_desc} {full_desc}".lower()
        if any(phrase in lowered for phrase in TEMPLATE_PHRASES):
            counters["template_language"] += 1
            add_issue(issues, "product", sku, "medium", "template_language_leak", "Copy still contains template-style wording.", "Rewrite in a more natural, product-specific retail voice.")

        if validation == "verified" and not review_notes:
            counters["verified_without_note"] += 1
            add_issue(issues, "product", sku, "low", "missing_validation_rationale", "Verified row has no explicit review note or validation rationale.", "Add a short note on why the row qualifies as verified.")

        if validation and not sources:
            counters["missing_sources"] += 1
            add_issue(issues, "product", sku, "high", "missing_sources", "Validated row is missing source URLs.", "Add source URLs before publishing the row again.")

    counters["completed_rows"] = len(completed)
    return dict(counters)


def check_country_library(issues: list[dict[str, str]]) -> dict[str, int]:
    rows = load_csv(COUNTRY_LIBRARY)
    counters = Counter()

    for row in rows:
        name = row.get("entity_name", "")
        short_desc = (row.get("description_short_en") or "").strip()
        full_desc = (row.get("description_full_en") or "").strip()
        status = (row.get("copy_status") or "").strip()

        if status != "expert_reviewed":
            continue

        if len(short_desc) > 150:
            counters["country_short_length"] += 1
            add_issue(issues, "country_taxonomy", name, "medium", "length_violation_short", f"Country short description is {len(short_desc)} characters.", "Shorten the line while keeping the defining country cue.")

        if len(full_desc) > 500:
            counters["country_full_length"] += 1
            add_issue(issues, "country_taxonomy", name, "medium", "length_violation_full", f"Country full description is {len(full_desc)} characters.", "Trim supporting detail to fit the target band.")

        lowered = f"{short_desc} {full_desc}".lower()
        if any(phrase in lowered for phrase in TEMPLATE_PHRASES):
            counters["country_template_language"] += 1
            add_issue(issues, "country_taxonomy", name, "medium", "template_language_leak", "Country taxonomy copy still contains template-style wording.", "Rewrite with stronger category knowledge and less catalog phrasing.")

    counters["expert_reviewed_countries"] = sum(1 for row in rows if (row.get("copy_status") or "").strip() == "expert_reviewed")
    return dict(counters)


def check_live_upload(issues: list[dict[str, str]]) -> dict[str, int]:
    rows = load_csv(LIVE_UPLOAD)
    counters = Counter()

    for row in rows:
        sku = row.get("sku", "")
        if not (row.get("id") or "").strip():
            counters["missing_live_id"] += 1
            add_issue(issues, "live_upload", sku, "high", "missing_live_id", "Live upload row has no Product Engine id.", "Keep it out of the live publish file until the record is matched.")

    counters["live_upload_rows"] = len(rows)
    return dict(counters)


def main() -> None:
    issues: list[dict[str, str]] = []
    summary = {
        "product_master": check_master_progress(issues),
        "country_taxonomy": check_country_library(issues),
        "live_upload": check_live_upload(issues),
    }

    issues_csv = PROGRESS_DIR / "quality_control_issues.csv"
    with issues_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=QC_FIELDS)
        writer.writeheader()
        writer.writerows(issues)

    summary_json = PROGRESS_DIR / "quality_control_summary.json"
    summary_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    report_md = PROGRESS_DIR / "quality_control_report.md"
    with report_md.open("w", encoding="utf-8") as handle:
        handle.write("# Quality Control Report\n\n")
        handle.write("QC is now a required workflow gate before publish-ready batches are treated as final.\n\n")
        handle.write("## Summary\n\n")
        for section, counters in summary.items():
            handle.write(f"- `{section}`: `{counters}`\n")
        handle.write("\n## Issue Counts By Type\n\n")
        counter = Counter(issue["issue_type"] for issue in issues)
        for issue_type, count in sorted(counter.items()):
            handle.write(f"- `{issue_type}`: {count}\n")
        handle.write("\n## Next Actions\n\n")
        handle.write("- Fix `high` severity items before publishing the next batch.\n")
        handle.write("- Fix recurring template-language or length issues during batch merge, not at the end of the project.\n")
        handle.write("- Re-run this script after each meaningful merge wave.\n")

    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
