# Region/Subregion Taxonomy Copy — Completion Brief

## Why this exists
117 of the 184 regions currently pinned on the WNLQ9 explore-map / shop pages have
NO authored description — they render with just a name and product count, no
sommelier copy. Only 67 regions (+ 59 subregions, + 23 countries) currently have
copy in `data/taxonomy.db`. This brief scopes writing the missing 117+.

## Format required (matches the existing pipeline exactly — do not invent a new shape)

Each entity needs a row in `taxonomy_contexts` (scope_id='wine') with:

| Field | Type | Notes |
|---|---|---|
| `description_short` | string, ~180–260 chars | One or two sentences: the region's identity in a nutshell. Shown as a teaser. |
| `description_en` ("full") | string, ~800–1,600 chars | 3–6 sentences of real substance: geography, climate, soil, dominant styles/grapes, what makes it distinct, one or two benchmark producers/appellations if relevant. This is the text that now renders in full (with "Read more" expand) on the shop page and explore-map drawer. |
| `attributes` | JSON object, string/array values | Freeform but consistent keys where they apply: `key_grapes` (array), `climate`, `classification_system`, `structure`, `primarily`. Omit keys that don't apply — don't force a template. |
| `source_citation` | string | e.g. `"Wine Bible 2e, France/Bordeaux"` — must be a real, checkable source. No fabricated claims (see "Sourcing rule" below). |

### Worked example (Bordeaux, already in the DB — use as the quality bar)

- **short**: "France's largest AOC and its benchmark red region: maritime-climate, blend-based Left Bank (gravel, cabernet-driven) vs Right Bank (clay/limestone, merlot-driven), organised around the château system and the 1855 Classification."
- **full**: "Bordeaux is the largest Appellation d'Origine Contrôlée in France and one of the largest fine-wine regions in the world (~290,350 acres across some sixty appellations), lying along the Gironde Estuary... [continues for ~1,500 chars covering climate, Left/Right Bank split, château system, classification, style]"
- **attributes**: `{"key_grapes": ["merlot","cabernet-sauvignon","cabernet-franc","sauvignon-blanc","semillon"], "climate": "maritime (Atlantic + Gulf Stream + Landes forests, temperate)", "classification_system": "1855 Classification (Médoc/Sauternes) plus separate Graves and St.-Émilion systems; Pomerol unclassified", "structure": "Left Bank (Médoc/Graves, gravel, cabernet-dominant) vs Right Bank (St.-Émilion/Pomerol, clay-limestone, merlot-dominant)", "primarily": "red (nearly 90% of production); wines are almost always blends"}`
- **citation**: "Wine Bible 2e, France/Bordeaux"

## Scope — prioritize by category, then by product count

The catalog is broad (wine, whisky, spirits, sake/shochu, liqueur, beer/RTD) but
**wine dominates by volume (7,109 of ~8,700 mapped products) and should be
written first**, followed by whisky/spirits regions, then sake, then the long
tail. Do NOT try to cover every category with equal depth in one pass — draft
in this order:

1. **Wine regions with real product weight, no copy yet** (top of the list —
   examples pulled from the current gap: Pomerol, Chianti, Barbaresco, Langhe,
   Soave, Franken, Bolgheri, Loire Valley, Rioja Alavesa, Prosecco, Asti,
   Valpolicella, Kremstal, Alentejo, La Mancha, Etna, Nero d'Avola)
2. **Whisky/spirits regions with real product weight** (Highland, Islay,
   Lowland, Cognac, Kentucky, Jalisco — several of these are big, well-known,
   easy to source well)
3. **Sake prefectures / everything else** — lower priority, smaller volume,
   but still "in scope" per the standing rule.

**117 regions total are missing copy.** Top 40 by product count (pulled
2026-08-06 — re-run the query below before starting in case the map has
changed since):

```
  148  Highland (Scotland) — Whisky, Liqueur, Spirits
  146  Cognac (France) — Spirits, Liqueur, Whisky
  136  Jalisco (Mexico) — Spirits
  132  Prosecco (Italy) — Wine, Spirits
  107  Saint-Émilion (France) — Wine
  104  Pauillac (France) — Wine
   84  Hyogo (Japan) — Sake & Asian, Wine, Spirits, Liqueur, Whisky
   78  Chianti (Italy) — Wine
   77  Margaux (France) — Wine
   76  Loire Valley (France) — Wine, Liqueur
   72  Chablis (France) — Wine
   69  Pomerol (France) — Wine
   69  Western Cape (South Africa) — Wine
   69  Montepulciano d'Abruzzo (Italy) — Wine
   66  Bolgheri (Italy) — Wine, Spirits
   66  Trentino-Alto Adige (Italy) — Wine, Spirits
   65  Kumamoto (Japan) — Sake & Asian, Spirits
   64  Médoc (France) — Wine
   60  Beaujolais (France) — Wine
   59  Islay (Scotland) — Whisky, Spirits
   59  Gevrey-Chambertin (France) — Wine, Spirits
   57  Kentucky (USA) — Whisky, Spirits
   55  Emilia-Romagna (Italy) — Wine, Spirits, Liqueur
   47  Umbria (Italy) — Wine
   47  Lombardy (Italy) — Beer & RTD, Wine, Liqueur, Spirits
   45  La Mancha (Spain) — Wine
   45  Montalcino (Italy) — Wine
   43  Asti (Italy) — Wine, Spirits, Liqueur
   42  Etna (Italy) — Wine
   42  Barbaresco (Italy) — Wine
   41  Kyoto (Japan) — Liqueur, Sake & Asian, Spirits, Whisky
   39  Pessac-Léognan (France) — Wine
   39  Curico Valley (Chile) — Wine
   38  Saint-Estèphe (France) — Wine
   36  Côte de Nuits (France) — Wine
   35  Oaxaca (Mexico) — Spirits
   34  Les Baux-de-Provence (France) — Wine
   34  Graves (France) — Wine
   31  Pays d'Oc (France) — Wine
   31  Saint-Julien (France) — Wine
   ... (77 more, smaller volume — re-run the query for the full tail)
```

Re-run this to refresh the list (counts shift as stock changes) or to see all
117:

```python
import json
data = json.load(open('apps/catalog/data/explore-map-data.json'))
missing = [(r['name'], r['country'], r.get('total', 0), list(r.get('countsByGroup', {}).keys()))
           for r in data['regions'] if not r.get('description')]
missing.sort(key=lambda x: -x[2])
for name, country, total, groups in missing:
    print(f"{total:>5}  {name} ({country}) — {', '.join(groups)}")
```

## Sourcing rule — non-negotiable (project standing rule, see CLAUDE.md + memory)

**No inferred item-level or region-level claims without a real, checkable
source.** This project has already been burned by fabricated/inferred
descriptions once (see `feedback_no_inferred_item_level_data` memory — 70
rows had to be quarantined after AI-inferred sensory claims went in without
sourcing). For region/subregion copy specifically:

- Every entry MUST cite a real source in `source_citation` (Wine Bible, a
  named producer/appellation body's official material, OEC/CIVB-style
  regulatory bodies, etc.) — not "general knowledge" or an unstated LLM prior.
- Geography/climate/soil/classification-system FACTS are fine to state
  plainly (these are stable, well-documented, low-risk).
- Avoid manufacturing SPECIFIC tasting-note or quality claims about the
  region that aren't attributable to the cited source.
- If a subregion is genuinely obscure and no reliable source exists, it's
  fine to leave it uncovered rather than inventing plausible-sounding copy —
  this mirrors the "leave PENDING otherwise" rule already in force for
  item-level enrichment.

## Delivery format

Write the batch as a JSON file matching `data/taxonomy_descriptions_export.json`'s
existing shape (so it merges into the taxonomy.db import path already built),
OR as direct rows for `taxonomy_contexts` if going straight to SQLite — either
is fine as long as it's `scope_id='wine'`. **Do not write directly to
`apps/catalog/data/explore-map-data.json`** — that file is a generated build
artifact (gitignored, regenerated by `apps/catalog/scripts/gen-explore-map-data.mjs`
at every prebuild); copy belongs in `taxonomy.db` / its JSON export, upstream
of the generator.

## After writing the copy

1. Re-run `scripts/export_taxonomy_knowledge.py` to refresh
   `data/taxonomy_descriptions_export.json` from the DB.
2. Re-run `node apps/catalog/scripts/gen-explore-map-data.mjs` from
   `apps/catalog` to rebuild `explore-map-data.json`.
3. Spot check 3–5 regions in both `/explore-map/[region]` and
   `/shop?region=X` in a browser to confirm the new copy renders (Rule 7).
4. Re-run the "missing" query above — confirm the count dropped by the
   number of entries actually written.
