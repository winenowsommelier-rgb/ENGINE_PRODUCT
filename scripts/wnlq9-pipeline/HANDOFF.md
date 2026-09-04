# WNLQ9 — design and process handoff

_State as of 31 August 2026. Supersedes the 28 August HANDOFF.md, which described
a 10-deep pipeline with a clearance page and no automation._

---

## 1. THE PROMPT — paste this to start the session

> Continue the WNLQ9 trending / best-seller / explorer page work.
>
> **Attached:** this handoff and `wnlq9-pipeline.zip` (all generators, all
> derived data, the SQL, the automation).
>
> **Do this first, before changing anything:**
> 1. Unzip into your working directory and read §3–§7 below.
> 2. `python3 refresh.py --offline` — rebuilds all three pages from the files on
>    disk and runs verification. Expect `build5.py` and `build6.py` to **stop
>    on the stale popularity feed** — that stop is the freshness gate working,
>    not a bug — and therefore expect verification to report **16/16 across 1
>    page**, because `unmet-demand.html` is the only page that gets built and so
>    the only one that gets checked. `refresh.py` exits 1.
>    The full **67/67 across 4 pages** is not reachable from a clean `--offline`
>    run while popularity is stale: it needs the three gated pages, which needs
>    `WNLQ9_ALLOW_STALE=popularity` on one deliberate build. Corrected 4 Sep
>    2026 — the previous wording asked for both outcomes at once, so a session
>    seeing 16/16 could not tell a broken package from a wrong instruction.
> 3. Report the numbers before you touch anything.
> 4. Fresh catalog data comes from Supabase via the MCP connector, project
>    `dsyplzckfezcxiuikkfm`. Do **not** use bash curl or web_fetch — the sandbox
>    has no route to it. That constraint is why every feed is a file.
>
> **Non-negotiable, all set explicitly by Pawin:**
> Never invent a critic score, vintage, producer fact, tasting note or sales
> figure. Never show sales quantities, client counts, cost, revenue or margin —
> those rank only, and must not reach the markup or the JSON payload. Stock
> shows as a level; exact figures only at 12 bottles or fewer. Thai is the
> default and English is hand-written, never machine-translated in either
> direction. Spirits link to `th.liq9.asia`, everything else to
> `th.wine-now.com`.

---

## 2. WHAT EXISTS

| Page | Views | Depth |
|---|---|---|
| `wine.html` | trending · best sellers · explorer | 50 + 4 type tabs · 20 segments / 400 rows · 20 |
| `liquor.html` | same | 50 + 6 type tabs · 23 segments / 460 rows · 16 |
| `wnlq9.html` | same, both catalogs | 50 + 10 type tabs · 18 segments / 360 rows · 20 |
| `unmet-demand.html` / `.csv` | **internal** — demand that came back out of stock | 48 |

Live Google Sites embeds:
`wine.html` → https://sites.google.com/view/wine-now-trending/home
`liquor.html` → https://sites.google.com/view/liq9-trending/home
`wnlq9.html` → **no Sites page yet.** Once created, cross-link all three.

The supplier clearance campaign is finished. Its page and generator are gone and
should not come back.

---

## 3. THE THREE VIEWS, AND WHY THEY ARE THREE

This is the core of the design. Each view answers a different question and must
not be allowed to blur into the others.

**มาแรง / Trending — "what are customers asking for right now."**
Source: stock-check tickets. A salesperson raised a ticket because a client
asked for a bottle, so it is a *demand* signal and it leads sales. Never a sales
claim.

**ขายดี / Best sellers — "what actually sold."**
Source: order data. This view makes a factual claim about sales, which is why
margin may only break ties and why the producer cap does *not* apply here — see
§5.

**น่าค้นหา / Explorer — "worth mentioning, and here is why."**
Neither a ranking nor a demand list. Every row carries a chip stating the reason
it appears; a bottle with no statable reason does not appear. That rule is what
stops the shelf quietly becoming a place to park slow stock, which is what
happens to every "curated" section eventually.

---

## 4. DATA SOURCES AND THEIR AUTHORITY

| Feed | Source | Authority for | State on 31 Aug |
|---|---|---|---|
| Demand | Stock_Checks tab, WNLQ9 Internal Team Ticket Stock Check sheet | which SKUs are in demand, and stock quantity | manual CSV slice, 17–26 Aug |
| Sales | `products.popularity_qty_90d` — **or** the MReport sheet | best-seller ranking | popularity frozen at 21 Jul; MReport path added, see §8 |
| Prices, scores, copy, images, URLs | Supabase `products` | everything rendered | catalog `updated_at` max 22 Aug |

### The diagnosis you need to carry

**These are not jobs that broke. They are jobs that were never built.**
`popularity_synced_at` is set on **122 of 6,388 rows** while 3,255 rows carry a
popularity value — so the numbers arrived in a bulk load that stamped nothing,
and one partial run on 21 July touched 122 products. `products.synced_at` is
2026-03-24 on 2,830 rows. Do not go looking for a scheduler to fix.

### Things that will bite you

- **`quantity_in_stock` is 0 on all 6,388 active products**, and so is
  `wn_stock`. The only real quantities are on the ticket sheet.
- **Six SKUs are live in Magento and absent from `products` entirely** —
  `WRW5835AF`, `WRW6041HR`, `WSP9035AB`, `WSP9046WN`, `WWW6325WN`, `WWW6326WN`,
  plus `-N` case SKUs. `links_supplement.csv` is the stopgap; delete it when the
  products sync exists.
- **Unquoted delimiters inside product names have now bitten this stack four
  times** — in the URL export (14 rows), in `products.name` where
  `"Nollen Erben\t Mosel Riesling Spatlese"` took its URL with it, and in the
  MReport export where `Total (THB)` is written `3,439` unquoted. Every reader
  parses from the left for the fixed head and from the right for the fixed tail.
  **Assume every delimited export from this stack is unquoted until proven
  otherwise.**
- **`reputation_summary` is a grab bag.** ~400 rows hold only a critic's name,
  138 hold only "Brut.", 100 only "Reserva.". Only two patterns are safe to
  read: `Top N% by sales` and `top N% of their reviews`. Ignore the rest.
- **`acidity` and `tannin` are populated on spirits**, where they are a default
  and not a measurement — The Botanist gin carries tannin 1, acidity 3. A
  distilled spirit has no grape-skin tannin. `bsdata.GAUGES_FOR` (`bsdata.py`
  line 195) gates which gauges are meaningful per category at build time.
  **Nothing verifies the built output**, despite what §8 claimed until 4 Sep
  2026 — there is no gauge check anywhere in `verify.py`. The build-time gate is
  the only thing between a gin and a tannin bar, and it is unguarded.

---

## 5. SELECTION RULES

**Trending — 50 per page.**
1. Score demand: distinct clients over 30 days, last 7 weighted ×2. Count
   clients, not rows — one ticket can be 17 lines from one wholesale buyer.
2. Core = 2+ distinct clients, sellable, ordered by demand alone.
3. Fill to 50 from single-client asks, ordered availability → premium price →
   demand, tagged with the lighter `เพิ่งถูกถามหา` tier so a single ask never
   wears the same badge as a repeated one.
4. Exclude anything answered OOS or catalog-only; route those to `unmet.py`.
5. Dedupe by family, then apply the producer cap, then cut to 50.

**Best sellers — 20 per segment.** Ordering, in this exact priority:
```
qty desc, orders desc, popularity_score desc, score_max desc,
margin_thb desc, price desc
```
Margin is the **last tie-break before price**. It separates products that sold
the same and never lifts one above a product that outsold it. Pawin's decision,
30 Aug: a list ordered by anything other than sales stops being a best-seller
list, and that is the one thing that would cost trust with the customers who use
it to decide.

Three lenses: 5 price bands, 10 countries, product type. On `wnlq9.html` the
bands rank across both catalogs, plus 13 types, no country lens, and the brand
filter hides itself on the band lens because bands are a joint ranking.

**Producer cap — `build5.BRAND_CAP`, default 2.**
No house takes more than 2 rows in the ranked 50 **or in any type tab**. Inside
a tab the count runs across demand rows and top-up rows together — cap only the
demand half and the same house walks straight back in below the divider. Bols
held 7 of 20 liqueur rows before this; Monsoon Valley held 3 of the wine 50.
Overflow is deferred, not deleted: a bottle pushed out still appears elsewhere.

**The cap does not apply to best-seller segments.** Those state what sold. If
Bols really is four of the top twenty liqueurs, capping it would make the
ranking say something untrue.

**Type-tab top-up.** Where a category's demand pool is too shallow to fill 20,
the remainder comes from that category's best sellers, below a labelled divider,
carrying a `ขายดีในหมวดนี้` chip and no demand tier. `other` has no best-seller
segment to draw from and stays at its real depth — padding it would mean
inventing a category.

**Explorer reasons**, in ranking order: `editor` (from `explorer.json`, Pawin's
own pick and his own line, with an `until` date that retires it) · `iconic`
(`reputation_tier`, 16 products in 6,388) · `critic` (top 5% of a named critic's
reviews) · `score` (95+, critic always named) · `rare` (Grand Cru, Premier Cru,
Single Malt, XO, Gran Reserva, Limited, Vintage, DOCG) · `low` (≤12 bottles on
the ticket sheet **and** premium-priced — real scarcity only).

**Dedup.** No list shows the same product twice as different sizes or vintages.
Family key = name with the size parenthetical and any 19xx/20xx year stripped,
lowercased, punctuation collapsed. Winner: standard bottle first, then
popularity, then margin. Scope is per list, not global. Before dedup the
฿5,000–10,000 wine band showed 10 rows from 7 products, four Clerc Milon
vintages stacked.

---

## 6. WHAT EACH ROW CARRIES

- **Story line** — `region · designation · variety`, plus a rarity clause when
  the catalog supports one. Thresholds in `bsdata.py`: sales percentile shows
  only at 5% or better, critic percentile at 10% or better. A percentile
  persuades while it is rare; "top 20%" is filler and is dropped.
- **Gauges** — up to three level bars from the PIM: body, tannin, acidity,
  sweetness, peat. Normalised 1–5, except sweetness which stays 1–4 because the
  source only distinguishes four steps.
- **Reputation badge** — `iconic` and `premium` only. `established`, `everyday`
  and `unrated` cover most of the catalog, and a badge every row wears is not a
  signal.
- **Real discount percentage** where `special_price` exists, not just a struck
  price.
- **Critic score** exactly as stored, critic always named.
- **Stock** as a 3-bar gauge. Exact figure only at ≤12. Top band is
  `มีสต็อกเหลือมาก` — Pawin rejected `มีให้เลือกสบาย`. Zero → `สั่งจองล่วงหน้า`,
  never "0 left".
- **Vintage** only where confirmed. `[**VINTAGE MAY CHANGE]` in the source
  suppresses the year and tags `ยืนยันวินเทจก่อนสั่ง`.

**Thai glossaries needing Pawin's review before publishing:** `bsdata.PAIR_TH`
(~19 food pairings), `bsdata.GAUGE_TH` (5 gauge labels — ความเปรี้ยว for acidity
is the one most worth checking), `explorer.REASON` (6 reason chips). These are
fixed vocabularies written once, not a translation step in the build. Regions,
appellations and designations stay in Latin on the Thai side: they are what a
Thai buyer reads on the label and searches for.

---

## 7. THE PIPELINE

```
refresh.py                one command: pull every feed, rebuild, verify
  ├─ sql/01..07           every query as a versioned file
  ├─ prep3.py             Stock_Checks → demand scores
  ├─ build5.py            wine.html + liquor.html; also holds family(), dedupe(),
  │                       gauge(), blurb(), cap_producers(), brand_count(),
  │                       explorer_row(), the design system and shared JS
  ├─ build6.py            wnlq9.html — imports build5 and reuses its helpers
  ├─ unmet.py             internal unmet-demand report
  └─ verify.py            67 checks, run last
```

`RUNBOOK.md` is the companion to this file: it lists each of the six sources,
who can refresh it, and at what cadence — written so Pawin can tell at a glance
which requests are mine to fulfil and which are blocked on the developer.

Supporting modules: `links.py` (product URLs and images, Supabase cache with a
CSV supplement) · `bsdata.py` (best-seller records, story lines, gauges,
glossaries) · `explorer.py` (the Explorer shelf) · `freshness.py` (the staleness
gate) · `mreport.py` (order-based ranking, see §8).

Data files: `links_cache.tsv` · `bs_rank.tsv` · `bs_prod_wn/lq.tsv` ·
`bs_story.tsv` · `bs_gauge.tsv` · `stock_checks.csv` · `explorer.json` ·
`feeds.json` · `links_supplement.csv` · `cat_*.json` · `blurbs.tsv` ·
`trend_types.json` · `margin_ml.json` · `oos.txt`.

### The freshness gate — do not route around it

Every build calls `freshness.check()` before writing a byte. Each feed declares
when it was refreshed, how old it may get, and which sections depend on it.
`blocking` is reserved for a section that would assert something time-sensitive
and no longer true; everything else is `warn`, because a gate that fires on
everything gets overridden permanently.

Right now `popularity` is 41 days old against a 14-day limit, so `build5` and
`build6` stop. `WNLQ9_ALLOW_STALE=popularity` builds anyway, prints a loud
banner and records the override in `build_receipt.json`.

**`run_weekly.sh` deliberately omits that variable.** It is the obvious thing to
add to stop the cron job failing and it is exactly wrong: it would make every
future run publish stale data silently, which is the failure this was built to
catch. A page shipped in August carrying a July ranking, with all 52 markup
tests green — because all 52 checked the HTML and none checked the age of the
data behind it.

---

## 8. VERIFICATION — run all of these, report numbers

Last full run: **67/67 passing across 4 pages** — 17 checks each on `wine`,
`liquor` and `wnlq9`, plus 16 on `unmet-demand`, which correctly skips the
sales-quantity check because client counts are that internal report's whole
point. Reaching 67 needs all four pages present; see §1 step 2.

`node --check` on every page's script · CSS braces and tag structure balanced ·
every external anchor `target="_blank"`, no `target="_top"` · no
`localStorage`/`sessionStorage` · no bare `object-fit` · type floor ≥12px, every
control ≥44px · no Thai renders in EN mode · TH/EN spans in step · no duplicate
product family in any list · no margin, cost or sales quantity in rendered
content **or in the payload** · exact stock only 1–12 · host routing per SKU
prefix.

**Listed here until 4 Sep 2026 but never implemented:** *no tannin or acidity
gauge on a spirit row.* `verify.py` has no gauge check at all. It is the only
trap in §4 with nothing verifying it, and it is worth writing — but it needs the
three gated pages built to test against, so it lands after §10.1.

**Four test traps already hit — do not re-learn them.**
A verifier that finds no pages used to print `0/0 checks passing` and exit 1,
while `refresh.py` scraped that line, matched `0 == 0`, and logged
**"verification passed"** — the return code was never read. So a run that built
nothing reported success. Fixed 4 Sep 2026: `verify.py` now fails loudly on zero
pages, exits non-zero on any failure, and `refresh.py` honours the exit code and
rejects a zero-check pass. This mattered most for §10.3 — the moment the build
moves to another host, `OUT` and the directory `verify.py` reads can diverge, and
the old code would have called that green. All three now come from one
`WNLQ9_OUT`. It is the same failure as the 52 green markup tests, one layer up:
the checker was healthy and checking nothing.
The Thai-leak regex must exclude `฿` (U+0E3F sits in the Thai block) and the
language switcher. The margin check must run on rendered content, not raw HTML,
or it matches the CSS `margin:0`. The host-routing check must pair image and
href **within one card block** — hero cards are `<a href><img></a>` and list
rows are `<li><img>…<a href></a></li>`, so pairing across the document couples
card N's image to card N+1's link.

---

## 9. GOOGLE SITES CONSTRAINTS

1. `target="_top"` is silently blocked — nav must be `target="_blank"`.
2. No `localStorage`. Language auto-detects from `navigator.language`.
3. Relative hrefs resolve against the embed sandbox, not the site. Cross-links
   must be absolute Sites URLs.
4. If the embed is tall enough that the *parent* scrolls, `position: sticky`
   inside the iframe does nothing.
5. Images: `max-width`/`max-height`, never bare `object-fit` — Sites crops
   bottles.
6. Mobile in-app browsers (LINE, Facebook, Chrome mobile) force-invert without
   `<meta name="color-scheme" content="light only">` plus CSS overrides.
7. The language toggle must use `textContent` for every node except those
   flagged `data-html="1"`, or markup renders as literal text after a toggle.

---

## 10. STILL OPEN, roughly by value

1. **Wire up the MReport path and retire the popularity columns.** `mreport.py`
   exists and reads the MReport Item Performance tab — real monthly order data
   per SKU back to January 2023, refreshed weekly. It makes SYNC-SPEC §3.2
   unnecessary, settles the `_90d` vs `popularity_window_days = 365` argument by
   making the window an explicit setting, and lets the page finally state a
   period out loud. Set `MREPORT_CSV`, run `refresh.py`, confirm the ranking
   moves. **This is the single highest-value item on the list** — until it
   lands, half of every page is a July photograph.
2. **Publish the Stock_Checks tab as CSV** and set `STOCK_CHECKS_CSV`. Removes
   the last manual step, deepens the demand pool past the thin categories now
   topped up from best sellers, and re-enables "new this week" — currently
   auto-suppressed because the August-only window makes 46 of 50 items look new.
3. **Host the automation.** `refresh.py` + `run_weekly.sh`, Monday 06:00 Bangkok,
   on a machine with network access to Supabase. Needs `DATABASE_URL` and
   `pip install "psycopg[binary]"`.
4. **Products sync, Magento → Supabase, nightly** (SYNC-SPEC §3.1). Stamp
   `synced_at` on every row it touches. Insert the six missing SKUs. Decide
   `quantity_in_stock` explicitly — sync it or drop it, but stop reading a
   column that is 0 everywhere.
5. **Producer stories.** No such field exists. `reputation_summary` is not it.
   Web research is viable but needs a corroboration rule — two independent
   non-retail sources agreeing, stored in a reviewable file with source URLs,
   never fetched at build time. Sources disagree on basics: four say Colin
   Glaetzer founded Glaetzer Wines, three retail sites carrying identical
   syndicated copy say Ben did. 75 producers appear across the pages but the top
   30 cover two-thirds of rendered rows.
6. **Apply `rank_snapshot_setup_v2.sql`** — movement arrows are built and
   smoke-tested but render nothing without a previous snapshot. Only worth doing
   after the ranking source moves weekly; applied now it would snapshot the same
   frozen list twice and show arrows that all read "no change", which looks like
   information and is not. Needs Pawin's explicit go-ahead — production schema.
7. **A Sites page for `wnlq9.html`**, then three-way cross-linking.
8. **Thai selling-point copy.** English exists for 5,968 products; translating it
   would violate the hand-written rule. Needs the team.
9. **20 best sellers are flagged not-in-stock** and still hold high ranks. They
   show `สั่งจองล่วงหน้า`; four carry `custom_stock_status = CATALOG` and are
   never sellable, so they have the weakest case for a ranked slot.
10. **Reguta Altropasso** — 3 distinct clients, out of stock every time. Still
    the clearest buy signal in the window.

---

## 11. HOW PAWIN WORKS

Brief, directive messages, several items at once, little rationale. Corrections
arrive as a symptom rather than a fix — "too many Monsoon Valley" meant "add a
producer cap", not "delete those rows". He expects the underlying rule to be
derived from the complaint, and he will notice if a rule is relaxed quietly.
Structural changes get made decisively; an accordion UI was built and removed
entirely once it was wrong for the retail context.

Data integrity is enforced at the pipeline level, not the display layer — sales
figures were stripped from the JSON payload entirely rather than hidden in the
UI. Hold that line.
