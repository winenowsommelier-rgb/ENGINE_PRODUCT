"""Phase A deterministic taste-axis inferers (free, no LLM).

Tests the pure name/region → ladder-value functions that backfill the universal
`smokiness`, `sweetness`, `body` columns. Validated against real in-stock product
names from the live export (see the finder taste-coverage enrichment plan).
"""
from data.lib.enrichment.taste_rules import infer_smokiness, infer_sweetness, infer_body


# ── smokiness: none | light | heavy | None(unknown) ──────────────────────────
def test_islay_region_is_heavy():
    assert infer_smokiness("Ardbeg 10 Year Old", "Islay") == "heavy"

def test_peated_keyword_is_heavy():
    assert infer_smokiness("Benriach The Smoky Ten", "Speyside") == "heavy"

def test_lightly_peated_is_light():
    assert infer_smokiness("Highland Park 12 (lightly peated)", "Islands") == "light"

def test_no_signal_is_none_value():
    # An unpeated Speyside with no keyword → 'none' (clean), NOT None (unknown).
    assert infer_smokiness("Glenfiddich 12", "Speyside") == "none"

def test_non_whisky_returns_None():
    # No region + no keyword on a non-whisky name → None (no claim).
    assert infer_smokiness("Tanqueray London Dry Gin", "") is None

# NEGATION GUARD (live-data validation; Rule 5 — don't lock in a bug):
def test_explicit_non_peated_overrides_keyword():
    # Name literally says "Non-Peated" — must NOT be heavy though 'peat' substring is present.
    assert infer_smokiness("Nikka YOICHI Discovery - Non-Peated", "Hokkaido") == "none"

def test_unpeated_islay_distillery_is_not_heavy():
    # Bruichladdich's CLASSIC line is UNPEATED despite being an Islay distillery.
    assert infer_smokiness("Bruichladdich The Classic Laddie", "Islay") == "none"
    assert infer_smokiness("Bruichladdich  18 Aged Years Old Whisky", "Islay") == "none"

def test_peated_bruichladdich_line_IS_heavy():
    # Their PEATED line (Port Charlotte/Octomore) still scores heavy.
    assert infer_smokiness("Bruichladdich Port Charlotte 10", "Islay") == "heavy"

def test_peated_non_islay_IS_caught():
    # The whole point of W4: a peated whisky OUTSIDE Islay (region proxy misses these) → heavy.
    assert infer_smokiness("The Glenturret 10 Years old Peat Smoked", "Highland") == "heavy"
    assert infer_smokiness("Nikka MIYAGIKYO Discovery - Peated", "Miyagikyo") == "heavy"
    assert infer_smokiness("Lark Tasmanian Peated Single Malt", "Tasmania") == "heavy"


# ── sweetness (sake): very dry | dry | off-dry | sweet | None ─────────────────
def test_sake_nigori_is_sweet():
    assert infer_sweetness("Hakutsuru Sayuri Nigori Sake", "Sake/Shochu") == "sweet"

def test_sake_karakuchi_is_dry():
    assert infer_sweetness("Ozeki Karakuchi Dry Sake", "Sake/Shochu") == "dry"

def test_sake_no_keyword_returns_None():
    # Most polished sake has no name cue → leave for Phase B (don't guess).
    assert infer_sweetness("Dassai 45 Junmai Daiginjo", "Sake/Shochu") is None


# ── body (wine): light .. full | None ────────────────────────────────────────
def test_body_light_keyword():
    assert infer_body("Beaujolais Nouveau (light, easy)", "Red Wine") == "light"

def test_body_full_keyword():
    assert infer_body("Barossa Shiraz — big, full-bodied", "Red Wine") == "full"

def test_body_no_keyword_returns_None():
    assert infer_body("Generic Red Blend", "Red Wine") is None
