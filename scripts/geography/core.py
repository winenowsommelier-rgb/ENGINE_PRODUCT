"""Shared beverage selection logic."""


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
