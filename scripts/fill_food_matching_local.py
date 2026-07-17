"""
fill_food_matching_local.py

Derives food_matching for products that are missing it, using pure deterministic
logic (no API cost). Reads and writes data/live_products_export.json directly.

Usage:
    python scripts/fill_food_matching_local.py [--dry-run] [--limit N]
"""
import json, argparse, sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).parent.parent
EXPORT = ROOT / "data" / "live_products_export.json"

sys.path.insert(0, str(ROOT))
from data.lib.taxonomy.sku_taxonomy import type_for

# ---------------------------------------------------------------------------
# Food pairing maps (copied from extract_fields_pass3.py)
# ---------------------------------------------------------------------------

FOOD_MAP_WINE = {
    "red_full":    "Grilled red meat, Beef stew & braised, Lamb dishes, Game meats, Aged hard cheese",
    "red_medium":  "Roast chicken, Pork dishes, Pasta with meat sauce, Pizza, Medium-aged cheese",
    "red_light":   "Salmon & tuna, Mushroom dishes, Charcuterie & pâté, Light pasta, Soft cheese",
    "white_full":  "Roast chicken, Grilled salmon, Creamy pasta, Lobster & crab, Rich seafood",
    "white_light": "Oysters & shellfish, Light salads, Goat cheese, Sushi & sashimi, Grilled fish",
    "white_default": "Grilled fish, Seafood pasta, Light cheese dishes, Vegetable stir-fry",
    "rose":        "Light salads, Grilled fish, Charcuterie, Sushi, Vegetarian dishes",
    "sparkling":   "Oysters, Fried appetizers, Sushi, Light canapés, Fresh fruit",
    "dessert":     "Fruit tarts, Blue cheese, Foie gras, Crème brûlée, Dark chocolate",
    "port":        "Dark chocolate, Blue cheese, Nuts & dried fruit, Crème brûlée",
    "orange":      "Grilled vegetables, Spiced dishes, Aged cheese, Charcuterie, Middle Eastern mezze",
}

FOOD_MAP_SPIRITS = {
    "whisky":   "Smoked salmon, Charcuterie & cured meats, Dark chocolate, Mature cheddar, Oysters",
    "bourbon":  "BBQ ribs, Pecan pie, Smoked meats, Aged cheddar, Dark chocolate",
    "cognac":   "Dark chocolate, Foie gras, Crème brûlée, Dried fruit & nuts",
    "armagnac": "Duck confit, Dark chocolate, Prunes, Aged cheese",
    "rum":      "Tropical fruit, Coconut desserts, Jerk chicken, Churros, Grilled pineapple",
    "gin":      "Smoked salmon, Cucumber salad, Oysters, Light canapés, Citrus desserts",
    "vodka":    "Caviar, Smoked salmon, Pickles & cured meats, Light sushi, Blinis",
    "tequila":  "Tacos & guacamole, Grilled fish, Ceviche, Spicy Mexican dishes, Lime-based desserts",
    "mezcal":   "Grilled meats, Mole, Roasted vegetables, Dark chocolate, Smoked cheese",
    "sake":     "Sushi & sashimi, Miso soup, Edamame, Steamed fish, Light Japanese dishes",
    "beer":     "Pizza, Burgers, Fried chicken, Spicy food, Sausages",
    "liqueur":  "Desserts, Ice cream, Fruit tarts, Cheese platters, Coffee cake",
    "brandy":   "Dark chocolate, Dried fruit, Aged cheese, Crêpes Suzette, Nuts",
    "absinthe": "Dark chocolate, Anise-spiced desserts, Strong cheese, Charcuterie",
    "cider":    "Roast pork, Aged cheddar, Fried appetizers, Apple desserts",
    "baijiu":   "Spicy Sichuan dishes, Braised meats, Hotpot, Salted nuts",
    "umeshu":   "Light appetizers, Grilled fish, Soft cheese, Fruit desserts",
    "calvados": "Roast pork, Apple tarts, Aged cheese, Duck dishes",
    "spirit":   "Light appetizers, Fresh fruit, Cured meats, Mild cheese",
}

SPIRIT_KEYWORDS = {
    "whisky":   ["whisky", "whiskey", "scotch", "bourbon", "rye whiskey", "japanese whisky",
                 "single malt", "blended malt", "irish whiskey"],
    "bourbon":  ["bourbon"],
    "cognac":   ["cognac", "vs cognac", "vsop", "xo cognac"],
    "armagnac": ["armagnac"],
    "rum":      ["rum", "rhum", "cachaça", "cachaca"],
    "gin":      ["gin", "sloe gin"],
    "vodka":    ["vodka"],
    "tequila":  ["tequila", "mezcal"],
    "mezcal":   ["mezcal"],
    "sake":     ["sake", "shochu", "sake/shochu"],
    "beer":     ["beer", "ale", "lager", "stout", "porter", "ipa", "craft beer"],
    "liqueur":  ["liqueur", "triple sec", "schnapps", "amaretto", "baileys", "kahlua",
                 "cointreau", "chartreuse", "limoncello", "aperol", "campari"],
    "brandy":   ["brandy", "pisco", "grappa", "marc"],
    "absinthe": ["absinthe"],
    "cider":    ["cider"],
    "baijiu":   ["baijiu"],
    "umeshu":   ["umeshu"],
    "calvados": ["calvados"],
    "spirit":   ["white spirits", "spirit"],
}

# Maps data/lib/taxonomy/sku_taxonomy.py type_for() output -> a SPIRIT_KEYWORDS key,
# used as a fallback when classification is blank (SKU prefix is the project's
# canonical type source, more reliable than parsing free-text names/classification).
TAXONOMY_TYPE_TO_SPIRIT = {
    "Whisky": "whisky", "Bourbon": "bourbon", "Cognac": "cognac", "Armagnac": "armagnac",
    "Rum": "rum", "Gin": "gin", "Vodka": "vodka", "Tequila": "tequila", "Mezcal": "mezcal",
    "Sake": "sake", "Sake / Shochu": "sake", "Umeshu": "umeshu", "Beer": "beer",
    "Liqueur": "liqueur", "Brandy": "brandy", "Grappa": "brandy", "Absinthe": "absinthe",
    "Cider": "cider", "Baijiu": "baijiu", "Calvados": "calvados",
    "Spirit": "spirit", "White Spirits": "spirit",
}
TAXONOMY_TYPE_TO_WINE_KEY = {
    "Red Wine": "red_medium", "White Wine": "white_default", "Rosé Wine": "rose",
    "Rose Wine": "rose", "Sparkling Wine": "sparkling", "Champagne": "sparkling",
    "Sparkling & Champagne": "sparkling", "Dessert Wine": "dessert",
    "Sweet/Dessert": "dessert", "Port Wine": "port", "Orange Wine": "orange",
}


def _classify_spirit(classification: str) -> Optional[str]:
    cl = (classification or "").lower()
    for spirit, keywords in SPIRIT_KEYWORDS.items():
        if any(kw in cl for kw in keywords):
            return spirit
    return None


def derive_food_matching(classification: str, style: str, body: str,
                         tannin: str, acidity: str, grape: str,
                         sku: Optional[str] = None) -> Optional[str]:
    cl = (classification or "").lower()
    bd = (body or "").lower()
    tn = (tannin or "").lower()
    gr = (grape or "").lower()

    spirit = _classify_spirit(classification)
    if spirit:
        return FOOD_MAP_SPIRITS.get(spirit)

    # classification is blank/unhelpful (e.g. "Wine product" junk bucket, or None) —
    # fall back to the SKU-prefix taxonomy, the project's canonical type source
    # (see CLAUDE.md Rule 12: classification is NOT a reliable category/type signal).
    if not cl or cl == "wine product":
        if sku:
            taxo_type = type_for(sku)
            tax_spirit = TAXONOMY_TYPE_TO_SPIRIT.get(taxo_type)
            if tax_spirit:
                return FOOD_MAP_SPIRITS.get(tax_spirit)
            tax_wine_key = TAXONOMY_TYPE_TO_WINE_KEY.get(taxo_type)
            if tax_wine_key:
                return FOOD_MAP_WINE.get(tax_wine_key)

    # Non-drinkable (glassware, accessories)
    non_drink = ["glassware", "accessory", "accessories", "equipment", "tool", "gift set"]
    if any(nd in cl for nd in non_drink):
        return None

    is_red      = "red" in cl
    is_white    = "white" in cl
    is_rose     = "rose" in cl or "rosé" in cl
    is_sparkling = "sparkling" in cl or "champagne" in cl or "prosecco" in cl or "cava" in cl
    is_dessert  = "dessert" in cl or "sweet" in cl or "ice wine" in cl
    is_port     = "port" in cl or "fortified" in cl
    is_orange   = "orange" in cl

    if is_port:      return FOOD_MAP_WINE["port"]
    if is_dessert:   return FOOD_MAP_WINE["dessert"]
    if is_sparkling: return FOOD_MAP_WINE["sparkling"]
    if is_orange:    return FOOD_MAP_WINE["orange"]
    if is_rose:      return FOOD_MAP_WINE["rose"]

    if is_red:
        if "full" in bd or "high" in tn:
            return FOOD_MAP_WINE["red_full"]
        if "light" in bd:
            return FOOD_MAP_WINE["red_light"]
        if "medium" in bd:
            return FOOD_MAP_WINE["red_medium"]
        full_grapes  = ["cabernet sauvignon", "syrah", "shiraz", "nebbiolo", "malbec",
                        "tannat", "mourvèdre", "monastrell", "touriga", "aglianico", "petite sirah"]
        light_grapes = ["pinot noir", "gamay", "schiava", "frappato", "dolcetto", "zweigelt"]
        if any(g in gr for g in full_grapes):  return FOOD_MAP_WINE["red_full"]
        if any(g in gr for g in light_grapes): return FOOD_MAP_WINE["red_light"]
        return FOOD_MAP_WINE["red_medium"]

    if is_white:
        if "full" in bd:
            return FOOD_MAP_WINE["white_full"]
        if "light" in bd or "crisp" in (style or "").lower():
            return FOOD_MAP_WINE["white_light"]
        full_whites  = ["chardonnay", "viognier", "marsanne", "roussanne", "sémillon", "semillon"]
        light_whites = ["sauvignon blanc", "riesling", "pinot grigio", "pinot gris",
                        "albariño", "albarino", "verdejo", "grüner veltliner", "gruner veltliner",
                        "muscadet", "vermentino", "assyrtiko"]
        if any(g in gr for g in full_whites):  return FOOD_MAP_WINE["white_full"]
        if any(g in gr for g in light_whites): return FOOD_MAP_WINE["white_light"]
        return FOOD_MAP_WINE["white_default"]

    # Generic wine-like (e.g. "Wine product")
    if "wine" in cl:
        return FOOD_MAP_WINE["red_medium"]

    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print changes without writing")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N products (canary)")
    args = parser.parse_args()

    print(f"Loading {EXPORT} …")
    with open(EXPORT) as f:
        products = json.load(f)

    total    = len(products)
    missing  = [p for p in products if not (p.get("food_matching") or "").strip()]
    print(f"Total: {total}  |  Missing food_matching: {len(missing)}")

    target = missing[:args.limit] if args.limit else missing
    filled = 0
    skipped = 0

    for p in target:
        result = derive_food_matching(
            p.get("classification", ""),
            p.get("style", ""),
            p.get("body", ""),
            p.get("tannin", ""),
            p.get("acidity", ""),
            p.get("variety", ""),
            p.get("sku"),
        )
        if result:
            if args.dry_run:
                print(f"  [{p.get('sku')}] {p.get('classification','')} → {result[:60]}…")
            else:
                p["food_matching"] = result
            filled += 1
        else:
            skipped += 1

    print(f"\nFilled: {filled}  |  Skipped (no rule match): {skipped}")

    if args.dry_run:
        print("\n[DRY RUN] No files written.")
        return

    with open(EXPORT, "w") as f:
        json.dump(products, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Written: {EXPORT}")
    print("\nNext step: verify a few rows, then run refresh_live_export.py if needed.")


if __name__ == "__main__":
    main()
