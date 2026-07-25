"""Export enriched taxonomy knowledge to the map-generator JSON.

Reads data/taxonomy.db and produces the dict that becomes
data/taxonomy_descriptions_export.json. The catalog's map generator reads
that JSON.

Output keeps the EXISTING shape so nothing downstream breaks:

    {"regions": {...}, "subregions": {...}, "countries": {...}}

each keyed by lowercase entity name, each value at minimum {"short", "full"}.
For REGION entities we additionally attach a "knowledge" block with
grapes / tiers / attributes / citation drawn from the graph.

CRITICAL: a region may carry MULTIPLE contexts across scopes (e.g. Bordeaux
has a validated `wine` context AND a draft `spirits` context with empty
attributes). The export reads the scope_id='wine' context specifically and
NEVER the draft — every query below is filtered WHERE scope_id='wine'.
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "taxonomy_descriptions_export.json"

# entity_type -> output bucket key
_BUCKETS = {"region": "regions", "subregion": "subregions", "country": "countries"}


def _region_grapes(conn: sqlite3.Connection, region_id: int) -> list[str]:
    """Sorted display names of grapes linked to this region via grown_in."""
    rows = conn.execute(
        "SELECT te.name FROM taxonomy_relationships r "
        "JOIN taxonomy_entities te ON te.id = r.from_entity_id "
        "WHERE r.relationship = 'grown_in' AND r.to_entity_id = ? "
        "AND te.entity_type = 'grape_variety'",
        (region_id,)).fetchall()
    return sorted(r[0] for r in rows)


def _region_tiers(conn: sqlite3.Connection, region_id: int) -> list[str]:
    """Names of classification tiers this region is classified_under."""
    rows = conn.execute(
        "SELECT te.name FROM taxonomy_relationships r "
        "JOIN taxonomy_entities te ON te.id = r.to_entity_id "
        "WHERE r.relationship = 'classified_under' AND r.from_entity_id = ? "
        "AND te.entity_type = 'classification_tier'",
        (region_id,)).fetchall()
    return [r[0] for r in rows]


def build(conn: sqlite3.Connection) -> dict:
    out: dict[str, dict] = {"regions": {}, "subregions": {}, "countries": {}}

    # ONLY the wine-scope context; a draft spirits context on the same entity
    # must never be picked up.
    rows = conn.execute(
        "SELECT te.id, te.entity_type, te.name, "
        "       tc.description_short, tc.description_en, "
        "       tc.attributes, tc.source_citation "
        "FROM taxonomy_entities te "
        "JOIN taxonomy_contexts tc ON tc.entity_id = te.id "
        "WHERE tc.scope_id = 'wine' "
        "AND te.entity_type IN ('region', 'subregion', 'country')"
    ).fetchall()

    for entity_id, entity_type, name, short, full, attributes, citation in rows:
        short = short or ""
        full = full or ""
        # skip entities whose wine context carries no description at all
        if not short and not full:
            continue

        bucket = _BUCKETS[entity_type]
        entry: dict = {"short": short, "full": full}

        if entity_type == "region":
            grapes = _region_grapes(conn, entity_id)
            tiers = _region_tiers(conn, entity_id)
            attrs: dict = {}
            if attributes:
                try:
                    parsed = json.loads(attributes)
                except (ValueError, TypeError):
                    parsed = {}
                if isinstance(parsed, dict):
                    attrs = parsed

            knowledge: dict = {}
            if grapes:
                knowledge["grapes"] = grapes
            if tiers:
                knowledge["tiers"] = tiers
            if attrs:
                knowledge["attributes"] = attrs
            if knowledge:
                if citation:
                    knowledge["citation"] = citation
                entry["knowledge"] = knowledge

        out[bucket][name.lower()] = entry

    return out


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


if __name__ == "__main__":
    db = resolve_db()
    if not db.exists():
        raise SystemExit(f"taxonomy.db not found at {db}")
    conn = sqlite3.connect(db)
    try:
        data = build(conn)
    finally:
        conn.close()
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    total = sum(len(v) for v in data.values())
    print(
        f"wrote {OUTPUT_PATH} — "
        f"{len(data['regions'])} regions, "
        f"{len(data['subregions'])} subregions, "
        f"{len(data['countries'])} countries ({total} total)"
    )
