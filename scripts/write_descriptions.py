#!/usr/bin/env python3
"""Generate professional, reference-quality product descriptions for T1 wine products.

Uses only product data fields — no external API calls. Writes desc_en_short and
desc_en_full back to Supabase via PATCH.

Usage:
    python scripts/write_descriptions.py --dry-run --limit=5
    python scripts/write_descriptions.py --tier=1
    python scripts/write_descriptions.py --tier=1 --limit=50
"""
import json, argparse, random, html, time, sys
from urllib import request, parse

# ---------------------------------------------------------------------------
# Supabase config
# ---------------------------------------------------------------------------
BASE = "https://xfcvliyxxguhihehqwkg.supabase.co"
KEY = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

FIELDS = (
    "sku,name,classification,country,region,subregion,appellation,"
    "vintage,brand,variety,body,acidity,tannin,"
    "flavor_tags,food_matching,style,desc_en_short,short_description_en,"
    "enrichment_priority,desc_en_full"
)

# ---------------------------------------------------------------------------
# Word maps for numeric scores (1-5)
# ---------------------------------------------------------------------------
BODY_MAP = {1: "light-bodied", 2: "light-to-medium-bodied", 3: "medium-bodied",
            4: "medium-to-full-bodied", 5: "full-bodied"}
ACIDITY_MAP = {1: "low acidity", 2: "moderate-low acidity", 3: "moderate acidity",
               4: "bright acidity", 5: "vibrant, crisp acidity"}
TANNIN_MAP = {1: "silky tannins", 2: "soft tannins", 3: "moderate tannins",
              4: "firm tannins", 5: "grippy, powerful tannins"}

# Friendlier adjective forms for inline use
BODY_ADJ = {1: "light", 2: "light-medium", 3: "medium-bodied", 4: "medium-full", 5: "full-bodied"}
ACIDITY_ADJ = {1: "low-acid", 2: "gently crisp", 3: "balanced", 4: "bright", 5: "vibrant"}

# ---------------------------------------------------------------------------
# Classification-aware serving suggestions
# ---------------------------------------------------------------------------
SERVING = {
    "Red Wine": "Serve at 16-18 °C in a large-bowled glass to let the aromas open up.",
    "White Wine": "Serve chilled at 8-10 °C to highlight freshness and fruit purity.",
    "Rosé Wine": "Best served well chilled at 6-8 °C, ideally on a warm afternoon.",
    "Sparkling Wine": "Serve well chilled at 6-8 °C in a flute or tulip glass to preserve the mousse.",
    "Champagne": "Serve at 8-10 °C in a tulip glass; allow five minutes after pouring for the aromas to develop.",
    "Dessert Wine": "Serve lightly chilled at 10-12 °C in a small glass to concentrate the aromatics.",
    "Fortified Wine": "Serve at cool room temperature (14-16 °C) in a small copita or tulip glass.",
    "Orange Wine": "Serve at 12-14 °C in a wide glass; a brief decant can help soften tannins.",
}
SERVING_DEFAULT = "Serve at the temperature appropriate to the style — cooler for lighter wines, warmer for fuller ones."

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def s(v):
    """Return cleaned string or empty string, collapsing multiple spaces."""
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(v)
    # Collapse multiple spaces into one
    import re as _re
    return _re.sub(r"  +", " ", str(v).strip())

def parse_tags(raw):
    """Parse tags from various formats: comma-sep, pipe-sep, or JSON array."""
    if not raw:
        return []
    text = str(raw).strip()
    # Try JSON array first: ["earth","mineral"]
    if text.startswith("["):
        try:
            arr = json.loads(text)
            if isinstance(arr, list):
                return [str(t).strip() for t in arr if str(t).strip()]
        except (json.JSONDecodeError, TypeError):
            pass
    # Support both comma and pipe separators
    text = text.replace("|", ",")
    return [t.strip() for t in text.split(",") if t.strip()]

def tags_to_prose(tags):
    """Turn a list of tags into natural English prose."""
    if not tags:
        return ""
    if len(tags) == 1:
        return tags[0]
    if len(tags) == 2:
        return f"{tags[0]} and {tags[1]}"
    return ", ".join(tags[:-1]) + f", and {tags[-1]}"

def esc(text):
    """HTML-escape text for safe embedding in description HTML."""
    return html.escape(str(text)) if text else ""

# ---------------------------------------------------------------------------
# Supabase fetch / patch
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
    return rows

def patch_batch(updates):
    """PATCH a list of (sku, payload) pairs one by one (Supabase REST has no bulk PATCH)."""
    ok, fail = 0, 0
    for sku, payload in updates:
        url = f"{BASE}/rest/v1/products?sku=eq.{parse.quote(str(sku))}"
        body = json.dumps(payload).encode()
        req = request.Request(
            url, data=body,
            headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
            method="PATCH",
        )
        try:
            with request.urlopen(req) as r:
                pass
            ok += 1
        except Exception as e:
            print(f"  PATCH failed for {sku}: {e}", flush=True)
            fail += 1
    return ok, fail

# ---------------------------------------------------------------------------
# Description generators
# ---------------------------------------------------------------------------

def _vintage_phrase(vintage):
    v = s(vintage)
    if not v or v.upper() == "NV":
        return ""
    return v

def _nv_phrase(vintage):
    v = s(vintage)
    if not v:
        return ""
    if v.upper() == "NV":
        return "non-vintage"
    return v

def generate_short(row, idx):
    """Generate desc_en_short — varies sentence structure based on idx % pattern count."""
    brand = s(row.get("brand"))
    clf = s(row.get("classification")) or "wine"
    country = s(row.get("country"))
    region = s(row.get("region"))
    subregion = s(row.get("subregion"))
    appellation = s(row.get("appellation"))
    grape = s(row.get("variety"))
    vintage = s(row.get("vintage"))
    tags = parse_tags(row.get("flavor_tags"))
    body_n = row.get("body")
    body_adj = BODY_ADJ.get(body_n, "") if body_n else ""

    # Build location string
    loc_parts = [p for p in [subregion or appellation, region, country] if p]
    location = ", ".join(loc_parts[:2]) if loc_parts else ""

    # Key character from tags (lowercase for natural reading)
    key_char = tags_to_prose([t.lower() for t in tags[:3]]) if tags else ""

    nv = _nv_phrase(vintage)
    vint = _vintage_phrase(vintage)

    patterns = []

    # Pattern 0 — Brand-led
    if brand and location:
        base = f"{brand} {clf.lower()} from {location}."
        if grape and key_char:
            base = f"{brand} {clf.lower()} from {location}. {grape}-based with notes of {key_char}."
        elif grape:
            base = f"{brand} {clf.lower()} from {location}, made from {grape}."
        patterns.append(base)

    # Pattern 1 — Body-led
    if body_adj and location:
        art = "An" if body_adj[0].lower() in "aeiou" else "A"
        detail = ""
        if grape:
            detail = f" {grape}"
            if subregion:
                detail += f" from {subregion}"
        elif subregion:
            detail = f" from {subregion}"
        suffix = f" Expresses {key_char}." if key_char else ""
        patterns.append(f"{art} {body_adj} {clf.lower()}{detail}, {location}.{suffix}")

    # Pattern 2 — Vintage-led
    if vint and grape and location:
        char_prose = tags_to_prose([t.lower() for t in tags[:2]]) if tags else ""
        char_bit = f" {char_prose[0].upper() + char_prose[1:]} character." if char_prose else ""
        patterns.append(f"{vint} {grape} from {brand + ', ' if brand else ''}{location}.{char_bit}")

    # Pattern 3 — Region-led
    if region and clf:
        grape_bit = f"crafted from {grape}" if grape else f"a {clf.lower()}"
        brand_bit = f" by {brand}" if brand else ""
        patterns.append(f"From {region}'s {subregion or appellation or 'vineyards'}, {grape_bit}{brand_bit}.")

    # Pattern 4 — NV-led (for non-vintage)
    if nv == "non-vintage" and brand:
        patterns.append(f"A {nv} {clf.lower()} from {brand}, {location}. {key_char.capitalize() + ' notes.' if key_char else ''}")

    if not patterns:
        # Fallback
        return f"{s(row.get('name'))} — {clf.lower()} from {location or country or 'an undisclosed origin'}."

    chosen = patterns[idx % len(patterns)]
    # Trim to reasonable length (aim 50-150 chars)
    if len(chosen) > 200:
        chosen = chosen[:197].rsplit(" ", 1)[0] + "."
    return chosen.strip()


def generate_full(row):
    """Generate desc_en_full as HTML in <div class='prod-desc'> wrapper."""
    brand = esc(s(row.get("brand")))
    name = esc(s(row.get("name")))
    clf = s(row.get("classification")) or "wine"
    country = esc(s(row.get("country")))
    region = esc(s(row.get("region")))
    subregion = esc(s(row.get("subregion")))
    appellation = esc(s(row.get("appellation")))
    grape = esc(s(row.get("variety")))
    vintage = s(row.get("vintage"))
    style = esc(s(row.get("style")))
    tags = parse_tags(row.get("flavor_tags"))
    food_raw = s(row.get("food_matching"))
    foods = parse_tags(row.get("food_matching"))

    body_n = row.get("body")
    acid_n = row.get("acidity")
    tann_n = row.get("tannin")
    body_w = BODY_MAP.get(body_n, "") if body_n else ""
    acid_w = ACIDITY_MAP.get(acid_n, "") if acid_n else ""
    tann_w = TANNIN_MAP.get(tann_n, "") if tann_n else ""

    serving = SERVING.get(clf, SERVING_DEFAULT)

    paragraphs = []

    # --- P1: What it is / origin ---
    vint_ctx = ""
    if vintage and vintage.upper() != "NV":
        vint_ctx = f", from the {esc(vintage)} vintage"
    elif vintage and vintage.upper() == "NV":
        vint_ctx = ", produced as a non-vintage blend"

    origin_parts = [p for p in [region, country] if p]
    origin_str = ", ".join(origin_parts) if origin_parts else "an undisclosed origin"

    # Avoid "Brand's Brand Product" duplication
    name_starts_with_brand = brand and name.lower().startswith(brand.lower())
    if brand and not name_starts_with_brand:
        p1 = f"{brand}'s {name} is a {clf.lower()} from {origin_str}{vint_ctx}."
    else:
        p1 = f"{name} is a {clf.lower()} from {origin_str}{vint_ctx}."
    paragraphs.append(p1)

    # --- P2: Grape, terroir, production ---
    p2_parts = []
    if grape:
        p2_parts.append(f"Made from {grape} grapes")
    else:
        p2_parts.append(f"This {clf.lower()}")

    terroir_bits = [p for p in [appellation, subregion] if p]
    if terroir_bits:
        p2_parts[0] += f" sourced from {' in '.join(terroir_bits)}"

    if body_w:
        p2_parts.append(f"the wine presents a {body_w} profile")
    # Only mention style if it adds info beyond the grape name / blend percentages
    # Include grape synonyms to avoid e.g. "reflecting a shiraz style" when grape is Syrah
    _GRAPE_SYNONYMS = {
        "syrah": "shiraz", "shiraz": "syrah",
        "zinfandel": "primitivo", "primitivo": "zinfandel",
        "pinot grigio": "pinot gris", "pinot gris": "pinot grigio",
    }
    if style and grape:
        import re as _re
        cleaned = _re.sub(r"\d+%?\s*", "", style.lower())
        grape_words = set(grape.lower().replace(",", " ").split())
        # Expand grape words with synonyms
        for gw in list(grape_words):
            if gw in _GRAPE_SYNONYMS:
                grape_words.add(_GRAPE_SYNONYMS[gw])
        style_words = set(cleaned.replace(",", " ").split()) - {""}
        extra = style_words - grape_words
        if extra:
            p2_parts.append(f"reflecting a {style.lower()} style")
    elif style and not grape:
        p2_parts.append(f"reflecting a {style.lower()} style")

    p2 = ", ".join(p2_parts) + "."
    # Capitalise first letter
    p2 = p2[0].upper() + p2[1:]
    paragraphs.append(p2)

    # --- P3: Palate / tasting notes ---
    if tags:
        tag_prose = tags_to_prose([esc(t).lower() for t in tags])
        p3 = f"On the palate, expect {tag_prose}."
    else:
        p3 = f"The palate follows the nose with characteristic {clf.lower()} expression."

    structure_bits = [w for w in [acid_w, tann_w] if w]
    if structure_bits:
        p3 += f" The wine shows {' and '.join(structure_bits)}, giving it a well-defined structure."
    elif body_w:
        p3 += f" The {body_w} frame provides balance and length."
    paragraphs.append(p3)

    # --- P4: Food pairing ---
    if foods:
        food_prose = tags_to_prose([esc(f).lower() for f in foods])
        p4 = f"At the table, this wine pairs well with {food_prose}."
    else:
        # Generic pairing by classification
        generic = {
            "Red Wine": "grilled meats, aged cheeses, and hearty stews",
            "White Wine": "seafood, salads, and light poultry dishes",
            "Rosé Wine": "Mediterranean appetisers, grilled vegetables, and charcuterie",
            "Sparkling Wine": "canapés, shellfish, and celebration toasts",
            "Champagne": "oysters, smoked salmon, and fine canapés",
            "Dessert Wine": "fruit tarts, blue cheese, and crème brûlée",
            "Fortified Wine": "dark chocolate, nuts, and aged cheese",
            "Orange Wine": "rich charcuterie, spiced dishes, and aged cheeses",
        }
        p4 = f"At the table, this wine complements {generic.get(clf, 'a wide range of dishes')}."
    paragraphs.append(p4)

    # --- P5: Serving suggestion ---
    paragraphs.append(serving)

    # Wrap in HTML
    inner = "\n".join(f"<p>{p}</p>" for p in paragraphs)
    return f'<div class="prod-desc">\n{inner}\n</div>'


def is_better(new_short, new_full, old_short, old_full):
    """Return True if the new description is meaningfully better than the old one.

    839/917 T1 descriptions are just reformatted originals wrapped in prod-desc.
    We detect these by counting <p> tags — a proper multi-paragraph description
    has 4-6 paragraphs, while reformatted originals typically have 1-2.
    """
    old_f = s(old_full)
    if not old_f:
        return True
    # Count paragraphs in existing description
    p_count = old_f.count("<p>")
    # If existing has 4+ paragraphs and is reasonably long, it's already good
    if p_count >= 4 and len(old_f) >= 400:
        return False
    # Otherwise, overwrite — it's likely a reformatted original
    return True

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate product descriptions for T1 wines")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--tier", type=int, default=1, help="Enrichment priority tier (default 1)")
    parser.add_argument("--limit", type=int, default=0, help="Max products to process (0=all)")
    parser.add_argument("--batch-size", type=int, default=50, help="PATCH batch size")
    parser.add_argument("--force", action="store_true", help="Overwrite even if existing desc looks OK")
    args = parser.parse_args()

    print(f"Fetching T{args.tier} wine products...", flush=True)

    # Fetch wine products for the requested tier
    # classification filter: wine-related
    wine_classes = ["Red Wine", "White Wine", "Rosé Wine", "Sparkling Wine",
                    "Champagne", "Dessert Wine", "Fortified Wine", "Orange Wine"]
    clf_filter = ",".join(parse.quote(c) for c in wine_classes)
    path = (
        f"products?select={FIELDS}"
        f"&enrichment_priority=eq.{args.tier}"
        f"&classification=in.({clf_filter})"
    )
    rows = fetch_all(path)
    print(f"Fetched {len(rows)} T{args.tier} wine products.", flush=True)

    if args.limit:
        rows = rows[:args.limit]
        print(f"Limited to {len(rows)} products.", flush=True)

    updates = []
    skipped = 0
    for idx, row in enumerate(rows):
        sku = row.get("sku")
        if not sku:
            continue

        new_short = generate_short(row, idx)
        new_full = generate_full(row)

        old_short = s(row.get("desc_en_short")) or s(row.get("short_description_en"))
        old_full = s(row.get("desc_en_full"))

        if not args.force and not is_better(new_short, new_full, old_short, old_full):
            skipped += 1
            continue

        updates.append((sku, {"desc_en_short": new_short, "desc_en_full": new_full}))

    print(f"\n{len(updates)} products to update, {skipped} skipped (existing desc OK).\n", flush=True)

    if args.dry_run:
        show = min(len(updates), 10)
        for i in range(show):
            sku, payload = updates[i]
            row = next(r for r in rows if r["sku"] == sku)
            print("=" * 72, flush=True)
            print(f"SKU:  {sku}", flush=True)
            print(f"Name: {row.get('name')}", flush=True)
            print(f"Classification: {row.get('classification')}", flush=True)
            print(f"Region: {row.get('region')}, {row.get('country')}", flush=True)
            print(f"Grape: {row.get('variety')}", flush=True)
            print(f"Vintage: {row.get('vintage')}", flush=True)
            print(f"Body/Acid/Tannin: {row.get('body')}/{row.get('acidity')}/{row.get('tannin')}", flush=True)
            print(f"Flavor tags: {row.get('flavor_tags')}", flush=True)
            print(f"Food matching: {row.get('food_matching')}", flush=True)
            print(f"\ndesc_en_short:\n  {payload['desc_en_short']}", flush=True)
            print(f"\ndesc_en_full:\n{payload['desc_en_full']}", flush=True)
            print(flush=True)
        if len(updates) > show:
            print(f"... and {len(updates) - show} more.", flush=True)
        print("\n[DRY RUN] No changes written.", flush=True)
        return

    # Patch in batches
    total_ok, total_fail = 0, 0
    for i in range(0, len(updates), args.batch_size):
        batch = updates[i:i + args.batch_size]
        print(f"Patching batch {i // args.batch_size + 1} ({len(batch)} products)...", flush=True)
        ok, fail = patch_batch(batch)
        total_ok += ok
        total_fail += fail
        if i + args.batch_size < len(updates):
            time.sleep(0.5)  # gentle rate-limit

    print(f"\nDone. {total_ok} updated, {total_fail} failed, {skipped} skipped.", flush=True)


if __name__ == "__main__":
    main()
