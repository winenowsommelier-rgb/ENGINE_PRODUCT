from __future__ import annotations

import csv
import json
from html import escape
from pathlib import Path
from publish_log import read_latest_publish_logs, ensure_publish_log_dir


WORK_DIR = Path("/Users/admin/Documents/CODEX Projects/research_jobs")
OUTPUT_DIR = WORK_DIR / "progress_outputs"
ENGINE_DATA_DIR = Path("/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data")

MASTER_CSV = ENGINE_DATA_DIR / "master_item_reference_with_descriptions_status_in_progress.csv"
RESEARCH_DASHBOARD_MD = ENGINE_DATA_DIR / "research_progress_dashboard_status.md"
RESEARCH_SUMMARY_CSV = ENGINE_DATA_DIR / "research_progress_summary.csv"
QUALITY_SUMMARY_JSON = ENGINE_DATA_DIR / "quality_control_summary.json"
GA_SUMMARY_JSON = ENGINE_DATA_DIR / "ga_priority_summary.json"
GA_PRODUCTS_CSV = ENGINE_DATA_DIR / "ga_priority_products.csv"
GA_BRANDS_CSV = ENGINE_DATA_DIR / "ga_priority_brands.csv"
GA_TAXONOMY_CSV = ENGINE_DATA_DIR / "ga_priority_taxonomy.csv"
GA_TRENDS_CSV = ENGINE_DATA_DIR / "ga_category_selection_trends.csv"
LIVE_UPLOAD_CSV = ENGINE_DATA_DIR / "product_engine_upload_live_records_only.csv"
COUNTRY_LIBRARY_CSV = ENGINE_DATA_DIR / "country_description_library.csv"
AUTHORITY_LIBRARY_CSV = ENGINE_DATA_DIR / "authority_brand_producer_library.csv"
NEXT_FAST_LANE_CSV = ENGINE_DATA_DIR / "next_fast_lane_queue.csv"
NEXT_BEST_SUMMARY_JSON = ENGINE_DATA_DIR / "next_best_batch_summary.json"
TREND_MAPPING_SUMMARY_JSON = ENGINE_DATA_DIR / "ga_trend_taxonomy_mapping_summary.json"
TREND_MAPPING_CSV = ENGINE_DATA_DIR / "ga_trend_taxonomy_mapping_candidates.csv"
GEOGRAPHY_QUEUE_CSV = ENGINE_DATA_DIR / "geography_priority_queue.csv"
GEOGRAPHY_SUMMARY_JSON = ENGINE_DATA_DIR / "geography_priority_summary.json"
GEOGRAPHY_LANE_SUMMARY_JSON = ENGINE_DATA_DIR / "geography_lanes_summary.json"
GEOGRAPHY_RECONCILIATION_JSON = ENGINE_DATA_DIR / "geography_reconciliation_summary.json"
GEOGRAPHY_RECONCILIATION_MD = ENGINE_DATA_DIR / "geography_reconciliation_summary.md"
GEOGRAPHY_COUNTRY_REFRESH_CSV = ENGINE_DATA_DIR / "geography_country_candidates_refresh.csv"
GEOGRAPHY_COUNTRY_REFRESH_MD = ENGINE_DATA_DIR / "geography_country_summary_refresh.md"
CURRENT_GEOGRAPHY_BATCH_CSV = ENGINE_DATA_DIR / "current_merge_now_geography_batch.csv"
CURRENT_GEOGRAPHY_BATCH_JSON = ENGINE_DATA_DIR / "current_merge_now_geography_summary.json"
GEOGRAPHY_PUBLISH_BATCH_CSV = ENGINE_DATA_DIR / "product_engine_geography_publish_batch.csv"
GEOGRAPHY_PUBLISH_BATCH_JSON = ENGINE_DATA_DIR / "product_engine_geography_publish_batch_summary.json"
SUBREGION_EXACT_BATCH_CSV = ENGINE_DATA_DIR / "product_engine_subregion_exact_match_batch.csv"
SUBREGION_EXACT_BATCH_JSON = ENGINE_DATA_DIR / "product_engine_subregion_exact_match_batch_summary.json"
FIELD_REGISTRY_CSV = Path("/Users/admin/Documents/CODEX Projects/FIELD_REGISTRY.csv")
RUNBOOK_MD = Path("/Users/admin/Documents/CODEX Projects/RUNBOOK.md")
PUBLISH_SAFE_FIELDS_JSON = Path("/Users/admin/Documents/CODEX Projects/PUBLISH_SAFE_FIELDS.json")
BATCH_STATES_MD = Path("/Users/admin/Documents/CODEX Projects/BATCH_STATES.md")
DELEGATED_BASE = Path("/Users/admin/Documents/CODEX Projects/research_jobs/progress_outputs/delegated_batches")
PRODUCER_LANE_SUMMARY = DELEGATED_BASE / "producer_authority_lane" / "producer_authority_lane_summary.md"
PRODUCER_LANE_CSV = DELEGATED_BASE / "producer_authority_lane" / "producer_authority_candidates.csv"
TAXONOMY_LANE_SUMMARY = DELEGATED_BASE / "taxonomy_refinement_lane" / "taxonomy_refinement_summary.md"
TAXONOMY_LANE_CSV = DELEGATED_BASE / "taxonomy_refinement_lane" / "taxonomy_mapping_candidates.csv"
IMAGE_LANE_SUMMARY = DELEGATED_BASE / "image_perfection_lane" / "image_perfection_summary.md"
IMAGE_LANE_CSV = DELEGATED_BASE / "image_perfection_lane" / "image_cleanup_candidates.csv"

OUTPUT_HTML = OUTPUT_DIR / "process_dashboard.html"
OUTPUT_JSON = OUTPUT_DIR / "process_dashboard_snapshot.json"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def parse_int(value) -> int:
    if value in (None, ""):
        return 0
    return int(float(str(value).replace(",", "").strip()))


def parse_progress_markdown(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    data = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("- Total queue rows:"):
            data["total_queue_rows"] = parse_int(line.split("`")[1])
        elif line.startswith("- Unique SKUs in pooled reference:"):
            data["unique_skus"] = parse_int(line.split("`")[1])
        elif line.startswith("- Items with researched answer + descriptions:"):
            data["completed_items"] = parse_int(line.split("`")[1])
        elif line.startswith("- Completed SKUs with live Product Engine record:"):
            data["completed_live_skus"] = parse_int(line.split("`")[1])
        elif line.startswith("- Producer library entries:"):
            data["producer_library_entries"] = parse_int(line.split("`")[1])
    return data


def summarize_master(rows: list[dict]) -> dict:
    completed_rows = [row for row in rows if (row.get("research_status") or "").strip() and row.get("research_status") != "pending"]
    validation = {}
    confidence = {}
    recent = []
    for row in completed_rows:
        validation_key = (row.get("validation") or "unknown").strip()
        confidence_key = (row.get("confidence_level") or "unrated").strip()
        validation[validation_key] = validation.get(validation_key, 0) + 1
        confidence[confidence_key] = confidence.get(confidence_key, 0) + 1

    for row in reversed(completed_rows[-12:]):
        recent.append(
            {
                "sku": row.get("sku", ""),
                "product_name": row.get("name", ""),
                "validation_status": row.get("validation", ""),
                "confidence_level": row.get("confidence_level", ""),
            }
        )

    return {
        "validation_mix": validation,
        "confidence_mix": confidence,
        "recent_items": recent,
    }


def summarize_country_library(rows: list[dict]) -> dict:
    total = len(rows)
    expert = sum(1 for row in rows if (row.get("copy_status") or "").strip() == "expert_reviewed")
    return {"total": total, "expert_reviewed": expert, "remaining": max(total - expert, 0)}


def summarize_authority_library(rows: list[dict]) -> dict:
    brand_rows = sum(1 for row in rows if row.get("entity_type") == "brand")
    producer_rows = sum(1 for row in rows if row.get("entity_type") == "producer")
    return {"total": len(rows), "brands": brand_rows, "producers": producer_rows}


def summarize_research_summary(rows: list[dict]) -> dict[str, dict]:
    return {
        row["source_file"]: {
            "total_rows": parse_int(row.get("total_rows")),
            "completed_rows": parse_int(row.get("completed_rows")),
            "remaining_rows": parse_int(row.get("remaining_rows")),
            "percent_complete": float(row.get("percent_complete") or 0),
        }
        for row in rows
    }


def aggregate_research_totals(rows: list[dict]) -> dict:
    total_rows = sum(parse_int(row.get("total_rows")) for row in rows)
    completed_rows = sum(parse_int(row.get("completed_rows")) for row in rows)
    remaining_rows = sum(parse_int(row.get("remaining_rows")) for row in rows)
    pct = round((completed_rows / total_rows) * 100) if total_rows else 0
    return {
        "total_rows": total_rows,
        "completed_rows": completed_rows,
        "remaining_rows": remaining_rows,
        "pct": pct,
    }


def build_eta_summary(research_totals: dict, t2: dict, country_summary: dict) -> dict:
    t2_remaining = parse_int(t2.get("remaining_rows"))
    flavor_remaining = 0
    all_remaining = research_totals["remaining_rows"]
    for file_name, remaining in [
        ("ai_research_flavor_t2.txt", t2_remaining),
        ("ai_research_flavor_t3.txt", 182),
        ("ai_research_flavor_t5.txt", 1200),
    ]:
        flavor_remaining += remaining
    country_remaining = country_summary["remaining"]
    return {
        "t2_flavor": {
            "remaining_rows": t2_remaining,
            "eta": "1 to 2 working days",
        },
        "country_taxonomy": {
            "remaining_rows": country_remaining,
            "eta": "1 to 2 working days",
        },
        "all_flavor_files": {
            "remaining_rows": flavor_remaining,
            "eta": "1.5 to 2.5 weeks",
        },
        "all_txt_queues": {
            "remaining_rows": all_remaining,
            "eta": "2.5 to 4.5 weeks",
        },
        "validated_program_pass": {
            "eta": "4.5 to 7 weeks",
        },
    }


def parse_markdown_metrics(path: Path, patterns: dict[str, str]) -> dict[str, int]:
    text = path.read_text(encoding="utf-8")
    result: dict[str, int] = {}
    for key, marker in patterns.items():
        for line in text.splitlines():
            if marker in line:
                nums = [int(part.strip("` ").replace(",", "")) for part in line.split("`")[1::2] if part.strip("` ").replace(",", "").isdigit()]
                if nums:
                    result[key] = nums[0]
                    break
    return result


def progress_bar(current: int, total: int, width: int = 22) -> str:
    if total <= 0:
        return ""
    filled = round((current / total) * width)
    return "█" * filled + "░" * max(width - filled, 0)


def render_table(rows: list[dict], columns: list[str], labels: dict[str, str]) -> str:
    headers = "".join(f"<th>{escape(labels.get(col, col))}</th>" for col in columns)
    body_rows = []
    for row in rows:
        cells = "".join(f"<td>{escape(str(row.get(col, '')))}</td>" for col in columns)
        body_rows.append(f"<tr>{cells}</tr>")
    body = "".join(body_rows)
    return f"<table><thead><tr>{headers}</tr></thead><tbody>{body}</tbody></table>"


def file_link(path: Path, label: str) -> str:
    return f"<a href=\"file://{escape(str(path))}\">{escape(label)}</a>"


def render_artifact_groups(groups: list[tuple[str, list[tuple[str, Path, str]]]]) -> str:
    blocks = []
    for title, items in groups:
        rows = "".join(
            f"<tr><td>{file_link(path, name)}</td><td>{escape(description)}</td><td><code>{escape(str(path))}</code></td></tr>"
            for name, path, description in items
        )
        blocks.append(
            f"<div class='artifact-group'><h3>{escape(title)}</h3>"
            f"<table><thead><tr><th>Artifact</th><th>Purpose</th><th>Path</th></tr></thead><tbody>{rows}</tbody></table></div>"
        )
    return "".join(blocks)


def summarize_publish_logs(logs: list[dict]) -> dict:
    if not logs:
        return {
            "count": 0,
            "latest_status": "no publish logs yet",
            "latest_type": "",
            "latest_succeeded": 0,
            "latest_failed": 0,
        }
    latest = logs[0]
    succeeded = latest.get("succeeded", latest.get("total_succeeded", 0))
    failed = latest.get("failed", latest.get("total_failed", 0))
    return {
        "count": len(logs),
        "latest_status": "latest wave recorded",
        "latest_type": latest.get("log_type", ""),
        "latest_succeeded": succeeded,
        "latest_failed": failed,
        "latest_timestamp": latest.get("timestamp", ""),
        "latest_log_path": latest.get("log_path", ""),
    }


def main() -> None:
    progress = parse_progress_markdown(RESEARCH_DASHBOARD_MD)
    quality = read_json(QUALITY_SUMMARY_JSON)
    ga_summary = read_json(GA_SUMMARY_JSON)

    master_rows = read_csv(MASTER_CSV)
    country_rows = read_csv(COUNTRY_LIBRARY_CSV)
    authority_rows = read_csv(AUTHORITY_LIBRARY_CSV)
    live_upload_rows = read_csv(LIVE_UPLOAD_CSV)
    research_summary_rows = read_csv(RESEARCH_SUMMARY_CSV)
    ga_product_rows = read_csv(GA_PRODUCTS_CSV)[:12]
    ga_brand_rows = read_csv(GA_BRANDS_CSV)[:12]
    ga_taxonomy_rows = read_csv(GA_TAXONOMY_CSV)[:12]
    ga_trend_rows = read_csv(GA_TRENDS_CSV)[:12]
    fast_lane_rows = read_csv(NEXT_FAST_LANE_CSV)[:12]
    geography_rows = read_csv(GEOGRAPHY_QUEUE_CSV)[:12]
    next_best_summary = read_json(NEXT_BEST_SUMMARY_JSON)
    trend_mapping_summary = read_json(TREND_MAPPING_SUMMARY_JSON)
    trend_mapping_rows = read_csv(TREND_MAPPING_CSV)[:12]
    geography_summary = read_json(GEOGRAPHY_SUMMARY_JSON)
    geography_lane_summary = read_json(GEOGRAPHY_LANE_SUMMARY_JSON)
    geography_reconciliation = read_json(GEOGRAPHY_RECONCILIATION_JSON)
    current_geography_batch = read_json(CURRENT_GEOGRAPHY_BATCH_JSON)
    producer_lane_rows = read_csv(PRODUCER_LANE_CSV)
    taxonomy_lane_rows = read_csv(TAXONOMY_LANE_CSV)
    image_lane_rows = read_csv(IMAGE_LANE_CSV)
    publish_logs = read_latest_publish_logs(limit=5)

    master_summary = summarize_master(master_rows)
    country_summary = summarize_country_library(country_rows)
    authority_summary = summarize_authority_library(authority_rows)
    research_summary = summarize_research_summary(research_summary_rows)
    research_totals = aggregate_research_totals(research_summary_rows)
    publish_log_summary = summarize_publish_logs(publish_logs)
    producer_lane_priority_1 = sum(1 for row in producer_lane_rows if str(row.get("lane_priority", "")).strip() == "1")
    taxonomy_promote_now = sum(1 for row in taxonomy_lane_rows if (row.get("proposed_resolution") or "").strip() == "promote_to_canonical")
    taxonomy_hybrid = sum(1 for row in taxonomy_lane_rows if (row.get("proposed_resolution") or "").strip() == "hybrid_reference_and_canonical")
    image_high_priority = sum(1 for row in image_lane_rows if str(row.get("cleanup_priority", "")).strip() in {"1", "high", "critical"})

    total_queue = research_totals["total_rows"]
    completed = research_totals["completed_rows"]
    overall_pct = round((completed / total_queue) * 100) if total_queue else 0
    t2 = research_summary.get("ai_research_flavor_t2.txt", {})
    eta_summary = build_eta_summary(research_totals, t2, country_summary)
    fast_lane_total = len(read_csv(NEXT_FAST_LANE_CSV))
    completed_skus = {row.get("sku") for row in master_rows if row.get("research_status") and row.get("research_status") != "pending"}
    fast_lane_completed = sum(1 for row in read_csv(NEXT_FAST_LANE_CSV) if row.get("sku") in completed_skus)
    fast_lane_pct = round((fast_lane_completed / fast_lane_total) * 100) if fast_lane_total else 0
    live_publish_total = quality["live_upload"]["live_upload_rows"]
    live_publish_clean = max(live_publish_total - quality["live_upload"]["weak_publish_rationale"], 0)
    live_publish_pct = round((live_publish_clean / live_publish_total) * 100) if live_publish_total else 0
    country_pct = round((country_summary["expert_reviewed"] / country_summary["total"]) * 100) if country_summary["total"] else 0

    snapshot = {
        "overall": {
            "total_queue_rows": total_queue,
            "completed_items": completed,
            "overall_pct": overall_pct,
            "unique_skus": progress.get("unique_skus", 0),
            "live_ready_rows": len(live_upload_rows),
            "completed_live_skus": progress.get("completed_live_skus", 0),
        },
        "eta": eta_summary,
        "progress_lenses": {
            "overall_program": {"done": completed, "total": total_queue, "pct": overall_pct},
            "active_t2_flavor": {"done": t2.get("completed_rows", 0), "total": t2.get("total_rows", 0), "pct": round(t2.get("percent_complete", 0))},
            "fast_lane": {"done": fast_lane_completed, "total": fast_lane_total, "pct": fast_lane_pct},
            "live_publish_clean": {"done": live_publish_clean, "total": live_publish_total, "pct": live_publish_pct},
            "country_taxonomy": {"done": country_summary["expert_reviewed"], "total": country_summary["total"], "pct": country_pct},
        },
        "quality": quality,
        "master": master_summary,
        "taxonomy": {
            "country": country_summary,
            "authority": authority_summary,
        },
        "ga": ga_summary,
        "next_queue": next_best_summary,
        "geography": {
            "summary": geography_summary,
            "lanes": geography_lane_summary,
            "reconciliation": geography_reconciliation,
            "merge_now": current_geography_batch,
        },
        "trend_mapping": trend_mapping_summary,
        "publish_logs": publish_log_summary,
        "side_lanes": {
            "producer_authority": {
                "rows": len(producer_lane_rows),
                "lane_priority_1": producer_lane_priority_1,
            },
            "taxonomy_refinement": {
                "rows": len(taxonomy_lane_rows),
                "promote_now": taxonomy_promote_now,
                "hybrid": taxonomy_hybrid,
            },
            "image_perfection": {
                "rows": len(image_lane_rows),
                "high_priority": image_high_priority,
            },
        },
    }
    OUTPUT_JSON.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")

    metric_cards = [
        ("Completed Research Rows", str(completed)),
        ("Overall Program", f"{overall_pct}%"),
        ("T2 Flavor", f"{round(t2.get('percent_complete', 0))}%"),
        ("Fast Lane", f"{fast_lane_pct}%"),
        ("Live Publish Clean", f"{live_publish_pct}%"),
        ("Country Taxonomy", f"{country_pct}%"),
        ("Live Upload Rows", str(len(live_upload_rows))),
        ("Live Product Records", str(progress.get("completed_live_skus", 0))),
        ("GA Priority Products", str(ga_summary.get("ga_priority_products", 0))),
        ("Mapped Trend Signals", str(trend_mapping_summary.get("mapped_exact", 0))),
        ("Side-Lane Packs", "3"),
        ("Publish Logs", str(publish_log_summary["count"])),
        ("Geography Gaps", str(geography_summary.get("actionable_gap_rows", geography_summary.get("total_gap_rows", 0)))),
        ("Geography Merge-Now", str(current_geography_batch.get("total_merge_now_rows", 0))),
    ]

    cards_html = "".join(
        f"<div class='card'><div class='label'>{escape(label)}</div><div class='value'>{escape(value)}</div></div>"
        for label, value in metric_cards
    )

    validation_list = "".join(
        f"<li><strong>{escape(k)}</strong>: {v}</li>" for k, v in master_summary["validation_mix"].items()
    )
    confidence_list = "".join(
        f"<li><strong>{escape(k)}</strong>: {v}</li>" for k, v in master_summary["confidence_mix"].items()
    )

    recent_html = "".join(
        f"<li><code>{escape(item['sku'])}</code> {escape(item['product_name'])} "
        f"<span class='pill {escape(item['validation_status'])}'>{escape(item['validation_status'])}</span></li>"
        for item in master_summary["recent_items"]
    )
    eta_html = "".join(
        f"<li><strong>{escape(label.replace('_', ' ').title())}:</strong> {escape(str(data.get('eta', '')))}"
        + (f" <span class='muted-inline'>({data.get('remaining_rows')} remaining)</span>" if data.get("remaining_rows") is not None else "")
        + "</li>"
        for label, data in eta_summary.items()
    )
    publish_log_html = "".join(
        f"<li><strong>{escape(log.get('log_type', 'unknown'))}</strong>: "
        f"{escape(str(log.get('succeeded', log.get('total_succeeded', 0))))} succeeded, "
        f"{escape(str(log.get('failed', log.get('total_failed', 0))))} failed"
        + (f" <span class='muted-inline'>({escape(log.get('timestamp', ''))})</span>" if log.get("timestamp") else "")
        + "</li>"
        for log in publish_logs[:5]
    ) or "<li>No publish logs recorded yet.</li>"
    progress_lenses = [
        ("Overall Program", completed, total_queue, overall_pct, "All queued TXT tasks across flavor, grape, and region."),
        ("Active T2 Flavor", t2.get("completed_rows", 0), t2.get("total_rows", 0), round(t2.get("percent_complete", 0)), "Main active file and the clearest short-term completion target."),
        ("Fast Lane Queue", fast_lane_completed, fast_lane_total, fast_lane_pct, "High-impact rows selected for speed: live records, GA pressure, and reusable clusters."),
        ("Live Publish Clean", live_publish_clean, live_publish_total, live_publish_pct, "Rows currently safe to publish without weak rationale flags."),
        ("Country Taxonomy", country_summary["expert_reviewed"], country_summary["total"], country_pct, "Expert-reviewed country descriptions in the taxonomy library."),
    ]
    progress_lens_html = "".join(
        f"<div class='lens'><div class='lens-head'><strong>{escape(label)}</strong><span>{done}/{total} • {pct}%</span></div>"
        f"<div class='mini-bar'><span style='width:{pct}%;'></span></div><p>{escape(note)}</p></div>"
        for label, done, total, pct, note in progress_lenses
    )
    artifact_groups = [
        (
            "Core Dashboard",
            [
                ("Process Dashboard HTML", ENGINE_DATA_DIR / "process_dashboard.html", "Main visual dashboard for progress, GA signals, mappings, and queue state."),
                ("Dashboard Snapshot JSON", ENGINE_DATA_DIR / "process_dashboard_snapshot.json", "Machine-readable status snapshot behind the dashboard."),
                ("Dashboard Builder", ENGINE_DATA_DIR / "build_process_dashboard.py", "Script that rebuilds the dashboard artifact."),
            ],
        ),
        (
            "Process Contract",
            [
                ("Runbook", RUNBOOK_MD, "High-level operating model for code, data, and Product Engine publishing."),
                ("Field Registry", FIELD_REGISTRY_CSV, "Ownership and publishability rules for important fields."),
                ("Publish Safe Fields", PUBLISH_SAFE_FIELDS_JSON, "Public-safe vs internal-only field split for Product Engine pushes."),
                ("Batch States", BATCH_STATES_MD, "Shared state model for research, QC, publish, and taxonomy work."),
            ],
        ),
        (
            "Research Progress",
            [
                ("Progress Markdown", ENGINE_DATA_DIR / "research_progress_dashboard_status.md", "Compact textual progress summary by queue and recent completions."),
                ("Progress Summary CSV", ENGINE_DATA_DIR / "research_progress_summary.csv", "Per-file completion counts and percentages."),
                ("Master Reference CSV", ENGINE_DATA_DIR / "master_item_reference_with_descriptions_status_in_progress.csv", "Main pooled SKU working file with descriptions, sources, and validation."),
                ("Flavor T2 Status TXT", ENGINE_DATA_DIR / "ai_research_flavor_t2_status_in_progress.txt", "Current answer file for the main active flavor batch."),
            ],
        ),
        (
            "Priority + GA",
            [
                ("GA Priority Products", ENGINE_DATA_DIR / "ga_priority_products.csv", "Top product priorities from live GA signals."),
                ("GA Priority Brands", ENGINE_DATA_DIR / "ga_priority_brands.csv", "Brand priorities from combined product and brand-page demand."),
                ("GA Website IA Signals", ENGINE_DATA_DIR / "ga_priority_taxonomy.csv", "Website category, collection, hub, and brand-page signals for taxonomy mapping."),
                ("Category + Selection Trends", ENGINE_DATA_DIR / "ga_category_selection_trends.csv", "Trend/reference layer from website categories and selections."),
                ("GA Summary JSON", ENGINE_DATA_DIR / "ga_priority_summary.json", "Summary of current GA-based priority extraction."),
            ],
        ),
        (
            "Geography Focus",
            [
                ("Geography Priority Queue", GEOGRAPHY_QUEUE_CSV, "Ranked country, region, and subregion queue for the geography-first refocus."),
                ("Geography Summary", GEOGRAPHY_SUMMARY_JSON, "Actionable geography gap counts and top queue slices."),
                ("Geography Lane Summary", GEOGRAPHY_LANE_SUMMARY_JSON, "Split counts for country, region, and subregion work lanes."),
                ("Geography Reconciliation", GEOGRAPHY_RECONCILIATION_MD, "What stayed valid versus stale after the main-process taxonomy update."),
                ("Country Refresh Summary", GEOGRAPHY_COUNTRY_REFRESH_MD, "Current live-safe country refresh pack."),
                ("Current Merge-Now Geography Batch", CURRENT_GEOGRAPHY_BATCH_CSV, "One clean current merge-now geography batch from refreshed country, valid region, and refreshed subregion rows."),
                ("Geography Publish Batch", GEOGRAPHY_PUBLISH_BATCH_CSV, "SKU-wide publish-safe geography wave ready for Product Engine bulk patch."),
                ("Geography Publish Summary", GEOGRAPHY_PUBLISH_BATCH_JSON, "Summary counts for the current publish-safe geography wave."),
                ("Subregion Exact-Match Batch", SUBREGION_EXACT_BATCH_CSV, "Second geography wave from exact product-title matches against existing taxonomy subregions."),
                ("Subregion Exact-Match Summary", SUBREGION_EXACT_BATCH_JSON, "Summary counts for the exact-match subregion wave."),
            ],
        ),
        (
            "Queue + Publishing",
            [
                ("Next Best Batch Queue", ENGINE_DATA_DIR / "next_best_batch_queue.csv", "Full prioritized queue for remaining enrichment work."),
                ("Next Fast Lane Queue", ENGINE_DATA_DIR / "next_fast_lane_queue.csv", "Small accelerated queue for high-impact next work."),
                ("Next Queue Summary", ENGINE_DATA_DIR / "next_best_batch_summary.json", "Summary metrics for the live queue state."),
                ("Live Records Upload CSV", ENGINE_DATA_DIR / "product_engine_upload_live_records_only.csv", "Rows currently staged for direct Product Engine publishing."),
                ("Live Review Upload CSV", ENGINE_DATA_DIR / "product_engine_upload_live_records_review_only.csv", "Rows with live records that still need review before publish."),
                ("Publish Log Folder", ensure_publish_log_dir(), "Structured history of Product Engine publish attempts."),
            ],
        ),
        (
            "Taxonomy + Mapping",
            [
                ("Country Description Library", ENGINE_DATA_DIR / "country_description_library.csv", "Country taxonomy copy and review status."),
                ("Authority Brand/Producer Library", ENGINE_DATA_DIR / "authority_brand_producer_library.csv", "Brand and producer authority layer with priority context."),
                ("Trend Mapping Candidates", ENGINE_DATA_DIR / "ga_trend_taxonomy_mapping_candidates.csv", "Suggested mappings from website trend signals into app taxonomy."),
                ("Trend Mapping Summary", ENGINE_DATA_DIR / "ga_trend_taxonomy_mapping_summary.json", "Coverage summary for mapped vs unmapped trend rows."),
            ],
        ),
        (
            "Parallel Side Lanes",
            [
                ("Producer Authority Summary", PRODUCER_LANE_SUMMARY, "Sub-agent authority cleanup recommendations for later quality passes."),
                ("Producer Authority Candidates", PRODUCER_LANE_CSV, "Priority queue for official-site mapping and producer cleanup."),
                ("Taxonomy Refinement Summary", TAXONOMY_LANE_SUMMARY, "Sub-agent recommendations for website IA to canonical taxonomy decisions."),
                ("Taxonomy Mapping Candidates", TAXONOMY_LANE_CSV, "Resolved reference-only and unmapped taxonomy trend rows."),
                ("Image Perfection Summary", IMAGE_LANE_SUMMARY, "Sub-agent later-pass image refinement plan."),
                ("Image Cleanup Candidates", IMAGE_LANE_CSV, "Ranked current image cleanup candidates."),
            ],
        ),
        (
            "Quality + Images",
            [
                ("Quality Control Report", ENGINE_DATA_DIR / "quality_control_report.md", "Narrative QC summary for current working data."),
                ("Quality Control Issues", ENGINE_DATA_DIR / "quality_control_issues.csv", "Structured list of QC findings."),
                ("Quality Control Summary", ENGINE_DATA_DIR / "quality_control_summary.json", "QC counts used by the dashboard."),
                ("Image Research Combined T2", ENGINE_DATA_DIR / "product_image_research_t2_combined_batches.csv", "Staged image research results for completed T2 items."),
            ],
        ),
    ]
    artifact_index_html = render_artifact_groups(artifact_groups)

    html = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WNLQ9 Enrichment Dashboard</title>
  <style>
    :root {{
      --bg: #f6f2e8;
      --panel: #fffdf8;
      --ink: #1f1a14;
      --muted: #6f675d;
      --line: #ddd3c4;
      --accent: #7a2f2f;
      --accent-2: #315d4f;
      --warn: #9a6b1b;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: linear-gradient(180deg, #f2ecdf 0%, #f8f4ec 100%);
      color: var(--ink);
    }}
    .wrap {{
      max-width: 1240px;
      margin: 0 auto;
      padding: 32px 24px 56px;
    }}
    .hero {{
      background: radial-gradient(circle at top left, rgba(122,47,47,.14), transparent 32%),
                  radial-gradient(circle at right, rgba(49,93,79,.12), transparent 28%),
                  var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 12px 40px rgba(46,36,24,.06);
    }}
    h1, h2, h3 {{ margin: 0 0 12px; }}
    h1 {{ font-size: 34px; }}
    h2 {{ font-size: 22px; margin-top: 28px; }}
    p.lead {{ margin: 0; color: var(--muted); max-width: 880px; line-height: 1.5; }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 20px;
    }}
    .card {{
      background: rgba(255,255,255,.82);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 16px;
    }}
    .label {{
      color: var(--muted);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: .06em;
      margin-bottom: 8px;
    }}
    .value {{
      font-size: 28px;
      font-weight: 700;
    }}
    .muted-inline {{
      color: var(--muted);
      font-size: 12px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 18px;
      margin-top: 18px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 22px;
      box-shadow: 0 10px 30px rgba(46,36,24,.05);
    }}
    .two-col {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
    }}
    .bar {{
      margin-top: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: var(--accent);
      font-size: 16px;
    }}
    ul {{
      margin: 10px 0 0 18px;
      padding: 0;
      line-height: 1.5;
    }}
    .pill {{
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      margin-left: 6px;
      border: 1px solid var(--line);
      background: #f9f4ea;
    }}
    .pill.verified {{ color: var(--accent-2); }}
    .pill.partially_verified {{ color: var(--warn); }}
    .pill.needs_review {{ color: var(--accent); }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 14px;
    }}
    th, td {{
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }}
    th {{
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .05em;
    }}
    code {{
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
    }}
    .foot {{
      margin-top: 18px;
      color: var(--muted);
      font-size: 13px;
    }}
    .lens-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }}
    .lens {{
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      background: rgba(255,255,255,.72);
    }}
    .lens-head {{
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
      font-size: 14px;
    }}
    .lens p {{
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
    }}
    .mini-bar {{
      height: 10px;
      background: #efe5d4;
      border-radius: 999px;
      overflow: hidden;
    }}
    .mini-bar span {{
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--accent), #c68f61);
      border-radius: 999px;
    }}
    .artifact-group + .artifact-group {{
      margin-top: 22px;
    }}
    a {{
      color: var(--accent);
      text-decoration: none;
    }}
    a:hover {{
      text-decoration: underline;
    }}
    @media (max-width: 980px) {{
      .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>WNLQ9 Enrichment Dashboard</h1>
      <p class="lead">This dashboard consolidates the current research queue, Product Engine publishing state, quality-control pressure points, taxonomy progress, and live GA-driven priorities for Wine-Now and LIQ9.</p>
      <div class="cards">{cards_html}</div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Program Progress</h2>
        <p><strong>{completed}</strong> completed researched rows out of <strong>{total_queue}</strong> queued tasks across flavor, grape, and region work. The dashboard now shows separate progress lenses so the active batch does not get buried under the full backlog.</p>
        <div class="bar">{progress_bar(completed, total_queue)} {overall_pct}%</div>
        <div class="lens-grid">{progress_lens_html}</div>
        <div class="two-col">
          <div>
            <h3>Validation Mix</h3>
            <ul>{validation_list}</ul>
          </div>
          <div>
            <h3>Confidence Mix</h3>
            <ul>{confidence_list}</ul>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Publish + QC</h2>
        <ul>
          <li><strong>Live-ready rows:</strong> {len(live_upload_rows)}</li>
          <li><strong>Short-description length issues:</strong> {quality["product_master"]["short_length"]}</li>
          <li><strong>Full-description length issues:</strong> {quality["product_master"]["full_length"]}</li>
          <li><strong>Template-language leaks:</strong> {quality["product_master"]["template_language"]}</li>
          <li><strong>Missing sources:</strong> {quality["product_master"]["missing_sources"]}</li>
          <li><strong>Verified rows missing rationale:</strong> {quality["product_master"]["verified_without_note"]}</li>
          <li><strong>Weak publish rationale:</strong> {quality["live_upload"]["weak_publish_rationale"]}</li>
          <li><strong>Latest publish wave:</strong> {escape(publish_log_summary['latest_type']) or 'none'} | {publish_log_summary['latest_succeeded']} succeeded / {publish_log_summary['latest_failed']} failed</li>
        </ul>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Updated ETA</h2>
        <p>The estimates below are recalculated from the current queue state and the active fast-lane workflow. They should be read as operational planning ranges, not hard deadlines.</p>
        <ul>{eta_html}</ul>
      </div>

      <div class="panel">
        <h2>Endpoint Sync Status</h2>
        <ul>
          <li><strong>Public-safe fields confirmed live:</strong> <code>enrichment_priority</code>, <code>enrichment_source</code>, <code>enrichment_note</code></li>
          <li><strong>Internal field kept local:</strong> <code>queue_priority</code></li>
          <li><strong>Push key to prefer:</strong> <code>sku</code> for public endpoint waves</li>
          <li><strong>Fast-lane metadata batch:</strong> keep as dashboard/local ops layer unless Product Engine gets a dedicated internal endpoint</li>
        </ul>
      </div>
    </section>

    <section class="panel">
      <h2>Publish History</h2>
      <p>Latest Product Engine publish attempts recorded by the orchestration scripts.</p>
      <ul>{publish_log_html}</ul>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Taxonomy + Authority</h2>
        <ul>
          <li><strong>Country taxonomy expert-reviewed:</strong> {country_summary["expert_reviewed"]} / {country_summary["total"]}</li>
          <li><strong>Country taxonomy remaining:</strong> {country_summary["remaining"]}</li>
          <li><strong>Authority library rows:</strong> {authority_summary["total"]}</li>
          <li><strong>Brand rows:</strong> {authority_summary["brands"]}</li>
          <li><strong>Producer rows:</strong> {authority_summary["producers"]}</li>
          <li><strong>Producer evidence entries:</strong> {progress.get("producer_library_entries", 0)}</li>
        </ul>
      </div>

      <div class="panel">
        <h2>Recently Completed</h2>
        <ul>{recent_html}</ul>
      </div>
    </section>

    <section class="panel">
      <h2>Artifact Index</h2>
      <p>Click any artifact below to open the underlying file directly. This is the fastest way to inspect the real working data behind each section of the process.</p>
      {artifact_index_html}
    </section>

    <section class="panel">
      <h2>Next Fast Lane</h2>
      <p><strong>{next_best_summary.get("fast_lane_rows", 0)}</strong> rows are now in the accelerated working queue, with <strong>{next_best_summary.get("top_20_live_records", 0)}</strong> live Product Engine records in the top 20.</p>
      {render_table(
        fast_lane_rows,
        ["priority_rank", "sku", "name", "priority_band", "ga_brand_rank", "ga_taxonomy_rank", "why_now"],
        {
          "priority_rank": "Rank",
          "sku": "SKU",
          "name": "Product",
          "priority_band": "Lane",
          "ga_brand_rank": "GA Brand",
          "ga_taxonomy_rank": "GA Taxonomy",
          "why_now": "Why Now",
        },
      )}
    </section>

    <section class="panel">
      <h2>Geography-First Queue</h2>
      <p>The mainline is now refocused on <strong>country → region → subregion</strong>. This queue separates actionable geography work from lower-value noise and ranks it by GA demand, value, and safe applicability.</p>
      <ul>
        <li><strong>Actionable geography gaps:</strong> {geography_summary.get("actionable_gap_rows", geography_summary.get("total_gap_rows", 0))}</li>
        <li><strong>Country gaps:</strong> {geography_summary.get("country_missing", 0)}</li>
        <li><strong>Region gaps:</strong> {geography_summary.get("region_missing", 0)}</li>
        <li><strong>Subregion gaps:</strong> {geography_summary.get("subregion_missing", 0)}</li>
        <li><strong>Current merge-now geography rows:</strong> {current_geography_batch.get("total_merge_now_rows", 0)}</li>
        <li><strong>Country lane:</strong> {geography_lane_summary.get("country_rows", 0)} rows</li>
        <li><strong>Region lane:</strong> {geography_lane_summary.get("region_rows", 0)} rows</li>
        <li><strong>Subregion clear-fill:</strong> {geography_lane_summary.get("subregion_fill_clear", 0)} rows</li>
        <li><strong>Subregion assess-later:</strong> {geography_lane_summary.get("subregion_assess", 0)} rows</li>
      </ul>
      {render_table(
        geography_rows,
        ["priority_rank", "gap_type", "sku", "name", "classification", "ga_priority_rank", "subregion_action", "priority_reason"],
        {
          "priority_rank": "Rank",
          "gap_type": "Gap",
          "sku": "SKU",
          "name": "Product",
          "classification": "Classification",
          "ga_priority_rank": "GA Rank",
          "subregion_action": "Subregion Action",
          "priority_reason": "Why Now",
        },
      )}
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Geography Reconciliation</h2>
        <ul>
          <li><strong>Live country gaps:</strong> {geography_reconciliation.get("live_baseline", {}).get("country_missing", 0)}</li>
          <li><strong>Live region gaps:</strong> {geography_reconciliation.get("live_baseline", {}).get("region_missing", 0)}</li>
          <li><strong>Live subregion gaps:</strong> {geography_reconciliation.get("live_baseline", {}).get("subregion_missing", 0)}</li>
          <li><strong>Old country lane:</strong> {geography_reconciliation.get("country_lane", {}).get("status", "")}</li>
          <li><strong>Old region lane:</strong> {geography_reconciliation.get("region_lane", {}).get("status", "")}</li>
          <li><strong>Old subregion clear-fill:</strong> {geography_reconciliation.get("subregion_lane", {}).get("status", "")}</li>
        </ul>
      </div>
      <div class="panel">
        <h2>Current Merge-Now Geography</h2>
        <ul>
          <li><strong>Total rows:</strong> {current_geography_batch.get("total_merge_now_rows", 0)}</li>
          <li><strong>Country rows:</strong> {current_geography_batch.get("country_rows", 0)}</li>
          <li><strong>Region rows:</strong> {current_geography_batch.get("region_rows", 0)}</li>
          <li><strong>Subregion rows:</strong> {current_geography_batch.get("subregion_rows", 0)}</li>
        </ul>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Parallel Side Lanes</h2>
        <p>These sub-agent lanes are intentionally separate from the mainline so deeper quality work can progress without slowing publishable SKU throughput.</p>
        <ul>
          <li><strong>Producer authority lane:</strong> {len(producer_lane_rows)} candidate rows, {producer_lane_priority_1} immediate official-site anchors</li>
          <li><strong>Taxonomy refinement lane:</strong> {len(taxonomy_lane_rows)} reviewed rows, {taxonomy_promote_now} promote-now candidates, {taxonomy_hybrid} hybrid candidates</li>
          <li><strong>Image perfection lane:</strong> {len(image_lane_rows)} cleanup rows, {image_high_priority} highest-priority later-pass items</li>
        </ul>
      </div>
      <div class="panel">
        <h2>Lane Strategy</h2>
        <ul>
          <li><strong>Mainline:</strong> fastest overall SKU coverage, QC, and publish-safe Product Engine updates</li>
          <li><strong>Producer lane:</strong> authority cleanup and official-site mapping for later quality lifts</li>
          <li><strong>Taxonomy lane:</strong> canonical structure and website-to-app mapping refinement</li>
          <li><strong>Image lane:</strong> asset consistency and selective perfection without blocking throughput</li>
        </ul>
      </div>
    </section>

    <section class="panel">
      <h2>Top GA Priority Products</h2>
      {render_table(
        ga_product_rows,
        ["priority_rank", "site", "sku", "product_name", "brand", "priority_score", "priority_band"],
        {
          "priority_rank": "Rank",
          "site": "Site",
          "sku": "SKU",
          "product_name": "Product",
          "brand": "Brand",
          "priority_score": "Score",
          "priority_band": "Band",
        },
      )}
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Top GA Priority Brands</h2>
        {render_table(
          ga_brand_rows,
          ["priority_rank", "brand", "sites", "priority_score", "priority_band", "matched_product_count"],
          {
            "priority_rank": "Rank",
            "brand": "Brand",
            "sites": "Sites",
            "priority_score": "Score",
            "priority_band": "Band",
            "matched_product_count": "Matched Products",
          },
        )}
      </div>

      <div class="panel">
        <h2>Top GA Website IA Signals</h2>
        <p>These rows come from website category, hub, brand-page, and collection demand. They are signals for mapping into app taxonomy, not direct app taxonomy records.</p>
        {render_table(
          ga_taxonomy_rows,
          ["priority_rank", "site", "website_surface_type", "website_surface_name", "suggested_app_entity_type", "priority_score", "priority_band"],
          {
            "priority_rank": "Rank",
            "site": "Site",
            "website_surface_type": "Website Surface",
            "website_surface_name": "Website Target",
            "suggested_app_entity_type": "Suggested App Type",
            "priority_score": "Score",
            "priority_band": "Band",
          },
        )}
      </div>
    </section>

    <section class="panel">
      <h2>Category + Selection Trends</h2>
      <p>This is the browse-demand reference layer for website categories, selections, hubs, and region discovery pages. It is useful for deciding what to enrich next and how to map trend pressure into app taxonomy.</p>
      {render_table(
        ga_trend_rows,
        ["trend_rank", "site", "trend_type", "reference_name", "suggested_app_entity_type", "suggested_app_entity_name", "trend_score"],
        {
          "trend_rank": "Rank",
          "site": "Site",
          "trend_type": "Trend Type",
          "reference_name": "Website Reference",
          "suggested_app_entity_type": "Suggested App Type",
          "suggested_app_entity_name": "Suggested App Entity",
          "trend_score": "Trend Score",
        },
      )}
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Trend Mapping Status</h2>
        <ul>
          <li><strong>Total trend rows:</strong> {trend_mapping_summary.get("total_rows", 0)}</li>
          <li><strong>Mapped exact:</strong> {trend_mapping_summary.get("mapped_exact", 0)}</li>
          <li><strong>Mapped alias:</strong> {trend_mapping_summary.get("mapped_alias", 0)}</li>
          <li><strong>Reference only:</strong> {trend_mapping_summary.get("reference_only", 0)}</li>
          <li><strong>Unmapped:</strong> {trend_mapping_summary.get("unmapped", 0)}</li>
        </ul>
      </div>
      <div class="panel">
        <h2>Top Mapping Candidates</h2>
        {render_table(
          trend_mapping_rows,
          ["trend_rank", "reference_name", "suggested_app_entity_type", "matched_entity_type", "matched_entity_name", "mapping_status"],
          {
            "trend_rank": "Rank",
            "reference_name": "Reference",
            "suggested_app_entity_type": "Suggested Type",
            "matched_entity_type": "Matched Type",
            "matched_entity_name": "Matched Entity",
            "mapping_status": "Status",
          },
        )}
      </div>
    </section>

    <div class="foot">
      Generated from live progress, QC, Product Engine staging, and GA-based priority files in <code>/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data</code>.
    </div>
  </div>
</body>
</html>
"""

    OUTPUT_HTML.write_text(html, encoding="utf-8")
    print(json.dumps({"html": str(OUTPUT_HTML), "json": str(OUTPUT_JSON)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
