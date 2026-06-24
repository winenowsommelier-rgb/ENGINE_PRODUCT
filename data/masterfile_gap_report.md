# Masterfile Intake — Gap Report (read-only sign-off artifact)

> This report spent **no money** and wrote **nothing** to the database. It describes what the later (gated) write steps WOULD do. On every conflict the **DB value is KEPT** (DB is source of truth).

- DB (read-only): `data/db/products.db`
- Masterfile CSV: `/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/Masterfile Data WNLQ9 - MReport Masterfile.csv`

## 1. SKU Reconciliation

| Metric | Count |
|---|---|
| Masterfile distinct SKUs | 11855 |
| Matched (in both) | 11262 |
| Masterfile-only (would be NEW products) | 588 |
| &nbsp;&nbsp;↳ in stock | 539 |
| &nbsp;&nbsp;↳ out of stock | 49 |
| DB-only (not in masterfile) | 174 |
| Duplicate-SKU artifacts removed | 5 |

_Invariant_: matched(11262) + mf_only(588) + dup_artifacts(5) = 11855 == mf_distinct(11855)

Duplicate SKUs: `WRW5216AB, WRW5217AB, WRW5236CU, WRW5243CU, WRW5244CU`
DB-only sample: `AWC0138EN, GDC0046AB, LBE0276AX, LBE0286AX, LBE0317AX, LBE0519AX, LBE0536CS, LBE0537CS, LBS00272GT, LBS0154LQ`
Masterfile-only sample: `ABA0834AB, ABA0835AB, ABA0836AB, ABA0837AB, ABA0838AB, ABA0839AB, ABA0840AB, ABA0841AB, ABA0842AB, ABA0843AB`

## 2. Per-Field Fill / Conflict / Agree (matched SKUs)

**Fill** = DB empty, masterfile has a value (would be written). **Conflict** = both present and differ (**DB KEPT, masterfile ignored**). **Agree** = identical.

| DB field | Fill candidates | Conflicts (DB kept) | Agree |
|---|---|---|---|
| country | 0 | 265 | 10868 |
| region | 7 | 3108 | 3741 |
| subregion | 0 | 0 | 0 |
| body | 2343 | 2879 | 1396 |
| acidity | 2344 | 2194 | 2069 |
| tannin | 2613 | 1929 | 2063 |
| food_matching | 2264 | 4306 | 0 |
| desc_en_short | 4505 | 6419 | 0 |
| full_description | 3494 | 5419 | 1 |
| variety | 224 | 3310 | 3317 |
| designation | 90 | 372 | 1872 |

<details><summary>Conflict samples — country (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| LGN0170CN | England | UK |
| LSJ0091GM | South Korea | Korea |
| LVK0105AV | Netherlands | Netherland |
| ABA0394AB | Austria | USA |
| ABA0297AB | Austria | USA |
| LVK0099AV | Netherlands | Netherland |
| LVK0098AV | Netherlands | Netherland |
| LGN0258FO | England | UK |

</details>

<details><summary>Conflict samples — region (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP2586DD | Veneto | Veneto | Prosecco |
| WRW6532GU | Veneto | Veneto | Valpolicella Ripasso |
| WRW6161AH | Languedoc-Roussillon | Languedoc |
| WRW2048AC | Tuscany | Tuscany | Chianti DOCG |
| WWW6183AB | California | California | Sonoma County |
| WRW6249FJ | Abruzzo | Abruzzo | Montepulciano d’Abruzzo |
| WRW5003AF | Bordeaux | Bordeaux | Saint-Émilion |
| WRW6135AC | California | California | Napa Valley |

</details>

<details><summary>Conflict samples — body (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP1483BU | Medium | Full |
| WRW6532GU | Medium-Full | Full |
| WWW5254FJ | Medium-Full | Medium |
| WWW5175GX | Medium | Light |
| WRW5925GE | Full | Medium |
| WRW2048AC | Medium-Full | Full |
| WWW6214CB | Medium | Full |
| WRW6249FJ | Medium-Full | Full |

</details>

<details><summary>Conflict samples — acidity (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP1483BU | Medium-Full | High |
| WWW5122AA | Medium-High | Medium |
| WWW5175GX | Medium-High | High |
| WRW5925GE | Medium-High | Medium |
| WWW6183AB | High | Medium |
| WSP2648DD | High | Low |
| WWW6214CB | Medium-Full | Medium |
| WDW0041AF | Low | Medium |

</details>

<details><summary>Conflict samples — tannin (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP1483BU | Light | Low |
| WRW5925GE | High | Medium |
| WRW2048AC | Medium-High | High |
| WWW6214CB | Light | Low |
| WRW5994BU | Medium-High | High |
| WDW0041AF | Low | High |
| WRW2019AC | Medium-High | High |
| WRW3197AD | Medium | Low |

</details>

<details><summary>Conflict samples — food_matching (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP2586DD | Aperitif & cocktail snacks | Soft & creamy cheese | Oysters  | Mushroom|Fish|Seafood |
| WSP1483BU | Shellfish & crustaceans | Duck & game birds | Cured meats &  | Fish|Seafood |
| WRW6532GU | Grilled red meat & steak | Hard & aged cheese | Tomato-based | Beef|Lamb|Pork|Cured Meat|Hard Cheese |
| WWW5254FJ | Creamy pasta & risotto | Shellfish & crustaceans | Grilled & | Pork|Vegetables |
| WWW5122AA | Fruit desserts & tarts | Creamy desserts & pastries | Aperit | Dessert |
| WWW5175GX | Grilled & roasted fish | Oysters & raw seafood | Leafy salad | Seafood|Vegetables |
| WRW5925GE | Grilled red meat & steak | Lamb dishes | Game meats | Hard & | Beef|Lamb |
| WRW2048AC | Tomato-based pasta | Grilled red meat & steak | Cured meats  | Beef|Lamb|Cured Meat|Soft Cheese|Pasta |

</details>

<details><summary>Conflict samples — desc_en_short (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP2586DD | Delicate Prosecco Rosé with strawberry and citrus notes, fin | <p>Delicate and complex bouquet with fruity notes that remin |
| WSP1483BU | Pinot Noir-only Champagne from Mumm's 160 ha Grand Cru estat | This Cuvee is produced exclusively with Pinot Noir from Verz |
| WRW6532GU | Valpolicella Ripasso with dark fruit depth, balanced oak, an | <p>Rich and velvety Valpolicella Ripasso bursting with cherr |
| WWW5254FJ | Margaret River Chardonnay with ripe stone fruit, citrus, and | <p>Pale straw with lime green hues. Aromas of citrus, cumqua |
| WWW5122AA | Delicate Piedmont Moscato with floral aromatics, stone fruit | Pale yellow. Ample and very intense bouquet, with a note of  |
| LWH1231AA | Single cask from Dufftown's 1974 distillation — one of Balve | At The Belvanie we stay true to our Five Rare Craft, making  |
| LGN0361DG | Cognac-region gin pivoting on juniper intensity; macerated b | A Juniper cask-aged gin to celebrate the 25th anniversary of |
| WWW5175GX | Margaret River Sauvignon Blanc–Semillon blend: crisp citrus, | An extended warm and dry period
following reasonable winter  |

</details>

<details><summary>Conflict samples — full_description (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP2586DD | <p>Barocco Prosecco Spumante Rosé DOC is a light, refreshing | <p>Delicate and complex bouquet with fruity notes that remin |
| WSP1483BU | <p>When Mumm installed its own press house directly in the G | This Cuvee is produced exclusively with Pinot Noir from Verz |
| WRW6532GU | <p><strong>Antichello Valpolicella Ripasso DOC Superiore</st | <p>Antichello Valpolicella Ripasso DOC Superiore is a luxuri |
| WWW5254FJ | <p>Fraser Gallop's Parterre Chardonnay from Margaret River s | <p>Pale straw with lime green hues. Aromas of citrus, cumqua |
| WWW5122AA | <p>7 Cascine Moscato d'Asti DOCG is a lightly sparkling whit | <p><strong>Vinification and refinement: </strong></p>
<p>Sof |
| LWH1231AA | <p>When William Grant converted the 18th-century Balvenie Ne | <p><strong>Tasting Notes</strong></p>
<p>NOSE: Herbal & slig |
| LGN0361DG | <p><strong>Citadelle Juniper Decadence</strong> originates f | <h3>Citadelle Gin</h3>
<p>Made with 19 botanicals are infuse |
| NNA0042AA | <p><strong>Monin</strong>, founded in Bourges, France in 191 | <div class="field field-name-field-product-description field |

</details>

<details><summary>Conflict samples — variety (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WSP2586DD | Glera, Pinot Nero | Glera, Pinot nero |
| WSP1483BU | Chardonnay, Pinot Noir, Pinot Meunier | Pinot Noir |
| WRW6532GU | Corvina, Rondinella, Corvinone | Corvina (โควีนา), Rondinella (รอนดินเนลลา), Corvinone (โควีน |
| WRW6920GW | Zinfandel | Primitivo |
| WSP1136AE | Chardonnay, Pinot Noir, Pinot Meunier | Pinot Noir, Chardonnay and Pinot Meunier |
| WRW2086AC | Cabernet Sauvignon | Cabernet Sauvignon, Petite Verdot, Mixed Varietals |
| WWW5175GX | Sauvignon Blanc, Semillon | 60% Sauvignon Blanc, 40% Semillon |
| WSP2648DD | White berry grapes (unspecified) | white berry grapes |

</details>

<details><summary>Conflict samples — designation (DB kept)</summary>

| SKU | DB (kept) | Masterfile (ignored) |
|---|---|---|
| WRW6161AH | DOP/IGP | IGP |
| WSP1136AE | Premier Cru | Brut |
| WWW4884AE | DOP/IGP | IGP |
| WRW3439AF | Premier Cru | 1er Cru |
| WRW3552DH | Reserva | Riserva |
| WRW6689DJ | Premier Cru | 1er Cru |
| WSP1244AC | DOC | Brut |
| WRW4564EF | DOP/IGP | IGP |

</details>

## 3. item_type Buckets (teach the taxonomy)

- **Bucket A — cosmetic** (same type, different spelling): 8953
- **Bucket B — real disagreements** (override candidates): 1311 rows across 45 distinct pairs
- Matched rows with no masterfile item_type: 998

| Resolver (`type_for`) | Masterfile item_type | Count |
|---|---|---|
| Sparkling & Champagne | Champagne | 451 |
| Sparkling & Champagne | Sparkling Wine | 419 |
| Mixer / Soft | Syrup | 138 |
| Shochu | Sake/Shochu | 73 |
| Sweet/Dessert | Dessert Wine | 53 |
| Umeshu | Yuzushu | 22 |
| Sweet/Dessert | Port Wine | 21 |
| Red Wine | Fruit Wine | 11 |
| Thai Rice Spirit | Thai White Spirits | 11 |
| Tonic / Mineral Water | Mixer Drink | 9 |
| White Wine | Fruit Wine | 8 |
| Thai Rice Spirit | Schnapps | 8 |
| Sweet/Dessert | White Wine | 8 |
| Shochu | Soju | 7 |
| Sparkling & Champagne | Sparkling Wine|Fruit Wine | 7 |
| Rum | Thai White Spirits | 7 |
| Ready-to-Drink | Cocktail | 5 |
| White Wine | White Wine|Fruit Wine | 5 |
| Red Wine | Red Wine|Fruit Wine | 4 |
| White Wine | Orange Wine | 4 |
| Tequila | Liqueur | 4 |
| Rosé Wine | Rose Wine|Fruit Wine | 3 |
| Rosé Wine | Champagne | 3 |
| Vodka | Thai White Spirits | 3 |
| Liqueur | Cocktail | 2 |

## 4. item_type NOT in designation-eligible set (silent-drop guard)

These masterfile item_type labels are not in the designation-eligible type set, so any designation in those names is silently dropped. Review labels that LOOK eligible (e.g. a wine spelled differently).

- Distinct types: 29 · Total matched rows: 2382

| Masterfile item_type | Count |
|---|---|
| Sake/Shochu | 519 |
| Liqueur | 382 |
| Gin | 302 |
| Beer | 221 |
| Vodka | 197 |
| Tequila | 188 |
| Rum | 174 |
| Syrup | 138 |
| Umeshu | 104 |
| Yuzushu | 24 |
| Thai White Spirits | 21 |
| Fruit Wine | 20 |
| Absinthe | 14 |
| Cachaca | 14 |
| Mixer Drink | 9 |
| Schnapps | 8 |
| Soju | 7 |
| Sparkling Wine|Fruit Wine | 7 |
| Cocktail | 7 |
| Makgeolli | 6 |
| White Wine|Fruit Wine | 5 |
| Red Wine|Fruit Wine | 4 |
| Rose Wine|Fruit Wine | 3 |
| White Liquor | 2 |
| Others | 2 |
| Gin|Rum | 1 |
| Mineral Water | 1 |
| Aquavit | 1 |
| Liqueur|Whisky | 1 |

## 5. Score Preview

| Metric | Count |
|---|---|
| Masterfile rows with any wine_score | 1639 |
| Incoming distinct (sku, critic, vintage) | 3175 |
| Bare-value vs HTML-parsed MISMATCH (same critic slot) | 38 |
| Existing critic_scores rows | 3144 |
| **NEW after dedupe on (sku, critic, vintage)** | 61 |

<details><summary>Bare-vs-HTML mismatch samples</summary>

| SKU | Critic | Bare value | HTML-parsed |
|---|---|---|---|
| WRW2150AC | Wine Advocate | 92 | 94 |
| WRW2355BN | Wine Advocate | 93 | 94 |
| WRW2051AC | Wine Advocate | 92 | 91 |
| WRW2451BN | Wine Spectator | 90 | 92 |
| WRW2458BN | Wine Enthusiast | 97 | 95 |
| WRW2458BN | Wine Spectator | 95 | 97 |
| WRW2362BN | Wine Advocate | 95 | 94 |
| WRW2898BN | Wine Advocate | 97 | 95 |
| WRW3587DH | James Suckling | 96 | 97 |
| WRW2332BN | James Suckling | 92 | 93 |
| WRW4017AJ | James Suckling | 94 | 91 |
| WRW4257AF | Wine Enthusiast | 96 | 98 |
| WRW4504AF | Wine Spectator | 90 | 92 |
| WWW2421DJ | Wine Advocate | 91 | 93 |
| WRW2297BN | Wine Spectator | 92 | 93 |

</details>

## 6. Designation Gap

DB rows with empty `designation` that `extract_designation(name, item_type)` would fill: **90**

| SKU | Name | item_type | Designation |
|---|---|---|---|
| WRW3573DH | Petrolo  Campolusso Toscana Rosso Igt | Red Wine | IGT |
| WWW6205CB | Frateli ponte roero arneis docg | White Wine | DOCG |
| WWW1872DH | Kuen Hof Peter Pliger  Eisacktaler Gewurztraminer Doc | White Wine | DOC |
| WWW1875DH | Schiopetto  Pinot Grigio Collio Doc | White Wine | DOC |
| WRW3561DH | Paolo Scavino  Barolo Bric Del Fiasc Docg | Red Wine | DOCG |
| WRW6164AB | Louis Jadot  Côte de Nuits Villages | Red Wine | Villages |
| WRW6306GQ | Chateau Premeaux  Cote de Nuits Villages | Red Wine | Villages |
| WRW1452FC | Louis Latour  Cote de Nuits-Villages (375 ml) | Red Wine | Villages |
| WWW5356FP | Max Ferd. Richter  Wehlener Sonnenuhr Riesling GG 'Uralte Reben' Trock | White Wine | GG |
| WWW1873DH | Schiopetto  Friulano Collio Doc | White Wine | DOC |

---
_Generated read-only. Next steps are separate, gated, and require sign-off._
