-- Product Changelog — mirrors local JSON changelog for production queries
-- Every field-level change from any source writes here for audit + analytics.
--
-- Run in Supabase SQL Editor or: supabase db push

create table if not exists product_changelog (
  id              text primary key,
  product_id      text not null,
  sku             text not null,
  changed_at      timestamptz not null default now(),
  source          text not null,
  field           text not null,
  old_value       text,
  new_value       text,
  note            text
);

-- Fast filters for the most common queries
create index if not exists idx_changelog_sku          on product_changelog (sku);
create index if not exists idx_changelog_product_id   on product_changelog (product_id);
create index if not exists idx_changelog_source       on product_changelog (source);
create index if not exists idx_changelog_field        on product_changelog (field);
create index if not exists idx_changelog_changed_at   on product_changelog (changed_at desc);

-- Composite index for batch view (source + minute grouping)
create index if not exists idx_changelog_source_time  on product_changelog (source, changed_at desc);

-- Row-Level Security: read is public (for internal dashboard), write via service role only.
-- Adjust for your auth model; this keeps it open for local dev.
alter table product_changelog enable row level security;

create policy "allow read for all"
  on product_changelog for select
  using (true);

create policy "allow insert via service role"
  on product_changelog for insert
  with check (true);

-- Analytics view: batch summary (source + minute bucket)
create or replace view product_changelog_batches as
select
  source,
  date_trunc('minute', changed_at)              as batch_minute,
  min(changed_at)                               as started_at,
  max(changed_at)                               as ended_at,
  count(*)                                      as total_changes,
  count(distinct sku)                           as unique_skus,
  array_agg(distinct field order by field)      as fields_changed,
  max(note)                                     as note
from product_changelog
group by source, date_trunc('minute', changed_at)
order by batch_minute desc;

-- Helpful aggregate: field change counts for last N days
create or replace view product_changelog_field_stats as
select
  field,
  source,
  count(*)                  as change_count,
  min(changed_at)           as first_seen,
  max(changed_at)           as last_seen
from product_changelog
where changed_at >= now() - interval '90 days'
group by field, source
order by change_count desc;
