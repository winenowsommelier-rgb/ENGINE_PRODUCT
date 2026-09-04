# WNLQ9 — the three sync jobs

_Written 28 August 2026. Everything below was measured against Supabase project
`dsyplzckfezcxiuikkfm` on that date._

This is written to be pasted as a session prompt or handed to the developer as
a brief. Sections 0–2 are the diagnosis and the acceptance tests; section 3 is
the work itself.

---

## 0. THE PROMPT — paste this to start the work

> Build the three WNLQ9 data sync jobs specified in `SYNC-SPEC.md`, in the
> order given. Supabase project `dsyplzckfezcxiuikkfm`, table `products`.
>
> Read §1 first — the premise most likely to trip you up is that these jobs do
> not exist yet and are not broken. Do not go looking for a scheduler to fix.
>
> Each job has an acceptance test in §3 that must pass before the next job
> starts. After each job lands, update `feeds.json` in the build pipeline and
> re-run `python3 freshness.py` — the gate is what proves the job is actually
> running on a schedule rather than having been run once by hand.
>
> Do not apply `rank_snapshot_setup_v2.sql` as part of this work. It depends on
> job 2 running twice on a schedule, and it is a production schema change that
> needs Pawin's explicit go-ahead.

---

## 1. THE DIAGNOSIS

The catalog is not being kept up to date by a job that broke. There is no job.
Three separate one-off imports left three separate timestamp columns frozen:

| Column | Newest value | Rows stamped | Rows in table |
|---|---|---|---|
| `products.synced_at` | 2026-03-24 | 2,830 | 6,388 |
| `products.popularity_synced_at` | 2026-07-21 | **122** | 6,388 |
| `products.bi_synced_at` | 2026-05-31 | — | 6,388 |

`popularity_synced_at` being set on 122 rows while 3,255 rows carry a
`popularity_qty_90d` value is the clearest tell: the popularity numbers arrived
through a bulk load that never stamped anything, and the 21 July run touched
122 products. `updated_at` shows where the real activity has been — 5,443 rows
on 2026-06-25 and 226 on 2026-08-22, both enrichment batches, not syncs.

Three consequences are already visible in the published pages:

- **Best-seller rankings are a July snapshot** presented as current. Every one
  of the 52 markup tests passed while this was true, because all 52 checked the
  HTML and none checked the age of the data behind it.
- **`quantity_in_stock` is 0 on all 6,388 active products**, and so is
  `wn_stock`. The only real quantities in the whole system come from the sales
  team's stock-check tickets.
- **Products live in Magento are missing from `products` entirely.** Six SKUs on
  the current clearance and trending lists have no row at all: `WRW5835AF`,
  `WRW6041HR`, `WSP9035AB`, `WSP9046WN`, `WWW6325WN`, `WWW6326WN`. Case and
  multipack SKUs with a `-N` suffix (`WRW5477DW-6`, `WRW5266DW-6`) are also
  absent. These are almost certainly products created after the March import.

One more, found while switching `links.py` onto Supabase: `WWW5371AB` and
`WWW5372AB` are stored as `"Nollen Erben\t Mosel Riesling Spatlese"` — with a
literal TAB inside `name` — and both have a null `magento_item_url`. That is the
same delimiter-inside-item-name bug that has always broken the CSV export,
except here it was frozen into the database at import time and took the URL with
it. Whatever writes `products` must quote or escape properly; see §3.1.

---

## 2. TARGET STATE

One source of truth (Supabase), four scheduled feeds into it, and a build that
refuses to publish anything stale.

| Feed | Cadence | Writes | Feeds which page section |
|---|---|---|---|
| Products | nightly | catalog fields, prices, stock, URLs, images | everything |
| Popularity | weekly | `popularity_*` | best sellers |
| Stock-checks | on write | new `stock_checks` table | trending, unmet-demand |
| Clearance | per campaign | stays a manual CSV — correctly | clearance page |

Clearance stays manual on purpose. It is a supplier negotiation, not a feed.

The gate that enforces this already exists in the pipeline: `freshness.py` reads
`feeds.json`, and each build calls `freshness.check()` before writing a single
byte. Right now it stops `build5.py` and `build6.py` cold because `popularity`
is 38 days old against a 14-day limit. **When a job lands, its entry in
`feeds.json` gets its real `as_of`, and the gate stops firing on its own. If it
still fires, the job is not running.**

---

## 3. THE JOBS

### 3.1 Products sync — nightly — do this one first

Everything else assumes the catalog is current, so this is the foundation.

**Direction.** Magento → Supabase `products`. One-way. Supabase is a read
replica for the storefront-adjacent tooling; nothing writes back to Magento.

**Fields.** `sku`, `name`, `brand`, `vintage`, `bottle_size`, `price`,
`special_price`, `cost`, `margin_thb`, `is_in_stock`, `custom_stock_status`,
`quantity_in_stock`, `wn_stock`, `country`, `region`, `magento_item_url`,
`image_url`, `websites`, `is_active`.

**Requirements**

1. **Stamp `synced_at` on every row the job touches**, not just changed rows.
   Freshness must be measurable per row, so the gate can tell "unchanged" from
   "never looked at". This is the single most important line in this section.
2. **Upsert on `sku`, and insert rows that do not exist yet.** The six missing
   SKUs above must appear after the first run. Include `-N` case and multipack
   SKUs — they are real, sellable products that customers ask for.
3. **Escape properly.** If the transport is delimited text, quote every field.
   The two `Nollen Erben` rows are proof this has bitten twice already, once in
   the CSV export and once in the import that created these rows. Prefer JSON or
   a direct DB connection over CSV.
4. **Deactivate, do not delete.** Products that vanish from Magento get
   `is_active = 0`. The pages read history; hard deletes break past snapshots.
5. **Decide `quantity_in_stock` explicitly.** Two acceptable outcomes, and doing
   neither is not one of them:
   - *Sync it.* Populate real Magento quantities. The trending page can then
     stop treating the ticket sheet as a stock authority.
   - *Drop it.* Remove both `quantity_in_stock` and `wn_stock` from the table
     and make the ticket sheet the documented sole authority.

   Today the pages read a field that is 0 for every product while the real
   numbers sit somewhere else. That ambiguity is worse than either answer.

**Acceptance test**

```sql
-- 1. every active row was looked at in the last 48 hours
select count(*) from products
 where is_active = 1 and (synced_at is null or synced_at < now() - interval '48 hours');
-- expect 0

-- 2. the six known-missing SKUs now exist
select count(*) from products where sku in
 ('WRW5835AF','WRW6041HR','WSP9035AB','WSP9046WN','WWW6325WN','WWW6326WN');
-- expect 6

-- 3. no control characters made it into a text field
select count(*) from products where name ~ '[\t\n\r]';
-- expect 0

-- 4. the stock decision was actually made
select count(*) filter (where quantity_in_stock > 0) from products where is_active = 1;
-- expect either a realistic non-zero count, or the column to no longer exist
```

Then set `feeds.json → catalog.as_of` to the run date, raise its severity from
`warn` to `blocking`, and drop `max_age_days` to 3.

---

### 3.2 Popularity job — weekly

**What it computes.** Units and orders per SKU over a fixed trailing window,
written to `popularity_qty_90d`, `popularity_orders_90d`,
`popularity_revenue_90d`, `popularity_score`, with `popularity_synced_at` set on
**every** row — including rows whose value is zero, so absence of sales is
distinguishable from absence of a run.

**Settle the window while you are in here.** `popularity_window_days` reads 365
on every row, which contradicts the `_90d` column names. Evidence that it is
genuinely 365: across the 582 products carrying both figures,
`popularity_qty_90d` runs a median 4.78× `sold_qty` — close to the 4× you would
expect from a year against a quarter. That is suggestive, not proof, and there is
no orders table in the project to settle it from the data alone.

Two acceptable outcomes:

- The job computes a real 90-day window, and `popularity_window_days` is
  corrected to 90.
- The figure is annual, and the columns are renamed to `_365d` throughout —
  including in `bs2_*.tsv` and the ordering key in `build5.py`.

Until one of these lands, **the pages must continue to state no period at all.**
They currently do this deliberately. Do not add "ขายดีใน 90 วัน" to a heading
before the window is confirmed.

**Acceptance test**

```sql
select count(*) from products where is_active = 1 and popularity_synced_at is null;
-- expect 0  (today: 6,266)

select distinct popularity_window_days from products where is_active = 1;
-- expect exactly one value, and it must match the column names

select max(popularity_synced_at) from products;
-- expect within 8 days, on two consecutive weeks
```

Then set `feeds.json → popularity.as_of` and drop `WNLQ9_ALLOW_STALE` from the
build command. **Verify by running `python3 build5.py` with no override and
watching it succeed** — that is the real test, not the SQL.

Only after this job has run on two consecutive weeks does
`rank_snapshot_setup_v2.sql` become worth applying. Applied earlier it would
snapshot the same frozen ranking twice and render movement arrows that all say
"no change" — worse than showing nothing, because it looks like information.

---

### 3.3 Stock-checks feed — on write

**Today.** The "WNLQ9 Internal Team Ticket Stock Check" Google Sheet is exported
by hand, sliced, and dropped into the pipeline as `stock_checks.csv`. Only the
August slice has ever been loaded — 399 rows, 17–26 August.

**Target.** An Apps Script `onEdit`/`onChange` trigger, or an n8n workflow on a
15-minute poll, appending new ticket lines into a Supabase table:

```sql
create table stock_checks (
  ticket      text        not null,
  line_no     int         not null,
  date        date        not null,
  sku         text        not null,
  name        text,
  qty         numeric,
  stock_raw   text,               -- free text, parsed downstream, never at write
  client      text        not null,
  synced_at   timestamptz not null default now(),
  primary key (ticket, line_no)
);
create index on stock_checks (date desc);
create index on stock_checks (sku);
```

**Requirements**

1. **Store `stock_raw` verbatim.** It arrives as free text in several shapes —
   `มีของ`, `stock 100+ ร้าน 24`, `100/2020`, `WN=10`, `oos`, `catalog`.
   `prep3.py` already parses all of them. Parsing at write time destroys
   information and moves the logic away from where it is tested.
2. **Backfill the full sheet history on first run.** This is what deepens the
   demand pool past 35 qualified SKUs and re-enables the "new this week" marker,
   currently auto-suppressed because 39 of 50 items looked new against an
   August-only window.
3. **Never let this table reach a customer page unaggregated.** It contains
   client names. The published pages show a demand tier chip and nothing else —
   no client counts, no ticket counts, no raw demand numbers. That rule is
   Pawin's and it is not negotiable.

**Acceptance test**

```sql
select min(date), max(date), count(*), count(distinct client) from stock_checks;
-- expect min well before 2026-08-17, and max within 2 days of today

select count(*) from stock_checks where stock_raw is null;
-- expect 0
```

Then point `prep3.py` at the table instead of the CSV and set
`feeds.json → stock_checks.as_of` from `max(date)`.

---

## 4. AFTER ALL THREE

The build still runs in a sandbox that cannot reach Supabase — which is why
`links_cache.tsv` exists and is refreshed by hand from an assistant session. Once
the three jobs are live, move the build to a host with network access and the
whole thing becomes a weekly cron:

```
prep3.py → build5.py → build6.py → verify.py
prep_clr.py → build_clr2.py
unmet.py
```

At that point `links.py` can drop its CSV supplement path entirely and read
`magento_item_url` live.

**One open design question for Pawin, not for the developer.** When a feed does
go stale, the gate currently refuses to build. That protects against publishing
a fresh-looking page built on old data — but it leaves the *previous* page up,
which is equally old and says nothing about it. The stronger fix is a dated
provenance line in the affected section header — Thai first, e.g.
`ข้อมูลการขายอัปเดตล่าสุด 21 ก.ค. 2569`. That is a visible change to a page
design Pawin set, so it needs his sign-off before it goes in.
