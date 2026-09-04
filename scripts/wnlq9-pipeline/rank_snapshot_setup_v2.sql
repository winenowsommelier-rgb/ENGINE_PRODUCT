-- ============================================================
-- WN / LIQ9 — Best Sellers rank snapshots  (v2, Aug 2026)
--
-- Changes from v1 — see CHANGE 1..4 inline:
--   1. No anon read access. units/orders must never be publicly
--      reachable (spec §6).
--   2. Top 10 per segment, not top 5 — the pages render 10.
--   3. Week boundary computed in Asia/Bangkok, not UTC.
--   4. Optional prefix guard on site assignment.
--
-- STILL NOT APPLIED. Review, then run in the Supabase SQL editor.
-- ============================================================

create table if not exists rank_snapshots (
  id            bigserial primary key,
  snapshot_date date        not null,          -- the Monday (Bangkok) of the ranking week
  site          text        not null,          -- 'WN' | 'LQ'
  lens          text        not null,          -- 'band' | 'country'
  segment_key   text        not null,          -- 'b1'..'b5' | 'France', 'Scotland', ...
  rank          int         not null,          -- 1..10   << CHANGE 2 (was 1..5)
  sku           text        not null,
  units         int         not null default 0,-- sold_qty at snapshot time — INTERNAL ONLY
  orders        int         not null default 0,-- INTERNAL ONLY
  price         numeric,
  created_at    timestamptz not null default now(),
  unique (snapshot_date, site, lens, segment_key, rank)
);

create index if not exists idx_rank_snap_lookup
  on rank_snapshots (site, lens, segment_key, snapshot_date desc);
create index if not exists idx_rank_snap_sku
  on rank_snapshots (sku, snapshot_date desc);

-- ------------------------------------------------------------
-- CHANGE 1 — access
--
-- v1 granted `select` on this table to `anon`. That exposes the
-- `units` and `orders` columns at /rest/v1/rank_snapshots to
-- anyone with the public anon key, which is printed in any
-- client bundle. Spec §6: sales quantities must not be in the UI
-- OR the payload. A REST endpoint is strictly worse than
-- view-source, so: no anon policy at all.
--
-- The page generator reads this table through the MCP connector
-- (service role) at build time, so nothing client-side needs it.
-- ------------------------------------------------------------
alter table rank_snapshots enable row level security;
drop policy if exists rank_snapshots_read on rank_snapshots;
-- (no policies => only the service role can read or write)

-- If you ever DO need client-side reads, expose this instead —
-- it has no units/orders columns to leak:
--
-- create or replace view rank_snapshots_public as
--   select snapshot_date, site, lens, segment_key, rank, sku, price
--   from rank_snapshots;
-- grant select on rank_snapshots_public to anon, authenticated;


-- ============================================================
-- WEEKLY JOB — run every Monday BEFORE regenerating the pages.
-- Writes this week's top 10 for all 30 segments.
-- Ordering is identical to the page generator (spec §4B).
-- ============================================================
insert into rank_snapshots (snapshot_date, site, lens, segment_key, rank, sku, units, orders, price)
with b as (
  select *,
         -- CHANGE 4 — site assignment.
         -- v1: left(sku,1)='W' => WN, everything else => LQ.
         -- That sweeps 538 live non-W/non-L products into LIQ9,
         -- including barware (prefix A: "Jiggers Black Pull Lever
         -- Corkscrew") and non-alcoholic mixers (prefix N: Monin
         -- syrups, country=France). None reach a top 10 as of
         -- 2026-08-21, but the pool is thin — 584 of 11,934
         -- products have any sales — so guard it now.
         case when left(sku,1) = 'W' then 'WN'
              when left(sku,1) = 'L' then 'LQ'
              else 'EXCLUDE' end as site,
         case when price < 1500  then 'b1'
              when price < 3000  then 'b2'
              when price < 5000  then 'b3'
              when price < 10000 then 'b4'
              else 'b5' end as band
  from products
  where price > 0 and coalesce(is_active,1) = 1
),
bb as (select * from b where site <> 'EXCLUDE'),
by_band as (
  select site, 'band' as lens, band as segment_key, sku,
         coalesce(sold_qty,0) units, coalesce(sold_orders,0) orders, price,
         row_number() over (
           partition by site, band
           order by coalesce(sold_qty,0) desc, coalesce(sold_orders,0) desc,
                    coalesce(popularity_score,0) desc, coalesce(score_max,0) desc, price desc
         ) rn
  from bb
),
by_country as (
  select site, 'country' as lens, country as segment_key, sku,
         coalesce(sold_qty,0) units, coalesce(sold_orders,0) orders, price,
         row_number() over (
           partition by site, country
           order by coalesce(sold_qty,0) desc, coalesce(sold_orders,0) desc,
                    coalesce(popularity_score,0) desc, coalesce(score_max,0) desc, price desc
         ) rn
  from bb
  where (site = 'WN' and country in ('Australia','Italy','France','Chile','New Zealand',
                                     'Spain','USA','Argentina','Thailand','South Africa'))
     -- NB: 10 countries here, incl. Thailand. Spec §4 lists only 9
     -- for LQ — the spec is the one missing a line (§2 says 15 segments).
     or (site = 'LQ' and country in ('Scotland','USA','England','Ireland','France',
                                     'Japan','Italy','Mexico','Thailand','Netherlands'))
)
-- CHANGE 3 — week boundary in Bangkok, not UTC. date_trunc('week', now())
-- on a Monday before 07:00 ICT still resolves to the PREVIOUS Monday, which
-- then collides with last week's rows on the unique constraint and the
-- `do update` below silently overwrites your comparison baseline.
select date_trunc('week', (now() at time zone 'Asia/Bangkok'))::date,
       site, lens, segment_key, rn, sku, units, orders, price
from (select * from by_band    where rn <= 10   -- CHANGE 2 (was 5)
      union all
      select * from by_country where rn <= 10) x
on conflict (snapshot_date, site, lens, segment_key, rank) do update
  set sku = excluded.sku, units = excluded.units,
      orders = excluded.orders, price = excluded.price;


-- ============================================================
-- READ QUERY — feeds `prev` into the page generator.
-- Unchanged from v1 apart from inheriting top-10 rows.
-- Returns NULL prev_rank for a SKU not ranked last week
-- (renders as "เริ่มต้น" / new entry).
-- ============================================================
with dates as (
  select distinct snapshot_date from rank_snapshots order by snapshot_date desc limit 2
),
cur  as (select * from rank_snapshots where snapshot_date = (select max(snapshot_date) from dates)),
prev as (select * from rank_snapshots where snapshot_date = (select min(snapshot_date) from dates)
         and (select count(*) from dates) = 2)
select c.site, c.lens, c.segment_key, c.rank, c.sku,
       p.rank as prev_rank,
       case when p.rank is null then null else p.rank - c.rank end as delta
from cur c
left join prev p
  on p.site = c.site and p.lens = c.lens
 and p.segment_key = c.segment_key and p.sku = c.sku
order by c.site, c.lens, c.segment_key, c.rank;
-- NB: c.units deliberately dropped from this select. The generator
-- never needs it and it should not travel further than this table.


-- ============================================================
-- NOTES / CAVEATS  (carried from v1, still true)
-- ============================================================
-- 1. `sold_qty` is a rolling 365-day total, not weekly sales. Movement
--    will be slow. popularity_qty_90d is numeric and entirely NULL; if it
--    gets populated, swap the ORDER BY for livelier rankings.
--
-- 2. popularity_synced_at was 2026-07-21 21:13 UTC and is UNCHANGED as of
--    2026-08-21 — one month stale. Until that sync runs weekly, every
--    snapshot repeats and every row reads "คงที่". Confirm the cadence
--    before turning the arrows on; the first two snapshots will otherwise
--    be identical by construction.
--
-- 3. Segment membership can change (a price change moves a product across
--    a band). The join is on SKU within the same segment, so a product that
--    moves bands reads as a new entry in its new band. Intentional.
