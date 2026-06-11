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
