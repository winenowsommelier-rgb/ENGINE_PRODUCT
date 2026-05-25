# Taste Taxonomy v2 — Design Spec

**Date:** 2026-05-25
**Status:** Draft for implementation planning
**Related work:** [`2026-05-21-local-first-sqlite-enrichment.md`](../plans/2026-05-21-local-first-sqlite-enrichment.md)

---

## Goal

Replace the current placeholder `flavor_profile` + flat `flavor_tags` model with a **tiered, controlled-vocabulary taste taxonomy** that powers:

1. A polished **3-ring taste wheel** on every wine/spirit product page (and an intensity-grouped chip card for beer/liqueur/RTD)
2. **Color-coded segmented gauges** for structural axes (body / acidity / tannin / sweetness)
3. Three AI-enabled features: **"More like this" rail**, **click-a-note discovery**, **smarter food pairing**

The taste data also becomes the foundation of an internal product-intelligence library — future pairing, recommendations, and cross-category exploration consume the same schema.

## Non-goals (deferred to phase 2+)

- Personalized recommendations based on user history (needs user-history infra)
- Curated tasting flights / progressions (needs editorial pipeline)
- Algorithmic cross-category bridge recommendations (cross-category surfaces only via user-initiated click-a-note discovery)
- Bespoke per-category micro-visuals for weak-fits (Strategy C from brainstorm — chip cards in v1)
- 4-axis radar comparison view (good for a future "compare two wines" tool)

## Background

The current state, verified during brainstorming:

- **11,436 products** in the master catalog
- **10,380 enriched** with description + region data (last run 7 weeks ago — no active enrichment in flight)
- **0 products with real taste data** — the existing `flavor_profile` field (on 4,333 products) holds an identical placeholder array (`["Green Apple","Apple","Pear",...]`) and `character_traits` is also constant (`["fruit","spice","herbal"]`)

So this design is the **first real taste enrichment**, not a migration. There's no v1 taste data to preserve.

The existing enrichment pipeline (`data/lib/enrichment/wine/`) serves every classification through one path despite the wine-named directory — Brandy, Whisky, Tequila, Cigar, Champagne all produce the same `result` schema. This becomes the home for the evolved prompt.

## Architecture — three concentric layers

| Layer | What | Rate of change |
|---|---|---|
| **L1 — Taxonomy & data contract** | Controlled vocabulary YAML (~300 notes) + `taste_profile` JSONB schema on `products` | Releases (rarely) |
| **L2 — Enrichment pipeline** | Evolved single prompt that branches by classification; validator enforces vocab; writes via existing local-first SQLite plan | Iterations (weekly) |
| **L3 — UI + AI consumers** | React components (wheel, chip card, gauges, note); similarity pre-compute; click-a-note nav; pairing v2 | Iterations (daily) |

Layers communicate only through the `taste_profile` shape. UI changes don't require re-enrichment; vocab expansions don't require frontend deploys.

---

## Layer 1 — Data model

### `taste_profile` JSONB column on `products`

One field, two shapes, discriminated by `structure`. UI dispatches on the discriminator — no nullable tier-fields to handle.

**Tiered shape** (Wine + Brown Spirits + White Spirits):

```json
{
  "schema_version": "2.0",
  "structure": "tiered",
  "tiers": {
    "primary":   [{"note": "Blackcurrant", "intensity": 3}, {"note": "Dark Plum", "intensity": 2}, {"note": "Violet", "intensity": 1}],
    "secondary": [{"note": "Cedar", "intensity": 3}, {"note": "Vanilla", "intensity": 2}],
    "tertiary":  [{"note": "Tobacco", "intensity": 2}, {"note": "Leather", "intensity": 1}]
  },
  "structural": {
    "body": "Full",
    "acidity": "Medium-High",
    "tannin": "High",
    "sweetness": "Dry"
  },
  "confidence": 0.78,
  "prompt_version": "2.0.0",
  "enriched_at": "2026-05-25T10:30:00Z"
}
```

**Flat shape** (Beer + Liqueur + RTD):

```json
{
  "schema_version": "2.0",
  "structure": "flat",
  "flat_tags": [
    {"note": "Citrus Hops", "intensity": 3},
    {"note": "Pine", "intensity": 3},
    {"note": "Bitter", "intensity": 2},
    {"note": "Malt Biscuit", "intensity": 2},
    {"note": "Tropical", "intensity": 1}
  ],
  "structural": {
    "body": "Medium",
    "bitterness": "High",
    "sweetness": "Low",
    "carbonation": "Medium"
  },
  "confidence": 0.72,
  "prompt_version": "2.0.0",
  "enriched_at": "2026-05-25T10:30:00Z"
}
```

**Intensity scale:** 1 = subtle, 2 = supporting, 3 = dominant. Notes within a tier are stored intensity-descending (auto-sorted by validator).

**`structural` axes per category family:**
- Wine / Brown Spirits / White Spirits: `body`, `acidity`, `tannin`, `sweetness`
- Beer: `body`, `bitterness`, `sweetness`, `carbonation`
- Liqueur: `body`, `sweetness`, `intensity` (alcoholic burn)
- RTD: `body`, `sweetness`, `intensity`

Each axis is ordinal with exactly 4 levels (e.g. `Light | Medium | Medium-Full | Full`). 4-level scale chosen because it's what the existing `data/lib/enrichment/wine/taxonomies.py` already encodes — preserves existing data structure.

### Classifications that are **out of scope** (no `taste_profile`)

`Cigar`, `Mineral Water`, `Non-Alcoholic`, `Accessories`, `Glassware`, `Events`, `Others` — `<TasteProfileSection>` renders nothing for these.

### Controlled vocabulary: `data/lib/enrichment/shared/taste_vocab.yml`

Without a canonical note registry, the AI generates "blackcurrant" / "black currant" / "cassis" / "blackcurrants" as four separate strings and similarity scoring breaks. ~300 notes seeded from UC Davis Wine Aroma Wheel + WSET Systematic Approach lexicon + spirit-specific additions.

```yaml
notes:
  - name: Blackcurrant
    default_tier: primary
    family: fruit.black
    aliases: [black currant, cassis, blackcurrants]
    applies_to: [wine, brown_spirit]

  - name: Cedar
    default_tier: secondary
    family: wood
    aliases: [cedarwood]
    applies_to: [wine, brown_spirit]

  - name: Tobacco
    default_tier: tertiary
    family: earth.aged
    aliases: [tobacco leaf, cigar]
    applies_to: [wine, brown_spirit]

  - name: Citrus Hops
    default_tier: primary
    family: hops
    aliases: [hoppy citrus, citra, hop citrus]
    applies_to: [beer]
```

| Field | Purpose |
|---|---|
| `name` | Canonical display string. Always used in UI + DB. |
| `default_tier` | Hint to AI; can be overridden per product (a young oak-driven wine might place Tobacco in secondary instead of tertiary). |
| `family` | Hierarchical group (e.g. `fruit.black`, `wood`, `earth.aged`). Powers similarity weighting — same-family matches score higher than no match. |
| `aliases` | Variant spellings; validator fuzzy-repairs incoming AI output. |
| `applies_to` | Which category families this note is valid for. Prompt embeds only the relevant subset to focus the AI and reduce hallucination. |

**Seed strategy:** Bootstrap from UC Davis Wine Aroma Wheel (~120 wine notes) + WSET Lexicon (~80 additions) + WSET Spirits Approach (~50 spirit notes) + brewing-style hop/malt/yeast notes (~50). Grow incrementally as the validator's "unknown note" log surfaces gaps. **Vocab is data (YAML), not code** — expansion does not require a deploy.

### Storage strategy — hybrid JSON + denormalized index

```sql
-- Source of truth: single JSONB column for full taste_profile
ALTER TABLE products ADD COLUMN taste_profile JSONB;

-- Denormalized for query (similarity scoring, click-a-note discovery)
CREATE TABLE product_taste_notes (
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  note           TEXT NOT NULL,           -- canonical name, e.g. "Blackcurrant"
  tier           TEXT NOT NULL,           -- "primary" | "secondary" | "tertiary" | "flat"
  intensity      SMALLINT NOT NULL CHECK (intensity BETWEEN 1 AND 3),
  note_family    TEXT NOT NULL,           -- copied from vocab at write time
  PRIMARY KEY (product_id, note, tier)
);
CREATE INDEX idx_ptn_note   ON product_taste_notes (note, tier);
CREATE INDEX idx_ptn_family ON product_taste_notes (note_family);

-- Pre-computed similarity (powers "More like this" rail)
CREATE TABLE product_similar (
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  similar_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  score          NUMERIC(4,3) NOT NULL,   -- 0.000 to 1.000
  matching_notes JSONB,                   -- {primary:[...], secondary:[...], ...} for "why similar" badge
  computed_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, similar_id)
);
CREATE INDEX idx_ps_product_score ON product_similar (product_id, score DESC);
```

`product_taste_notes` is **regenerated on every `taste_profile` write** (the enrichment writer does a `DELETE WHERE product_id = ? + INSERT` of the new note rows in the same transaction).

The existing placeholder columns `flavor_profile` and `character_traits` are dropped in the same migration (they're all the same dummy values).

Mirror these tables in the local SQLite store per the in-flight local-first plan; existing `sync_to_supabase.py` learns to push the new tables and column.

---

## Layer 2 — Enrichment pipeline

### Single CLI, evolved prompt

The user already plans to re-enrich the catalog. Rather than introduce a separate `enrich_taste.py` with a `--taste-only` mode, we evolve the existing `data/enrich_wines.py` and its prompt to include the new taste fields in its output schema. One pass per product produces both description and taste data.

### File changes

| Path | Action | Purpose |
|---|---|---|
| `data/lib/enrichment/shared/taste_vocab.yml` | **NEW** | Controlled vocabulary (~300 notes). |
| `data/lib/enrichment/shared/vocab_loader.py` | **NEW** | Parses YAML; builds alias reverse-map for O(1) lookup; exposes `lookup(name) → CanonicalNote \| None`. |
| `data/lib/enrichment/wine/schemas.py` | **NEW** | `TypedDict` definitions for `TasteProfile` (tiered + flat variants). |
| `data/lib/enrichment/wine/prompt.py` | **MODIFY** | Output schema includes `taste_profile`. New helper `_taste_section(classification)` injects category-specific tier definitions and vocab subset. |
| `data/lib/enrichment/wine/validator.py` | **MODIFY** | Adds vocab + tier + intensity rule checks (existing structural validation kept). |
| `data/lib/enrichment/wine/taxonomies.py` | **KEEP** | Existing structural enums (BODY_VALUES, ACIDITY_VALUES, TANNIN_VALUES) reused as `structural` field values. |
| `data/enrich_wines.py` | **MODIFY** | Writes `taste_profile` JSON to `products` row; on each write, refreshes `product_taste_notes` rows for that product. No new flags. |

Eventual cleanup: `data/lib/enrichment/wine/` should be renamed to `core/` or `taste/` since it serves all classifications. **Not in scope for this work** — a separate rename PR after launch.

### Prompt design

`prompt.py` exposes one entry point (`build(evidence) → (system, user)`) that internally:

1. Looks up the **prompt strategy** for `evidence.classification` (`wine_tiered`, `brown_spirit_tiered`, `white_spirit_tiered`, `beer_flat`, `liqueur_flat`, `rtd_flat`).
2. Embeds the **vocab subset** filtered by `applies_to`. Keeps prompt focused; reduces hallucination.
3. Embeds the **tier definitions** for that category. Wine: *"Primary = from the grape; Secondary = from winemaking; Tertiary = from aging."* Brown spirit: *"Primary = from raw material; Secondary = from distillation; Tertiary = from cask aging."* etc.
4. Declares the **output schema** — `tiered` (3 arrays + structural) or `flat` (1 array + structural).
5. Continues to pass existing evidence (Winesensed, brand library, heuristic profile) unchanged.
6. Continues to honor the Winesensed License Rule and Critic Scores Rule from the existing prompt.

### Validator rules

Every AI output is checked:

1. **Schema:** required fields present, types correct, `structure` matches expected for classification.
2. **Vocab lookup per note:** exact → alias → fuzzy (Levenshtein ≤ 2). Repaired matches are logged to `vocab_repair_log` for QA but don't fail validation. Unknown notes after fuzzy attempt are logged to `enrichment_failures` for vocab-expansion review and the call retries once with a corrective hint; second failure rejects the entire output.
3. **Tier validity:** A note's `default_tier` is a hint — AI can override, but unusual placements drop the recorded `confidence` by a step.
4. **Intensity validity:** Values 1–3 only; auto-sort notes within a tier descending by intensity.
5. **Minimum content:** Tiered must have ≥ 1 tier non-empty; flat must have ≥ 3 tags.

### Cost — taste data is essentially free when bundled

The taste schema adds ~500 output tokens to an enrichment call that's already generating descriptions. With Haiku 4.5 as the workhorse and Opus retry only on `confidence < 0.7`, the **incremental cost of adding taste to the planned re-enrichment is ~$60 across all 11,436 products** (the bulk of any re-enrichment cost is the description, which is happening anyway).

Smoke-test wave: re-enrich the **top 500 most-viewed products first** (~$10–25) to validate the format before full rollout.

---

## Layer 3 — UI + AI features

### Component inventory

| Component | Path | Role |
|---|---|---|
| `<TasteProfileSection>` | `components/product/TasteProfileSection.tsx` | Top-level dispatcher. Reads `taste_profile.structure`; renders `<TasteWheel>` or `<TasteChipCard>`. Renders `<StructuralGauges>` below. |
| `<TasteWheel>` | `components/product/TasteWheel.tsx` | 3-ring SVG wheel for `structure: "tiered"`. Outer ring = primary, middle = secondary, inner = tertiary. Wedge size proportional to intensity within tier. Hover reveals note name; click delegates to `<TasteNote>`. Default 240px; scales via `viewBox`. |
| `<TasteChipCard>` | `components/product/TasteChipCard.tsx` | Intensity-grouped chip layout for `structure: "flat"`. Three rows (Dominant, Supporting, Subtle) of `<TasteNote>` chips. |
| `<StructuralGauges>` | `components/product/StructuralGauges.tsx` | 4-cell segmented track per axis (Vivino-style honesty about ordinal data), with per-axis color: red for body/tannin, green for acidity, gold for sweetness, blue for bitterness/carbonation. |
| `<TasteNote>` | `components/product/TasteNote.tsx` | Shared primitive used by wheel + chip card. Renders a single clickable note. Owns navigation: `router.push('/explore?note={name}&tier={tier}')`. |
| `<SimilarProductsRail>` | `components/product/SimilarProductsRail.tsx` | Horizontal scrollable rail rendered under `<TasteProfileSection>`. Shows 6–10 products with thumb + name + price + "5 matching notes" badge. |
| `ProductDetailCard.tsx` | `components/explore/ProductDetailCard.tsx` (existing) | Mounts `<TasteProfileSection>` + `<SimilarProductsRail>`. |
| `ProductSidebar.tsx` | `components/explore/ProductSidebar.tsx` (existing) | When `?note=` is in URL, renders a dismissible "Filtered by: Tobacco · Tertiary" chip. |

### `<TasteProfileSection>` API

```ts
type TasteProfile = {
  schema_version: "2.0";
  structure: "tiered" | "flat";
  tiers?: { primary: Note[]; secondary: Note[]; tertiary: Note[] };
  flat_tags?: Note[];
  structural: Record<string, string | null>;
  confidence: number;
  prompt_version: string;
  enriched_at: string;
};
type Note = { note: string; intensity: 1 | 2 | 3 };

<TasteProfileSection profile={taste_profile} productId={id} />
```

### Empty / loading / low-confidence behavior

- **Missing `taste_profile`** (legacy product, not yet re-enriched): `<TasteProfileSection>` returns `null` — no placeholder. Better to show nothing than a broken-looking section.
- **Loading state:** skeleton with greyed wheel outline.
- **Confidence < 0.5:** small "Preliminary tasting profile" badge so users understand quality.

### Mobile

- `<TasteWheel>` scales via `viewBox`; readable down to 200px. Below 480px viewport: drop wedge labels, rely on tap tooltips.
- `<TasteChipCard>` chips wrap intrinsically.
- `<StructuralGauges>` stacks vertically (already does).

### Feature flag

`NEXT_PUBLIC_TASTE_PROFILE_ENABLED` (server-side env var, also exposed to client) defaults **off** until ≥ 90% of catalog has been re-enriched with v2. When off, `<TasteProfileSection>` returns `null` everywhere, regardless of data. Lets us land code without exposing partial coverage.

### Final polish

Wireframes in this spec are engineer-mockup grade. Production implementation goes through the **frontend-design skill** for typography, spacing, hover states, micro-animations, accessibility (aria labels for wheel segments + chip semantics).

---

## AI features

### F1 — "More like this" rail

**Algorithm:** Weighted Jaccard on `product_taste_notes`. For each note shared between products A and B:

```
score(A, B) = Σ over matches:
              3.0 × min(intA, intB)      # same-tier same-note (strongest signal)
            + 1.5 × min(intA, intB)      # cross-tier same-note (e.g. Cedar primary on A, secondary on B)
            + 1.0 × min(intA, intB)      # same-family different-note (e.g. Vanilla / Mocha both wood)
... normalized 0–1 by sum-of-possible.
```

Worked example (two Coonawarra Cabs): score 0.84 → "very similar." Rail threshold: ≥ 0.5.

**Compute strategy:** Pre-computed nightly via Vercel cron at 03:00 ICT (`scripts/compute_similarity.py`). Naive O(n²) on 11,436 products is 130M comparisons — slow but tractable in a nightly window. Optimization: only recompute for products whose `enriched_at` changed in the last 24h plus their existing top-50 neighbors (incremental delta).

For cold start (new product enriched mid-day, no neighbors yet), an incremental update fires from the enrichment write hook — adds the product to its likely top-neighbors' similar-lists within a minute.

**API:** `GET /api/products/[id]/similar?limit=10` returns ordered list with `score` and `matching_notes`. New route (~30 lines).

**UI:** `<SimilarProductsRail>` under `<TasteProfileSection>`. Each card has a "5 matching notes" badge that's hover-expandable. Instrumentation: log impressions + click-throughs for threshold tuning.

### F2 — Click-a-note discovery

**API extension:** `GET /api/products/search` (existing) accepts new optional params `?note=Blackcurrant&tier=primary`. Joins `product_taste_notes`, filters, returns same shape as current search. ~15 lines added. **Cross-category by default** — clicking "Tobacco" on a wine surfaces matching Brandies too. (Cross-category bridge in its safest form: user-initiated, not algorithmic.)

**UI:** Existing `app/explore/` route handles the URL params. `<ProductSidebar>` shows dismissible "Filtered by: Tobacco · Tertiary" chip. Results sorted by `intensity DESC` then by existing popularity score.

### F3 — Smarter food pairing

**Prompt update inside the enrichment call:** The pairing instructions in the system prompt now receive the tier-tagged notes as context. AI is instructed to ground pairing prose in specific tiers: *"The blackcurrant primary calls for lamb; the cedar secondary suggests rosemary; the tobacco tertiary loves smoked brisket."*

**Output schema:** Existing `food_matching` controlled-taxonomy chips are unchanged. New optional `pairing_rationale` string contains the tier-grounded prose paragraph.

**UI:** Existing food pairing section in `ProductDetailCard.tsx` renders the new paragraph below the chip list when present. No new component.

**Cost:** ~0 incremental — runs in the same call that produces `taste_profile`.

---

## Rollout

The user's existing plan to re-enrich the catalog provides the cadence. Taste data ships as part of that work, not as a separate run.

| Phase | Deliverables | Gate before next |
|---|---|---|
| **0. Spec + foundations** | Design doc committed (this). `taste_vocab.yml` seeded ~300 notes. Migration: `taste_profile` JSONB column + `product_taste_notes` + `product_similar` tables (Supabase + local SQLite mirror). Drop placeholder `flavor_profile` / `character_traits` columns. | Migration applied; vocab loader unit tests green. |
| **1. Pipeline evolution** | `data/lib/enrichment/wine/prompt.py` + `validator.py` modified. `schemas.py` + `vocab_loader.py` added. `enrich_wines.py` writes `taste_profile` + refreshes `product_taste_notes`. | 10-SKU dry run across wine + brown spirits + white spirits + beer. Inspect output by eye. |
| **2. Frontend components** | `<TasteWheel>`, `<TasteChipCard>`, `<StructuralGauges>`, `<TasteNote>`, `<TasteProfileSection>`. Mounted in `ProductDetailCard.tsx`. Storybook entries. | Components render correctly against hand-built sample `taste_profile` fixtures. Feature flag default off. |
| **3. Smoke-test re-enrichment** | Run on **top 500 most-viewed products**. Spot-check 20 products by eye. | ≥ 80% of the 500 at confidence ≥ 0.6. Vocab repair log < 10% of total notes. Smoke-test sample looks right. |
| **4. AI features** | `scripts/compute_similarity.py` + Vercel cron entry. `/api/products/[id]/similar` route. `<SimilarProductsRail>` mounted. `/api/products/search` extended with `?note=&tier=`. Filter chip in `<ProductSidebar>`. Pairing rationale render. | Integration tests green; manual smoke test on top 500. |
| **5. Full re-enrichment** | Remaining ~10,900 products re-enriched at the user's normal cadence. | ≥ 90% of catalog enriched with v2. |
| **6. Launch** | Flip feature flag to on. Production deploy. | Monitor: enrichment failure rate < 5%, similarity rail CTR baseline established, "unknown note" log reviewed weekly. |

Phase 2 runs in parallel with Phase 1; Phase 4 in parallel with Phase 5.

---

## Testing

**Unit tests** (Python, `tests/`):
- `test_vocab_loader.py` — YAML parses; alias reverse-map correct; family lookup works; `applies_to` filtering returns expected subset.
- `test_taste_validator.py` — exact match · alias match · fuzzy repair (Levenshtein ≤ 2) · unknown rejection · intensity bounds · tier-balance minimum · auto-sort within tier · confidence decrement on unusual tier placement.
- `test_taste_prompt.py` — each classification dispatch produces a system prompt containing the right tier definitions and the right vocab subset (e.g. beer prompt doesn't include wine-only notes).
- `test_similarity.py` — known-similar pairs (two Coonawarra Cabs) score > 0.7; known-dissimilar (Cab vs Riesling) score < 0.3; same product = 1.0; missing taste_profile excluded.

**Integration tests:**
- `test_enrich_e2e.py` — fixture product → real (or mocked) AI call → SQLite row → API read → component render snapshot.
- `test_search_note_filter.py` — `?note=Tobacco&tier=tertiary` returns products with that exact match.
- `test_similarity_rail.py` — for a known Coonawarra Cab, top-10 similar includes other Coonawarra Cabs.

**Manual QA gates before launch (after smoke test re-enrichment):**
- 50 random product pages spot-checked (wheel feels right; structural gauges feel right; pairing prose reads naturally).
- Vocab repair log < 10% of all notes had to be alias-repaired (signals AI mostly uses canonical names).
- Confidence distribution: ≥ 80% of products at confidence ≥ 0.6.
- Hard-reject rate after retry: < 5%.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Vocab too restrictive — AI rejects valid notes | "Unknown note" log surfaces gaps; vocab is YAML (data, not code) — expand without redeploy. Bi-weekly vocab review during smoke-test phase. |
| AI assigns wrong tiers (e.g. Tobacco as primary on young wine) | Validator drops `confidence` on unusual placements; manual override field on `products.taste_profile_override JSONB` for QA-driven corrections. First 200 enrichments are a calibration set. |
| Similarity scoring tuned wrong — "More like this" surfaces poor matches | Conservative threshold (0.6) to start; A/B test threshold; monitor click-through rate; instrument thumbs-down feedback. |
| Backfill cost overrun | Haiku 4.5 first pass; Opus retry only at `confidence < 0.7`; budget cap at $300 with alerts every $100. |
| Production `/api/products/search?note=X` latency | GIN/btree composite index on `product_taste_notes (note, tier)`. Cache popular note results (Vercel KV) if needed after launch metrics. |
| Frontend deploys before data is ready | `NEXT_PUBLIC_TASTE_PROFILE_ENABLED` defaults off until ≥ 90% coverage. |
| Wheel renders empty for missing data | `<TasteProfileSection>` returns `null` when `taste_profile` is absent — no placeholder, no broken-looking section. |

## Rollback

All changes are **additive** (new tables, new columns, new components, new routes). Existing UI continues to work if `taste_profile` is missing.

- **If a phase looks bad:** feature flag the new UI off; data stays in DB unchanged.
- **If vocab needs reset:** `taste_vocab.yml` is the source of truth — re-run validator on existing `taste_profile` JSONB to re-canonicalize without re-prompting the AI.
- **If similarity rail underperforms:** flag hides `<SimilarProductsRail>`; `product_similar` table stays, tune and re-enable.
- **If backfill produces bad data on a model version:** `taste_profile.prompt_version` is recorded; can mass-clear by version and re-run.

---

## Cost

| Item | Volume | Estimate |
|---|---|---|
| Incremental cost of adding taste fields to planned re-enrichment | 11,436 products | ~$60 (the description regeneration was happening regardless) |
| Smoke-test wave: top 500 most-viewed products | 500 | $10–25 |
| Nightly similarity compute | CPU only | ~$0 |
| **Total ballpark** | | **$70–85 incremental** |

Hard cap: $300 with early-exit if exceeded; alerts every $100 spent.

---

## What's at launch

A wine / spirit product page renders:
1. The 3-ring TasteWheel with click-to-discover navigation
2. Color-coded segmented gauges (Body / Acidity / Tannin / Sweetness)
3. A "More like this" rail of 6–10 similar products with matching-note badges
4. Smarter food pairing prose grounded in tier data

A beer / liqueur / RTD product page renders:
1. The TasteChipCard with intensity-grouped chips
2. Category-appropriate gauges
3. Same "More like this" rail (cross-category capable)
4. Same smarter pairing prose

A `Cigar` / `Mineral Water` / `Non-Alcoholic` / `Accessories` etc. page: no taste section at all.

---

## Open implementation decisions (resolve during planning)

1. **Vercel cron vs Supabase scheduled function for similarity recompute** — depends on where compute runs cheapest; both work.
2. **`taste_profile_override` JSONB column for manual QA edits** — included in spec as a risk mitigation; may or may not need its own UI in v1 (could be DB-edit-only initially).
3. **Renaming `data/lib/enrichment/wine/` → `core/`** — out of scope; track as follow-up cleanup PR.
4. **Where the `family` taxonomy hierarchy is defined** (a separate `families.yml` or inline in `taste_vocab.yml`) — pick during phase 0; inline is simpler if family list stays small (<40 entries).
