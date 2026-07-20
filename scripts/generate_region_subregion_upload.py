#!/usr/bin/env python3
"""Build a validated region/subregion upload package from the manual review CSV.

The output is deliberately conservative:
- region/subregion are treated as shopper-facing browse fields
- deeper or conflicting geography is held for review instead of forced into browse
- blank manual subregion never silently clears useful existing DB detail
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANUAL_PATH = Path(
    "/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
    "DATA_ WNLQ9 Performance - wine region manual check.csv"
)
DB_PATH = ROOT / "data/db/products.db"
OUT_DIR = ROOT / "outputs/manual-region-audit-2026-06-27/final-region-upload"


REGION_ALIASES = {
    ("France", "Loire valley"): ("Loire Valley", ""),
    ("Portugal", "Douro Valley"): ("Douro", ""),
    ("Spain", "Aragón"): ("Aragon", ""),
    ("France", "Provence | Les Baux-de-Provence"): ("Provence", "Les Baux-de-Provence"),
}

SUBREGION_ALIASES = {
    ("France", "Rhône Valley", "Cote-Rotie"): "Côte-Rôtie",
    ("France", "Loire Valley", "Muscadet Sevre et Maine"): "Muscadet Sèvre et Maine",
    ("France", "Champagne", "Ay"): "Aÿ",
    ("France", "Burgundy", "Macon"): "Mâcon",
}

REDUNDANT_SUBREGIONS = {
    ("Italy", "Tuscany", "Toscana"),
    ("Italy", "Tuscany", "Toscana IGT"),
    ("Italy", "Sicily", "Sicilia"),
    ("Italy", "Piedmont", "Piemonte"),
    ("Italy", "Sardinia", "Sardegna"),
}

INVALID_REGION_VALUES = {"", "Others region", "Other region", "Others"}

# Curated extensions for browse-level subregions missing from the local taxonomy.
# These are intentionally high-confidence, repeated retail browse values. Very fine
# villages/crus are left for appellation/refiner work unless already in local taxonomy.
APPROVED_SUBREGION_EXTENSIONS = {
    ("USA", "California"): {
        "Napa Valley",
        "Sonoma County",
    },
    ("Australia", "Western Australia"): {
        "Great Southern",
        "Margaret River",
    },
    ("Australia", "Victoria"): {
        "Alpine Valleys",
        "Yarra Valley",
        "Grampians",
        "King Valley",
        "Mornington Peninsula",
        "Murray Darling",
        "Pyrenees",
    },
    ("Australia", "South Australia"): {
        "Barossa Valley",
        "Coonawarra",
        "Clare Valley",
        "Eden Valley",
        "McLaren Vale",
        "Mount Benson",
        "Padthaway",
        "Riverland",
    },
    ("Australia", "South Eastern Australia"): {
        "Hunter Valley",
        "Riverina",
    },
    ("Australia", "Tasmania"): {
        "Coal River Valley",
        "Pipers River",
    },
    ("Chile", "Central Valley"): {
        "Cachapoal Valley",
        "Colchagua Valley",
        "Curico Valley",
        "Maipo Valley",
        "Maule Valley",
        "Rapel Valley",
    },
    ("Chile", "Rapel Valley"): {
        "Cachapoal Valley",
        "Colchagua Valley",
    },
    ("France", "Burgundy"): {
        "Fleurie",
        "Morgon",
        "Moulin-à-Vent",
        "Vougeot",
        "Mâcon",
        "Brouilly",
    },
    ("France", "Rhône Valley"): {
        "Côtes du Rhône",
        "Hermitage",
        "Côte-Rôtie",
        "Gigondas",
        "Lirac",
    },
    ("France", "Loire Valley"): {
        "Saumur",
        "Muscadet Sèvre et Maine",
    },
    ("Italy", "Veneto"): {
        "Lugana",
    },
    ("Italy", "Marche"): {
        "Castelli di Jesi",
        "Piceno",
    },
    ("Spain", "Jerez"): {
        "Jerez de la Frontera",
    },
}


def clean(value: object) -> str:
    return "" if value is None else str(value).strip()


def norm(value: object) -> str:
    text = clean(value)
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def is_no_change(value: str) -> bool:
    return norm(value) == "no change"


def load_taxonomy() -> tuple[dict[str, set[str]], dict[tuple[str, str], set[str]], dict[str, str]]:
    countries = json.loads((ROOT / "data/taxonomy/countries.json").read_text())["data"]
    regions = json.loads((ROOT / "data/taxonomy/regions.json").read_text())["data"]
    subregions = json.loads((ROOT / "data/taxonomy/subregions.json").read_text())["data"]

    country_by_id = {row["id"]: row["name"] for row in countries}
    region_by_id = {row["id"]: row for row in regions}

    region_names_by_country: dict[str, set[str]] = defaultdict(set)
    canonical_region_by_norm: dict[tuple[str, str], str] = {}
    for row in regions:
        country = country_by_id.get(row["country_id"], "")
        region = clean(row["name"])
        region_names_by_country[country].add(region)
        canonical_region_by_norm[(norm(country), norm(region))] = region

    subregion_names_by_country_region: dict[tuple[str, str], set[str]] = defaultdict(set)
    canonical_subregion_by_norm: dict[tuple[str, str, str], str] = {}
    for row in subregions:
        region_row = region_by_id.get(row["region_id"]) or {}
        country = country_by_id.get(region_row.get("country_id"), "")
        region = clean(region_row.get("name"))
        subregion = clean(row["name"])
        subregion_names_by_country_region[(country, region)].add(subregion)
        canonical_subregion_by_norm[(norm(country), norm(region), norm(subregion))] = subregion

    for (country, region), values in APPROVED_SUBREGION_EXTENSIONS.items():
        for value in values:
            subregion_names_by_country_region[(country, region)].add(value)
            canonical_subregion_by_norm[(norm(country), norm(region), norm(value))] = value

    canonical_region_lookup = {
        f"{country_norm}::{region_norm}": region
        for (country_norm, region_norm), region in canonical_region_by_norm.items()
    }
    canonical_region_lookup.update(
        {
            f"{norm(country)}::{norm(alias)}": canonical
            for (country, alias), (canonical, _sub) in REGION_ALIASES.items()
        }
    )
    return region_names_by_country, subregion_names_by_country_region, canonical_region_lookup


@dataclass
class Decision:
    sku: str
    manual_line: str
    manual_check: str
    country: str
    old_region: str
    old_subregion: str
    new_region: str
    new_subregion: str
    upload_action: str
    decision: str
    reason: str
    manual_region: str
    manual_subregion: str
    source_conflict: str


def load_db() -> dict[str, dict[str, object]]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        select sku, name, country, region, subregion, appellation, classification,
               validation_status
        from products
        """
    )
    return {clean(row["sku"]).upper(): dict(row) for row in rows}


def manual_rows() -> list[dict[str, str]]:
    with MANUAL_PATH.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for line_no, row in enumerate(reader, start=2):
            row["_line"] = str(line_no)
            row["_sku"] = clean(row.get("sku")).upper()
            rows.append(row)
        return rows


def canonicalize_region(country: str, region: str, region_lookup: dict[str, str]) -> tuple[str, str]:
    alias = REGION_ALIASES.get((country, region))
    if alias:
        return alias
    found = region_lookup.get(f"{norm(country)}::{norm(region)}")
    return (found or region, "")


def canonicalize_subregion(country: str, region: str, subregion: str) -> str:
    alias = SUBREGION_ALIASES.get((country, region, subregion))
    return alias or subregion


def is_region_level_value(
    country: str,
    value: str,
    region_names_by_country: dict[str, set[str]],
) -> bool:
    return norm(value) in {norm(v) for v in region_names_by_country.get(country, set())}


def allowed_subregion(
    country: str,
    region: str,
    value: str,
    subregions_by_region: dict[tuple[str, str], set[str]],
) -> str:
    if not value:
        return ""
    for subregion in subregions_by_region.get((country, region), set()):
        if norm(subregion) == norm(value):
            return subregion
    return ""


def legacy_subregion_candidate(
    country: str,
    region: str,
    old_region: str,
    old_subregion: str,
    subregions_by_region: dict[tuple[str, str], set[str]],
) -> tuple[str, str, str]:
    """Promote useful legacy geography only when it fits the corrected parent."""
    for source, value in (("old_region", old_region), ("old_subregion", old_subregion)):
        if not value or norm(value) == norm(region):
            continue
        candidate = allowed_subregion(country, region, value, subregions_by_region)
        if candidate:
            return candidate, source, value
    return "", "", ""


def decide_rows() -> tuple[list[Decision], dict[str, object]]:
    regions_by_country, subregions_by_region, region_lookup = load_taxonomy()
    db = load_db()
    rows = manual_rows()

    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[row["_sku"]].append(row)

    decisions: list[Decision] = []
    for sku, sku_rows in grouped.items():
        row = sku_rows[0]
        manual_country = clean(row.get("country"))
        manual_region = clean(row.get("Region import"))
        manual_subregion = clean(row.get("Sub region import"))
        manual_check = clean(row.get("Check"))
        source_conflict = ""

        distinct_geo = {
            (
                clean(r.get("country")),
                clean(r.get("Region import")),
                clean(r.get("Sub region import")),
            )
            for r in sku_rows
        }
        if len(sku_rows) > 1:
            source_conflict = "duplicate_manual_sku_same_geo"
        if len(distinct_geo) > 1:
            source_conflict = "duplicate_manual_sku_conflicting_geo"

        db_row = db.get(sku)
        old_region = clean(db_row.get("region")) if db_row else ""
        old_subregion = clean(db_row.get("subregion")) if db_row else ""

        def reject(reason: str) -> None:
            decisions.append(
                Decision(
                    sku=sku,
                    manual_line=row["_line"],
                    manual_check=manual_check,
                    country=manual_country,
                    old_region=old_region,
                    old_subregion=old_subregion,
                    new_region="",
                    new_subregion="",
                    upload_action="exclude",
                    decision="review",
                    reason=reason,
                    manual_region=manual_region,
                    manual_subregion=manual_subregion,
                    source_conflict=source_conflict,
                )
            )

        if not sku:
            reject("blank_sku")
            continue
        if not db_row:
            reject("sku_missing_in_database")
            continue
        if source_conflict == "duplicate_manual_sku_conflicting_geo":
            reject("duplicate_manual_sku_conflicting_geo")
            continue
        if manual_region in INVALID_REGION_VALUES:
            reject("manual_region_is_unknown_or_other")
            continue

        final_region, alias_subregion = canonicalize_region(manual_country, manual_region, region_lookup)
        if not final_region or final_region in INVALID_REGION_VALUES:
            reject("region_not_approved_for_browse")
            continue
        if not is_region_level_value(manual_country, final_region, regions_by_country):
            reject("region_not_in_canonical_browse_taxonomy")
            continue

        final_subregion = canonicalize_subregion(
            manual_country,
            final_region,
            alias_subregion or manual_subregion,
        )

        reason_parts = []
        if final_region != manual_region:
            reason_parts.append(f"region_normalized:{manual_region}->{final_region}")

        if (manual_country, final_region, final_subregion) in REDUNDANT_SUBREGIONS:
            reason_parts.append(f"redundant_subregion_removed:{final_subregion}")
            final_subregion = ""

        if not final_subregion and not manual_subregion:
            legacy_subregion, legacy_source, legacy_raw_value = legacy_subregion_candidate(
                manual_country,
                final_region,
                old_region,
                old_subregion,
                subregions_by_region,
            )
            if legacy_subregion:
                final_subregion = legacy_subregion
                reason_parts.append(
                    f"legacy_{legacy_source}_promoted_to_subregion:{legacy_raw_value}->{legacy_subregion}"
                )

        if final_subregion:
            if final_subregion != manual_subregion and not alias_subregion:
                reason_parts.append(f"subregion_normalized:{manual_subregion}->{final_subregion}")

            allowed_subregions = subregions_by_region.get((manual_country, final_region), set())
            allowed_norms = {norm(v) for v in allowed_subregions}
            if norm(final_subregion) not in allowed_norms:
                if is_region_level_value(manual_country, final_subregion, regions_by_country):
                    reject("manual_subregion_is_region_level_value_elsewhere")
                else:
                    reject("subregion_not_approved_for_browse_taxonomy")
                continue

        if not final_subregion and old_subregion:
            reason_parts.append("manual_blank_subregion_preserved_as_blank_in_validated_baseline")

        changed = norm(final_region) != norm(old_region) or norm(final_subregion) != norm(old_subregion)
        if changed and not final_subregion and old_subregion:
            action = "baseline_only_do_not_clear_subregion"
        elif changed:
            action = "update_region_subregion"
        else:
            action = "no_change"
        if changed and is_no_change(manual_check):
            reason_parts.append("manual_check_no_change_but_current_db_differs")
        if not changed and not is_no_change(manual_check):
            reason_parts.append("manual_check_change_but_db_already_matches")
        if source_conflict:
            reason_parts.append(source_conflict)

        decisions.append(
            Decision(
                sku=sku,
                manual_line=row["_line"],
                manual_check=manual_check,
                country=manual_country,
                old_region=old_region,
                old_subregion=old_subregion,
                new_region=final_region,
                new_subregion=final_subregion,
                upload_action=action,
                decision="upload_ready",
                reason=";".join(reason_parts) or "validated_against_browse_taxonomy",
                manual_region=manual_region,
                manual_subregion=manual_subregion,
                source_conflict=source_conflict,
            )
        )

    summary = {
        "manual_rows": len(rows),
        "manual_unique_skus": len(grouped),
        "upload_ready_unique_skus": sum(1 for d in decisions if d.decision == "upload_ready"),
        "patch_update_rows": sum(
            1 for d in decisions if d.decision == "upload_ready" and d.upload_action == "update_region_subregion"
        ),
        "baseline_only_do_not_clear_subregion_rows": sum(
            1
            for d in decisions
            if d.decision == "upload_ready"
            and d.upload_action == "baseline_only_do_not_clear_subregion"
        ),
        "no_change_rows": sum(
            1 for d in decisions if d.decision == "upload_ready" and d.upload_action == "no_change"
        ),
        "review_rows": sum(1 for d in decisions if d.decision != "upload_ready"),
        "decision_counts": dict(Counter(d.decision for d in decisions)),
        "action_counts": dict(Counter(d.upload_action for d in decisions)),
        "review_reason_counts": dict(Counter(d.reason for d in decisions if d.decision != "upload_ready")),
        "upload_reason_counts": dict(Counter(d.reason for d in decisions if d.decision == "upload_ready")),
    }
    return decisions, summary


def write_csv(path: Path, rows: list[dict[str, object]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(clean(value).replace("|", "/") for value in row) + " |")
    return "\n".join(lines)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    decisions, summary = decide_rows()

    base_fields = [
        "sku",
        "country",
        "new_region",
        "new_subregion",
        "upload_action",
        "reason",
        "old_region",
        "old_subregion",
        "manual_region",
        "manual_subregion",
        "manual_check",
        "manual_line",
    ]
    upload_rows = [
        {field: getattr(d, field) for field in base_fields}
        for d in decisions
        if d.decision == "upload_ready"
    ]
    patch_rows = [row for row in upload_rows if row["upload_action"] == "update_region_subregion"]
    review_fields = base_fields + ["decision", "source_conflict"]
    review_rows = [
        {field: getattr(d, field) for field in review_fields}
        for d in decisions
        if d.decision != "upload_ready"
    ]

    write_csv(OUT_DIR / "region_subregion_validated_baseline.csv", upload_rows, base_fields)
    write_csv(OUT_DIR / "region_subregion_upload_patch.csv", patch_rows, base_fields)
    write_csv(OUT_DIR / "region_subregion_review_exclusions.csv", review_rows, review_fields)

    legacy_recovery_rows = [
        row
        for row in patch_rows
        if row["country"] in {"Australia", "Chile"} and "legacy_" in row["reason"]
    ]
    legacy_recovery_fields = [
        "sku",
        "country",
        "old_region",
        "old_subregion",
        "new_region",
        "new_subregion",
        "reason",
        "manual_region",
        "manual_subregion",
        "manual_check",
        "manual_line",
    ]
    write_csv(
        OUT_DIR / "australia_chile_legacy_geo_recovery.csv",
        [{field: row[field] for field in legacy_recovery_fields} for row in legacy_recovery_rows],
        legacy_recovery_fields,
    )

    (OUT_DIR / "region_subregion_upload_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    review_reason_rows = Counter(row["reason"] for row in review_rows).most_common(20)
    patch_reason_rows = Counter(row["reason"] for row in patch_rows).most_common(20)
    manual_diff_rows = [
        row
        for row in upload_rows
        if norm(row["new_region"]) != norm(row["manual_region"])
        or norm(row["new_subregion"]) != norm(row["manual_subregion"])
    ]

    report = []
    report.append("# Final Region/Subregion Upload Package")
    report.append("")
    report.append("Generated: 2026-06-27 Asia/Bangkok")
    report.append("")
    report.append("## Files")
    report.append("")
    report.append("- `region_subregion_validated_baseline.csv`: full validated baseline for upload-ready SKUs.")
    report.append("- `region_subregion_upload_patch.csv`: only rows that would change current DB `region`/`subregion`.")
    report.append("- `region_subregion_review_exclusions.csv`: rows intentionally excluded from upload.")
    report.append("- `australia_chile_legacy_geo_recovery.csv`: focused audit of recovered old DB geography for Australia and Chile.")
    report.append("- `region_subregion_upload_summary.json`: machine-readable counts.")
    report.append("")
    report.append("## Upload Verdict")
    report.append("")
    report.append(
        "Use `region_subregion_upload_patch.csv` for the first database update. "
        "Use `region_subregion_validated_baseline.csv` as the new validated region/subregion baseline."
    )
    report.append("")
    report.append("The patch is conservative: it contains only rows whose final browse `region` and `subregion` are approved by the current taxonomy or the curated high-confidence browse extensions in the generator.")
    report.append("")
    report.append("## Counts")
    report.append("")
    report.append(
        md_table(
            ["Metric", "Count"],
            [
                ["Manual rows", summary["manual_rows"]],
                ["Manual unique SKUs", summary["manual_unique_skus"]],
                ["Upload-ready baseline SKUs", summary["upload_ready_unique_skus"]],
                ["Patch rows that change current DB", summary["patch_update_rows"]],
                [
                    "Baseline-only rows not patched because they would clear DB subregion",
                    summary["baseline_only_do_not_clear_subregion_rows"],
                ],
                ["Upload-ready no-change rows", summary["no_change_rows"]],
                ["Excluded review rows", summary["review_rows"]],
            ],
        )
    )
    report.append("")
    report.append("## Difference From Manual File")
    report.append("")
    report.append(
        md_table(
            ["Difference type", "Rows", "Meaning"],
            [
                [
                    "Manual rows collapsed by SKU",
                    summary["manual_rows"] - summary["manual_unique_skus"],
                    "Duplicate SKU rows in the manual sheet are collapsed to one SKU when geography is not conflicting.",
                ],
                [
                    "Upload-ready rows whose final browse geo differs from manual",
                    len(manual_diff_rows),
                    "Mostly canonical spelling/region alias cleanup or redundant subregion removal.",
                ],
                [
                    "Excluded rows",
                    summary["review_rows"],
                    "Missing DB SKU, pseudo-region, or unapproved/conflicting browse geography.",
                ],
                [
                    "Patch rows where manual said No Change but DB differs",
                    sum(1 for row in patch_rows if is_no_change(row["manual_check"])),
                    "Manual baseline and current DB drifted; patch chooses validated browse value.",
                ],
                [
                    "Rows deliberately kept out of patch to avoid clearing DB subregion",
                    summary["baseline_only_do_not_clear_subregion_rows"],
                    "These are in the baseline for policy review, but not in the first upload patch.",
                ],
            ],
        )
    )
    report.append("")
    report.append("## Top Exclusion Reasons")
    report.append("")
    report.append(md_table(["Reason", "Rows"], [[reason, count] for reason, count in review_reason_rows]))
    report.append("")
    report.append("## Top Patch Reasons")
    report.append("")
    report.append(md_table(["Reason", "Rows"], [[reason, count] for reason, count in patch_reason_rows]))
    report.append("")
    report.append("## Australia/Chile Legacy Geography Recovery")
    report.append("")
    report.append(
        "Old DB `region`/`subregion` values are promoted into final `new_subregion` only when the value is approved under the corrected `country > region` parent. Conflicting values remain excluded or baseline-only."
    )
    report.append("")
    country_recovery_rows = []
    for country in ["Australia", "Chile"]:
        country_rows = [row for row in legacy_recovery_rows if row["country"] == country]
        country_recovery_rows.append(
            [
                country,
                len(country_rows),
                ", ".join(
                    f"{subregion} ({count})"
                    for subregion, count in Counter(row["new_subregion"] for row in country_rows).most_common(8)
                ),
            ]
        )
    report.append(md_table(["Country", "Recovered patch rows", "Top recovered subregions"], country_recovery_rows))
    report.append("")
    report.append("## Upload Schema")
    report.append("")
    report.append("The upload CSV is intentionally narrow:")
    report.append("")
    report.append("`sku,country,new_region,new_subregion,upload_action,reason,old_region,old_subregion,manual_region,manual_subregion,manual_check,manual_line`")
    report.append("")
    report.append("Parser rule: update only rows where `upload_action=update_region_subregion`; set DB `region=new_region` and `subregion=new_subregion`. Rows with `upload_action=no_change` are baseline evidence and do not need to be written. Rows with `upload_action=baseline_only_do_not_clear_subregion` are intentionally excluded from the patch because applying them would clear an existing DB subregion.")
    report.append("")
    report.append("## Browse Structure Policy Applied")
    report.append("")
    report.append("- `country > region > subregion` is the visible browse spine.")
    report.append("- `Others region` is excluded; it should not become a production region value.")
    report.append("- Region aliases are normalized, for example `Loire valley` to `Loire Valley` and `Douro Valley` to `Douro`.")
    report.append("- High-confidence missing browse subregions are allowed only through the curated extension list in `scripts/generate_region_subregion_upload.py`.")
    report.append("- Unapproved fine-grained or conflicting terms are excluded for review instead of being forced into the frontend browse hierarchy.")
    report.append("")
    report.append("## Validation Inputs")
    report.append("")
    report.append("- Manual operations CSV supplied by the team.")
    report.append("- Current product DB table: `data/db/products.db:products`.")
    report.append("- Existing browse taxonomy: `data/taxonomy/countries.json`, `data/taxonomy/regions.json`, `data/taxonomy/subregions.json`.")
    report.append("- Curated browse extensions in `scripts/generate_region_subregion_upload.py`, based on repeated manual values and prior official spot checks for high-impact gaps such as Napa Valley, Margaret River, Rhône Valley crus, and Burgundy/Beaujolais names.")
    report.append("")
    report.append("Validation checks run on the generated patch:")
    report.append("")
    report.append("- Unique SKU per patch row.")
    report.append("- Every patch SKU exists in the current DB.")
    report.append("- No blank `new_region`.")
    report.append("- No `Others region` or pseudo-region in the patch.")
    report.append("- Every patch row has `upload_action=update_region_subregion`.")
    report.append("- No patch row clears an existing DB subregion.")
    report.append("")
    report.append("## Next Step After Upload")
    report.append("")
    report.append("After applying the patch, regenerate the storefront export and verify that `/shop` region/subregion counts match the patch summary. Then work the exclusion file separately as taxonomy/appellation/refiner enrichment, not as a blind browse upload.")

    (OUT_DIR / "region_subregion_final_upload_report.md").write_text(
        "\n".join(report) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"wrote {OUT_DIR}")


if __name__ == "__main__":
    main()
