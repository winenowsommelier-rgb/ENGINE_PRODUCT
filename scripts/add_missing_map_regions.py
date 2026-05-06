#!/usr/bin/env python3
"""Add the new wine/whisky regions we enriched into data/taxonomy_for_map.json
so the explore map renders pins for them.

After running, re-run scripts/build_explore_taxonomy.py to regenerate
data/taxonomy/explore-taxonomy.json.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAP_TAX = REPO / "data" / "taxonomy_for_map.json"


def slugify(name: str) -> str:
    import re, unicodedata
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    n = re.sub(r"[^a-z0-9]+", "-", n).strip("-")
    return n


# Each entry: parent_country_name -> list of (region_name, lat, lng)
NEW_REGIONS_BY_COUNTRY: dict[str, list[tuple[str, float, float]]] = {
    "Australia": [
        ("Riverland",        -34.27, 140.60),  # Berri / Renmark, SA
        ("Riverina",         -34.30, 146.05),  # Griffith area, NSW
        ("Eden Valley",      -34.65, 139.10),  # SA
        ("Hunter Valley",    -32.78, 151.30),  # NSW (Pokolbin); supersedes 'Hunter'
        ("King Valley",      -36.65, 146.40),  # VIC
        ("Grampians",        -37.20, 142.50),  # VIC
        ("Mount Benson",     -36.97, 139.83),  # SA Limestone Coast
        ("Great Southern",   -34.62, 117.85),  # WA
        ("Beechworth",       -36.36, 146.69),  # VIC
        ("Heathcote",        -36.92, 144.71),  # VIC
        ("Padthaway",        -36.62, 140.50),  # SA Limestone Coast
        ("Murray Darling",   -34.18, 142.16),  # VIC/NSW
    ],
    "Chile": [
        ("Limarí Valley",    -30.62, -71.20),
    ],
    "USA": [
        ("Lodi",              38.13, -121.27),
        ("Alexander Valley",  38.62, -122.85),
    ],
    "Scotland": [
        ("Speyside",          57.45,  -3.20),  # Aberlour area
        ("Islands",           58.50,  -6.30),  # Outer Hebrides midpoint (covers Skye/Orkney/Mull/Jura/Arran)
    ],
    "Spain": [
        ("Almansa",           38.87,  -1.10),
        ("La Mancha",         39.50,  -3.10),
        ("Toro",              41.52,  -5.40),
        ("Calatayud",         41.35,  -1.65),
        ("Yecla",             38.62,  -1.10),
        ("Cigales",           41.75,  -4.69),
        ("Campo de Borja",    41.83,  -1.55),
        ("Bierzo",            42.55,  -6.60),
        ("Castilla y León",   41.75,  -4.30),  # broad VT
        ("Aragón",            41.65,  -0.90),
        ("Cádiz",             36.53,  -6.30),
    ],
    "Portugal": [
        ("Alentejo",          38.55,  -7.95),
    ],
    "Austria": [
        ("Kremstal",          48.40,  15.62),
    ],
    "New Zealand": [
        ("Nelson",            -41.27, 173.28),
    ],
    "Germany": [
        ("Franken",           49.80,   9.95),
    ],
}


def atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=str(path.parent), delete=False, suffix=".tmp", encoding="utf-8") as tmp:
        json.dump(data, tmp, indent=2, ensure_ascii=False)
        tmp.flush()
        os.fsync(tmp.fileno())
        tmp_path = Path(tmp.name)
    os.replace(tmp_path, path)


def main() -> int:
    tax = json.loads(MAP_TAX.read_text())
    countries = {c["name"]: c for c in tax.get("countries", [])}
    regions = tax.get("regions", [])
    existing = {(r.get("parent_name"), r.get("name")) for r in regions}

    # Get the next id
    max_id = max((r.get("id", 0) for r in regions), default=0)
    next_id = max_id + 1

    added = 0
    skipped = 0
    for parent_country, items in NEW_REGIONS_BY_COUNTRY.items():
        parent = countries.get(parent_country)
        if not parent:
            print(f"WARN: country {parent_country!r} not found in taxonomy_for_map.json — skipping its regions")
            skipped += len(items)
            continue
        parent_id = parent.get("id")
        for name, lat, lng in items:
            if (parent_country, name) in existing:
                skipped += 1
                continue
            regions.append({
                "id": next_id,
                "name": name,
                "slug": slugify(name),
                "latitude": lat,
                "longitude": lng,
                "parent_id": parent_id,
                "parent_name": parent_country,
            })
            existing.add((parent_country, name))
            next_id += 1
            added += 1

    print(f"Added {added} new regions, skipped {skipped} existing/missing-parent.")
    if added == 0:
        return 0
    atomic_write_json(MAP_TAX, tax)
    print(f"Wrote {MAP_TAX.name}.\nNow run: scripts/build_explore_taxonomy.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
