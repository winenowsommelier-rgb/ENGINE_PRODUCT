# WN/LIQ9 Sommelier AI — Knowledge Base

This folder contains the product database files for use with Claude Projects, ChatGPT Projects, and Gemini NotebookLM.
The AI reads these files to answer tasting note, recommendation, and catalog queries with real product data.

---

## Files in this folder

| File | Size | Contents |
|------|------|----------|
| `system_prompt.md` | ~3KB | **Start here.** Paste as system prompt / first message. |
| `product_index.md` | ~1.3MB | Full product index — all 11,436 SKUs, one row each. Attach always. |
| `product_index_compact.tsv` | ~1.2MB | Compact TSV version of the index. Use for tight-context tools. |
| `products_wines_red_france.json` | ~2.5MB | French red wines (1,226 products) |
| `products_wines_red_italy.json` | ~2.0MB | Italian red wines (1,086 products) |
| `products_wines_red_world.json` | ~3.3MB | All other red wines (1,810 products) |
| `products_wines_white_france.json` | ~0.7MB | French white wines (412 products) |
| `products_wines_white_world.json` | ~1.9MB | All other white wines (1,171 products) |
| `products_wines_sparkling.json` | ~1.7MB | Champagne + Sparkling wines (898 products) |
| `products_wines_rose.json` | ~0.1MB | Rosé + Orange wines (192 products) |
| `products_wines_other.json` | ~1.4MB | Dessert, Port, Fruit, Wine products (1,611 products) |
| `products_spirits_whisky.json` | ~1.4MB | Whisky + Whiskey (629 products) |
| `products_spirits_gin_vodka.json` | ~0.5MB | Gin, Vodka, White Spirits (379 products) |
| `products_spirits_rum_tequila.json` | ~0.3MB | Rum, Tequila, Mezcal, Cachaça (261 products) |
| `products_spirits_brandy_liqueur.json` | ~0.7MB | Brandy, Cognac, Liqueur, Absinthe (489 products) |
| `products_sake_shochu.json` | ~0.9MB | Sake, Shochu, Umeshu (432 products) |
| `products_beer.json` | ~0.1MB | Beer (210 products) |
| `products_non_alcoholic.json` | ~0.04MB | Non-alcoholic (63 products) |
| `products_other_products.json` | ~0.3MB | Cigars, Glassware, Accessories (567 products) |
| `update_schema.md` | ~3KB | JSON patch format reference for applying AI suggestions |

---

## Setup by platform

### Claude Projects (recommended)

1. Create a new Project in Claude.ai
2. In **Project Instructions**, paste the full content of `system_prompt.md`
3. Upload files to the project:
   - Always upload: `product_index.md`
   - Upload all category JSON files you want the AI to access
   - Claude Projects supports up to ~20MB per file and ~200MB total
4. Start chatting — the AI will search the index and pull detail automatically

### ChatGPT Projects

1. Create a new Project in ChatGPT
2. In the **Custom Instructions** field, paste `system_prompt.md` content
3. Upload files via the paperclip / file attachment in the project
4. Same file set as Claude Projects above

### Gemini NotebookLM

NotebookLM has a lower per-source limit (~500KB recommended per source).

**Recommended approach:**
1. Upload `system_prompt.md` as a source
2. Upload `product_index_compact.tsv` as the index (smaller than the .md version)
3. Upload individual category JSON files as separate sources — start with the categories most relevant to your queries
4. For red wines, upload France + Italy separately rather than the combined world file

---

## Which files to attach for which query type

| Query type | Must attach | Optional |
|------------|-------------|----------|
| French red wine recommendation | `product_index.md` + `products_wines_red_france.json` | `products_wines_red_italy.json` |
| Italian wine pairing | `product_index.md` + `products_wines_red_italy.json` | `products_wines_white_world.json` |
| Whisky gift recommendation | `product_index.md` + `products_spirits_whisky.json` | — |
| Champagne selection | `product_index.md` + `products_wines_sparkling.json` | — |
| Sake pairing | `product_index.md` + `products_sake_shochu.json` | — |
| General recommendation across all categories | `product_index.md` + all relevant category files | — |
| Catalog gap analysis (admin) | `product_index.md` + category files for the target range | — |

**Rule of thumb:** Always attach the index. Then attach whichever category file covers the question.

---

## How the update loop works

At the end of every AI reply you will see:

```
## 📋 Suggested Updates
> Admin: review these suggestions and reply "apply updates" to confirm, or "skip" to ignore.
[JSON patch block]
```

1. **Read the suggestions** — the AI explains what it found and why
2. **Reply "apply updates"** to confirm, or "skip" to ignore
3. **Export the confirmed patches** — copy the JSON blocks you approved into a file
4. **Apply to the database** — use the batch import script (see `update_schema.md`) or apply manually via the admin panel

This keeps your product database improving with every conversation.

---

## Keeping files up to date

These files are exported from `data/live_products_export.json`. To regenerate them after a database update:

```bash
cd /path/to/ENGINE_PRODUCT
python3 scripts/export_ai_knowledge_base.py
```

(Script to be created — regenerates all files in this folder from the live export.)

Recommended cadence: regenerate weekly, or after any bulk enrichment run.
