"""Shared beverage selection logic."""

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any


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
    aliases: dict[str, dict[str, str]]
    failures: list[str]
    quarantined_names: set[str]


def _group(rows, key):
    grouped = {}
    for row in rows:
        grouped.setdefault(key(row), []).append(row)
    return grouped


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

    countries = {row["id"]: row for row in countries_list}
    regions = {row["id"]: row for row in regions_list}
    subregions = {row["id"]: row for row in subregions_list}
    failures = []
    quarantined_names = set()

    for row in regions_list:
        if row["country_id"] not in countries:
            failures.append(f"orphan_region:{row['id']}")
            quarantined_names.add(normalize(row["name"]))

    for row in subregions_list:
        if row["region_id"] not in regions:
            failures.append(f"orphan_subregion:{row['id']}")
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

    canonical_groups = {
        "country": countries_by_name,
        "region": _group(
            regions_list, lambda row: normalize(row["name"])
        ),
        "subregion": _group(
            subregions_list, lambda row: normalize(row["name"])
        ),
    }
    aliases = {"country": {}, "region": {}, "subregion": {}}
    for level in aliases:
        for entry in alias_doc.get(level, []):
            alias = normalize(entry["alias"])
            canonical = normalize(entry["canonical"])
            canonical_rows = canonical_groups[level].get(canonical, [])
            if alias in aliases[level] or len(canonical_rows) != 1:
                failures.append(f"ambiguous_alias:{level}:{alias}")
                quarantined_names.add(alias)
                continue
            aliases[level][alias] = canonical

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
