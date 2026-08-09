# Designation Description Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sourced, cited description copy for all 22 canonical wine/spirits designations (Grand Cru, DOCG, XO, etc.) and show it in a new card on the shop page whenever a shopper filters by `?designation=X` and that designation has at least one live product.

**Architecture:** A new static JSON data file (`data/designation_descriptions.json`) holds the 22 entries. A new server-only lookup (`designation-lookup.server.ts`) reads it once, caches it for the process lifetime, and returns `null` unless there's both a copy entry AND a non-zero live product count for the requested designation. A new `DesignationDescriptionCard` component (structurally a trimmed copy of the existing `RegionDescriptionCard`) renders it. The shop page wires the two together using the product count `shopFacets()` already computes.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Vitest + Testing Library, no new dependencies.

---

## Ground truth this plan relies on (from the approved spec)

- `docs/superpowers/specs/2026-08-09-designation-classification-linking-design.md` (reviewed, approved, commit `d2c3f17`).
- `apps/catalog/lib/designation.ts` — the 22-entry `DESIGNATIONS` array (exact order): `Grand Cru`, `Premier Cru`, `Cru Classé`, `DOCG`, `DOC`, `IGT`, `DOP/IGP`, `AOC`, `Single Malt`, `XO`, `VSOP`, `VS`, `Gran Reserva`, `Crianza`, `Classico`, `Superiore`, `Extra Brut`, `Brut`, `Reserva`, `Reserve`, `Limited`, `Vintage`.
- `apps/catalog/lib/facets.ts:designationsFor()` already excludes 0-count designations and is consumed via `shopFacets()` in `apps/catalog/lib/shop-facets.ts` — `facets.designations` in `shop/page.tsx` is a `FacetOption[]` (`{ value: string; count: number }[]`) that already reflects every filter EXCEPT the active `designation` param (see `shop-facets.ts:74-77`), so it's the correct source for "does this designation have live results right now."
- `apps/catalog/lib/explore/map-data.server.ts` is the pattern for a cached, fs-backed server loader that throws loudly (`"...not found — run the prebuild generator"`) on a missing file rather than silently degrading.
- `apps/catalog/lib/explore/split-sentences.ts` — reuse `splitSentences()` as-is, do not reimplement.
- `apps/catalog/components/shop/RegionDescriptionCard.tsx` — the card to structurally mirror (sentence-per-line body, `gap-1.5 leading-relaxed`, 3-sentence collapse threshold, Read more/less toggle). It does **not** render a citation footer despite having citation data available — this plan intentionally diverges here (see Task 3) but must not "fix" `RegionDescriptionCard` while doing so; that's explicitly out of scope.
- `apps/catalog/app/shop/page.tsx:219-224` — where `RegionDescriptionCard` is wired in; the new card is wired the same way, immediately after it.

## Explicitly out of scope (do not implement)

- Product detail page designation display/linking.
- Any change to `apps/catalog/lib/designation.ts`, `scripts/backfill_designation.py`, or the `TIER_TO_DESIGNATION` map in `KnowledgeSection.tsx` — verified during brainstorming that no linking-coverage changes are needed.
- Backfilling more products into thin designations (e.g. `VS`, currently 0 live products) — separate follow-up task.
- A citation footer on `RegionDescriptionCard`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `data/designation_descriptions.json` | Create | 22 hand-authored, cited entries keyed by exact `DESIGNATIONS` label |
| `apps/catalog/lib/explore/designation-descriptions.server.ts` | Create | Loads/caches the JSON, throws loudly if missing |
| `apps/catalog/lib/explore/designation-lookup.server.ts` | Create | `findDesignationDescription()` — the null-unless-linkable lookup |
| `apps/catalog/lib/explore/designation-lookup.test.ts` | Create | Unit tests for the lookup (0-count suppression, missing-copy, missing-file) |
| `apps/catalog/components/shop/DesignationDescriptionCard.tsx` | Create | The card component |
| `apps/catalog/components/shop/__tests__/DesignationDescriptionCard.test.tsx` | Create | Render tests |
| `apps/catalog/app/shop/page.tsx` | Modify (~line 219) | Wire the new card in next to `RegionDescriptionCard` |
| `apps/catalog/lib/designation.test.ts` | Modify | Add a completeness test: every `DESIGNATIONS` label has a JSON entry |

Two files (JSON loader + lookup) instead of one, mirroring the existing `map-data.server.ts` (raw load/cache) vs. `region-lookup.server.ts` (business logic: which entry, is it valid to show) split — keeps the "throw on missing file" concern separate from the "is this actually linkable right now" concern, which is exactly the kind of logic Task 5's test needs to isolate.

---

### Task 1: Add the designation descriptions data file

**Files:**
- Create: `data/designation_descriptions.json`

- [ ] **Step 1: Write the file**

Create `data/designation_descriptions.json` with exactly this content (22 entries, one per `DESIGNATIONS` label, each cited to a real, checkable source):

```json
{
  "Grand Cru": {
    "short": "\"Great growth\" — the top tier in France's vineyard classification systems, marking a single vineyard site officially recognized as the highest quality in its region.",
    "full": "Grand Cru (\"great growth\") is the highest official vineyard classification in several French wine regions, each with its own legally defined system. In Burgundy, 33 Grand Cru vineyards (about 1.4% of the region's production) are classified directly at the vineyard level under INAO appellation law, sitting above Premier Cru, Village, and Regional tiers. In Champagne, Grand Cru is a village-level ranking under the historic échelle des crus system: 17 villages hold Grand Cru status, entitling grapes grown there to the designation. Alsace has its own separate Grand Cru AOC covering 51 named vineyards, established in 1975 and expanded through 2007. Bordeaux does not use \"Grand Cru\" as a standalone tier in its 1855 Classification (see Cru Classé), though St.-Émilion has a distinct \"Grand Cru\" and \"Grand Cru Classé\" system revised roughly every decade. Because the term is legally defined differently by region, a Grand Cru Burgundy and a Grand Cru Champagne reflect different classification mechanics, but both signal the top rank within their respective systems.",
    "citation": "Wine Bible 2e, France chapters (Burgundy, Champagne, Alsace); INAO appellation decrees"
  },
  "Premier Cru": {
    "short": "\"First growth\" — the tier directly below Grand Cru in Burgundy and Champagne's vineyard/village classification systems, covering roughly 640 named Burgundy sites and 42 Champagne villages.",
    "full": "Premier Cru (\"first growth\") sits one level below Grand Cru in the French classification systems that use the term. In Burgundy, roughly 640 Premier Cru vineyard sites (about 10% of the region's production) are classified above Village-level wines but below the 33 Grand Crus, again under INAO appellation law tied to specific, named parcels. In Champagne, Premier Cru is a village-level rank under the échelle des crus system: 42 villages hold Premier Cru status, one tier below the 17 Grand Cru villages. The distinction is not a marketing term — it corresponds to a legally fixed list of vineyard or village names that can be checked against the appellation decree, and Premier Cru wines from a named vineyard (e.g. a Burgundy \"Premier Cru Les Charmes\") can command significant price premiums over unclassified village wine from the same commune.",
    "citation": "Wine Bible 2e, France chapters (Burgundy, Champagne); INAO appellation decrees"
  },
  "Cru Classé": {
    "short": "\"Classified growth\" — Bordeaux's estate-level ranking system, most famously the 1855 Classification of the Médoc and Sauternes.",
    "full": "Cru Classé (\"classified growth\") refers to Bordeaux's chateau-level classification systems, the best known being the 1855 Classification commissioned by Napoleon III for the Exposition Universelle de Paris. It ranked 61 Médoc red-wine chateaux (plus one Graves estate, Château Haut-Brion) into five tiers — First through Fifth Growth — based on the trading price of their wines at the time, and separately ranked Sauternes/Barsac sweet-wine estates into Premier Cru Supérieur (Château d'Yquem alone), Premier Cru, and Deuxième Cru. The 1855 list has been amended only once (Mouton Rothschild's 1973 promotion to First Growth) and otherwise remains frozen. Graves and St.-Émilion later developed their own separate, periodically revised Cru Classé systems; Pomerol has never adopted a classification at all. \"Cru Classé\" without further qualification most commonly refers to the 1855 Médoc/Sauternes list.",
    "citation": "Wine Bible 2e, France/Bordeaux; 1855 Classification official records"
  },
  "DOCG": {
    "short": "Denominazione di Origine Controllata e Garantita — Italy's highest wine classification, with legally mandated tasting panels and government-sealed bottles.",
    "full": "DOCG (Denominazione di Origine Controllata e Garantita, \"controlled and guaranteed designation of origin\") is the top tier of Italy's wine classification pyramid, above DOC, IGT, and Vino da Tavola. Introduced in 1980, it adds a government tasting-panel approval requirement and a numbered state seal across the bottle neck (the fascetta) on top of the geographic, yield, and production-method rules that already apply to DOC wines — intended to guarantee both origin and a minimum quality bar. The first four DOCGs, granted in 1980, were Barolo, Barbaresco, Brunello di Montalcino, and Vino Nobile di Montepulciano. As of the mid-2020s there are 77 DOCGs; Piedmont alone accounts for a large share, with roughly 84% of the region's wine production falling under DOC or DOCG rules. Prosecco's premium hillside zone, Conegliano-Valdobbiadene, was elevated to DOCG status in 2009, distinguishing it from broader-appellation Prosecco DOC.",
    "citation": "Wine Bible 2e, Italy chapters; Ministero delle Politiche Agricole (Mipaaf) DOCG registry"
  },
  "DOC": {
    "short": "Denominazione di Origine Controllata — Italy's standard controlled-origin wine classification, the tier below DOCG.",
    "full": "DOC (Denominazione di Origine Controllata, \"controlled designation of origin\") is Italy's main tier of geographically defined, rule-governed wine production, sitting below DOCG and above IGT and Vino da Tavola in the country's four-tier pyramid established by a 1963 law (modeled on France's AOC system) and later aligned with EU-wide DOP/PDO rules. DOC rules specify the permitted grape varieties, maximum yields, minimum alcohol levels, and aging requirements for wines from a defined zone. There are several hundred DOCs across Italy — more numerous than DOCGs — ranging from broad regional appellations to small, specific zones. A wine can be produced in a DOCG-eligible zone but declassified to DOC (or lower) if it fails to meet the stricter DOCG requirements in a given vintage.",
    "citation": "Wine Bible 2e, Italy chapters; Mipaaf DOC/DOCG registry"
  },
  "IGT": {
    "short": "Indicazione Geografica Tipica — a broader, more flexible Italian wine category that permits non-traditional grapes and blends, home to many \"Super Tuscans.\"",
    "full": "IGT (Indicazione Geografica Tipica, \"typical geographic indication\") is the third tier of Italy's wine classification system, below DOC/DOCG but above basic Vino da Tavola. Introduced in 1992, IGT rules are deliberately looser on permitted grape varieties and blending than DOC/DOCG, which is why the category became the label of choice for Tuscany's \"Super Tuscans\" — wines like Sassicaia, Tignanello, and Masseto that use non-traditional grapes (Cabernet Sauvignon, Merlot) or blends the strict DOC/DOCG rules of the era didn't permit, despite being produced to a very high standard and commanding prices well above many DOCG wines. IGT is not a quality demotion; it reflects a producer's choice to work outside a DOC/DOCG's compositional rules while still identifying a broad geographic origin (e.g. Toscana IGT).",
    "citation": "Wine Bible 2e, Italy/Tuscany; Mipaaf IGT registry"
  },
  "DOP/IGP": {
    "short": "The EU-wide geographic-origin labels — Denominazione di Origine Protetta / Indicazione Geografica Protetta — that sit alongside national systems across the European Union.",
    "full": "DOP (Denominazione di Origine Protetta, \"protected designation of origin\") and IGP (Indicazione Geografica Protetta, \"protected geographic indication\") are the Italian-language forms of the European Union's two-tier geographic-indication framework, used across all EU member states under harmonized rules (the equivalents are AOP/IGP in France and DOP/IGP in Spain and Portugal). DOP is the stricter tier, requiring that a product's raw materials, production, and processing all occur within the named area under a defined specification — in Italy, DOC and DOCG wines are legally DOP wines using national terminology. IGP is looser, generally requiring only that one stage of production occur in the named area — IGT wines are legally IGP wines. The EU framework exists so that a Denominazione di Origine Controllata (Italy), Appellation d'Origine Contrôlée (France), and Denominación de Origen (Spain) are all recognized as equivalent-tier protections across the single market.",
    "citation": "EU Regulation (EU) No 1308/2013 (wine geographic indications); Wine Bible 2e, Italy chapters"
  },
  "AOC": {
    "short": "Appellation d'Origine Contrôlée — France's foundational controlled-origin system, regulating where, how, and from which grapes a wine may be made.",
    "full": "AOC (Appellation d'Origine Contrôlée, \"controlled designation of origin\"), legally now AOP (Appellation d'Origine Protégée) under EU-wide terminology though AOC remains in common use, is the system that governs the great majority of French wine production. Established in law in 1935 under the INAO (Institut National de l'Origine et de la Qualité), it defines each appellation's precise geographic boundaries, permitted grape varieties, maximum yields, minimum alcohol levels, and often specific viticultural and winemaking practices. There are several hundred AOCs in France, ranging from broad regional appellations (e.g. Bordeaux AOC) down to single named vineyards (e.g. Romanée-Conti AOC, an appellation of one plot). AOC is the framework underneath Burgundy's Grand Cru/Premier Cru/Village/Regional hierarchy and Champagne's échelle des crus — those are refinements within the AOC system, not alternatives to it.",
    "citation": "Wine Bible 2e, France introduction and regional chapters; INAO"
  },
  "Single Malt": {
    "short": "Scotch whisky (or whisky made elsewhere in the same style) produced entirely from malted barley at a single distillery, as opposed to a blend of multiple distilleries' spirit.",
    "full": "Single Malt is a legally defined term under Scotch whisky regulation (the Scotch Whisky Regulations 2009): a whisky made exclusively from water and malted barley, produced by pot-still distillation at a single distillery. \"Single\" refers to the one-distillery requirement, not a single cask — most single malt releases are vatted from many casks at one site to achieve a consistent house style. This distinguishes it from blended Scotch (which combines single malt and grain whisky from multiple distilleries) and from blended malt (malt whiskies from more than one distillery, no grain whisky). The term and its legal framework originated in Scotland but the labeling convention — 100% malted barley, one distillery — has been adopted by whisky producers in other countries (Japan, Ireland, the US) as a recognizable quality/style signal, even where not identically regulated.",
    "citation": "Scotch Whisky Regulations 2009 (UK Statutory Instrument 2009 No. 2890); Michael Jackson's Whisky guides for style context"
  },
  "XO": {
    "short": "\"Extra Old\" — a Cognac age-grade requiring a minimum 10-year-old blend component, the tier above VSOP.",
    "full": "XO (\"Extra Old\") is an official age classification under the Bureau National Interprofessionnel du Cognac (BNIC), the regulatory body governing Cognac production. As of 2018 revised rules, an XO Cognac's youngest eau-de-vie component must be aged at least 10 years in oak (raised from a prior 6-year minimum). XO sits above VSOP (minimum 4 years) and VS (minimum 2 years) in Cognac's standard age hierarchy, and below unregulated marketing terms some houses use for even older blends (Extra, Hors d'Âge). Because Cognac is a blend of many eaux-de-vie of different ages, the age stated is always the youngest component in the blend — a bottle can (and often does) contain much older spirit alongside the minimum-age component. The XO term and its minimum-age rule are specific to Cognac (and, by extension, other BNIC-adjacent French brandies); it is used more loosely as a marketing term on some non-Cognac spirits without the same legal backing.",
    "citation": "BNIC (Bureau National Interprofessionnel du Cognac) official age-designation rules, 2018 revision"
  },
  "VSOP": {
    "short": "\"Very Superior Old Pale\" — a Cognac age grade requiring a minimum 4-year-old blend component, between VS and XO.",
    "full": "VSOP (\"Very Superior Old Pale\") is an official BNIC age classification for Cognac, requiring the youngest eau-de-vie in the blend to have aged at least 4 years in oak — above VS (2 years minimum) and below XO (10 years minimum, as of the 2018 rule revision). The term dates to the 19th century, coined for the British market where \"pale\" distinguished lightly colored, more delicately aged Cognac from darker, heavily caramel-adjusted styles. As with all Cognac age statements, the stated minimum reflects only the youngest component of the blend, not the average or oldest age present.",
    "citation": "BNIC official age-designation rules"
  },
  "VS": {
    "short": "\"Very Special\" — the entry-level Cognac age grade, requiring a minimum 2-year-old blend component.",
    "full": "VS (\"Very Special\") is the youngest official BNIC age classification for Cognac, requiring the youngest eau-de-vie in the blend to have aged at least 2 years in oak. It is the base tier beneath VSOP (4 years minimum) and XO (10 years minimum). VS Cognacs are typically the most affordably priced within a house's range and are commonly used in cocktails rather than sipped neat, though quality still varies significantly by producer and the actual (often older) ages blended in beyond the legal minimum.",
    "citation": "BNIC official age-designation rules"
  },
  "Gran Reserva": {
    "short": "Spain's highest wine-aging category, reserved for exceptional vintages and requiring the longest combined barrel-and-bottle aging before release.",
    "full": "Gran Reserva is the top tier of Spain's wine-aging classification system, applied only in vintages a producer's region deems exceptional. Under DOCa Rioja rules, a Gran Reserva red must age a minimum of 5 years before release, including at least 2 years in oak barrel and the remainder in bottle. It sits above Reserva (minimum 3 years total, 1 in oak) and Crianza (minimum 2 years total, 1 in oak, for reds), and reflects both extended aging and a producer's confidence in a vintage's quality — not every year is declared a Gran Reserva year. Similar aging-tier systems exist in other Spanish DOs (e.g. Ribera del Duero) with comparable minimums, and DOCa status itself (held only by Rioja and Priorat) sits above the standard DO tier.",
    "citation": "Wine Bible 2e, Spain/Rioja; Consejo Regulador DOCa Rioja aging requirements"
  },
  "Crianza": {
    "short": "Spain's entry-level wine-aging category — a minimum of 2 years' total aging with at least 1 year in oak barrel, for red wines.",
    "full": "Crianza is the base aging tier in Spain's classification system, sitting below Reserva and Gran Reserva. Under DOCa Rioja rules, a red Crianza must age a minimum of 2 years total, with at least 1 year of that in oak barrel before the wine can be released; white and rosé Crianza rules typically require somewhat less oak time. Crianza wines are meant to be more immediately approachable than the longer-aged Reserva and Gran Reserva tiers, and are usually the highest-volume category within a Rioja producer's range. Aging minimums vary slightly by DO — Ribera del Duero and other regions apply their own Consejo Regulador rules, generally similar in structure though not always identical in exact time requirements.",
    "citation": "Consejo Regulador DOCa Rioja aging requirements; Wine Bible 2e, Spain/Rioja"
  },
  "Classico": {
    "short": "An Italian designation marking wine from the original, historic heartland of a larger DOC/DOCG zone, as distinct from later-added surrounding areas.",
    "full": "Classico is a sub-zone qualifier used within several Italian DOC/DOCG appellations to mark wine sourced from the original, historically defined core of the zone, as opposed to the broader area added when the appellation's boundaries were later expanded. Chianti Classico is the best-known example: the historic Chianti heartland between Florence and Siena, now its own DOCG separate from the wider Chianti DOCG that was created when the appellation expanded into surrounding zones in the 1930s-60s. Similarly, Soave Classico and Valpolicella Classico denote the original hillside cores of those DOCs, generally regarded as producing more structured, terroir-distinct wine than the flatter, higher-yield areas added to the broader appellation. \"Classico\" is not a separate legal quality tier like DOCG vs. DOC — it is a geographic sub-designation within a single DOC or DOCG's own rules.",
    "citation": "Wine Bible 2e, Italy/Tuscany and Veneto chapters; Consorzio Vino Chianti Classico"
  },
  "Superiore": {
    "short": "An Italian designation indicating a wine made to stricter rules than the base DOC — typically higher minimum alcohol and lower permitted yields — within the same appellation.",
    "full": "Superiore is a qualifier applied within many Italian DOC (and some DOCG) appellations to a wine produced under stricter rules than the standard version of that same appellation — commonly a higher minimum alcohol level and/or lower maximum yield per hectare, sometimes combined with additional aging requirements. It functions similarly to Classico as an in-appellation upgrade rather than a separate classification tier: a Soave Superiore, for instance, is DOCG-level (elevated above standard Soave DOC) and must meet tighter production limits than base Soave. Valpolicella Superiore similarly requires higher minimum alcohol and a minimum aging period beyond base Valpolicella DOC. The exact rules that Superiore unlocks are defined individually by each appellation's own disciplinare (production regulation), so the specific requirement varies by wine.",
    "citation": "Wine Bible 2e, Italy/Veneto chapter; individual DOC/DOCG disciplinari (Mipaaf)"
  },
  "Extra Brut": {
    "short": "A sparkling-wine sweetness category drier than standard Brut, permitting very little to no added dosage sugar.",
    "full": "Extra Brut is a defined sweetness (dosage) category on the official sparkling-wine sweetness scale used in Champagne and adopted across most traditional-method sparkling wine regions. Under EU rules, Extra Brut permits a maximum residual sugar of 6 grams per liter, compared to Brut's maximum of 12 g/L — placing it between Brut Nature (0-3 g/L, no sugar addition permitted beyond that occurring naturally) and standard Brut, which remains the most common style produced. The category reflects the final dosage (a small sugar-and-wine liqueur added at disgorgement) rather than a separate quality or origin classification; an Extra Brut and a Brut from the same producer and vintage are typically made identically up to the final dosage step.",
    "citation": "EU sparkling wine sweetness regulation (Regulation (EU) No 1308/2013, Annex II); Wine Bible 2e, France/Champagne"
  },
  "Brut": {
    "short": "The most common sparkling-wine sweetness category — dry, with a maximum residual sugar of 12 grams per liter under EU rules.",
    "full": "Brut is the standard, most widely produced sweetness (dosage) category for Champagne and other traditional-method sparkling wines, permitting a maximum residual sugar of 12 grams per liter under EU sparkling-wine regulation. It sits in the middle of the official sweetness scale, drier than Extra-Dry, Sec, Demi-Sec, and Doux, but less strictly dry than Extra Brut (max 6 g/L) or Brut Nature (max 3 g/L, essentially no dosage). The final sweetness level is set by the dosage — a small addition of wine and sugar (the liqueur d'expédition) blended in at disgorgement, after the wine's long secondary fermentation and aging on lees — meaning the same base wine can be released across multiple sweetness tiers depending on how much dosage a producer adds.",
    "citation": "EU sparkling wine sweetness regulation (Regulation (EU) No 1308/2013, Annex II); Wine Bible 2e, France/Champagne"
  },
  "Reserva": {
    "short": "A Spanish (Reserva) or Italian (Riserva) wine-aging category above the base tier, requiring extended combined oak and bottle aging before release.",
    "full": "Reserva (Spain) and Riserva (Italy) both denote an aging tier above a wine region's standard release, though the specific minimums are set independently by each country's regulatory system. Under DOCa Rioja rules, a red Reserva must age a minimum of 3 years total with at least 1 year in oak barrel, sitting above Crianza (2 years total, 1 in oak) and below Gran Reserva (5 years total, 2 in oak). In Italy, Riserva is applied within individual DOC/DOCG disciplinari rather than a single national rule — for example, Chianti Classico Riserva requires a minimum 24 months of aging (at least 3 months in bottle) versus the standard Chianti Classico's shorter minimum, and Barolo Riserva requires 62 months total versus Barolo's standard 38. Because Reserva/Riserva rules are set per-appellation rather than universally, the exact aging requirement behind the term depends on which region's wine carries it.",
    "citation": "Consejo Regulador DOCa Rioja aging requirements; individual Italian DOC/DOCG disciplinari (Mipaaf); Wine Bible 2e"
  },
  "Reserve": {
    "short": "An English-language term used by many producers worldwide to signal a higher-tier bottling — unlike Spain's Reserva or Italy's Riserva, it typically carries no legally enforced minimum aging or production standard.",
    "full": "\"Reserve\" (as distinct from the legally regulated Spanish Reserva or Italian Riserva) is generally an unregulated marketing term used by wineries and distilleries across many countries — including the US, Australia, and elsewhere — to signal a bottling positioned above their standard release, typically involving longer aging, more selective grape/barrel sourcing, or higher production standards than the producer's base tier. Unlike DOCa Rioja's Reserva or Italy's DOC/DOCG-specific Riserva rules, there is no single legal minimum-aging or minimum-quality requirement attached to \"Reserve\" in most jurisdictions (a small number of specific US AVAs or producer associations have adopted their own internal standards, but these are not universal). Because of this, \"Reserve\" quality and meaning vary substantially by producer, and the term should not be assumed to carry the same guarantee as a legally defined designation like Reserva, Riserva, or DOCG.",
    "citation": "Wine Bible 2e, general terminology notes on unregulated \"Reserve\" labeling in New World wine regions"
  },
  "Limited": {
    "short": "A marketing term (\"Limited\" or \"Limited Edition\") indicating a small, capped production run — not a legally defined quality or origin classification.",
    "full": "\"Limited\" or \"Limited Edition\" is a marketing designation used by wine and spirits producers to indicate a bottling made in a restricted, capped quantity — often tied to a special barrel selection, a single-vineyard parcel, an anniversary release, or an experimental finish (common in whisky, e.g. a limited cask-finish release). It carries no legal minimum-aging, minimum-quality, or geographic-origin requirement in the way DOCG, AOC, or Reserva do, and the size of the \"limited\" run itself is entirely at the producer's discretion and not independently verified or regulated. It signals scarcity and, often, a producer's own view that the release is special, rather than a guarantee comparable to a legally regulated classification.",
    "citation": "General industry usage; no regulatory body governs this term (noted here for accuracy rather than sourced to a specific regulation)"
  },
  "Vintage": {
    "short": "A wine or spirit made from grapes (or, for Champagne/Port, declared) from a single specified harvest year, rather than blended across multiple years.",
    "full": "\"Vintage\" indicates that a wine is made from grapes harvested in a single, stated calendar year, printed on the label — as opposed to a non-vintage (NV) blend combining wine from multiple years, which is the norm for most Champagne and many everyday wines. In Champagne, a \"vintage\" bottling is only produced in years a house declares exceptional (not every year), must be aged a legally required minimum longer than NV Champagne, and represents a small fraction of most houses' total output. Vintage Port similarly is only \"declared\" in years the Instituto dos Vinhos do Douro e do Porto and individual shippers judge outstanding, typically averaging around three declarations per decade, and represents the pinnacle, longest-lived style of Port. For still wines generally, \"vintage\" simply states the harvest year and does not by itself imply a quality tier, though single-vintage wines are the norm for most fine wine outside of NV blending traditions like Champagne.",
    "citation": "Wine Bible 2e, France/Champagne and Portugal/Port chapters; Instituto dos Vinhos do Douro e do Porto (IVDP) vintage declaration records"
  }
}
```

- [ ] **Step 2: Validate it's well-formed and complete**

Run: `python3 -c "
import json
with open('data/designation_descriptions.json') as f:
    data = json.load(f)
DESIGNATIONS = ['Grand Cru','Premier Cru','Cru Classé','DOCG','DOC','IGT','DOP/IGP','AOC','Single Malt','XO','VSOP','VS','Gran Reserva','Crianza','Classico','Superiore','Extra Brut','Brut','Reserva','Reserve','Limited','Vintage']
assert set(data.keys()) == set(DESIGNATIONS), (set(DESIGNATIONS) - set(data.keys()), set(data.keys()) - set(DESIGNATIONS))
for k, v in data.items():
    assert set(v.keys()) == {'short','full','citation'}, k
print('OK:', len(data), 'entries, all keys match DESIGNATIONS')
"`

Expected: `OK: 22 entries, all keys match DESIGNATIONS`

- [ ] **Step 3: Content spot-check (manual, not automated)**

Pick 3 random designations from the 22 (e.g. roll a die or pick non-adjacent ones — suggestion: `DOCG`, `XO`, `Gran Reserva`) and verify the `full` copy's specific factual claims (dates, minimum aging years, counts) against the cited source or a quick independent check. This is the verification gate the spec added — do not skip it. Note the 3 chosen and confirm in the commit message or PR description which were checked.

- [ ] **Step 4: Commit**

```bash
git add data/designation_descriptions.json
git commit -m "feat(catalog): add sourced description copy for all 22 designations"
```

---

### Task 2: Build the data loader

**Files:**
- Create: `apps/catalog/lib/explore/designation-descriptions.server.ts`

- [ ] **Step 1: Write the loader**

```ts
import fs from 'node:fs';
import path from 'node:path';

export interface DesignationDescriptionData {
  short: string;
  full: string;
  citation: string;
}

/**
 * SERVER-ONLY loader for the static designation-description copy. Mirrors
 * map-data.server.ts's convention: read once, cache for the process
 * lifetime, throw loudly on a missing file rather than let every lookup
 * silently resolve to null (which would be indistinguishable from a
 * genuine 0-count case).
 */
function dataPath(): string {
  const candidates = [
    path.join(process.cwd(), 'data', 'designation_descriptions.json'),
    path.join(process.cwd(), '..', '..', 'data', 'designation_descriptions.json'),
    process.env.DESIGNATION_DESCRIPTIONS_PATH ?? '',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('designation_descriptions.json not found');
  return found;
}

let _cache: Record<string, DesignationDescriptionData> | null = null;
export function loadDesignationDescriptions(): Record<string, DesignationDescriptionData> {
  if (_cache) return _cache;
  _cache = JSON.parse(fs.readFileSync(dataPath(), 'utf8')) as Record<string, DesignationDescriptionData>;
  return _cache;
}
```

Note: the two-candidate list above (`data/...` and `../../data/...`, both relative to `process.cwd()`) is the correct, established pattern for a repo-root data file read from `apps/catalog` code — it matches how `catalog-data.ts`, `collections.ts`, `co-purchase.ts`, and `sku-taxonomy.ts` already resolve repo-root `data/` files, since `process.cwd()` is `apps/catalog` both under `npx vitest run` (from that directory) and under the Next dev/build process, and `apps/catalog/data/designation_descriptions.json` does not exist — only repo-root `data/designation_descriptions.json` does. Keep both candidates as written in Step 1; do not drop the `../../` one.

- [ ] **Step 2: Commit**

```bash
git add apps/catalog/lib/explore/designation-descriptions.server.ts
git commit -m "feat(catalog): add cached loader for designation description data"
```

---

### Task 3: Build the lookup with the non-empty guarantee (TDD)

**Files:**
- Create: `apps/catalog/lib/explore/designation-lookup.server.ts`
- Test: `apps/catalog/lib/explore/designation-lookup.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./designation-descriptions.server', () => ({
  loadDesignationDescriptions: vi.fn(),
}));

import { loadDesignationDescriptions } from './designation-descriptions.server';
import { findDesignationDescription } from './designation-lookup.server';

const mockLoad = vi.mocked(loadDesignationDescriptions);

beforeEach(() => {
  mockLoad.mockReset();
  mockLoad.mockReturnValue({
    DOCG: { short: 'short copy', full: 'full copy', citation: 'Wine Bible 2e' },
  });
});

describe('findDesignationDescription', () => {
  it('returns the entry when a designation param, copy, and a positive count all exist', () => {
    const result = findDesignationDescription({ designation: 'DOCG', productCount: 356 });
    expect(result).toEqual({ designation: 'DOCG', description: 'full copy', citation: 'Wine Bible 2e' });
  });

  it('returns null when productCount is 0, even though copy exists (the VS case)', () => {
    const result = findDesignationDescription({ designation: 'DOCG', productCount: 0 });
    expect(result).toBeNull();
  });

  it('returns null when no designation param is given', () => {
    expect(findDesignationDescription({ designation: null, productCount: 356 })).toBeNull();
    expect(findDesignationDescription({ designation: undefined, productCount: 356 })).toBeNull();
    expect(findDesignationDescription({ designation: '', productCount: 356 })).toBeNull();
  });

  it('returns null when no copy entry exists for the given designation', () => {
    const result = findDesignationDescription({ designation: 'Nonexistent Label', productCount: 5 });
    expect(result).toBeNull();
  });

  it('propagates a thrown error from the loader (missing file) rather than swallowing it into null', () => {
    mockLoad.mockImplementation(() => {
      throw new Error('designation_descriptions.json not found');
    });
    expect(() => findDesignationDescription({ designation: 'DOCG', productCount: 356 })).toThrow(
      'designation_descriptions.json not found',
    );
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `cd apps/catalog && npx vitest run lib/explore/designation-lookup.test.ts`
Expected: FAIL — `Cannot find module './designation-lookup.server'`

- [ ] **Step 3: Write the implementation**

```ts
import { loadDesignationDescriptions } from './designation-descriptions.server';

export interface DesignationDescriptionEntry {
  designation: string;
  description: string;
  citation?: string;
}

/**
 * Looks up authored copy for the shop page's designation-description card.
 * Returns null when there's no designation param, no authored copy for it,
 * or (the non-empty guarantee, same rule PR #106 established for tier
 * links) when productCount is 0 — never link/show a card for a filter that
 * would return no results.
 */
export function findDesignationDescription(params: {
  designation?: string | null;
  productCount: number;
}): DesignationDescriptionEntry | null {
  const designation = (params.designation ?? '').trim();
  if (!designation) return null;
  if (params.productCount <= 0) return null;

  const all = loadDesignationDescriptions();
  const entry = all[designation];
  if (!entry) return null;

  return { designation, description: entry.full, citation: entry.citation };
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `cd apps/catalog && npx vitest run lib/explore/designation-lookup.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/explore/designation-lookup.server.ts apps/catalog/lib/explore/designation-lookup.test.ts
git commit -m "feat(catalog): add findDesignationDescription with 0-count suppression"
```

---

### Task 4: Build the card component (TDD)

**Files:**
- Create: `apps/catalog/components/shop/DesignationDescriptionCard.tsx`
- Test: `apps/catalog/components/shop/__tests__/DesignationDescriptionCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignationDescriptionCard } from '@/components/shop/DesignationDescriptionCard';
import type { DesignationDescriptionEntry } from '@/lib/explore/designation-lookup.server';

const shortEntry: DesignationDescriptionEntry = {
  designation: 'DOCG',
  description: 'Sentence one. Sentence two.',
  citation: 'Wine Bible 2e',
};

const longEntry: DesignationDescriptionEntry = {
  designation: 'XO',
  description: 'One. Two. Three. Four. Five.',
  citation: 'BNIC',
};

describe('DesignationDescriptionCard', () => {
  it('renders the designation name in the header', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.getByText('DOCG')).toBeInTheDocument();
    expect(screen.getByText(/Classification/)).toBeInTheDocument();
  });

  it('renders short copy fully with no Read more toggle (3 or fewer sentences)', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.getByText('Sentence one.')).toBeInTheDocument();
    expect(screen.getByText('Sentence two.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /read more/i })).not.toBeInTheDocument();
  });

  it('collapses long copy behind a Read more toggle', () => {
    render(<DesignationDescriptionCard entry={longEntry} />);
    expect(screen.getByText('One.')).toBeInTheDocument();
    expect(screen.queryByText('Five.')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /read more/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not render a citation footer (matches RegionDescriptionCard)', () => {
    render(<DesignationDescriptionCard entry={shortEntry} />);
    expect(screen.queryByText('Wine Bible 2e')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `cd apps/catalog && npx vitest run components/shop/__tests__/DesignationDescriptionCard.test.tsx`
Expected: FAIL — `Cannot find module '@/components/shop/DesignationDescriptionCard'`

- [ ] **Step 3: Write the implementation**

```tsx
'use client';
import { useId, useState } from 'react';
import { splitSentences } from '@/lib/explore/split-sentences';
import type { DesignationDescriptionEntry } from '@/lib/explore/designation-lookup.server';

const COLLAPSED_SENTENCE_COUNT = 3;

/**
 * Sommelier-authored designation/classification copy on the shop page,
 * shown once a shopper filters by ?designation=X and that designation has
 * a non-empty live count (enforced by findDesignationDescription, not
 * here). Structurally mirrors RegionDescriptionCard but drops the
 * KnowledgeSection block (region-specific) and the citation footer
 * (RegionDescriptionCard doesn't render one either — kept consistent).
 */
export function DesignationDescriptionCard({ entry }: { entry: DesignationDescriptionEntry }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const sentences = splitSentences(entry.description);
  const isLong = sentences.length > COLLAPSED_SENTENCE_COUNT;
  const visibleSentences = isLong && !expanded ? sentences.slice(0, COLLAPSED_SENTENCE_COUNT) : sentences;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Classification</div>
        <h2 className="text-lg font-semibold text-foreground sm:text-xl">{entry.designation}</h2>
      </div>

      <div>
        <div id={panelId} className="flex flex-col gap-1.5 text-sm leading-relaxed text-foreground sm:text-base">
          {visibleSentences.map((sentence, i) => (
            <p key={i}>{sentence}</p>
          ))}
        </div>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {expanded ? 'Read less' : 'Read more'}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `cd apps/catalog && npx vitest run components/shop/__tests__/DesignationDescriptionCard.test.tsx`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/components/shop/DesignationDescriptionCard.tsx apps/catalog/components/shop/__tests__/DesignationDescriptionCard.test.tsx
git commit -m "feat(catalog): add DesignationDescriptionCard component"
```

---

### Task 5: Wire the card into the shop page

**Files:**
- Modify: `apps/catalog/app/shop/page.tsx`

- [ ] **Step 1: Add the imports**

Near the existing `RegionDescriptionCard`/`findRegionDescription` imports (around line 19-21):

```tsx
import { DesignationDescriptionCard } from '@/components/shop/DesignationDescriptionCard';
import { findDesignationDescription } from '@/lib/explore/designation-lookup.server';
```

- [ ] **Step 2: Add the wiring**

Immediately after the existing region-description block (around line 219-224 in the current file):

```tsx
{(() => {
  const regionEntry = findRegionDescription({
    region: currentParams.region,
    subregion: currentParams.subregion,
  });
  return regionEntry ? <RegionDescriptionCard entry={regionEntry} /> : null;
})()}

{/* Designation/classification copy — shown only once a shopper filters by
    ?designation=X AND that designation currently has live product results
    (facets.designations already excludes 0-count values and is computed
    with every OTHER active filter applied, so it reflects the count this
    exact card's link would resolve to). */}
{(() => {
  const count = facets.designations.find((d) => d.value === currentParams.designation)?.count ?? 0;
  const designationEntry = findDesignationDescription({
    designation: currentParams.designation,
    productCount: count,
  });
  return designationEntry ? <DesignationDescriptionCard entry={designationEntry} /> : null;
})()}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/app/shop/page.tsx
git commit -m "feat(catalog): show DesignationDescriptionCard on the shop page"
```

---

### Task 6: Add the DESIGNATIONS-completeness guard test

**Files:**
- Modify: `apps/catalog/lib/designation.test.ts`

- [ ] **Step 1: Add the test**

Append to the existing `describe('designationForProduct', ...)` block, or add a new top-level `describe`:

```ts
import fs from 'node:fs';
import path from 'node:path';

describe('designation description data completeness', () => {
  it('every DESIGNATIONS label has a matching entry in designation_descriptions.json', () => {
    const dataPath = path.join(process.cwd(), '..', '..', 'data', 'designation_descriptions.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    for (const label of DESIGNATIONS) {
      expect(data).toHaveProperty(label);
    }
  });
});
```

Note: confirm the relative path from `apps/catalog` to repo-root `data/` resolves correctly when Vitest runs (`process.cwd()` during `vitest run` from `apps/catalog` is `apps/catalog`, so `../../data/designation_descriptions.json` should land on repo-root `data/`) — adjust the `path.join` if the actual vitest working directory differs; verify with a quick `console.log(process.cwd())` during a local run if the test fails on path resolution before assuming the assertion itself is wrong.

- [ ] **Step 2: Run and verify it passes**

Run: `cd apps/catalog && npx vitest run lib/designation.test.ts`
Expected: PASS, all existing tests plus the new one

- [ ] **Step 3: Commit**

```bash
git add apps/catalog/lib/designation.test.ts
git commit -m "test(catalog): guard that every DESIGNATIONS label has description copy"
```

---

### Task 7: Full test suite + browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full catalog test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all tests pass, including the 5 + 4 + 1 new tests from Tasks 3, 4, 6

- [ ] **Step 2: Start the dev server**

Run: `cd apps/catalog && npm run dev` (background — repo convention is port 3100, confirm from `package.json`/`project_catalog_dev_port` memory if it differs)

- [ ] **Step 3: Curl a designation with live results (Rule 7 — no interactive browser tool in this environment)**

Run: `curl -s "http://localhost:3100/shop?designation=DOCG" | grep -A5 "Classification"`
Expected: the rendered HTML includes the DOCG description card's header and opening sentence text.

- [ ] **Step 4: Curl a designation with 0 live results — confirm the card is absent**

Run: `curl -s "http://localhost:3100/shop?designation=VS" | grep -c "Very Special.*Cognac age grade"`
Expected: `0` — the card must NOT render for `VS` since it has 0 live products today.

- [ ] **Step 5: Stop the dev server, report results to the user**

Include in the report: which 2 curl checks were run, their pass/fail, and a reminder that a full visual check (spacing, Read more/less interaction) still needs a human or screenshot pass since this environment has no interactive browser — same limitation noted for PR #104-#106.

---

## Explicitly out of scope reminders (do not do these even if convenient)

- Do not modify `apps/catalog/components/explore/KnowledgeSection.tsx` or its `TIER_TO_DESIGNATION` map — verified complete during brainstorming.
- Do not modify `apps/catalog/lib/designation.ts`'s regex patterns or run any backfill script.
- Do not add a citation footer to `RegionDescriptionCard.tsx`.
- Do not add designation display to the product detail page (`apps/catalog/app/product/`).
