#!/usr/bin/env python3
"""
Fix taxonomy_for_map.json:
1. Merge duplicate regions into canonical names
2. Add missing coordinates for all levels (countries, regions, subregions, appellations)
3. Fix country-level issues (Netherland -> merge into Netherlands)
4. Re-export clean JSON + human-readable txt
"""

import json
import os
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
MAP_JSON = DATA_DIR / "taxonomy_for_map.json"
MAP_TXT = DATA_DIR / "full_taxonomy_list.txt"

# ============================================================
# DUPLICATE REGION MERGES
# Key = canonical name, Value = names to merge INTO it
# ============================================================
REGION_MERGES = {
    "Barossa Valley":     ["Barossa"],           # Australia — "Barossa Valley" is the GI name
    "Casablanca Valley":  ["Casablanca"],         # Chile
    "Colchagua Valley":   ["Colchagua"],          # Chile
    "Clare Valley":       ["Clare"],              # Australia
    "Maipo Valley":       ["Maipo"],              # Chile
    "Rhône Valley":       ["Rhône"],              # France — already has coords on Rhône Valley
    "Loire Valley":       ["Loire", "Loire valley"], # France — canonical = Loire Valley
    "Friuli-Venezia Giulia": ["Friuli"],          # Italy
    "Sonoma County":      ["Sonoma"],             # USA — Sonoma is region, Sonoma County also region-level
}

# ============================================================
# COUNTRY-LEVEL FIXES
# ============================================================
COUNTRY_MERGES = {
    "Netherlands": ["Netherland"],  # Merge typo into canonical
}

# ============================================================
# COORDINATES DATABASE
# All coordinates are [lat, lng] for the center/representative point
# ============================================================

COUNTRY_COORDS = {
    "Caribbean":       [17.5, -67.5],      # Central Caribbean Sea
    "Czech Republic":  [49.8, 15.5],       # Prague area
    "Norway":          [59.9, 10.7],       # Oslo area
    # Netherland merged into Netherlands which already has coords
}

REGION_COORDS = {
    # --- Australia ---
    "Adelaide Hills":          [-35.0, 138.7],
    "Barossa Valley":          [-34.5, 138.9],
    "Clare Valley":            [-33.8, 138.6],
    "Coonawarra":              [-37.3, 140.8],
    "Hunter":                  [-32.8, 151.3],    # Hunter Valley
    "Multi-Regional":          [-34.0, 140.0],    # Generic Australia
    "South Eastern Australia": [-36.0, 145.0],    # Generic SE Aus
    "Victoria":                [-37.0, 145.0],
    "Yarra":                   [-37.7, 145.5],    # Yarra Valley

    # --- Chile ---
    "Aconcagua Valley":   [-32.8, -70.7],
    "Cachapoal Valley":   [-34.2, -70.9],
    "Casablanca Valley":  [-33.3, -71.4],
    "Colchagua Valley":   [-34.6, -71.2],
    "Curico Valley":      [-35.0, -71.2],
    "Maipo Valley":       [-33.5, -70.6],
    "Maule":              [-35.5, -71.7],

    # --- China ---
    "Ningxia":            [38.5, 106.3],

    # --- France ---
    "Loire Valley":       [47.3, 0.7],     # canonical merged name
    "Rhône Valley":       [44.1, 4.8],     # already existed, keep

    # --- Italy ---
    "Abruzzo":              [42.4, 13.4],
    "Campania":             [40.8, 14.3],
    "Emilia-Romagna":       [44.5, 11.3],
    "Friuli-Venezia Giulia":[46.1, 13.2],
    "Lazio":                [41.9, 12.5],
    "Lombardy":             [45.5, 9.9],
    "Marche":               [43.6, 13.5],
    "Sardinia":             [40.1, 9.1],
    "Trentino-Alto Adige":  [46.4, 11.3],
    "Umbria":               [42.7, 12.6],

    # --- New Zealand ---
    "Martinborough":    [-41.2, 175.5],

    # --- Portugal ---
    "Dão":              [40.5, -7.9],

    # --- Scotland ---
    "Lowland":          [55.9, -3.2],

    # --- South Africa ---
    "Western Cape":     [-33.9, 18.4],

    # --- Spain ---
    "Catalunya":        [41.4, 1.8],
    "La Mancha":        [39.0, -3.0],
    "Others region":    [40.0, -3.7],   # Generic Spain center
    "Rueda":            [41.4, -4.9],
    "Toro":             [41.5, -5.4],
    "Valencia":         [39.5, -0.4],

    # --- USA ---
    "Oregon":           [45.5, -122.7],
    "Sonoma County":    [38.5, -122.8],
    "Washington":       [46.8, -120.5],
}

SUBREGION_COORDS = {
    # --- Argentina / Mendoza ---
    "Luján de Cuyo / Valle de Uco": [-33.1, -69.1],
    "Maipú":                        [-32.9, -68.4],
    "Uco Valley":                   [-33.8, -69.3],

    # --- Australia ---
    "Seppeltsfield":    [-34.5, 138.9],
    "Roennfeldt Road":  [-34.5, 139.0],   # Barossa subzone
    "Wilyabrup":        [-33.8, 115.0],
    "Tamar Valley / Adelaide Hills / Henty": [-41.3, 147.0],  # Tamar Valley center
    "Coonawarra / McLaren Vale / Barossa Valley / Adelaide Hills": [-35.5, 138.8],
    "Riverland":        [-34.2, 140.5],

    # --- Chile ---
    "Millahue Valley":  [-34.1, -71.0],
    "Curicó Valley":    [-35.0, -71.2],
    "Puente Alto":      [-33.6, -70.6],

    # --- China ---
    "Helan Mountain":   [38.8, 105.8],

    # --- France / Bordeaux ---
    "Blaye":            [45.1, -0.7],
    "Côtes de Bourg":   [45.0, -0.6],
    "Fronsac":          [44.9, -0.3],
    "Graves":           [44.7, -0.5],
    "Margaux":          [45.1, -0.7],
    "Médoc":            [45.2, -0.9],
    "Pauillac":         [45.2, -0.8],
    "Pessac-Léognan":   [44.7, -0.6],
    "Pomerol":          [44.9, -0.2],
    "Right Bank":       [44.9, -0.1],
    "Saint-Estèphe":    [45.3, -0.8],
    "Saint-Julien":     [45.2, -0.7],
    "Saint-Émilion":    [44.9, -0.2],

    # --- France / Burgundy ---
    "Beaujolais":           [46.2, 4.6],
    "Beaune":               [47.0, 4.8],
    "Chablis":              [47.8, 3.8],
    "Chassagne-Montrachet": [46.9, 4.7],
    "Côte de Beaune":       [47.0, 4.8],
    "Côte de Nuits":        [47.2, 5.0],
    "Gevrey-Chambertin":    [47.2, 4.9],
    "Pommard":              [47.0, 4.8],
    "Pouilly-Fuissé":       [46.3, 4.7],
    "Volnay":               [47.0, 4.8],

    # --- France / Champagne ---
    "Montagne de Reims": [49.2, 3.9],

    # --- France / Languedoc ---
    "Minervois":    [43.3, 2.8],
    "Pays d'Oc":    [43.5, 3.4],

    # --- France / Loire ---
    "Anjou":        [47.5, -0.6],

    # --- France / Provence ---
    "Les Baux-de-Provence": [43.7, 4.8],

    # --- France / Rhône ---
    "Southern Rhône": [44.1, 4.8],

    # --- Germany ---
    "Ruwer":        [49.8, 6.7],
    "Ruppertsberg":  [49.4, 8.2],

    # --- Italy ---
    "Montepulciano d'Abruzzo": [42.4, 13.8],
    "Benevento":    [41.1, 14.8],
    "Asti":         [44.9, 8.2],
    "Barbaresco":   [44.7, 8.1],
    "Langhe":       [44.6, 8.0],
    "Manduria":     [40.4, 17.6],
    "Taranto":      [40.5, 17.2],
    "Etna":         [37.8, 15.0],
    "Marsala":      [37.8, 12.4],
    "Nero d'Avola": [37.0, 14.9],     # Central Sicily
    "Bolgheri":     [43.2, 10.6],
    "Chianti":      [43.5, 11.3],
    "Maremma":      [42.8, 11.1],
    "Montalcino":   [43.1, 11.5],
    "Vinci":        [43.8, 10.9],
    "Amarone":      [45.5, 10.9],     # Valpolicella area
    "Piave":        [45.7, 12.3],
    "Prosecco":     [45.9, 12.0],
    "Soave":        [45.4, 11.2],
    "Valpolicella": [45.5, 10.9],

    # --- New Zealand ---
    "Waipara Valley": [-43.1, 172.8],

    # --- Spain ---
    "Alpera":       [38.9, -1.2],
    "Cahors":       [44.5, 1.4],      # Actually France, but filed under Spain/Others in data
    "Rioja Alavesa": [42.6, -2.6],
    "Rioja Alta":    [42.5, -2.8],

    # --- USA ---
    "Central Coast":    [35.3, -120.7],
    "Mendocino County": [39.2, -123.4],
    "Monterey County":  [36.2, -121.4],
    "Calistoga":        [38.6, -122.6],
    "Napa Valley":      [38.5, -122.3],
    "Oakville":         [38.4, -122.4],
    "Rutherford":       [38.5, -122.4],
    "St. Helena":       [38.5, -122.5],
    "Columbia Gorge":   [45.7, -121.6],
    "Sonoma County":    [38.5, -122.8],
    "Alexander Valley": [38.7, -122.9],
}

APPELLATION_COORDS = {
    "Aglianico del Beneventano":             [41.1, 14.8],
    "Alexander Valley AVA":                  [38.7, -122.9],
    "Almansa":                               [38.9, -1.1],
    "Alsace":                                [48.2, 7.3],
    "Altamira / Vista Flores / Gualtallary": [-33.6, -69.2],
    "Alto Adige":                            [46.7, 11.4],
    "Amarone della Valpolicella":            [45.5, 10.9],
    "Anderson Valley":                       [39.1, -123.5],
    "Barbaresco":                            [44.7, 8.1],
    "Barolo":                                [44.6, 7.9],
    "Barossa Valley":                        [-34.5, 138.9],
    "Bolgheri":                              [43.2, 10.6],
    "Bordeaux":                              [44.8, -0.6],
    "Bordeaux AOC":                          [44.8, -0.6],
    "Bordeaux Supérieur":                    [44.8, -0.6],
    "Brauneberger Juffer":                   [49.9, 6.9],
    "Brunello di Montalcino":                [43.1, 11.5],
    "Cahors":                                [44.5, 1.4],
    "California":                            [37.3, -119.5],
    "Chablis Premier Cru":                   [47.8, 3.8],
    "Chambolle-Musigny":                     [47.2, 4.9],
    "Chassagne-Montrachet":                  [46.9, 4.7],
    "Chianti Classico":                      [43.5, 11.3],
    "Châteauneuf-du-Pape":                   [44.1, 4.8],
    "Columbia Gorge AVA":                    [45.7, -121.6],
    "DOC Rioja":                             [42.5, -2.5],
    "DOCa Rioja":                            [42.5, -2.5],
    "Douro DOC":                             [41.2, -7.8],
    "Franciacorta":                          [45.6, 10.0],
    "Gevrey-Chambertin":                     [47.2, 4.9],
    "Haut-Médoc":                            [45.1, -0.8],
    "Helan Mountain Wine Region":            [38.8, 105.8],
    "Hermitage":                             [45.1, 4.8],
    "Kabinett":                              [50.0, 8.0],     # Generic Germany (quality level, not place)
    "Lambrusco Emilia":                      [44.6, 11.0],
    "Lambrusco Grasparossa di Castelvetro":  [44.5, 11.0],
    "Langhe Nebbiolo":                       [44.6, 8.0],
    "Maipo Valley":                          [-33.5, -70.6],
    "Margaux":                               [45.1, -0.7],
    "Meursault":                             [47.0, 4.8],
    "Montepulciano d'Abruzzo DOC":           [42.4, 13.8],
    "Monterey County":                       [36.2, -121.4],
    "Morey-Saint-Denis":                     [47.2, 4.9],
    "Multi-Appellation California":          [37.3, -119.5],
    "Napa Valley":                           [38.5, -122.3],
    "Nuits-Saint-Georges":                   [47.1, 4.9],
    "Orvieto Classico":                      [42.7, 12.1],
    "Pauillac":                              [45.2, -0.8],
    "Pauillac AOC":                          [45.2, -0.8],
    "Pays d'Oc IGP":                         [43.5, 3.4],
    "Pays d'Oc PGI":                         [43.5, 3.4],
    "Pessac-Léognan AOC":                    [44.7, -0.6],
    "Piave DOC":                             [45.7, 12.3],
    "Pomerol":                               [44.9, -0.2],
    "Primitivo di Manduria":                 [40.4, 17.6],
    "Primitivo di Manduria DOP":             [40.4, 17.6],
    "Pritchard Hill":                        [38.5, -122.3],
    "Prosecco":                              [45.9, 12.0],
    "Puligny-Montrachet":                    [46.9, 4.7],
    "Rioja":                                 [42.5, -2.5],
    "Rosso di Montepulciano":                [43.1, 11.8],
    "Saint-Estèphe":                         [45.3, -0.8],
    "Saint-Julien":                          [45.2, -0.7],
    "Saint-Émilion":                         [44.9, -0.2],
    "Saint-Émilion Grand Cru":               [44.9, -0.2],
    "Salento":                               [40.4, 18.2],
    "Sancerre":                              [47.3, 2.8],
    "Santenay":                              [46.9, 4.7],
    "Sekt":                                  [50.0, 8.0],     # Generic Germany (sparkling category)
    "Sicilia DOC":                           [37.5, 14.0],
    "Soave Classico":                        [45.4, 11.2],
    "Sonoma County":                         [38.5, -122.8],
    "Spätlese":                              [50.0, 8.0],     # Generic Germany (quality level)
    "Stags Leap District":                   [38.4, -122.4],
    "Toscana IGT":                           [43.3, 11.3],
    "Tre Venezie I.G.P.":                    [45.8, 12.0],
    "Valpolicella Classico Superiore":       [45.5, 10.9],
    "Vino Nobile di Montepulciano":          [43.1, 11.8],
    "Volnay AOC":                            [47.0, 4.8],
    "Vosne-Romanée":                         [47.2, 4.9],
    "Vouvray":                               [47.4, 0.8],
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Saved: {path}")


def merge_scopes(items):
    """Merge scopes from multiple entries."""
    scopes = set()
    for item in items:
        if "scopes" in item:
            if isinstance(item["scopes"], list):
                scopes.update(item["scopes"])
            elif isinstance(item["scopes"], str):
                scopes.add(item["scopes"])
    return sorted(scopes) if scopes else None


def apply_country_merges(data):
    """Merge country duplicates (e.g., Netherland -> Netherlands)."""
    changes = 0
    for canonical, aliases in COUNTRY_MERGES.items():
        canonical_entry = None
        alias_entries = []
        for c in data["countries"]:
            if c["name"] == canonical:
                canonical_entry = c
            elif c["name"] in aliases:
                alias_entries.append(c)

        if canonical_entry and alias_entries:
            # Merge scopes if present
            for ae in alias_entries:
                if "scopes" in ae and ae["scopes"]:
                    if "scopes" not in canonical_entry:
                        canonical_entry["scopes"] = []
                    for s in (ae["scopes"] if isinstance(ae["scopes"], list) else [ae["scopes"]]):
                        if s not in canonical_entry["scopes"]:
                            canonical_entry["scopes"].append(s)
            # Remove aliases
            data["countries"] = [c for c in data["countries"] if c["name"] not in aliases]
            changes += len(alias_entries)
            print(f"  Country merge: {aliases} -> {canonical}")

    return changes


def apply_region_merges(data):
    """Merge duplicate regions into canonical names."""
    changes = 0
    all_alias_names = set()
    for canonical, aliases in REGION_MERGES.items():
        all_alias_names.update(aliases)

    for canonical, aliases in REGION_MERGES.items():
        canonical_entry = None
        alias_entries = []

        for r in data["regions"]:
            if r["name"] == canonical:
                canonical_entry = r
            elif r["name"] in aliases:
                alias_entries.append(r)

        if alias_entries:
            if not canonical_entry:
                # Rename the first alias to canonical
                alias_entries[0]["name"] = canonical
                alias_entries[0]["slug"] = canonical.lower().replace(" ", "-").replace("è", "e").replace("ô", "o")
                canonical_entry = alias_entries[0]
                alias_entries = alias_entries[1:]

            # Transfer coordinates if canonical lacks them
            if (canonical_entry.get("latitude") is None) and alias_entries:
                for ae in alias_entries:
                    if ae.get("latitude") is not None:
                        canonical_entry["latitude"] = ae["latitude"]
                        canonical_entry["longitude"] = ae["longitude"]
                        break

            # Transfer scopes
            for ae in alias_entries:
                if "scopes" in ae and ae["scopes"]:
                    if "scopes" not in canonical_entry:
                        canonical_entry["scopes"] = []
                    if isinstance(canonical_entry["scopes"], str):
                        canonical_entry["scopes"] = [canonical_entry["scopes"]]
                    for s in (ae["scopes"] if isinstance(ae["scopes"], list) else [ae["scopes"]]):
                        if s not in canonical_entry["scopes"]:
                            canonical_entry["scopes"].append(s)

            # Update subregions that pointed to alias parent
            alias_ids = {ae["id"] for ae in alias_entries}
            alias_names_set = set(aliases)
            for sr in data.get("subregions", []):
                if sr.get("parent_id") in alias_ids or sr.get("parent_name") in alias_names_set:
                    sr["parent_id"] = canonical_entry["id"]
                    sr["parent_name"] = canonical

            # Remove alias entries
            data["regions"] = [r for r in data["regions"] if r["name"] not in aliases or r["id"] == canonical_entry["id"]]
            changes += len(alias_entries)
            print(f"  Region merge: {aliases} -> {canonical}")

    return changes


def add_coordinates(data):
    """Add missing coordinates at all levels."""
    stats = {"countries": 0, "regions": 0, "subregions": 0, "appellations": 0}

    # Countries
    for c in data["countries"]:
        if c.get("latitude") is None and c["name"] in COUNTRY_COORDS:
            c["latitude"], c["longitude"] = COUNTRY_COORDS[c["name"]]
            stats["countries"] += 1

    # Regions
    for r in data["regions"]:
        if r.get("latitude") is None and r["name"] in REGION_COORDS:
            r["latitude"], r["longitude"] = REGION_COORDS[r["name"]]
            stats["regions"] += 1

    # Subregions
    for sr in data["subregions"]:
        if sr.get("latitude") is None and sr["name"] in SUBREGION_COORDS:
            sr["latitude"], sr["longitude"] = SUBREGION_COORDS[sr["name"]]
            stats["subregions"] += 1

    # Appellations
    for a in data["appellations"]:
        if a.get("latitude") is None and a["name"] in APPELLATION_COORDS:
            a["latitude"], a["longitude"] = APPELLATION_COORDS[a["name"]]
            stats["appellations"] += 1

    return stats


def update_meta(data):
    """Recalculate _meta counts and needs_coords lists."""
    from datetime import datetime, timezone
    data["_meta"]["generated"] = datetime.now(timezone.utc).isoformat()

    needs = {"countries": [], "regions": [], "subregions": [], "appellations": []}
    counts = {}

    for level in ["countries", "regions", "subregions", "appellations"]:
        items = data[level]
        counts[level] = len(items)
        for item in items:
            if item.get("latitude") is None:
                needs[level].append(item["name"])

    data["_meta"]["counts"] = counts
    data["_meta"]["needs_coords"] = needs
    return needs


def generate_txt(data, path):
    """Generate human-readable full_taxonomy_list.txt."""
    lines = []
    counts = data["_meta"]["counts"]
    lines.append(f"=== FULL TAXONOMY LIST ===")
    lines.append(f"Countries: {counts['countries']}")
    lines.append(f"Regions: {counts['regions']}")
    lines.append(f"Subregions: {counts['subregions']}")
    lines.append(f"Appellations: {counts['appellations']}")
    lines.append("")

    # Countries
    lines.append(f"=== COUNTRIES ({counts['countries']}) ===")
    for c in sorted(data["countries"], key=lambda x: x["name"]):
        status = "✓" if c.get("latitude") is not None else "○"
        coord = f"[{c['latitude']}, {c['longitude']}]" if c.get("latitude") is not None else "[NEEDS COORDS]"
        scopes = c.get("scopes", [])
        scope_str = ", ".join(sorted(scopes)) if isinstance(scopes, list) else str(scopes)
        lines.append(f"{status} {c['name']:<24} {coord:<20} scopes: {scope_str}")
    lines.append("")

    # Regions grouped by country
    lines.append(f"=== REGIONS ({counts['regions']}) ===")
    lines.append("Format: status | name | [lat, lng] | parent_country | scopes")
    lines.append("")

    regions_by_country = {}
    for r in data["regions"]:
        parent = r.get("parent_name", "Unknown")
        regions_by_country.setdefault(parent, []).append(r)

    for country in sorted(regions_by_country.keys()):
        lines.append(f"--- {country} ---")
        for r in sorted(regions_by_country[country], key=lambda x: x["name"]):
            status = "✓" if r.get("latitude") is not None else "○"
            coord = f"[{r['latitude']}, {r['longitude']}]" if r.get("latitude") is not None else "[NEEDS COORDS]"
            scopes = r.get("scopes", [])
            scope_str = ", ".join(sorted(scopes)) if isinstance(scopes, list) else str(scopes)
            lines.append(f"  {status} {r['name']:<30} {coord:<22} {scope_str}")
        lines.append("")

    # Subregions grouped by parent region
    lines.append(f"=== SUBREGIONS ({counts['subregions']}) ===")
    lines.append("Format: status | name | [lat, lng] | parent_region | grandparent_country")
    lines.append("")

    subs_by_country = {}
    for sr in data["subregions"]:
        gp = sr.get("grandparent_name", "Unknown")
        subs_by_country.setdefault(gp, {}).setdefault(sr.get("parent_name", "Unknown"), []).append(sr)

    for country in sorted(subs_by_country.keys()):
        lines.append(f"--- {country} ---")
        for region in sorted(subs_by_country[country].keys()):
            lines.append(f"  [{region}]")
            for sr in sorted(subs_by_country[country][region], key=lambda x: x["name"]):
                status = "✓" if sr.get("latitude") is not None else "○"
                coord = f"[{sr['latitude']}, {sr['longitude']}]" if sr.get("latitude") is not None else "[NEEDS COORDS]"
                scopes = sr.get("scopes", [])
                scope_str = ", ".join(sorted(scopes)) if isinstance(scopes, list) else str(scopes)
                lines.append(f"    {status} {sr['name']:<30} {coord:<22} {scope_str}")
        lines.append("")

    # Appellations
    lines.append(f"=== APPELLATIONS ({counts['appellations']}) ===")
    for a in sorted(data["appellations"], key=lambda x: x["name"]):
        status = "✓" if a.get("latitude") is not None else "○"
        coord = f"[{a['latitude']}, {a['longitude']}]" if a.get("latitude") is not None else "[NEEDS COORDS]"
        scopes = a.get("scopes", [])
        scope_str = ", ".join(sorted(scopes)) if isinstance(scopes, list) else str(scopes)
        lines.append(f"  {status} {a['name']:<44} {coord:<22} {scope_str}")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  Saved: {path}")


def main():
    print("Loading taxonomy_for_map.json...")
    data = load_json(MAP_JSON)

    print(f"\nBefore: {data['_meta']['counts']}")

    # Step 1: Fix duplicates
    print("\n=== STEP 1: Merging duplicates ===")
    country_merges = apply_country_merges(data)
    region_merges = apply_region_merges(data)
    print(f"  Merged {country_merges} country duplicates, {region_merges} region duplicates")

    # Step 2: Add coordinates
    print("\n=== STEP 2: Adding coordinates ===")
    coord_stats = add_coordinates(data)
    print(f"  Coordinates added:")
    for level, count in coord_stats.items():
        print(f"    {level}: +{count}")

    # Step 3: Update meta
    print("\n=== STEP 3: Updating metadata ===")
    remaining = update_meta(data)
    print(f"\nAfter: {data['_meta']['counts']}")
    print(f"\nRemaining without coords:")
    for level, names in remaining.items():
        print(f"  {level}: {len(names)}")
        if names:
            for n in names:
                print(f"    - {n}")

    # Step 4: Save
    print("\n=== STEP 4: Saving files ===")
    save_json(MAP_JSON, data)
    generate_txt(data, MAP_TXT)

    print("\nDone!")


if __name__ == "__main__":
    main()
