#!/usr/bin/env python3
"""Fix P1 data consistency issues across the entire product library.

Fixes:
  1. Invalid vintage values
  2. Missing country (brand-inference + SKU prefix heuristics)
  3. Brand name standardisation
  4. Scotland → correct country for wine products
  5. Placeholder descriptions
  6. Empty descriptions (basic generation from fields)

Usage:
    python scripts/fix_data_consistency.py --dry-run
    python scripts/fix_data_consistency.py
"""
import os, json, argparse, re, sys, time, html
from urllib import request, parse
from collections import Counter

# ---------------------------------------------------------------------------
# Supabase config
# ---------------------------------------------------------------------------
BASE = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "https://xfcvliyxxguhihehqwkg.supabase.co")
KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

FIELDS = (
    "sku,name,classification,country,region,subregion,appellation,"
    "vintage,brand,variety,body,acidity,tannin,"
    "flavor_tags,food_matching,style,desc_en_short,desc_en_full"
)

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def fetch_all(path):
    rows, offset = [], 0
    while True:
        url = f"{BASE}/rest/v1/{path}&limit=1000&offset={offset}"
        r = request.Request(url, headers=H)
        with request.urlopen(r) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000:
                break
            offset += 1000
        print(f"  fetched {len(rows)} rows so far...", flush=True)
    return rows


def patch_one(sku, payload):
    encoded = parse.quote(str(sku), safe="")
    url = f"{BASE}/rest/v1/products?sku=eq.{encoded}"
    body = json.dumps(payload).encode()
    req = request.Request(
        url, data=body,
        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH",
    )
    with request.urlopen(req) as r:
        pass


def patch_batch(updates, dry_run=False, label=""):
    """PATCH a list of (sku, payload) pairs in groups of 50."""
    if not updates:
        print(f"  [{label}] Nothing to patch.", flush=True)
        return 0, 0
    if dry_run:
        print(f"  [{label}] DRY RUN — would patch {len(updates)} products.", flush=True)
        return len(updates), 0
    ok, fail = 0, 0
    for i in range(0, len(updates), 50):
        batch = updates[i:i+50]
        for sku, payload in batch:
            try:
                patch_one(sku, payload)
                ok += 1
            except Exception as e:
                print(f"  PATCH failed for {sku}: {e}", flush=True)
                fail += 1
        done = i + len(batch)
        print(f"  [{label}] patched {done}/{len(updates)}...", flush=True)
        if i + 50 < len(updates):
            time.sleep(0.3)
    return ok, fail


def s(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(v)
    return re.sub(r"  +", " ", str(v).strip())

def parse_tags(raw):
    if not raw:
        return []
    if isinstance(raw, list):
        return [t.strip() for t in raw if t and str(t).strip()]
    text = str(raw).strip()
    if text.startswith("["):
        try:
            arr = json.loads(text)
            if isinstance(arr, list):
                return [str(t).strip() for t in arr if str(t).strip()]
        except (json.JSONDecodeError, TypeError):
            pass
    text = text.replace("|", ",")
    return [t.strip() for t in text.split(",") if t.strip()]

def tags_to_prose(tags):
    if not tags:
        return ""
    if len(tags) == 1:
        return tags[0]
    if len(tags) == 2:
        return f"{tags[0]} and {tags[1]}"
    return ", ".join(tags[:-1]) + f", and {tags[-1]}"

# ---------------------------------------------------------------------------
# Wine classifications
# ---------------------------------------------------------------------------
WINE_CLASSIFICATIONS = {
    "Red Wine", "White Wine", "Rosé Wine", "Sparkling Wine", "Champagne",
    "Dessert Wine", "Fortified Wine", "Orange Wine",
}

SPIRITS_CLASSIFICATIONS = {
    "Whisky", "Gin", "Vodka", "Rum", "Tequila", "Brandy", "Cognac",
    "Liqueur", "Beer", "Sake", "Shochu", "Mezcal", "Absinthe",
    "Baijiu", "Soju", "Bitters", "Vermouth", "Grappa",
}

# ===================================================================
# FIX 1 — Invalid vintage values
# ===================================================================

def fix_vintages(products):
    """Return list of (sku, {vintage: new_value}) for products with bad vintage."""
    updates = []
    stats = {"kept": 0, "extracted_year": 0, "set_nv": 0, "cleared": 0}
    year_re = re.compile(r"(19\d{2}|20[0-2]\d)")
    html_re = re.compile(r"<[^>]+>|&[a-z]+;|&#\d+;", re.I)

    for p in products:
        v = s(p.get("vintage"))
        if not v:
            continue  # already empty

        # Already valid
        if v == "NV":
            stats["kept"] += 1
            continue
        if re.fullmatch(r"(19\d{2}|20[0-2]\d)", v):
            stats["kept"] += 1
            continue

        sku = p["sku"]

        # CHANGE / MAY CHANGE markers
        if "CHANGE" in v.upper():
            m = year_re.search(v)
            if m:
                updates.append((sku, {"vintage": m.group(1)}))
                stats["extracted_year"] += 1
                continue
            else:
                updates.append((sku, {"vintage": "NV"}))
                stats["set_nv"] += 1
                continue

        # HTML or special chars
        if html_re.search(v):
            m = year_re.search(v)
            if m:
                updates.append((sku, {"vintage": m.group(1)}))
                stats["extracted_year"] += 1
            else:
                updates.append((sku, {"vintage": "NV"}))
                stats["set_nv"] += 1
            continue

        # Contains a 4-digit year buried in other text
        m = year_re.search(v)
        if m:
            updates.append((sku, {"vintage": m.group(1)}))
            stats["extracted_year"] += 1
            continue

        # Garbage — clear
        updates.append((sku, {"vintage": ""}))
        stats["cleared"] += 1

    print(f"  Vintage fix summary: {stats}", flush=True)
    return updates


# ===================================================================
# FIX 2 — Missing country
# ===================================================================

def build_brand_country_map(products):
    """From products that DO have country, find most common country per brand."""
    brand_countries = {}
    for p in products:
        brand = s(p.get("brand"))
        country = s(p.get("country"))
        if brand and country:
            brand_countries.setdefault(brand, []).append(country)
    result = {}
    for brand, countries in brand_countries.items():
        cnt = Counter(countries)
        result[brand] = cnt.most_common(1)[0][0]
    return result


def fix_missing_country(products):
    """Return list of (sku, {country: inferred}) for products missing country."""
    brand_map = build_brand_country_map(products)
    updates = []
    stats = {"brand_inferred": 0, "unfixed": 0}

    for p in products:
        country = s(p.get("country"))
        if country:
            continue
        sku = p["sku"]
        brand = s(p.get("brand"))

        # Try brand map first (most reliable)
        if brand and brand in brand_map:
            updates.append((sku, {"country": brand_map[brand]}))
            stats["brand_inferred"] += 1
            continue

        stats["unfixed"] += 1

    print(f"  Missing country fix summary: {stats}", flush=True)
    return updates


# ===================================================================
# FIX 3 — Brand name standardisation
# ===================================================================

BRAND_FIXES = {
    "ST Agnes": "St Agnes",
    "Concha Y Toro": "Concha y Toro",
    "Mcguigan": "McGuigan",
    "MR.RIGGS": "Mr.Riggs",
    "Niwa no Uguisu": "Niwa No Uguisu",
}

def fix_brand_names(products):
    """Standardise known duplicate brand names."""
    updates = []
    # Build case-insensitive lookup
    fix_map_lower = {k.lower(): v for k, v in BRAND_FIXES.items()}

    for p in products:
        brand = s(p.get("brand"))
        if not brand:
            continue
        canonical = fix_map_lower.get(brand.lower())
        if canonical and brand != canonical:
            updates.append((p["sku"], {"brand": canonical}))

    # Count by target brand for reporting
    counts = Counter(payload["brand"] for _, payload in updates)
    print(f"  Brand fix summary: {dict(counts)}", flush=True)
    return updates


# ===================================================================
# FIX 4 — Scotland → correct country for wine products
# ===================================================================

# Known brand → country for common misclassifications
BRAND_COUNTRY_OVERRIDES = {
    # Italian
    "Castello Banfi": "Italy", "Banfi": "Italy", "Antinori": "Italy",
    "Frescobaldi": "Italy", "Masi": "Italy", "Zonin": "Italy",
    "Ruffino": "Italy", "Bolla": "Italy", "Fontanafredda": "Italy",
    "Gaja": "Italy", "Allegrini": "Italy", "Bertani": "Italy",
    "Planeta": "Italy", "Cusumano": "Italy", "Tasca d'Almerita": "Italy",
    "Feudi di San Gregorio": "Italy", "Marchesi di Barolo": "Italy",
    "Tenuta San Guido": "Italy", "Sassicaia": "Italy", "Ornellaia": "Italy",
    # French
    "Louis Jadot": "France", "Mouton Cadet": "France", "Chapoutier": "France",
    "Guigal": "France", "Trimbach": "France", "Hugel": "France",
    "Drouhin": "France", "Bouchard": "France", "Jaboulet": "France",
}


def fix_scotland_wine(products, all_products):
    """Fix wine products incorrectly marked as Scotland."""
    brand_map = build_brand_country_map(all_products)
    updates = []

    for p in products:
        country = s(p.get("country"))
        clf = s(p.get("classification"))
        if country != "Scotland":
            continue
        if clf not in WINE_CLASSIFICATIONS:
            continue

        sku = p["sku"]
        brand = s(p.get("brand"))
        region = s(p.get("region"))

        # Check explicit overrides
        new_country = BRAND_COUNTRY_OVERRIDES.get(brand)
        if not new_country:
            # Check region hints
            italian_regions = {"Tuscany", "Piedmont", "Veneto", "Sicily", "Puglia",
                               "Abruzzo", "Campania", "Sardinia", "Trentino",
                               "Friuli", "Umbria", "Marche", "Liguria", "Emilia-Romagna"}
            french_regions = {"Bordeaux", "Burgundy", "Rhone", "Loire", "Alsace",
                              "Champagne", "Languedoc", "Provence", "Jura"}
            if region in italian_regions:
                new_country = "Italy"
            elif region in french_regions:
                new_country = "France"

        if not new_country:
            # Use brand_map — what country do OTHER products of this brand have?
            # Exclude Scotland since that's the wrong one
            brand_products = [pp for pp in all_products
                              if s(pp.get("brand")) == brand and s(pp.get("country"))
                              and s(pp.get("country")) != "Scotland"]
            if brand_products:
                cnt = Counter(s(pp.get("country")) for pp in brand_products)
                new_country = cnt.most_common(1)[0][0]

        if new_country and new_country != "Scotland":
            updates.append((sku, {"country": new_country}))

    print(f"  Scotland wine fix: {len(updates)} products to re-assign.", flush=True)
    if updates:
        countries = Counter(payload["country"] for _, payload in updates)
        print(f"    Target countries: {dict(countries)}", flush=True)
    return updates


# ===================================================================
# FIX 5 — Placeholder descriptions
# ===================================================================

PLACEHOLDER_PATTERNS = re.compile(
    r"\b(wine product|unknown|tbd|n/a|test|placeholder)\b", re.I
)

def fix_placeholder_descriptions(products):
    """Clear placeholder descriptions so they get regenerated."""
    updates = []
    for p in products:
        desc_short = s(p.get("desc_en_short"))
        if desc_short and PLACEHOLDER_PATTERNS.search(desc_short):
            updates.append((p["sku"], {"desc_en_short": "", "desc_en_full": ""}))

    print(f"  Placeholder descriptions to clear: {len(updates)}", flush=True)
    return updates


# ===================================================================
# FIX 6 — Empty descriptions (basic generation)
# ===================================================================

SERVING = {
    "Red Wine": "Serve at 16-18 °C in a large-bowled glass.",
    "White Wine": "Serve chilled at 8-10 °C to highlight freshness.",
    "Rosé Wine": "Best served well chilled at 6-8 °C.",
    "Sparkling Wine": "Serve well chilled at 6-8 °C in a flute or tulip glass.",
    "Champagne": "Serve at 8-10 °C in a tulip glass.",
    "Dessert Wine": "Serve lightly chilled at 10-12 °C.",
    "Fortified Wine": "Serve at cool room temperature (14-16 °C).",
    "Orange Wine": "Serve at 12-14 °C in a wide glass.",
}

BODY_ADJ = {1: "light", 2: "light-medium", 3: "medium-bodied", 4: "medium-full", 5: "full-bodied"}

_SPIRIT_ADJ = {
    "Whisky": "rich and characterful",
    "Gin": "aromatic and refreshing",
    "Vodka": "clean and smooth",
    "Rum": "rich and full-bodied",
    "Tequila": "bright and agave-forward",
    "Brandy": "rich and velvety",
    "Cognac": "elegant and complex",
    "Liqueur": "rich and flavourful",
    "Beer": "refreshing and well-crafted",
    "Sake": "delicate and refined",
}


def generate_wine_short(p):
    brand = s(p.get("brand"))
    clf = s(p.get("classification")) or "wine"
    country = s(p.get("country"))
    region = s(p.get("region"))
    grape = s(p.get("variety"))
    tags = parse_tags(p.get("flavor_tags"))

    loc_parts = [r for r in [region, country] if r]
    location = ", ".join(loc_parts[:2]) if loc_parts else ""
    key_char = tags_to_prose([t.lower() for t in tags[:3]]) if tags else ""

    if brand and location:
        base = f"{brand} {clf.lower()} from {location}."
        if grape and key_char:
            base = f"{brand} {clf.lower()} from {location}. {grape}-based with notes of {key_char}."
        elif grape:
            base = f"{brand} {clf.lower()} from {location}, made from {grape}."
        return base
    elif location:
        art = "A"
        return f"{art} {clf.lower()} from {location}."
    return f"{s(p.get('name'))} — {clf.lower()}."


def generate_wine_full(p):
    brand = s(p.get("brand"))
    clf = s(p.get("classification")) or "wine"
    country = s(p.get("country"))
    region = s(p.get("region"))
    grape = s(p.get("variety"))
    vintage = s(p.get("vintage"))
    tags = parse_tags(p.get("flavor_tags"))
    food = parse_tags(p.get("food_matching"))
    body_n = p.get("body")
    body = BODY_ADJ.get(body_n, "") if body_n else ""

    paras = []

    # Intro
    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")
    intro = f"{brand} presents " if brand else "A "
    if body:
        intro += f"a {body} {clf.lower()}"
    else:
        intro += f"a {clf.lower()}"
    if origin:
        intro += f" {origin}"
    intro += "."
    if grape:
        intro += f" Crafted from {grape}"
        if vintage and vintage != "NV":
            intro += f" ({vintage} vintage)"
        intro += "."
    paras.append(intro)

    if tags:
        paras.append(f"On the palate, expect notes of {tags_to_prose([t.lower() for t in tags[:5]])}.")
    if food:
        paras.append(f"Pairs well with {tags_to_prose(food[:4])}.")

    serving = SERVING.get(clf, "")
    if serving:
        paras.append(serving)

    inner = "".join(f"<p>{para}</p>" for para in paras)
    return f'<div class="prod-desc">{inner}</div>'


def generate_spirit_short(p):
    brand = s(p.get("brand"))
    clf = s(p.get("classification")) or "spirit"
    country = s(p.get("country"))
    region = s(p.get("region"))
    style = s(p.get("style"))
    tags = parse_tags(p.get("flavor_tags"))

    adj = _SPIRIT_ADJ.get(clf, "distinctive")
    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")
    ctx = f"{style} {clf.lower()}" if style else clf.lower()

    short = f"{brand} {ctx}" if brand else f"A {ctx}"
    if origin:
        short += f" {origin}"
    short += "."
    if tags:
        short += f" {adj.capitalize().split(' and ')[0].capitalize()} with notes of {tags_to_prose([t.lower() for t in tags[:3]])}."
    else:
        short += f" A {adj} expression."
    return re.sub(r"\s+", " ", short).strip()


def generate_spirit_full(p):
    brand = s(p.get("brand"))
    clf = s(p.get("classification")) or "spirit"
    country = s(p.get("country"))
    region = s(p.get("region"))
    style = s(p.get("style"))
    tags = parse_tags(p.get("flavor_tags"))
    food = parse_tags(p.get("food_matching"))

    adj = _SPIRIT_ADJ.get(clf, "distinctive")
    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")
    ctx = f"{style} {clf.lower()}" if style else clf.lower()

    paras = []
    intro = f"{brand} presents a {adj} {ctx}" if brand else f"A {adj} {ctx}"
    if origin:
        intro += f" {origin}"
    intro += "."
    paras.append(intro)

    if tags:
        paras.append(f"The palate reveals {tags_to_prose([t.lower() for t in tags[:5]])}.")
    if food:
        paras.append(f"Pairs well with {tags_to_prose(food[:4])}.")

    inner = "".join(f"<p>{para}</p>" for para in paras)
    return f'<div class="prod-desc">{inner}</div>'


def fix_empty_descriptions(products):
    """Generate basic descriptions for products with empty desc_en_short."""
    updates = []
    for p in products:
        desc_short = s(p.get("desc_en_short"))
        if desc_short:
            continue  # already has one

        clf = s(p.get("classification"))
        name = s(p.get("name"))
        if not name:
            continue

        sku = p["sku"]
        payload = {}

        if clf in WINE_CLASSIFICATIONS:
            payload["desc_en_short"] = generate_wine_short(p)
            if not s(p.get("desc_en_full")):
                payload["desc_en_full"] = generate_wine_full(p)
        elif clf in SPIRITS_CLASSIFICATIONS:
            payload["desc_en_short"] = generate_spirit_short(p)
            if not s(p.get("desc_en_full")):
                payload["desc_en_full"] = generate_spirit_full(p)
        else:
            # Generic fallback
            brand = s(p.get("brand"))
            country = s(p.get("country"))
            parts = [brand, clf or "product"]
            if country:
                parts.append(f"from {country}")
            payload["desc_en_short"] = " ".join(parts) + "."
            if not s(p.get("desc_en_full")):
                payload["desc_en_full"] = f'<div class="prod-desc"><p>{payload["desc_en_short"]}</p></div>'

        if payload:
            updates.append((sku, payload))

    print(f"  Empty descriptions to fill: {len(updates)}", flush=True)
    return updates


# ===================================================================
# Main
# ===================================================================

def main():
    parser = argparse.ArgumentParser(description="Fix P1 data consistency issues")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without patching")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("DATA CONSISTENCY FIX — P1 Issues", flush=True)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}", flush=True)
    print("=" * 60, flush=True)

    # -------------------------------------------------------------------
    # Fetch ALL products
    # -------------------------------------------------------------------
    print("\n[FETCH] Loading all products...", flush=True)
    products = fetch_all(f"products?select={FIELDS}")
    print(f"  Total products loaded: {len(products)}", flush=True)

    summary = {}

    # -------------------------------------------------------------------
    # FIX 2 — Missing country (run first — other fixes depend on country)
    # -------------------------------------------------------------------
    print("\n[FIX 2] Missing country...", flush=True)
    country_updates = fix_missing_country(products)
    ok, fail = patch_batch(country_updates, dry_run=args.dry_run, label="Country")
    summary["Missing country"] = {"fixed": ok, "failed": fail}

    # Apply in-memory so subsequent fixes see corrected country
    country_map = {sku: pl["country"] for sku, pl in country_updates}
    for p in products:
        if p["sku"] in country_map:
            p["country"] = country_map[p["sku"]]

    # -------------------------------------------------------------------
    # FIX 4 — Scotland → correct country for wine
    # -------------------------------------------------------------------
    print("\n[FIX 4] Scotland wine mis-classification...", flush=True)
    scotland_updates = fix_scotland_wine(products, products)
    ok, fail = patch_batch(scotland_updates, dry_run=args.dry_run, label="Scotland")
    summary["Scotland wine fix"] = {"fixed": ok, "failed": fail}

    # Apply in-memory
    scot_map = {sku: pl["country"] for sku, pl in scotland_updates}
    for p in products:
        if p["sku"] in scot_map:
            p["country"] = scot_map[p["sku"]]

    # -------------------------------------------------------------------
    # FIX 1 — Invalid vintage values
    # -------------------------------------------------------------------
    print("\n[FIX 1] Invalid vintage values...", flush=True)
    vintage_updates = fix_vintages(products)
    ok, fail = patch_batch(vintage_updates, dry_run=args.dry_run, label="Vintage")
    summary["Invalid vintage"] = {"fixed": ok, "failed": fail}

    # Apply in-memory
    vint_map = {sku: pl["vintage"] for sku, pl in vintage_updates}
    for p in products:
        if p["sku"] in vint_map:
            p["vintage"] = vint_map[p["sku"]]

    # -------------------------------------------------------------------
    # FIX 3 — Brand name standardisation
    # -------------------------------------------------------------------
    print("\n[FIX 3] Brand name standardisation...", flush=True)
    brand_updates = fix_brand_names(products)
    ok, fail = patch_batch(brand_updates, dry_run=args.dry_run, label="Brand")
    summary["Brand standardisation"] = {"fixed": ok, "failed": fail}

    # Apply in-memory
    brand_map_u = {sku: pl["brand"] for sku, pl in brand_updates}
    for p in products:
        if p["sku"] in brand_map_u:
            p["brand"] = brand_map_u[p["sku"]]

    # -------------------------------------------------------------------
    # FIX 5 — Placeholder descriptions
    # -------------------------------------------------------------------
    print("\n[FIX 5] Placeholder descriptions...", flush=True)
    placeholder_updates = fix_placeholder_descriptions(products)
    ok, fail = patch_batch(placeholder_updates, dry_run=args.dry_run, label="Placeholder")
    summary["Placeholder descriptions"] = {"fixed": ok, "failed": fail}

    # Apply in-memory
    for sku, pl in placeholder_updates:
        for p in products:
            if p["sku"] == sku:
                p["desc_en_short"] = ""
                p["desc_en_full"] = ""
                break

    # -------------------------------------------------------------------
    # FIX 6 — Empty descriptions
    # -------------------------------------------------------------------
    print("\n[FIX 6] Empty descriptions...", flush=True)
    desc_updates = fix_empty_descriptions(products)
    ok, fail = patch_batch(desc_updates, dry_run=args.dry_run, label="Descriptions")
    summary["Empty descriptions"] = {"fixed": ok, "failed": fail}

    # -------------------------------------------------------------------
    # Summary
    # -------------------------------------------------------------------
    print("\n" + "=" * 60, flush=True)
    print("SUMMARY", flush=True)
    print("=" * 60, flush=True)
    total_fixed = 0
    total_failed = 0
    for category, counts in summary.items():
        print(f"  {category}: {counts['fixed']} fixed, {counts['failed']} failed", flush=True)
        total_fixed += counts["fixed"]
        total_failed += counts["failed"]
    print(f"\n  TOTAL: {total_fixed} fixes applied, {total_failed} failures", flush=True)
    if args.dry_run:
        print("\n  *** DRY RUN — no changes were made ***", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
