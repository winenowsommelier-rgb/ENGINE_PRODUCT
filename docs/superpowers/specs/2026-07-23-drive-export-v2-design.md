# Drive Export v2 — AI-Accessible Data Layer

**Date:** 2026-07-23
**Status:** Design approved by user; pending spec review
**Scope:** Make the Google Drive data folder a clean, self-describing, correctly-sized
source that any Claude/ChatGPT Project, NotebookLM notebook, or ad-hoc chat session
can consume — with prices/stock fresh daily and heavy product detail refreshed only
when it changes.

This is **project 1 of a 4–5 project decomposition** of the "WINE-NOW & LIQ9 Data
Requirements" brief. It is the export-plumbing project (the brief's Q2). It spends
**$0 in API money** and de-risks the downstream (paid) projects. Later projects
(each its own spec cycle): structured spirits/sake/fridge enrichment; product
relationships graph; per-field source/confidence provenance.

---

## 1. Problem & context

The brief asks to "prepare all files as sources so all chat sessions can access and
use data" and to "estimate the file size and ability to update daily." Investigation
of the real repo found that **most of this already exists and runs nightly** — but is
incomplete and mis-sized for the AI-chat consumers:

**Already exists (verified):**
- `scripts/refresh_live_export.py` → `data/live_products_export.json` (42MB, 11,934 rows, 77 fields), nightly 03:00 via launchd (`com.wnlq9.daily-sync` → `scripts/scheduled_sync.sh`).
- `scripts/export_ai_knowledge_base.py` → `docs/ai-knowledge-base/` (category-split JSON + `product_index_compact.tsv` + `product_index.md`).
- `scripts/export_ai_knowledge_base_slim.py` → `docs/ai-knowledge-base-slim/` (Claude/ChatGPT) and `docs/ai-knowledge-base-notebooklm/` (plain text).
- `scripts/sync_ai_knowledge_base_to_drive.py` → pushes the KB files to Drive parent folder `1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK` (OAuth user creds at `~/.config/wnlq9/gdrive_credentials.json`, token `~/.config/wnlq9/gdrive_token.json`, scope `drive`). Has `--dry-run`.

**Gaps this project closes:**
1. Exports include all 11,934 SKUs — the not-in-stock set (5,630 `is_in_stock='0'` + 98 NULL = 5,728) plus the cross-cutting archived flag (`custom_stock_status='CATALOG'` = 4,116, which overlaps stock state, not a disjoint bucket). This is noise that blows past Project/NotebookLM caps and risks recommending unavailable items.
2. Live commercial data (price/stock) is baked into the 42MB blob — every price change means re-pushing 42MB; no lightweight daily feed.
3. No manifest — a chat session has no machine-readable index of what's in the folder, how fresh, or how to use it.
4. No `product_url` field anywhere (the brief's P0). Column doesn't exist in the DB.
5. No change detection — heavy unchanged files re-upload every night.

**Out of scope (future projects):** structured spirits/sake/fridge attribute
enrichment (paid API — Rules 1/4/10 apply); populating the empty `product_similar`
relationships table; per-field `source_registry` provenance. The manifest reserves a
slot for `source_registry.csv` so it slots in later without rework.

---

## 2. Verified data facts (denominator = 11,934 products in `data/db/products.db`)

- **In-stock signal:** `is_in_stock == '1'` → **6,206 SKUs** (TEXT flag; canonical per `refresh_live_export.py`). `wn_stock`/`quantity_in_stock` are effectively empty — do NOT use.
- **Not-in-stock:** `is_in_stock='0'` → 5,630 and NULL → 98 (total 5,728). Not additive with in-stock in any clean way if you also count archived.
- **Archived:** `custom_stock_status == 'CATALOG'` → 4,116 (front-end "Archive" badge, excluded from recs). This is a **cross-cutting flag, not a disjoint bucket** — 4,113 of the archived are also out-of-stock, but **3 archived SKUs are `is_in_stock='1'`**. Rule for this project: the in-stock filter is `is_in_stock='1'` ONLY; those 3 archived-but-in-stock SKUs DO pass the filter and appear in `live/` + `catalog/` (they are technically sellable). We do not special-case them.
- **Category (Rule 12 — critical):** raw `classification` is free text (95.8% filled, **498 blank in-stock**, some pipe-delimited dirty values like `Red Wine|Fruit Wine`, plus out-of-GROUP_MAP values like `Mineral Water`). It **MUST NOT** be used for grouping/routing. The canonical category is `category_group`/`category_type`, **derived at export time** from SKU prefix via `data.lib.taxonomy.sku_taxonomy.resolve` (which reads the SKU prefix and explicitly ignores `classification` — `sku_taxonomy.py:53-54`). These are already present in `live_products_export.json`.
- **`product_url`:** does not exist. User will supply real URLs with the next image-URL update. Plumb the column now (empty), populate later.
- **Current export:** 42MB JSON array, 11,934 records, 77 fields.

---

## 3. Architecture & data flow

One new orchestrator script wraps the existing generators — we build on the skeleton,
not from scratch (Rule 11).

```
products.db ──(nightly 03:00, existing launchd)──► refresh_live_export.py
                                                        │
                                            live_products_export.json (42MB, all 11,934)
                                                        │
                              export_drive_bundle.py  (NEW — the one orchestrator)
                                                        │
        ┌───────────────┬───────────────┬──────────────┬──────────────┬────────────┐
        ▼               ▼               ▼              ▼              ▼
   live/*.csv     catalog/*.json     slim/*        notebooklm/*   MANIFEST.json
   (daily,        (on-change,        (on-change,    (on-change)    + README.md
    in-stock)      in-stock)          in-stock)                    (every run)
        │                                                               │
        └──────────────► sync (existing Drive push, extended) ◄─────────┘
```

**Decisions:**
- **Central in-stock filter** (`is_in_stock=='1'` → 6,206) applied once in `export_drive_bundle.py`, then filtered subsets are handed to the generator functions.
- **MANDATORY grouping refactor (Rule 12 fix — the highest-priority change):** the existing `export_ai_knowledge_base.py` / `_slim.py` group by raw `classification` (`GROUP_MAP` keyed on `classification`, and `classification == 'Red Wine'` branches, with `if group is None: continue` silently dropping unmapped rows — `export_ai_knowledge_base.py:26-68,175-207`). This BOTH violates Rule 12 AND drops the 498 blank + `Mineral Water` + pipe-dirty in-stock SKUs to **zero** category files, breaking our own invariant. **The grouping MUST be switched to `category_group`/`category_type`** (already in the export, derived from `sku_taxonomy.resolve`), with an explicit `Unknown`/catch-all bucket so no SKU is ever dropped. This is a required refactor of the generators, not optional cleanup. The refactored generators expose a callable `generate(items: list[dict], out_dir: str)` that groups on `category_group`/`category_type`; their `__main__` behavior (writing to `docs/ai-knowledge-base*`) is preserved by having `__main__` call `generate()` with the full unfiltered list and the legacy dir.
- **Live/static split** by content-hash change detection (see §6).
- **Full archive** (`products_all_archive.jsonl`, all 11,934, thin field set) written to `catalog/` as reference; on-change refresh only. Nothing is lost; recommendations draw from in-stock.
- **Shared cross-tier artifacts** (`product_index_compact.tsv`, `system_prompt.md`/`system_prompt.txt`): generated ONCE by the orchestrator and copied into each tier that needs them, rather than one generator reading another generator's output directory (the existing slim generator copies the TSV and `system_prompt.md` out of `docs/ai-knowledge-base/` — that cross-script file dependency must not survive the refactor). `system_prompt.md`/`.txt` are hand-maintained static assets checked into the repo (`docs/ai-knowledge-base/system_prompt.md` already exists); the orchestrator copies them, it does not generate them. They are listed in deliverables and the manifest.

---

## 4. File split (freshness tiers)

### `live/` — regenerated & re-uploaded DAILY (~1.6 MB total)

| File | Columns | Rows | Rationale |
|---|---|---|---|
| `inventory_live.csv` | sku, name, is_in_stock, custom_stock_status, wn_stock, category_group, category_type, product_url | 6,206 | stock flips daily |
| `pricing_promotions_live.csv` | sku, price, special_price, sp_discount_pct, currency, product_url | 6,206 | prices/sales change often |

There is **no promotion-validity/date field** in the DB (`EXPORT_COLS`,
`refresh_live_export.py:51-105`, has only `special_price` + `sp_discount_pct`). Promo
validity is therefore NOT a v1 column — it is deferred like `product_url` and will be
plumbed empty only if/when a real source field exists. Do not invent it.

Flat CSVs, trivial to diff, cheap to push. "Current commercial truth" an AI reads to
avoid recommending a sold-out or mis-priced bottle.

#### Concrete file taxonomy (which field splits the files, and the exact filenames)

Files are partitioned by **`category_group`** (the 9-value axis from `resolve()`), with
the single large group **Wine** sub-split by `category_type` + country so no file is
oversized for AI-chat caps. `category_type` is carried as a field INSIDE each record
(so an AI can still filter Gin vs Rum within `spirits`), but does not itself create
files except for the Wine sub-split. Verified in-stock counts drive this:

| File (`catalog/`, `slim/`, `notebooklm/` mirror the same split) | Source rows | ~In-stock |
|---|---|---|
| `products_wine_red_france.json` | Wine/Red Wine, country=France | ~subset |
| `products_wine_red_italy.json` | Wine/Red Wine, country=Italy | ~subset |
| `products_wine_red_world.json` | Wine/Red Wine, other countries | ~subset |
| `products_wine_white_france.json` | Wine/White Wine, country=France | ~subset |
| `products_wine_white_world.json` | Wine/White Wine, other | ~subset |
| `products_wine_sparkling.json` | Wine/Sparkling & Champagne | 448 |
| `products_wine_other.json` | Wine/{Rosé, Sweet/Dessert, Fortified, Orange, Wine Set} | ~146 |
| `products_whisky.json` | group=Whisky | 429 |
| `products_spirits.json` | group=Spirits (all types; type field kept per-record) | 632 |
| `products_liqueur.json` | group=Liqueur | 256 |
| `products_sake_asian.json` | group=Sake & Asian | 440 |
| `products_beer_rtd.json` | group=Beer & RTD | 18 |
| `products_non_alcoholic.json` | group=Non-Alcoholic | 79 |
| `products_accessories.json` | group=Accessories (incl. Wine Coolers & Fridges) | 392 |
| `products_cigars.json` | group=Cigars | 64 |

**~15 files per tier.** Every in-stock SKU maps to exactly one file via its
`category_group` (+ Wine sub-rule). An `Unknown` group would produce
`products_unknown.json`; verified **0 in-stock SKUs resolve to Unknown** today, so it is
an empty safety net. The old `GROUP_MAP`/country logic is REPLACED by this
`category_group`-driven scheme — filenames change from `wines_red_*` to `wine_red_*`;
NotebookLM/Project uploads must be re-pointed once (one-time, documented in README).

### `catalog/`, `slim/`, `notebooklm/` — regenerated daily, re-uploaded ONLY on hash change (~36 MB)

| File | Source (existing generator, filtered to in-stock) | Refresh trigger |
|---|---|---|
| `catalog/products_*.json` | refactored `export_ai_knowledge_base.py` (grouped by `category_group`/`category_type`, NOT classification) | sha256 change |
| `catalog/product_index_compact.tsv` | same | sha256 change |
| `catalog/products_all_archive.jsonl` | new thin writer (all 11,934) | sha256 change |
| `slim/*` | `export_ai_knowledge_base_slim.py` logic | sha256 change |
| `notebooklm/*` | same (plain text) | sha256 change |

**Design principle (brief §4):** live commercial data is deliberately separated from
static product facts. AI reads `pricing_promotions_live.csv` for availability/price
and `catalog/products_*.json` for tasting notes/pairing.

**`product_url`:** added to the export-column allowlist and to the live CSVs + catalog
JSON now, empty until the user supplies real URLs. Auto-populates when the source
lands; no later schema change.

---

## 5. Drive layout & manifest

```
DRIVE ROOT (1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK)
├── MANIFEST.json      ← machine-readable index (read first)
├── README.md          ← human/LLM orientation
├── live/              (daily)   inventory_live.csv, pricing_promotions_live.csv
├── catalog/           (on-change) product_index_compact.tsv, products_*.json, products_all_archive.jsonl
├── slim/              (on-change) Claude/ChatGPT project files + system_prompt.md
└── notebooklm/        (on-change) plain-text sources + system_prompt.txt   (≤50 files)
```

**`MANIFEST.json` contract:**
```json
{
  "generated_at": "2026-07-23T03:00:00+07:00",
  "catalog_version": "<sha256 of concatenated catalog file hashes>",
  "total_skus_in_stock": 6206,
  "total_skus_all": 11934,
  "freshness": { "live": "daily", "catalog": "on-change" },
  "files": [
    { "path": "live/pricing_promotions_live.csv", "purpose": "Current price & promo per in-stock SKU",
      "tier": "live", "rows": 6206, "bytes": 812340, "sha256": "…", "updated_at": "2026-07-23T03:00:00+07:00" }
  ],
  "reserved_future": ["source_registry.csv"],
  "usage_notes": "Read live/ for availability & price. Read catalog/ for tasting notes & pairing. Never recommend a SKU absent from inventory_live.csv."
}
```

`README.md` is a short plain-language version so NotebookLM / a human skimming the
folder is oriented without parsing JSON.

---

## 6. Change detection, verification & error handling

**Change detection:** each `catalog`/`slim`/`notebooklm` file gets a sha256 on its
bytes; compared against the **local `.last_manifest.json` cache** (the single source of
truth for gating — NOT the Drive copy, to avoid ambiguity when the two disagree).
Unchanged → skip upload, carry prior `updated_at`. Changed → upload, stamp new
`updated_at`. `live/` CSVs + `MANIFEST.json` always upload. The `.last_manifest.json`
is rewritten only after a successful, verified push.

**First-run / absent-cache behavior:** if `.last_manifest.json` does not exist (first
run, or cache deleted), ALL files are treated as changed → full upload. We do NOT
consult Drive to seed the cache; a full re-upload is safe and idempotent (overwrites
by filename via the existing `files().update` path).

**Stale-file cleanup (auto-prune — so the user never deletes files manually):** because
this project (a) reorganizes the flat KB folder into `live/`/`catalog/`/`slim/`/
`notebooklm/` subfolders and (b) renames the category files (`wines_red_*` →
`wine_red_*`), the old files would otherwise linger as orphans. The orchestrator
reconciles each folder against the manifest: `files on Drive (via list_drive_files) −
files in this run's manifest for that folder = stale`. Stale files are moved to Drive
trash via `files().delete()` (which trashes, not hard-purges — 30-day recoverable). The
existing client already has `list_drive_files` and the full `drive` scope; the only
net-new call is `files().delete()`.

Two mandatory safety rails (Rule 10 — verify before the destructive step):
- **Prune is opt-in and report-first.** Without `--prune`, the run prints
  `STALE (would delete): …` per folder and touches nothing. The user eyeballs the list,
  then enables `--prune`. The 03:00 cron uses `--prune` only after the first watched run.
- **Abort-on-anomaly.** If pruning would remove >40% of a folder's existing files, or
  the generated manifest for that folder is empty, the script refuses to prune that
  folder and warns loudly (guards a half-built manifest from trashing the folder).

The old flat-root files are stale-by-definition under the new subfolder manifest, so the
first `--prune` run clears the entire old layout in one sweep — no manual hunting.

**Verification (Rule 1 / Rule 6 — no "done" without proof):** after the push the
script prints an explicit per-file table (uploaded / unchanged / bytes / rows), then
performs a **Drive re-fetch check** — resolves the uploaded `MANIFEST.json` file ID via
the existing `list_drive_files` helper, downloads it back with a **new
`files().get_media()` download helper (net-new deliverable — the existing sync script
only uploads/lists)**, and asserts `total_skus_in_stock` and file count match what was
generated. To avoid false failures from Drive read-after-write propagation lag, the
re-fetch uses **up to 3 retries with short backoff** before declaring FAIL. Mismatch
after retries → **non-zero exit, FAIL in launchd log**. Success is never claimed from
log lines alone.

**Error handling:**
- Any generator raises → abort before Drive push; prior Drive files stay intact.
- Drive auth/token failure → clear message pointing at `~/.config/wnlq9/gdrive_token.json`; non-zero exit; no partial state.
- `--dry-run` → build everything locally + write manifest, skip upload (canary/inspection before first real push — Rule 10).
- Row-count sanity: in-stock count drop >20% vs. last manifest → warn loudly (guards upstream DB glitch).

**Concurrency / snapshot consistency:** the bundle runs as step 3 of `scheduled_sync.sh`,
immediately after `refresh_live_export.py` (step 2) rewrites the 42MB source JSON. The
bundle **reads `live_products_export.json` exactly once into memory at start** and
operates on that snapshot for the whole run — so a subsequent rewrite cannot produce a
half-built bundle. A simple **lockfile** (`~/.config/wnlq9/drive_bundle.lock`) prevents
a manual run from colliding with the 03:00 cron run; if the lock is held, the second
invocation exits early with a clear message. (Project memory notes the shared DB can be
replaced by a parallel process between turns — reading a single in-memory snapshot is
the guard.)

**Integration test (Rule 6 invariant — zero-drop, all tiers):** all three tiers
(`catalog/`, `slim/`, `notebooklm/`) share the same `generate(items, out_dir)` grouping
logic, so a single guarantee covers them. The test asserts, for the FULL in-stock set
(all 6,206): every SKU appears in `inventory_live.csv` AND in exactly one file per tier
(grouped by `category_group` + the Wine sub-rule, `Unknown` bucket as safety net). The
test runs the assertion against **each of the three tier output dirs** so a regression
in any one is caught. Fails if even one in-stock SKU lands in zero files in any tier —
the exact regression the old `classification`-grouping bug (`if group is None:
continue`) would cause.

---

## 7. Size & daily-update feasibility (the brief's Q2 answer)

In-stock = 6,206 SKUs (~52% of the 11,934 that produce today's 42MB).

| Tier | Files | Est. size | Upload freq |
|---|---|---|---|
| `live/` | 2 CSVs | ~1.6 MB | daily |
| `catalog/` | 15 JSON (§4 taxonomy) + tsv + archive | ~22 MB | on-change |
| `slim/` | 15 JSON + tsv + prompt | ~6 MB | on-change |
| `notebooklm/` | 15 txt + index + prompt | ~8 MB | on-change |

(Counts follow the concrete §4 file taxonomy; the manifest is still enumerated from
disk, so the estimate is documentation only, not load-bearing.)
| manifest+readme | 2 | <100 KB | daily |
| **Total footprint** | | **~38 MB** | |
| **Typical DAILY upload** | live + manifest | **~1.7 MB/day** | ✅ |
| **Enrichment-day upload** | + changed catalog | up to ~38 MB | occasional |

**Verdict:** daily update is comfortable. A normal day pushes ~1.7MB, not 42MB — this
*reduces* current daily bandwidth. Full rebuild (~38MB) over the existing OAuth client
is a sub-minute upload. No new infrastructure, no rate-limit risk.

---

## 8. Scheduling

`export_drive_bundle.py` replaces the direct call to
`sync_ai_knowledge_base_to_drive.py` inside `scripts/scheduled_sync.sh` (03:00
launchd, `com.wnlq9.daily-sync`). One line changes. The 03:00 job already runs
`refresh_live_export.py` immediately before, so the source JSON is fresh.

---

## 9. Testing plan

1. **Unit:** in-stock filter returns 6,206; live CSV contains exactly the sellable rows; hash-gate skips an unchanged file and uploads a changed one; manifest entries match files on disk.
2. **Integration (Rule 6):** the DB→file invariant test in §6.
3. **`--dry-run` canary:** build full bundle locally, eyeball `MANIFEST.json` + one file per tier, confirm counts — before first real Drive push (Rule 10).
4. **First live run:** manual, watched, verification table + Drive re-fetch check green — then hand back to the 03:00 cron.

---

## 10. Deliverables

- `scripts/export_drive_bundle.py` (new orchestrator: lock → snapshot-read → filter → generate tiers → shared artifacts → manifest → hash-gated push → re-fetch verify).
- **Refactor of `export_ai_knowledge_base.py` / `_slim.py`**: expose `generate(items, out_dir)` that **groups by `category_group`/`category_type` (Rule 12), with an `Unknown` catch-all so no SKU is dropped**; keep `__main__` behavior (full list → legacy `docs/ai-knowledge-base*` dir).
- New live-CSV writer (`inventory_live.csv`, `pricing_promotions_live.csv`) + thin `products_all_archive.jsonl` writer.
- Shared-artifact handling: orchestrator generates `product_index_compact.tsv` once and copies into tiers; copies hand-maintained `system_prompt.md`/`.txt` into `slim/`/`notebooklm/` (no cross-generator output-dir reads).
- Extension of the Drive layer: tiered-subfolder upload, hash-gated skipping, a **new `files().get_media()` download helper** for the re-fetch verification, and **auto-prune** (stale-file reconciliation via `files().delete()`, `--prune` opt-in + report-first + abort-on-anomaly per §6).
- `product_url` added to the export allowlist in `refresh_live_export.py` (empty-tolerant).
- Tests per §9.
- One-line edit to `scripts/scheduled_sync.sh`.
- `MANIFEST.json` + `README.md` generation; `.last_manifest.json` local cache.

## 11. Acceptance criteria

- Drive root has `MANIFEST.json` + `README.md` + `live/` + `catalog/` + `slim/` + `notebooklm/`.
- `live/inventory_live.csv` and `live/pricing_promotions_live.csv` contain exactly the 6,206 in-stock SKUs.
- **All 6,206 in-stock SKUs appear in exactly one `catalog/` category file — zero dropped** (grouped by `category_group`/`category_type`, `Unknown` bucket catches the 498 blank + `Mineral Water` + pipe-dirty rows). Invariant test green.
- No grouping/routing anywhere branches on raw `classification` (Rule 12).
- Manifest lists every file with correct rows/bytes/sha256/updated_at/tier, **enumerated from files actually on disk** (not from the size estimate).
- A second consecutive run with no DB change uploads only `live/` + `MANIFEST.json` (catalog/slim/notebooklm skipped by hash).
- Drive re-fetch check passes (manifest in-stock count == generated count); script exits 0 only then.
- `product_url` column present in export + CSVs (empty until source supplied), no crash on empty.
- Without `--prune`: stale old files (flat-root + `wines_red_*`) are reported, not deleted. With `--prune`: they are trashed; abort-on-anomaly refuses if >40% of a folder would be removed.
- $0 API spend.
```
