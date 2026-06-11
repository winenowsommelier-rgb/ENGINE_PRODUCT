"""Shared beverage selection logic."""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Union


AliasKey = Union[str, tuple[int, str]]


NON_BEVERAGE_CLASSIFICATIONS = {
    "accessories",
    "cigar",
    "events",
    "glassware",
    "mineral water",
    "non-alcoholic",
}

NON_BEVERAGE_PREFIXES = {
    "ABA",
    "AWC",
    "CIG",
    "GBE",
    "GDC",
    "GLQ",
    "GWN",
    "WEV",
}


def clean(value):
    return "" if value is None else str(value).strip()


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFKC", clean(value)).casefold()
    return re.sub(r"\s+", " ", text)


def source_fingerprint(product):
    fields = (
        "id",
        "sku",
        "country",
        "region",
        "subregion",
        "updated_at",
    )
    payload = {field: clean(product.get(field)) for field in fields}
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def geography_basis(product):
    name = normalize(product.get("name"))
    if re.search(
        r"\b(mixed pack|mixed case|assorted|assortment|blend)\b", name
    ):
        return "multi_region_blend"

    classification = normalize(product.get("classification"))
    if any(
        beverage in classification
        for beverage in ("wine", "cognac", "armagnac", "brandy")
    ):
        return "protected_origin"
    if any(
        beverage in classification
        for beverage in ("gin", "vodka", "beer", "liqueur")
    ):
        return "production_location"
    return "unknown"


def is_beverage(product):
    classification = clean(product.get("classification")).lower()
    prefix = clean(product.get("sku"))[:3].upper()

    if classification in NON_BEVERAGE_CLASSIFICATIONS:
        return False
    if prefix in NON_BEVERAGE_PREFIXES:
        return False
    if classification == "wine product":
        return prefix.startswith("L") or (
            prefix.startswith("W") and prefix != "WEV"
        )
    return True


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class Taxonomy:
    batch_hash: str
    file_hashes: dict[str, str]
    countries: dict[int, dict[str, Any]]
    regions: dict[int, dict[str, Any]]
    subregions: dict[int, dict[str, Any]]
    countries_by_name: dict[str, list[dict[str, Any]]]
    regions_by_parent_name: dict[
        tuple[int, str], list[dict[str, Any]]
    ]
    subregions_by_parent_name: dict[
        tuple[int, str], list[dict[str, Any]]
    ]
    aliases: dict[str, dict[AliasKey, str]]
    failures: list[str]
    quarantined_names: set[str]


def _group(rows, key):
    grouped = {}
    for row in rows:
        grouped.setdefault(key(row), []).append(row)
    return grouped


def _first_by_id(rows):
    indexed = {}
    for row in rows:
        indexed.setdefault(row["id"], row)
    return indexed


def load_taxonomy(directory: Path) -> Taxonomy:
    names = [
        "countries.json",
        "regions.json",
        "subregions.json",
        "geography-aliases.json",
    ]
    paths = {name: directory / name for name in names}
    hashes = {name: _sha256(path) for name, path in paths.items()}
    batch_hash = hashlib.sha256(
        json.dumps(
            hashes, sort_keys=True, separators=(",", ":")
        ).encode()
    ).hexdigest()

    countries_list = json.loads(
        paths["countries.json"].read_text(encoding="utf-8")
    )["data"]
    regions_list = json.loads(
        paths["regions.json"].read_text(encoding="utf-8")
    )["data"]
    subregions_list = json.loads(
        paths["subregions.json"].read_text(encoding="utf-8")
    )["data"]
    alias_doc = json.loads(
        paths["geography-aliases.json"].read_text(encoding="utf-8")
    )

    failures = []
    quarantined_names = set()

    id_groups = {
        "country": _group(countries_list, lambda row: row["id"]),
        "region": _group(regions_list, lambda row: row["id"]),
        "subregion": _group(subregions_list, lambda row: row["id"]),
    }
    duplicate_ids = {
        level: {
            row_id
            for row_id, rows in grouped.items()
            if len(rows) > 1
        }
        for level, grouped in id_groups.items()
    }
    for level, grouped in id_groups.items():
        for row_id in duplicate_ids[level]:
            failures.append(f"duplicate_{level}_id:{row_id}")
            quarantined_names.update(
                normalize(row["name"]) for row in grouped[row_id]
            )

    countries = _first_by_id(countries_list)
    regions = _first_by_id(regions_list)
    subregions = _first_by_id(subregions_list)

    for row in regions_list:
        if row["country_id"] not in countries:
            failures.append(f"orphan_region:{row['id']}")
            quarantined_names.add(normalize(row["name"]))
        if row["country_id"] in duplicate_ids["country"]:
            quarantined_names.add(normalize(row["name"]))

    for row in subregions_list:
        if row["region_id"] not in regions:
            failures.append(f"orphan_subregion:{row['id']}")
            quarantined_names.add(normalize(row["name"]))
            continue
        parent = regions[row["region_id"]]
        if (
            row["region_id"] in duplicate_ids["region"]
            or parent["country_id"] in duplicate_ids["country"]
        ):
            quarantined_names.add(normalize(row["name"]))

    countries_by_name = _group(
        countries_list, lambda row: normalize(row["name"])
    )
    regions_by_parent_name = _group(
        regions_list,
        lambda row: (row["country_id"], normalize(row["name"])),
    )
    subregions_by_parent_name = _group(
        subregions_list,
        lambda row: (row["region_id"], normalize(row["name"])),
    )

    grouped_levels = (
        ("country", countries_by_name),
        ("region", regions_by_parent_name),
        ("subregion", subregions_by_parent_name),
    )
    for level, grouped in grouped_levels:
        for key, rows in grouped.items():
            if len(rows) <= 1:
                continue
            failures.append(f"duplicate_{level}:{key}")
            quarantined_names.add(
                key[-1] if isinstance(key, tuple) else key
            )

    subregion_names_by_country = {}
    for subregion in subregions_list:
        parent = regions.get(subregion["region_id"])
        if parent is None:
            continue
        subregion_names_by_country.setdefault(
            parent["country_id"], set()
        ).add(normalize(subregion["name"]))

    for region in regions_list:
        country = countries.get(region["country_id"])
        if country is None:
            continue
        name = normalize(region["name"])
        if name in subregion_names_by_country.get(
            region["country_id"], set()
        ):
            failures.append(
                f"cross_level:{normalize(country['name'])}:{name}"
            )
            quarantined_names.add(name)

    aliases = {"country": {}, "region": {}, "subregion": {}}

    alias_candidates = {"country": [], "region": [], "subregion": []}
    for entry in alias_doc.get("country", []):
        alias_candidates["country"].append(
            (normalize(entry["alias"]), normalize(entry["canonical"]))
        )

    for entry in alias_doc.get("region", []):
        alias = normalize(entry["alias"])
        country_rows = countries_by_name.get(
            normalize(entry.get("country")), []
        )
        if (
            len(country_rows) != 1
            or country_rows[0]["id"] in duplicate_ids["country"]
        ):
            failures.append(f"invalid_alias_parent:region:{alias}")
            quarantined_names.add(alias)
            continue
        alias_candidates["region"].append(
            (
                (country_rows[0]["id"], alias),
                normalize(entry["canonical"]),
            )
        )

    for entry in alias_doc.get("subregion", []):
        alias = normalize(entry["alias"])
        country_rows = countries_by_name.get(
            normalize(entry.get("country")), []
        )
        if (
            len(country_rows) != 1
            or country_rows[0]["id"] in duplicate_ids["country"]
        ):
            failures.append(f"invalid_alias_parent:subregion:{alias}")
            quarantined_names.add(alias)
            continue
        country_id = country_rows[0]["id"]
        region_rows = regions_by_parent_name.get(
            (country_id, normalize(entry.get("region"))), []
        )
        if (
            len(region_rows) != 1
            or region_rows[0]["id"] in duplicate_ids["region"]
        ):
            failures.append(f"invalid_alias_parent:subregion:{alias}")
            quarantined_names.add(alias)
            continue
        alias_candidates["subregion"].append(
            (
                (region_rows[0]["id"], alias),
                normalize(entry["canonical"]),
            )
        )

    canonical_groups = {
        "country": countries_by_name,
        "region": regions_by_parent_name,
        "subregion": subregions_by_parent_name,
    }
    for level, candidates in alias_candidates.items():
        candidates_by_key = _group(candidates, lambda item: item[0])
        for key, entries in candidates_by_key.items():
            alias = key[-1] if isinstance(key, tuple) else key
            if len(entries) != 1:
                failures.append(f"ambiguous_alias:{level}:{alias}")
                quarantined_names.add(alias)
                continue

            canonical = entries[0][1]
            canonical_key = (
                (key[0], canonical) if isinstance(key, tuple)
                else canonical
            )
            canonical_rows = canonical_groups[level].get(
                canonical_key, []
            )
            if (
                len(canonical_rows) != 1
                or canonical_rows[0]["id"]
                in duplicate_ids[level]
            ):
                failures.append(f"ambiguous_alias:{level}:{alias}")
                quarantined_names.add(alias)
                continue

            alias_rows = canonical_groups[level].get(key, [])
            if alias_rows:
                if alias == canonical:
                    continue
                failures.append(
                    f"alias_shadows_canonical:{level}:{alias}"
                )
                quarantined_names.add(alias)
                continue
            aliases[level][key] = canonical

    return Taxonomy(
        batch_hash=batch_hash,
        file_hashes=hashes,
        countries=countries,
        regions=regions,
        subregions=subregions,
        countries_by_name=countries_by_name,
        regions_by_parent_name=regions_by_parent_name,
        subregions_by_parent_name=subregions_by_parent_name,
        aliases=aliases,
        failures=sorted(set(failures)),
        quarantined_names=quarantined_names,
    )


def _duplicate_id(taxonomy, level, row_id):
    return f"duplicate_{level}_id:{row_id}" in taxonomy.failures


def _resolve(taxonomy, level, value, parent_id=None):
    name = normalize(value)
    if name in taxonomy.quarantined_names:
        return None, False, f"quarantined_{level}"

    if level == "country":
        key = name
        grouped = taxonomy.countries_by_name
    elif level == "region":
        key = (parent_id, name)
        grouped = taxonomy.regions_by_parent_name
    else:
        key = (parent_id, name)
        grouped = taxonomy.subregions_by_parent_name

    rows = grouped.get(key, [])
    used_alias = False
    if not rows:
        canonical = taxonomy.aliases[level].get(key)
        if canonical is not None:
            used_alias = True
            canonical_key = (
                canonical
                if level == "country"
                else (parent_id, canonical)
            )
            rows = grouped.get(canonical_key, [])

    if len(rows) != 1:
        if len(rows) > 1:
            return None, used_alias, f"ambiguous_{level}"
        return None, used_alias, f"unknown_{level}"

    row = rows[0]
    if (
        normalize(row["name"]) in taxonomy.quarantined_names
        or _duplicate_id(taxonomy, level, row["id"])
    ):
        return None, used_alias, f"quarantined_{level}"
    return row, used_alias, None


def _base_result(product, taxonomy):
    old = {
        "country": clean(product.get("country")),
        "region": clean(product.get("region")),
        "subregion": clean(product.get("subregion")),
    }
    return {
        "sku": clean(product.get("sku")),
        "name": clean(product.get("name")),
        "classification": clean(product.get("classification")),
        "old_geography": old,
        "new_geography": dict(old),
        "taxonomy_ids": {
            "country_id": None,
            "region_id": None,
            "subregion_id": None,
        },
        "geography_basis": geography_basis(product),
        "taxonomy_hash": taxonomy.batch_hash,
        "source_fingerprint": source_fingerprint(product),
        "status": "evidence_review",
        "reason_codes": [],
    }


def _finish(result, status, reason):
    result["status"] = status
    result["reason_codes"] = [] if reason is None else [reason]
    return result


def _blocked_reason(reason):
    return reason is not None and reason.startswith("quarantined_")


def _subregion_exists_elsewhere(taxonomy, country_id, value):
    name = normalize(value)
    for (region_id, candidate), rows in (
        taxonomy.subregions_by_parent_name.items()
    ):
        region = taxonomy.regions.get(region_id)
        if (
            candidate == name
            and region is not None
            and region["country_id"] == country_id
            and rows
        ):
            return True
    for (region_id, alias), canonical in taxonomy.aliases[
        "subregion"
    ].items():
        region = taxonomy.regions.get(region_id)
        if (
            alias == name
            and canonical
            and region is not None
            and region["country_id"] == country_id
        ):
            return True
    return False


def classify_product(product, taxonomy):
    result = _base_result(product, taxonomy)
    old = result["old_geography"]
    ids = result["taxonomy_ids"]

    if not old["country"]:
        return _finish(result, "evidence_review", "missing_country")

    country, country_alias, reason = _resolve(
        taxonomy, "country", old["country"]
    )
    if reason:
        status = "taxonomy_blocked" if _blocked_reason(reason) else (
            "evidence_review"
        )
        return _finish(result, status, reason)
    ids["country_id"] = country["id"]
    result["new_geography"]["country"] = country["name"]

    if not old["region"]:
        return _finish(result, "evidence_review", "missing_region")

    parts = [clean(part) for part in old["region"].split("|")]
    has_compound = len(parts) > 1
    if has_compound and (len(parts) != 2 or not all(parts)):
        return _finish(result, "evidence_review", "malformed_compound")

    region_value = parts[0] if has_compound else old["region"]
    region, region_alias, reason = _resolve(
        taxonomy, "region", region_value, country["id"]
    )
    if reason:
        status = "taxonomy_blocked" if _blocked_reason(reason) else (
            "evidence_review"
        )
        return _finish(result, status, reason)
    ids["region_id"] = region["id"]
    result["new_geography"]["region"] = region["name"]

    if has_compound:
        embedded, _, reason = _resolve(
            taxonomy, "subregion", parts[1], region["id"]
        )
        if reason:
            status = (
                "taxonomy_blocked"
                if _blocked_reason(reason)
                else "evidence_review"
            )
            return _finish(result, status, reason)

        if old["subregion"]:
            current, _, current_reason = _resolve(
                taxonomy, "subregion", old["subregion"], region["id"]
            )
            if _blocked_reason(current_reason):
                return _finish(
                    result, "taxonomy_blocked", current_reason
                )
            if current is None or current["id"] != embedded["id"]:
                return _finish(
                    result,
                    "evidence_review",
                    "compound_subregion_conflict",
                )

        ids["subregion_id"] = embedded["id"]
        result["new_geography"]["subregion"] = embedded["name"]
        return _finish(
            result,
            "exact_restructure_review",
            "compound_region_restructure",
        )

    if not old["subregion"]:
        result["new_geography"]["subregion"] = ""
        if result["geography_basis"] in {
            "production_location",
            "multi_region_blend",
        }:
            reason = (
                "multi_region_blend"
                if result["geography_basis"] == "multi_region_blend"
                else "subregion_not_applicable"
            )
            return _finish(result, "legitimately_blank", reason)
        return _finish(
            result, "valid_region_only", "subregion_not_proven"
        )

    if normalize(old["subregion"]) == normalize(region["name"]):
        same_name_rows = taxonomy.subregions_by_parent_name.get(
            (region["id"], normalize(region["name"])), []
        )
        if (
            normalize(region["name"]) in taxonomy.quarantined_names
            or same_name_rows
        ):
            status = (
                "taxonomy_blocked"
                if normalize(region["name"])
                in taxonomy.quarantined_names
                else "evidence_review"
            )
            reason = (
                "quarantined_region"
                if status == "taxonomy_blocked"
                else "redundant_subregion_ambiguous"
            )
            return _finish(result, status, reason)
        result["new_geography"]["subregion"] = ""
        return _finish(
            result,
            "exact_mechanical_correction",
            "redundant_subregion_cleared",
        )

    subregion, subregion_alias, reason = _resolve(
        taxonomy, "subregion", old["subregion"], region["id"]
    )
    if reason:
        if _blocked_reason(reason):
            return _finish(result, "taxonomy_blocked", reason)
        if _subregion_exists_elsewhere(
            taxonomy, country["id"], old["subregion"]
        ):
            reason = "subregion_parent_mismatch"
        return _finish(result, "evidence_review", reason)

    ids["subregion_id"] = subregion["id"]
    result["new_geography"]["subregion"] = subregion["name"]

    aliases_used = country_alias or region_alias or subregion_alias
    canonical = result["new_geography"]
    formatting_changed = any(
        old[level] != canonical[level]
        for level in ("country", "region", "subregion")
    )
    if aliases_used or formatting_changed:
        reason = (
            "approved_alias_correction"
            if aliases_used
            else "canonical_format_correction"
        )
        return _finish(
            result, "exact_mechanical_correction", reason
        )
    return _finish(result, "valid_exact", None)
