"""Export shop-filter collections (§7) to data/collections_export.json.

Reads the `collections` table and emits a stable, allowlist-enforced JSON list
the catalog can consume. The shop-query engine only recognizes clean-join
filter keys; any other key in a stored filter_definition is DROPPED here (with a
stderr warning — Rule 2: never silently swallow a skipped key). The key is
`class` (category_type), NOT `category`; `grape`/`variety` are BLOCKED by §7.
`designation` IS allowed — it's the derived product classification tier (Grand
Cru / DOCG / XO / Single Malt …) the shop engine filters on via
designationForProduct (the "Classification" control in the Taste & more menu).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "taxonomy.db"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "collections_export.json"

ALLOWED_KEYS = {"country", "region", "subregion", "class", "designation", "body", "acidity", "tannin", "price"}


def build(conn: sqlite3.Connection) -> list[dict]:
    """Read all collections; allowlist-filter each filter_definition.

    Emits {"slug","name","description","filter"} per row, sorted by slug for
    stable diffs. Any filter key outside ALLOWED_KEYS is dropped and a warning
    is printed to stderr.
    """
    out: list[dict] = []
    rows = conn.execute(
        "SELECT slug, name, description, filter_definition, category_group, sort_order "
        "FROM collections"
    ).fetchall()

    for slug, name, description, fdef, group, sort_order in rows:
        try:
            parsed = json.loads(fdef) if fdef else {}
        except (ValueError, TypeError):
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}

        allowed: dict = {}
        for key, value in parsed.items():
            if key in ALLOWED_KEYS:
                allowed[key] = value
            else:
                print(
                    f"[export_collections] WARNING: dropping disallowed filter "
                    f"key '{key}' from collection '{slug}'",
                    file=sys.stderr,
                )

        out.append(
            {
                "slug": slug,
                "name": name,
                "description": description or "",
                "group": group or "",
                "sortOrder": sort_order if sort_order is not None else 999,
                "filter": allowed,
            }
        )

    # (sort_order, slug) → intended category sequence, stable within group.
    out.sort(key=lambda c: (c["sortOrder"], c["slug"]))
    return out


def resolve_db() -> Path:
    override = os.environ.get("WNLQ9_TAXONOMY_DB")
    return Path(override) if override else DEFAULT_DB


def main() -> None:
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
    print(f"wrote {OUTPUT_PATH} — {len(data)} collections")


if __name__ == "__main__":
    main()
