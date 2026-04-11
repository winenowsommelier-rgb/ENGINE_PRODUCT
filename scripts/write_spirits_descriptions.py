#!/usr/bin/env python3
"""Generate professional descriptions for T1 spirits, beer, sake, and accessories.

Zero-API approach: builds desc_en_short and desc_en_full from structured product
fields (classification, brand, style, region, country, flavor_tags, food_matching).
"""
import json, argparse, random, re, html
from urllib import request, parse

BASE = "https://xfcvliyxxguhihehqwkg.supabase.co"
KEY = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

SPIRITS_CLASSIFICATIONS = {
    "Whisky", "Gin", "Vodka", "Rum", "Tequila", "Brandy", "Cognac",
    "Liqueur", "Beer", "Sake", "Shochu", "Mezcal", "Absinthe",
    "Baijiu", "Soju", "Bitters", "Vermouth", "Grappa",
    "Accessories", "Glassware", "Barware",
}

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
    return rows


def patch(sku, data):
    encoded = parse.quote(sku, safe="")
    url = f"{BASE}/rest/v1/products?sku=eq.{encoded}"
    body = json.dumps(data).encode()
    req = request.Request(
        url, data=body,
        headers={**H, "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH",
    )
    with request.urlopen(req) as r:
        pass


def s(v):
    """Safe string from field value."""
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(v)
    return str(v).strip()

# ---------------------------------------------------------------------------
# Flavor / food helpers
# ---------------------------------------------------------------------------
def parse_tags(raw):
    """Turn flavor_tags (JSON array or comma string) into a clean list."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [t.strip() for t in raw if t and t.strip()]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(t).strip() for t in parsed if t]
    except (json.JSONDecodeError, TypeError):
        pass
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def tags_to_prose(tags, max_items=5):
    """Convert tag list to natural English phrase."""
    if not tags:
        return ""
    items = tags[:max_items]
    items = [t.lower() for t in items]
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def food_to_prose(raw, max_items=4):
    tags = parse_tags(raw)
    if not tags:
        return ""
    items = tags[:max_items]
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def wrap_full(paragraphs):
    """Wrap list of paragraph strings into prod-desc HTML."""
    inner = "".join(f"<p>{p}</p>" for p in paragraphs if p)
    return f'<div class="prod-desc">{inner}</div>'

# ---------------------------------------------------------------------------
# Character / adjective pools (for variety)
# ---------------------------------------------------------------------------
_WHISKY_ADJ = [
    "rich and characterful", "smooth and well-balanced", "bold and complex",
    "refined and nuanced", "warming and full-bodied", "elegant and layered",
]
_GIN_ADJ = [
    "aromatic and refreshing", "crisp and botanical-forward", "complex and balanced",
    "vibrant and juniper-led", "smooth with layered botanicals",
]
_VODKA_ADJ = [
    "clean and smooth", "crisp and pure", "silky and refined",
    "exceptionally smooth", "clean with a soft finish",
]
_RUM_ADJ = [
    "rich and full-bodied", "smooth with tropical depth", "warm and characterful",
    "complex and well-rounded", "bold with caramel warmth",
]
_TEQUILA_ADJ = [
    "bright and agave-forward", "smooth with earthy depth", "bold and expressive",
    "clean and vibrant", "complex with roasted agave character",
]
_BRANDY_ADJ = [
    "rich and velvety", "elegant and complex", "warm with dried-fruit depth",
    "smooth and opulent", "refined with lingering warmth",
]
_LIQUEUR_ADJ = [
    "rich and flavourful", "vibrant and versatile", "luscious and aromatic",
    "smooth and indulgent", "balanced and distinctive",
]
_SAKE_ADJ = [
    "delicate and refined", "clean and umami-rich", "elegant and fragrant",
    "crisp and well-balanced", "silky with subtle complexity",
]
_BEER_ADJ = [
    "refreshing and well-crafted", "crisp and flavourful", "balanced and satisfying",
    "bold and characterful", "smooth and approachable",
]

def _pick(pool, seed_str):
    """Deterministic-ish pick based on product name hash."""
    idx = hash(seed_str) % len(pool)
    return pool[idx]

# ---------------------------------------------------------------------------
# Style context helpers
# ---------------------------------------------------------------------------
WHISKY_STYLE_CONTEXT = {
    "Single Malt": "single malt whisky",
    "Single Grain": "single grain whisky",
    "Blended Malt": "blended malt whisky",
    "Blended": "blended whisky",
    "Bourbon": "bourbon whiskey",
    "Rye": "rye whiskey",
    "Tennessee": "Tennessee whiskey",
    "Irish": "Irish whiskey",
    "Japanese": "Japanese whisky",
    "Scotch": "Scotch whisky",
    "Single Malt Scotch": "single malt Scotch whisky",
}

RUM_STYLE_CONTEXT = {
    "White": "white rum", "Light": "light rum", "Silver": "silver rum",
    "Gold": "gold rum", "Amber": "amber rum",
    "Dark": "dark rum", "Aged": "aged rum", "Spiced": "spiced rum",
    "Overproof": "overproof rum", "Rhum Agricole": "rhum agricole",
}

TEQUILA_STYLE_CONTEXT = {
    "Blanco": "blanco tequila", "Silver": "silver tequila",
    "Reposado": "reposado tequila", "Anejo": "anejo tequila",
    "Extra Anejo": "extra anejo tequila", "Cristalino": "cristalino tequila",
    "Joven": "joven tequila",
}

BRANDY_STYLE_CONTEXT = {
    "VS": "VS (Very Special)", "VSOP": "VSOP (Very Superior Old Pale)",
    "XO": "XO (Extra Old)", "Napoleon": "Napoleon grade",
    "Hors d'Age": "Hors d'Age",
}

GIN_STYLE_CONTEXT = {
    "London Dry": "London Dry gin", "Old Tom": "Old Tom gin",
    "Navy Strength": "Navy Strength gin", "Plymouth": "Plymouth gin",
    "Genever": "genever", "Contemporary": "contemporary-style gin",
    "New Western": "New Western gin", "Sloe": "sloe gin",
}

# ---------------------------------------------------------------------------
# Description generators per classification
# ---------------------------------------------------------------------------

def _gen_whisky(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    region = s(p.get("region"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_WHISKY_ADJ, name)
    ctx = WHISKY_STYLE_CONTEXT.get(style, f"{style} whisky" if style else "whisky")

    # Short
    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")
    short = f"{brand} {ctx} {origin}." if origin else f"{brand} {ctx}."
    short = short.strip()
    if tags:
        short += f" {adj.capitalize()} with notes of {tags_to_prose(tags)}."
    else:
        short += f" A {adj} expression."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} presents a {adj} {ctx}"
    if origin:
        p1 += f" {origin}"
    p1 += "."
    if style:
        p1 += f" Crafted in the {ctx} tradition, this expression exemplifies the character of its origin."
    paras.append(p1)

    if tags:
        prose = tags_to_prose(tags)
        paras.append(
            f"On the nose and palate, expect layers of {prose}. "
            f"The finish is satisfying and well-integrated, revealing the depth of this {ctx}."
        )
    else:
        paras.append(
            f"This {ctx} delivers a well-rounded profile with a satisfying finish "
            f"that rewards slow sipping."
        )

    serve = "Best enjoyed neat or with a few drops of water to open the aromas."
    if food:
        serve += f" Pairs well with {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_gin(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    region = s(p.get("region"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_GIN_ADJ, name)
    ctx = GIN_STYLE_CONTEXT.get(style, f"{style} gin" if style else "gin")

    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")

    # Short
    short = f"{brand} {ctx} {origin}." if origin else f"{brand} {ctx}."
    short = short.strip()
    if tags:
        short += f" Botanicals include {tags_to_prose(tags)}."
    else:
        short += f" An {adj} spirit."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} is an {adj} {ctx}"
    if origin:
        p1 += f" crafted {origin}"
    p1 += "."
    if style:
        p1 += f" Rooted in the {ctx} style, it balances tradition with distinctive character."
    paras.append(p1)

    if tags:
        paras.append(
            f"The botanical profile features {tags_to_prose(tags)}, "
            f"creating a harmonious and layered spirit that rewards exploration."
        )
    else:
        paras.append(
            "A carefully composed botanical blend delivers complexity and balance, "
            "with juniper at its heart."
        )

    serve = "Excellent in a classic G&T with a complementary garnish, or as the base for a Martini."
    if food:
        serve += f" Also pairs beautifully with {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_vodka(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    adj = _pick(_VODKA_ADJ, name)

    flavored = bool(style and style.lower() not in ("plain", "classic", "unflavored", ""))
    style_note = f"flavored with {style.lower()}" if flavored else ""

    origin = f"from {country}" if country else ""

    # Short
    short = f"{brand} vodka {origin}." if origin else f"{brand} vodka."
    short = short.strip()
    if flavored:
        short += f" {style_note.capitalize()}."
    elif tags:
        short += f" {adj.capitalize()} with hints of {tags_to_prose(tags)}."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} delivers a {adj} vodka"
    if origin:
        p1 += f" {origin}"
    p1 += "."
    if flavored:
        p1 += f" This expression is {style_note}, adding a distinctive twist."
    paras.append(p1)

    if tags:
        paras.append(
            f"Subtle notes of {tags_to_prose(tags)} complement the {adj.split(' and ')[0]} character, "
            f"making it equally suited to sipping chilled or mixing."
        )
    else:
        paras.append(
            "Distilled for purity and smoothness, this vodka offers a neutral yet "
            "characterful base for cocktails or refined neat service."
        )

    paras.append(
        "Versatile by nature — try it in a Moscow Mule, Vodka Martini, or simply over ice."
    )

    return short, wrap_full(paras)


def _gen_rum(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    region = s(p.get("region"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_RUM_ADJ, name)
    ctx = RUM_STYLE_CONTEXT.get(style, f"{style} rum" if style else "rum")

    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")

    # Short
    short = f"{brand} {ctx} {origin}." if origin else f"{brand} {ctx}."
    short = short.strip()
    if tags:
        short += f" {adj.capitalize()} with notes of {tags_to_prose(tags)}."
    elif "aged" in ctx.lower() or "dark" in ctx.lower():
        short += f" {adj.capitalize()}, matured for depth and smoothness."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} is a {adj} {ctx}"
    if origin:
        p1 += f" produced {origin}"
    p1 += "."
    if "aged" in ctx.lower() or "dark" in ctx.lower() or "gold" in ctx.lower():
        p1 += " Time in oak has imparted warmth and complexity to this expression."
    paras.append(p1)

    if tags:
        paras.append(
            f"The palate reveals {tags_to_prose(tags)}, "
            f"delivering a layered and satisfying drinking experience."
        )
    else:
        paras.append(
            f"This {ctx} offers a well-rounded profile with the warmth and character "
            f"that {brand} is known for."
        )

    serve = "Enjoy neat, over ice, or as the foundation for classic rum cocktails such as a Daiquiri or Old Fashioned."
    if food:
        serve += f" Pairs well with {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_tequila(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_TEQUILA_ADJ, name)
    ctx = TEQUILA_STYLE_CONTEXT.get(style, f"{style} tequila" if style else "tequila")

    # Short
    short = f"{brand} {ctx}."
    if tags:
        short += f" {adj.capitalize()} with {tags_to_prose(tags)}."
    elif "reposado" in ctx.lower() or "anejo" in ctx.lower():
        short += f" Oak-aged for smoothness and complexity."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} {ctx} is crafted from 100% blue Weber agave."
    if "reposado" in ctx.lower():
        p1 += " Rested in oak barrels, it bridges the freshness of blanco with the depth of aged expressions."
    elif "anejo" in ctx.lower():
        p1 += " Extended oak aging brings rich complexity and a velvety texture."
    elif "blanco" in ctx.lower() or "silver" in ctx.lower():
        p1 += " Unaged and vibrant, it captures the pure essence of the agave."
    paras.append(p1)

    if tags:
        paras.append(
            f"Expect flavours of {tags_to_prose(tags)}, "
            f"woven into a {adj} profile that reflects the terroir and craftsmanship behind {brand}."
        )
    else:
        paras.append(
            f"A {adj} spirit that showcases the quality of its agave and the skill of its distillers."
        )

    serve = "Sip neat to appreciate its character, or use as the star of a Margarita or Paloma."
    if food:
        serve += f" Complements {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_brandy(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    region = s(p.get("region"))
    country = s(p.get("country"))
    cls = s(p.get("classification"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_BRANDY_ADJ, name)

    is_cognac = cls.lower() == "cognac" or (region and "cognac" in region.lower())
    spirit_type = "Cognac" if is_cognac else "brandy"
    age_ctx = BRANDY_STYLE_CONTEXT.get(style, style if style else "")

    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")

    # Short
    parts = [brand]
    if age_ctx:
        parts.append(age_ctx)
    parts.append(spirit_type)
    short = " ".join(parts)
    if origin:
        short += f" {origin}"
    short += "."
    if tags:
        short += f" {adj.capitalize()} with notes of {tags_to_prose(tags)}."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} presents a {adj} {spirit_type}"
    if age_ctx:
        p1 += f" of {age_ctx} designation"
    if origin:
        p1 += f", produced {origin}"
    p1 += "."
    if is_cognac:
        p1 += " Distilled in the Cognac region's copper pot stills and aged in French oak, this expression embodies centuries of tradition."
    paras.append(p1)

    if tags:
        paras.append(
            f"The nose opens with {tags_to_prose(tags[:3])}, leading to a palate of "
            f"remarkable depth. The finish lingers with warmth and refinement."
        )
    else:
        paras.append(
            f"Expect a {adj} character with dried fruit, oak spice, and a long, "
            f"warming finish that invites contemplation."
        )

    serve = "Best savoured neat in a tulip glass at room temperature, allowing the aromas to develop fully."
    if food:
        serve += f" An excellent companion to {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_liqueur(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_LIQUEUR_ADJ, name)

    flavor_type = style if style else ""
    origin = f"from {country}" if country else ""

    # Short
    short = f"{brand} {flavor_type} liqueur {origin}." if flavor_type else f"{brand} liqueur {origin}."
    short = short.strip()
    if tags:
        short += f" {tags_to_prose(tags).capitalize()}, ideal for cocktails and sipping."
    else:
        short += f" {adj.capitalize()}, suited to mixing and after-dinner enjoyment."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} is a {adj} liqueur"
    if flavor_type:
        p1 += f" with a {flavor_type.lower()} character"
    if origin:
        p1 += f", crafted {origin}"
    p1 += "."
    paras.append(p1)

    if tags:
        paras.append(
            f"Flavours of {tags_to_prose(tags)} define the profile, "
            f"creating a versatile spirit that enhances both classic and modern cocktails."
        )
    else:
        paras.append(
            "A well-balanced recipe delivers consistent flavour and character, "
            "making it a dependable choice behind any bar."
        )

    serve = "Enjoy neat over ice, as a dessert accompaniment, or as a key ingredient in signature cocktails."
    if food:
        serve += f" Pairs nicely with {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_sake(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    region = s(p.get("region"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    cls = s(p.get("classification"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_SAKE_ADJ, name)

    spirit_type = "shochu" if cls.lower() == "shochu" else "sake"
    origin = f"from {region}, {country}" if region and country else (f"from {country}" if country else "")

    # Style context (polishing, grade)
    grade_note = ""
    if style:
        sl = style.lower()
        if "daiginjo" in sl:
            grade_note = "brewed to Daiginjo grade with highly polished rice"
        elif "ginjo" in sl:
            grade_note = "brewed to Ginjo grade with carefully polished rice"
        elif "junmai" in sl:
            grade_note = "a pure rice (Junmai) expression with no added alcohol"
        elif "honjozo" in sl:
            grade_note = "a Honjozo style with a touch of brewer's alcohol for lightness"
        elif "nigori" in sl:
            grade_note = "a Nigori (unfiltered) style with a creamy, cloudy character"

    # Short
    short = f"{brand} {spirit_type} {origin}." if origin else f"{brand} {spirit_type}."
    short = short.strip()
    if grade_note:
        short += f" {grade_note.capitalize()[0].upper()}{grade_note[1:]}."
    elif tags:
        short += f" {adj.capitalize()} with notes of {tags_to_prose(tags)}."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} is a {adj} {spirit_type}"
    if origin:
        p1 += f" {origin}"
    p1 += "."
    if grade_note:
        p1 += f" This is {grade_note}, reflecting meticulous craftsmanship."
    paras.append(p1)

    if tags:
        paras.append(
            f"Delicate flavours of {tags_to_prose(tags)} emerge on the palate, "
            f"showcasing the skill of the brewery and the quality of its ingredients."
        )
    else:
        paras.append(
            f"The palate is {adj}, with a finish that is clean and inviting — "
            f"hallmarks of quality {spirit_type} production."
        )

    if spirit_type == "sake":
        serve = "Serve chilled, at room temperature, or gently warmed depending on the style."
    else:
        serve = "Serve neat, on the rocks, or with a splash of water or soda."
    if food:
        serve += f" An excellent match for {food}."
    else:
        serve += " Pairs naturally with Japanese cuisine and seafood."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_beer(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    country = s(p.get("country"))
    name = s(p.get("name"))
    tags = parse_tags(p.get("flavor_tags"))
    food = food_to_prose(p.get("food_matching"))
    adj = _pick(_BEER_ADJ, name)

    style_desc = f"{style} beer" if style else "beer"
    origin = f"from {country}" if country else ""

    # Short
    short = f"{brand} {style_desc} {origin}." if origin else f"{brand} {style_desc}."
    short = short.strip()
    if tags:
        short += f" {adj.capitalize()} with {tags_to_prose(tags)}."
    else:
        short += f" {adj.capitalize()}."
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    p1 = f"{brand} is a {adj} {style_desc}"
    if origin:
        p1 += f" brewed {origin}"
    p1 += "."
    if style:
        p1 += f" True to the {style} tradition, it delivers consistent quality and character."
    paras.append(p1)

    if tags:
        paras.append(
            f"Notes of {tags_to_prose(tags)} define the flavour profile, "
            f"making this an approachable yet interesting choice for any occasion."
        )
    else:
        paras.append(
            "Well-balanced and easy-drinking, it offers reliable refreshment "
            "with enough character to keep things interesting."
        )

    serve = "Best served chilled."
    if food:
        serve += f" Pairs well with {food}."
    paras.append(serve)

    return short, wrap_full(paras)


def _gen_accessories(p):
    brand = s(p.get("brand"))
    style = s(p.get("style"))
    name = s(p.get("name"))
    cls = s(p.get("classification"))

    product_type = style if style else cls.lower() if cls else "accessory"

    # Short
    short = f"{brand} {product_type}." if brand else f"{name}."
    feature = "Designed for the discerning home bar or professional setting."
    short = f"{short.strip()} {feature}"
    short = re.sub(r"\s+", " ", short).strip()

    # Full
    paras = []
    paras.append(
        f"{brand or name} {product_type} — a quality addition to any bar setup. "
        f"Built with attention to detail and designed for everyday use."
    )
    paras.append(
        "Whether you are entertaining guests or perfecting your craft at home, "
        "the right tools and glassware make all the difference."
    )

    return short, wrap_full(paras)


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
GENERATORS = {
    "Whisky":      _gen_whisky,
    "Gin":         _gen_gin,
    "Vodka":       _gen_vodka,
    "Rum":         _gen_rum,
    "Tequila":     _gen_tequila,
    "Mezcal":      _gen_tequila,   # similar template
    "Brandy":      _gen_brandy,
    "Cognac":      _gen_brandy,
    "Grappa":      _gen_brandy,
    "Liqueur":     _gen_liqueur,
    "Bitters":     _gen_liqueur,
    "Vermouth":    _gen_liqueur,
    "Absinthe":    _gen_liqueur,
    "Sake":        _gen_sake,
    "Shochu":      _gen_sake,
    "Soju":        _gen_sake,
    "Baijiu":      _gen_sake,
    "Beer":        _gen_beer,
    "Accessories": _gen_accessories,
    "Glassware":   _gen_accessories,
    "Barware":     _gen_accessories,
}

def generate_descriptions(p):
    cls = s(p.get("classification"))
    gen = GENERATORS.get(cls)
    if gen is None:
        return None, None
    return gen(p)


def is_placeholder(text):
    """Return True if existing description is essentially empty or a bare reformatting."""
    if not text or not text.strip():
        return True
    t = text.strip().lower()
    if len(t) < 20:
        return True
    return False

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Generate descriptions for T1 spirits products.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to Supabase")
    parser.add_argument("--tier", type=int, default=1, help="Enrichment priority tier (default: 1)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of products processed (0 = all)")
    parser.add_argument("--force", action="store_true", help="Overwrite even if existing description looks decent")
    args = parser.parse_args()

    # Build classification filter
    cls_list = ",".join(SPIRITS_CLASSIFICATIONS)
    select = "sku,name,classification,country,region,brand,style,flavor_tags,food_matching,desc_en_short,desc_en_full,short_description_en,enrichment_priority"
    tier_filter = f"enrichment_priority=eq.{args.tier}"
    cls_filter = f"classification=in.({cls_list})"
    query = f"products?{tier_filter}&{cls_filter}&select={select}&order=sku.asc"

    print(f"Fetching T{args.tier} spirits/accessories products...", flush=True)
    products = fetch_all(query)
    print(f"  Fetched: {len(products)} products", flush=True)

    if args.limit > 0:
        products = products[:args.limit]
        print(f"  Limited to: {len(products)}", flush=True)

    updates = {}
    skipped_no_gen = 0
    skipped_existing = 0
    by_class = {}

    for p in products:
        sku = p["sku"]
        cls = s(p.get("classification"))
        existing_short = s(p.get("desc_en_short")) or s(p.get("short_description_en"))
        existing_full = s(p.get("desc_en_full"))

        short, full = generate_descriptions(p)
        if short is None:
            skipped_no_gen += 1
            continue

        # Decide whether to overwrite
        if not args.force:
            if not is_placeholder(existing_short) and not is_placeholder(existing_full):
                skipped_existing += 1
                continue

        patch_data = {}
        if is_placeholder(existing_short) or args.force:
            patch_data["desc_en_short"] = short
        if is_placeholder(existing_full) or args.force:
            patch_data["desc_en_full"] = full

        if patch_data:
            updates[sku] = patch_data
            by_class[cls] = by_class.get(cls, 0) + 1

    print(f"\n--- Summary ---", flush=True)
    print(f"  Will update:     {len(updates)}", flush=True)
    print(f"  Skipped (existing): {skipped_existing}", flush=True)
    print(f"  Skipped (no gen):   {skipped_no_gen}", flush=True)
    print(f"  By classification:", flush=True)
    for cls, count in sorted(by_class.items(), key=lambda x: -x[1]):
        print(f"    {cls:20s} {count}", flush=True)

    if args.dry_run:
        print(f"\n--- Dry Run Preview ---", flush=True)
        for i, (sku, data) in enumerate(updates.items()):
            if i >= 10:
                print(f"  ... and {len(updates) - 10} more", flush=True)
                break
            print(f"\n  SKU: {sku}", flush=True)
            if "desc_en_short" in data:
                print(f"  SHORT: {data['desc_en_short'][:120]}...", flush=True)
            if "desc_en_full" in data:
                # Show first 150 chars of the HTML
                print(f"  FULL:  {data['desc_en_full'][:150]}...", flush=True)
        print(f"\n[DRY RUN] No changes written.", flush=True)
        return

    # Batch PATCH
    patched = 0
    failed = 0
    items = list(updates.items())
    total = len(items)

    for i in range(0, total, 50):
        batch = items[i:i + 50]
        for sku, data in batch:
            try:
                patch(sku, data)
                patched += 1
            except Exception as e:
                print(f"  FAIL {sku}: {e}", flush=True)
                failed += 1
        done = i + len(batch)
        pct = done / total * 100
        print(f"  Patched {patched}/{total} ({pct:.0f}%)", flush=True)

    print(f"\nDone: {patched} patched, {failed} failed.", flush=True)


if __name__ == "__main__":
    main()
