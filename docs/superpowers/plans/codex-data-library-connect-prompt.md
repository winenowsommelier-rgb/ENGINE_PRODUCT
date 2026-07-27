# Session Prompt — Connect Engine Product to the CODEX Data Library

> Paste the block below the `---` into a fresh Claude Code session running in
> this repo (`/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT`). Everything above the line
> is a note to you (the human).
>
> **Why this exists:** the CODEX side already wrote us an access prompt
> (`/Users/admin/Documents/CODEX Projects/ENGINE_PRODUCT_ACCESS_PROMPT.md`). But
> that file describes an Engine-side write contract that **does not exist in this
> repo** (`lib/products/ownership.ts`, `POST /api/products/bulk-patch`,
> `X-Source: enrichment`, `data/db/products.json`) and uses field names we don't
> use (`wine_body`, `grape_variety`, `producer_key`). This prompt reconciles their
> reference to our real architecture so a session doesn't chase paths that aren't
> here. Verified against this repo 2026-07-27.

---

We are connecting this repo (the **WNLQ9 Product Engine**, catalog owner) to a
second local repo, the **CODEX enrichment data library**, at:

```
/Users/admin/Documents/CODEX Projects
```

Read our CLAUDE.md ABSOLUTE RULES first. Rules 1, 4, 6, 9, 10, and 12 all govern
this work. Then read `/Users/admin/.claude/projects/-Users-admin-WNLQ9-PIE-ENGINE-PRODUCT/memory/MEMORY.md`
— the entries under **Data Sources & Ownership**, **Country / Region**, and
`project_codex_enrichment_library_sync` are directly on point.

The library is an **upstream read-only reference source.** Read from it freely.
**Never write to it** — enrichment owns that repo, we own the catalog. (Their
scripts write to `research_jobs/progress_outputs/`; when we hand them corrected
data we do it via a file *they* pull, not by editing their tree. See
`project_codex_enrichment_library_sync`: their QC reads from OUR `data/` copies,
so any file we regenerate must be copied back for them.)

## 1. Orient — read these first (in the CODEX repo)

| File | What it gives you |
|---|---|
| `ENGINE_PRODUCT_ACCESS_PROMPT.md` | Their view of the contract. **Authoritative on the library; STALE on our write path** — see §4 corrections below. |
| `research_jobs/progress_outputs/data_library_index.json` (5.9 MB) | Machine-readable index of every library file: path, rows, columns, null %, dupes, quality status, 200-row sample. The single fastest "what exists / is it good" lookup. |
| `PUBLISH_SAFE_FIELDS.json` | Their publish allowlist. **Stricter than ours — honor the stricter policy.** `public_safe_fields` = OK to publish; `internal_only_fields` = never publish (`queue_priority`, `ga_signal_rank`, `website_surface_*`, `priority_band`, `why_now`, `copy_status`, `research_validation`, `research_confidence_level`). Read the file, don't trust this copy — it changes. |
| `FIELD_REGISTRY.csv` | Canonical field definitions + ownership. |
| `PRODUCT_ENGINE_SYNC_FIELD_PLAN.md` | Their field-name mapping intent toward our schema. |

The human view of the index is `data_library_dashboard.html` (5.9 MB, open in a
browser, no server). Do **not** Read it into context — it's inlined data. Use
`data_library_index.json` programmatically instead.

## 2. The consolidated layers worth consuming

Prefer these over the raw scattered sources:

- **`research_jobs/progress_outputs/reviews_reference_library.csv`** (~210k rated
  rows, wine-only). Key columns: `producer_key` (their normalized join key),
  `scale` (`vivino_5` user 1–5 vs `critic_100` critic 80–100 — **never blend
  scales**), `score_100`, `ratings_count`, `flavor_keywords_en` (English —
  publish from this, not the mixed-language `flavor_keywords`), `body`/`acidity`/
  `tannin`/`sweetness` on a 1–5 scale, `grape_variety`, `style`, `source_file`.
- **`research_jobs/progress_outputs/producer_score_index.csv`** (2,428 producers
  rolled up). `matches_live_brand == True` marks the **~500 producers that match a
  brand already in our catalog** — that is the highest-value entry point.
  `<attr>_est` is the per-producer estimate to use; `attribute_reliability`
  =`consistent` (n≥3, sd≤0.5) is publish-grade, `wide_range`/`single_observation`
  are review-only.
- **`research_jobs/progress_outputs/food_pairing_library.csv`** (222 grape→food
  pairings, ranked by **lift** not raw share). Grape-level, filter `confidence==high`.
- Geography/description libraries: `country_/region_/subregion_/origin_description_library.csv`
  (note: base `country_description_library.csv` is stale — the real head is the
  `_merged_round2/3` variant per `project_codex_enrichment_library_sync`).

Spirits/beer/sake have **no scores** (no open source publishes them) — absence is
not a low rating. For those, `wine_data/spirits_authority/` gives producer
identity + country only, never quality.

## 3. Join model

Their key is `producer_key` (lowercase, de-accented, stop-words like `château`/
`domaine`/`winery` stripped, collapsed). Our catalog carries `brand` and has **no
`producer_key` column**. To match, normalize our `brand` the same way — mirror
`producer_key()` in `research_jobs/build_reviews_reference_library.py`, don't
reimplement from prose.

**Producer- and region-level joins are reliable. Product-level joins are NOT**
(vintage/size/cuvée differ across sources). Treat any product-level match as a
review candidate, never an automatic write. This aligns with our own hard lesson
`feedback_dont_infer_country_from_brand` (19/24 brand-inferred countries were
wrong) — producer identity is fine, but a brand→country/region inference still
gets verified against the manufacturer before it lands.

## 4. ⚠️ CORRECTIONS to their access prompt — our real write path

Their `ENGINE_PRODUCT_ACCESS_PROMPT.md` §4 references an Engine architecture that
**does not exist in this repo**. Do not go looking for these — they aren't here:

| Their prompt says | Reality in THIS repo |
|---|---|
| `lib/products/ownership.ts` | ✗ does not exist |
| `lib/products/field-validation.ts` | ✗ does not exist |
| `POST /api/products/bulk-patch`, header `X-Source: enrichment` | ✗ no such endpoint |
| `data/db/products.json` | ✗ — our DB is **`data/db/products.db`** (SQLite, 11,934 rows) |

**The actual publish path (Rule 9):**
```
write to data/db/products.db  →  .venv/bin/python scripts/refresh_live_export.py  →  data/live_products_export.json (the UI source)
```
`refresh_live_export.py` only exports **allowlisted** columns
(`project_export_cols_allowlist`) — a new/renamed DB column is silently dropped
from the UI unless it's added to the allowlist. Any bulk DB write is a
payment-path operation under CLAUDE.md §5.

**Field-name mapping (their names → our real `products` columns):**

| CODEX / their prompt | Our actual column |
|---|---|
| `wine_body` | `body` |
| `wine_acidity` | `acidity` |
| `wine_tannin` | `tannin` |
| `grape_variety` | `variety` |
| `flavor_tags` | `flavor_tags` (same) |
| `food_matching` | `food_matching` (same — **pipe-delimited**, use `parseFoodMatching()`, never `.split(',')`) |
| `wine_classification` | `wine_classification` (same) |
| `country`/`region`/`subregion`/`appellation` | same |
| `category_group` / `category_type` | **NOT stored columns** — SKU-derived at read time via `sku_taxonomy.resolve`. Rule 12: never route/group on raw `classification`. |

A wrong field name here silently wastes the mapping effort (CLAUDE.md §1
exception) — validate every target column name against the live `products` schema
before writing.

## 5. What we may take / must never take

**Safe to consume as evidence** (subject to the stricter of our and their publish
allowlist): `country`, `region`, `subregion`, `appellation`, `variety`, `style`,
`body`, `acidity`, `tannin`, `flavor_tags`, `food_matching`, descriptions, and
enrichment confidence/status/notes.

**Never take from the library:** `sku`, `name`, `brand`, `bottle_size`, `vintage`,
`alcohol`, price, cost, stock, supplier fields. We own identity + commercial data.
Their prices are third-party scrapes from other markets — **not** our pricing
(`feedback_price_ownership_bi_writes_db`, `feedback_db_is_source_of_truth_not_masterfile`).

Translate French taste rows (`language=fr`: Bordeaux/Burgundy/Champagne Vivino,
`agrume`/`pomme verte`) before writing English `flavor_tags` — never pass raw.
Prefer `flavor_keywords_en`, which is already translated.

## 6. What to actually do (this session) — NO WRITES YET

1. Read `data_library_index.json` and confirm every path in §1–§2 resolves.
2. Load `producer_score_index.csv`, filter `matches_live_brand == True`, and
   reconcile those ~500 producers against our catalog `brand` (normalize brand via
   their `producer_key()`).
3. Report back, **writing nothing**:
   - how many of our SKUs sit under a matched producer;
   - for those SKUs, which enrichment-owned columns are currently empty in
     `products.db` (`body`, `acidity`, `tannin`, `variety`, `flavor_tags`,
     `food_matching`, geography) — a real COUNT query, not an estimate;
   - where library evidence with `attribute_reliability==consistent` /
     `evidence_strength` `strong`/`very_strong` could fill those gaps;
   - any producer whose library region **contradicts** our catalog region — list
     these individually; they're the highest-value corrections, and per
     `feedback_dont_infer_country_from_brand` each needs manufacturer verification
     before it lands.
4. Propose a first batch as a **Rule-10 dry run**: show the diff, cite
   `source_file` + `scale` per field, map every field to its real `products`
   column, and wait for sign-off before any DB write.

**Verification is not optional (Rules 1, 4, 6).** After any eventual bulk write:
`cp data/db/products.db data/db/products.db.bak-pre-<batch>` first; run the write;
then run `scripts/refresh_live_export.py`; then a direct `sqlite3` COUNT proving
the target column is populated on the intended SKUs AND that the value appears in
`data/live_products_export.json`. Counting matched rows or log lines is NOT
verification. Every published field must trace to a `source_file` in the library.

Prefer a small, fully-cited batch over a large inferred one.

Confirm you've read the CODEX orientation files + our MEMORY entries, resolved the
paths, and completed the read-only reconciliation report (step 3) before proposing
any batch.
