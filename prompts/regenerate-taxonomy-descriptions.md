# Prompt: Regenerate Taxonomy Descriptions

Use this prompt with Claude or another AI to rewrite all taxonomy descriptions with proper wine/spirits knowledge. Run once per entity type.

---

## How to Use

1. Export the current description CSV for the entity type you want to fix
2. Send this prompt + the CSV to Claude
3. Claude rewrites every entry with researched content
4. Save the output back to the CSV file

---

## Prompt Template

Copy everything below the line and send it to Claude (or another AI agent):

---

You are a wine and spirits expert writing taxonomy descriptions for a premium online wine/spirits retailer (Wine-Now and LIQ9) based in Thailand, selling imported products.

I will give you a CSV with taxonomy entries that need descriptions rewritten. The current descriptions were auto-generated from catalog patterns and are mostly wrong — they use template fill-in instead of real knowledge.

**Your task:** Rewrite `description_short_en` and `description_full_en` for every entry using your expert knowledge of wine, spirits, beer, and sake regions/classifications/brands.

### Rules:

1. **description_short_en** (1-2 sentences, max 150 chars):
   - State what this entity IS in the wine/spirits world
   - For regions: mention the country, key grape varieties or spirit types, and what makes it notable
   - For classifications: what kind of product this represents
   - For brands: the brand's identity and what they're known for
   - NO catalog-speak like "core origin in the WNLQ9 catalog" or "represented most strongly through"
   - Write as if for a consumer browsing a wine shop

2. **description_full_en** (5-8 sentences, max 1000 chars):
   - Expand on the short description with rich expert context (this acts as a knowledge base for downstream product description generation).
   - For wine regions: terroir, climate, signature styles, notable appellations
   - For spirit regions: production traditions, signature expressions
   - For classifications: what defines this category, quality expectations
   - For brands: history, production philosophy, signature products, and reputation.
   - **Copywriting Constraint:** Make the first sentence a strong value proposition or statement of prestige (social proof). Dedicate the final sentence strictly to the sensory profile (what it tastes/feels like) to drive consumer craving.
   - Professional but accessible tone — informative, not academic
   - NO template phrases like "appears in the assortment" or "merchandising perspective"

3. **Keep these fields unchanged:** entity_type, entity_name, parent_country, parent_region, parent_subregion, classification_scope, product_count, segments_seen, source_basis, notes

4. **Update copy_status to:** `expert_reviewed`

### Examples of GOOD descriptions:

**Country: France**
- Short: "France is the world's most celebrated wine-producing country, home to Bordeaux, Burgundy, Champagne, and the Rhône Valley."
- Full: "France defines the standards of winemaking worldwide. Its diverse terroirs produce everything from the structured Cabernet blends of Bordeaux to the elegant Pinot Noirs of Burgundy and the iconic sparkling wines of Champagne. France is also the origin of Cognac and Armagnac brandies. The appellation system (AOC) guarantees regional authenticity and quality."

**Region: Bordeaux (France)**
- Short: "Bordeaux is France's largest fine wine region, renowned for age-worthy Cabernet Sauvignon and Merlot blends from the Left and Right Banks."
- Full: "Located in southwest France along the Gironde estuary, Bordeaux produces some of the world's most sought-after wines. The Left Bank (Médoc, Graves) is known for Cabernet Sauvignon-dominant blends with firm tannins, while the Right Bank (Saint-Émilion, Pomerol) favors Merlot-based wines of richness and elegance. The 1855 Classification established the region's hierarchy of estates."

**Classification: Single Malt Whisky**
- Short: "Single malt whisky is produced at a single distillery from 100% malted barley, typically aged in oak casks for a minimum of three years."
- Full: "Single malt whisky represents the pinnacle of Scotch whisky craftsmanship. Each distillery develops a unique house style influenced by water source, barley, yeast, still shape, and maturation casks. Scotland's main whisky regions — Speyside, Highland, Islay, Lowland, and Campbeltown — each contribute distinct flavor profiles, from the delicate floral notes of Speyside to the peaty intensity of Islay."

**Brand: Penfolds (Australia)**
- Short: "Australia's most iconic wine producer, Penfolds is celebrated globally for its historic multi-regional blends and the legendary Grange."
- Full: "Considered the pinnacle of Australian winemaking, Penfolds commands an unrivaled reputation among wine collectors worldwide. Founded in 1844 in Adelaide, the estate defined the modern era of Australian wine by championing a multi-regional blending philosophy to achieve a perfectly consistent house style, rather than focusing strictly on single vineyards. Their portfolio spans from the highly accessible Koonunga Hill to the globally celebrated Bin series, culminating in their flagship Grange. With a masterful approach to oak maturation, Penfolds consistently delivers a heavy-hitting signature profile of rich dark fruits, dense chocolate, and warm baking spices."

### Now rewrite this CSV:

```csv
[PASTE THE CSV CONTENT HERE]
```

Return the complete CSV with updated description_short_en, description_full_en, and copy_status fields. Keep all other fields exactly as they are.

---

## Running Order

Run the prompt for each entity type in this order:

1. **Countries** — `data/country_description_library.csv` (71 entries)
2. **Regions** — `data/region_description_library.csv` (304 entries — may need to split into batches of 50)
3. **Subregions** — `data/subregion_description_library.csv` (191 entries)
4. **Classifications** — `data/classification_description_library.csv` (30 entries)
5. **Brands** — `data/brand_description_library.csv` (3,126 entries — split into batches of 100)
6. **Origins/Appellations** — `data/origin_description_library.csv` (553 entries — split into batches of 100)

### Tips:
- For large files (brands, origins), split into batches of 50-100 rows
- After each batch, save the output and verify a few entries manually
- The taxonomy manager at http://localhost:3000 will show updated descriptions immediately after you save the CSV
- For brands with < 3 products, a shorter description is fine

### After regeneration:
The taxonomy manager page loads descriptions from these CSVs automatically. No code changes needed — just save the updated CSV and refresh.
