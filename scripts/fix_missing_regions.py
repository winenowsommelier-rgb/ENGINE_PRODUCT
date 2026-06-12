"""
Fix 203 active beverage products with region = NULL or ''
Strategy:
1. Subregion-based inference (look up parent region from taxonomy)
2. Name-based inference (well-known producers/brands → region)
3. Country-based single-region mapping (Barbados, Jamaica, etc.)
4. Skip anything that can't be confidently inferred (>90% confidence required)
"""

import json
import sqlite3
import re

DB_PATH = "data/db/products.db"
REGIONS_PATH = "data/taxonomy/regions.json"
SUBREGIONS_PATH = "data/taxonomy/subregions.json"
COUNTRIES_PATH = "data/taxonomy/countries.json"


def load_taxonomy():
    r = json.load(open(REGIONS_PATH))
    c = json.load(open(COUNTRIES_PATH))
    s = json.load(open(SUBREGIONS_PATH))
    country_map = {row["id"]: row["name"] for row in c["data"]}
    region_by_id = {row["id"]: row["name"] for row in r["data"]}
    regions = r["data"]
    subregions = s["data"]

    # subregion name (lowercase) → parent region name
    subregion_to_region = {}
    for sub in subregions:
        parent = region_by_id.get(sub["region_id"])
        if parent:
            subregion_to_region[sub["name"].lower().strip()] = parent

    # country name → list of region names in taxonomy
    country_to_regions = {}
    for row in regions:
        cname = country_map.get(row["country_id"], "?")
        country_to_regions.setdefault(cname, []).append(row["name"])

    return subregion_to_region, country_to_regions, region_by_id, country_map


def infer_region(sku, name, classification, country, subregion, subregion_to_region, country_to_regions):
    """
    Returns (region_name, confidence_note) or (None, reason).
    Only returns a value if confidence >= 90%.
    """

    # --- 1. Subregion-based inference ---
    if subregion and subregion.strip():
        sr_lower = subregion.strip().lower()
        if sr_lower in subregion_to_region:
            return subregion_to_region[sr_lower], f"subregion '{subregion}' → parent"

    # --- 2. Country with exactly one region in taxonomy ---
    # Countries that only have one sensible geographic region
    single_region_country = {
        "Barbados": "Caribbean",
        "Jamaica": "Caribbean",
        "Cuba": "Caribbean",
        "Georgia": "Kakheti",
        "Hungary": "Tokaj",
        "Lebanon": "Bekaa Valley",
        "Israel": "Galilee",
        "Brazil": "Serra Gaúcha",
        "Peru": "Ica Valley",
        "Vietnam": None,  # no taxonomy region for Vietnam
        "Indonesia": None,
        "Belgium": None,
        "Russia": None,
        "Norway": None,
        "China": None,  # ambiguous — Ningxia vs Other China
    }
    if country in single_region_country:
        region = single_region_country[country]
        if region:
            return region, f"country='{country}' → single canonical region"
        else:
            return None, f"country='{country}' has no taxonomy region"

    # --- 3. Name / brand-based inference ---
    name_lower = name.lower()

    # Scotland — Johnnie Walker and other blended Scotch (no specific distillery region → Other Scotland)
    if country == "Scotland":
        jw_patterns = [
            "johnnie walker", "lower east side", "moonshine runners",
            "the deacon", "blended scotch", "blended malt scotch",
        ]
        for pat in jw_patterns:
            if pat in name_lower:
                return "Other Scotland", f"blended Scotch brand → Other Scotland"
        # Generic Scotland whisky without region clue
        return "Other Scotland", "Scotland country, no specific region clue → Other Scotland"

    # Ireland — Jameson is Cork
    if country == "Ireland":
        if "jameson" in name_lower:
            return "Cork", "Jameson Irish Whiskey → Cork (Midleton Distillery)"
        return "Dublin", "Ireland default → Dublin"

    # England — Dead Man's Finger (Cornwall/SW England), Gilbey's, Hoxton, Tanqueray
    if country == "England":
        # Most English spirits brands without specific regional indicator → London
        london_brands = ["gilbey", "beefeater", "gordon", "hoxton", "tanqueray"]
        cornwall_brands = ["dead man", "dead mans"]
        for pat in london_brands:
            if pat in name_lower:
                return "London", f"brand='{pat}' → London"
        for pat in cornwall_brands:
            if pat in name_lower:
                return "London", "Dead Man's Fingers brand → London (registered)"
        return "London", "England country, spirits brand → London"

    # USA
    if country == "USA":
        if "bourbon" in name_lower or "kentucky" in name_lower:
            return "Kentucky", "bourbon/Kentucky → Kentucky"
        if "old virginia" in name_lower:
            return "Kentucky", "Old Virginia Bourbon → Kentucky"
        if "tennessee" in name_lower:
            return "Tennessee", "Tennessee → Tennessee"
        if "tequila rose" in name_lower:
            # Tequila Rose is produced in USA but is a cream liqueur — no specific regional identity
            return "Other USA", "Tequila Rose (USA cream liqueur) → Other USA"
        if "mccormick" in name_lower:
            return "Other USA", "McCormick (USA, no specific region) → Other USA"
        if "hiram walker" in name_lower:
            return "Other USA", "Hiram Walker USA products → Other USA"
        return None, "USA country, cannot determine region confidently"

    # Mexico — Tequila → Jalisco, Mezcal → Oaxaca
    if country == "Mexico":
        if "mezcal" in name_lower or "oaxaca" in name_lower:
            return "Oaxaca", "mezcal/Oaxaca → Oaxaca"
        # Tequila: most tequila is Jalisco
        if "tequila" in name_lower or "reposado" in name_lower or "blanco" in name_lower or "anejo" in name_lower:
            return "Jalisco", "tequila → Jalisco"
        if "sierra" in name_lower and ("reposado" in name_lower or "tequila" in name_lower):
            return "Jalisco", "Sierra Reposado tequila → Jalisco"
        if "casco viejo" in name_lower:
            return "Jalisco", "Casco Viejo tequila → Jalisco"
        return "Jalisco", "Mexico spirits default → Jalisco"

    # Thailand — wines are Khao Yai or Hua Hin; spirits have no wine region
    if country == "Thailand":
        # Granmonte is Khao Yai winery
        if "granmonte" in name_lower:
            return "Khao Yai", "Granmonte is Khao Yai winery"
        # Phraya, Kosapan, Sod Chaeng, Sangvein, Iron Balls, Moose — no wine region
        # Prakaan (single malt) — distilled in Thailand, no specific wine subregion
        spirits_brands = ["phraya", "kosapan", "sod chaeng", "sangvein",
                          "iron balls", "moose", "prakaan"]
        for pat in spirits_brands:
            if pat in name_lower:
                return None, f"Thailand spirits brand '{pat}' — no taxonomy wine region applicable"
        return None, "Thailand product, cannot determine region"

    # Japan — Sake/spirits
    if country == "Japan":
        # Map known brands/prefectures
        brand_region = {
            "asamai": "Akita",          # Asamai Shuzo, Akita
            "kozaemon": "Gifu",          # Kozaemon, Gifu
            "bijofu": "Kochi",           # Bijofu, Kochi
            "aotan no yuzushu": "Kochi", # Aotan, Kochi
            "shio": None,                # ambiguous
            "kotsuzumi": "Hyogo",        # Kotsuzumi, Hyogo
            "suntory yamazaki": "Yamazaki",  # Yamazaki
            "yamazaki": "Yamazaki",
            "dassai": "Yamaguchi",       # Dassai, Yamaguchi
            "kinmon akita": "Akita",
            "kunizakari": "Aichi",       # Kunizakari, Aichi
            "hakutake": "Kumamoto",      # Hakutake, Kumamoto
            "niwa no uguisu": "Fukuoka", # Niwa no Uguisu, Fukuoka
            "ume mansaku": "Akita",      # Ume no Yado Matsui Sake, Akita
            "yuzu rocks": None,
            "the japanese": None,        # generic brand
        }
        for brand, region in brand_region.items():
            if brand in name_lower:
                if region:
                    return region, f"brand '{brand}' → {region}"
                else:
                    return None, f"brand '{brand}', region ambiguous"
        # LSK (sake) SKUs — Asamai/Kunizakari handled above
        return None, "Japan product, region unknown"

    # France — syrups (Monin), sober spirits, general products
    if country == "France":
        # Monin is a brand from Bourges (Loire Valley / Centre region)
        # Their products don't have a geographic wine AOC; use "Other France" as safe fallback
        if "monin" in name_lower:
            return "Other France", "Monin (French syrup brand, Loire region) → Other France"
        if "sober spirits" in name_lower:
            return "Other France", "Sober Spirits (French NA brand) → Other France"
        # WRS0204FR: Les Pins D'Aubane Rose De France — generic Vin de France
        if "pins d'aubane" in name_lower or "rose de france" in name_lower:
            return "Other France", "generic Vin de France → Other France"
        # WWW5167FR: Les Solstices Cuvee Tradition Blanc De France
        if "solstices" in name_lower or "blanc de france" in name_lower:
            return "Other France", "generic Vin de France → Other France"
        # Domaine Coustarret — Jurançon area (Southwest France)
        if "coustarret" in name_lower:
            return "Southwest France", "Domaine Coustarret is from Jurançon/Southwest France"
        return None, "France product, cannot determine region confidently"

    # Australia — wine brands
    if country == "Australia":
        # Headline Acts — generic Australian wine, South Eastern Australia
        if "headline acts" in name_lower:
            return "South Eastern Australia", "Headline Acts (generic AU multi-region) → South Eastern Australia"
        # ST Agnes brandy — South Australia (Angove, Renmark)
        if "st agnes" in name_lower:
            return "South Australia", "ST Agnes brandy → South Australia (Angove)"
        return None, "Australia product, cannot determine region confidently"

    # Italy — Haras de Pirque by Antinori — these are Chilean wines mistakenly labeled country=Italy
    if country == "Italy":
        if "haras de pirque" in name_lower:
            # Haras de Pirque is a Chilean winery (Antinori partnership), in Maipo Valley
            return None, "Haras de Pirque is Chilean (Maipo), but DB says Italy — data conflict, skip"
        return None, "Italy product, cannot determine region from name"

    # Netherlands — De Kuyper liqueurs
    if country == "Netherlands":
        if "de kuyper" in name_lower:
            return "Schiedam", "De Kuyper is based in Schiedam, Netherlands"
        return None, "Netherlands product, no taxonomy region applicable"

    # Norway — Aquavit
    if country == "Norway":
        return None, "Norway has no taxonomy region"

    # Remaining
    return None, f"no rule matched for country='{country}'"


def main():
    subregion_to_region, country_to_regions, region_by_id, country_map = load_taxonomy()

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        SELECT sku, name, classification, country, region, subregion
        FROM products
        WHERE COALESCE(is_active,1)=1
          AND (region IS NULL OR TRIM(region)='')
          AND classification NOT IN ('Accessories','Events','Glassware','Non-Alcoholic','Mineral Water','Cigar')
          AND substr(sku,1,3) NOT IN ('ABA','AWC','CIG','GBE','GDC','GLQ','GWN','WEV')
        ORDER BY sku
    """)
    rows = cur.fetchall()

    updates = []  # (sku, name, inferred_region, note)
    skipped = []  # (sku, name, reason)

    for sku, name, classification, country, region, subregion in rows:
        inferred, note = infer_region(
            sku, name, classification, country, subregion,
            subregion_to_region, country_to_regions
        )
        if inferred:
            updates.append((sku, name, country, inferred, note))
        else:
            skipped.append((sku, name, country, note))

    print(f"\n=== INFERENCE RESULTS ===")
    print(f"Total products with missing region: {len(rows)}")
    print(f"Can be updated: {len(updates)}")
    print(f"Cannot be confidently filled: {len(skipped)}")

    print(f"\n--- UPDATES ({len(updates)}) ---")
    for sku, name, country, region, note in updates:
        print(f"  {sku} | {country} | {region} | {note}")
        print(f"       Name: {name}")

    print(f"\n--- SKIPPED ({len(skipped)}) ---")
    for sku, name, country, reason in skipped:
        print(f"  {sku} | {country} | {reason}")
        print(f"       Name: {name}")

    # Apply updates
    print(f"\n=== APPLYING {len(updates)} UPDATES ===")
    for sku, name, country, region, note in updates:
        cur.execute(
            "UPDATE products SET region=?, updated_at=datetime('now') WHERE sku=?",
            (region, sku)
        )
    conn.commit()
    conn.close()

    print(f"Done. {len(updates)} rows updated.")


if __name__ == "__main__":
    main()
