# Lane 6: Product Image Write-Back Readiness

Scope: `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT`

## What I verified

- Local product records already carry image fields in `data/db/products.json`.
- The app code already expects image fields in the local type layer and UI.
- The live Supabase `products` table definition in `supabase/schema.sql` does **not** define `image_url`, `image_scraped_url`, `image_local_path`, or `image_alt_text`.
- The live image upload route writes those fields directly to Supabase, so it will fail until the database schema accepts them.
- The main product `PATCH /api/products/[id]` route is not the blocker by itself; it forwards arbitrary fields straight through to Supabase.
- `supabase/schema.sql` currently contains unresolved merge-conflict markers, so it should not be treated as a clean canonical schema file until repaired.

## Minimum implementation plan

1. Add a dedicated Supabase migration that adds the missing product image columns.
2. Keep the columns nullable so existing rows are not broken.
3. Update the image write route only if needed to keep the payload aligned with the new columns.
4. Update the sync route so local image fields are included when products are published to Supabase.
5. Leave the general product PATCH route unchanged unless a later validation pass shows it needs field filtering.
6. Clean up `supabase/schema.sql` merge markers separately, or rely on the migration as the source of truth.

## Minimum patch set

### 1) New migration

Create a migration such as:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/supabase/migrations/002_product_image_fields.sql`

Recommended SQL:

```sql
alter table if exists products
  add column if not exists image_url text,
  add column if not exists image_scraped_url text,
  add column if not exists image_local_path text,
  add column if not exists image_alt_text text;
```

Notes:
- Keep all four fields nullable.
- No index is needed for these columns at this stage.
- If the live DB already has one or more of these columns, the `if not exists` form keeps the migration safe.

### 2) Sync route

Update:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/app/api/settings/sync/route.ts`

Minimum change:
- include `image_scraped_url` and `image_local_path` in the payload pushed to Supabase
- keep `image_url` and `image_alt_text` in place

Reason:
- this is the main path that persists validated local products to Supabase in bulk
- once the DB schema accepts the columns, the sync route should preserve the full image metadata instead of dropping it

### 3) Image upload route

Review/update if needed:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/app/api/products/[id]/image/route.ts`

Current behavior:
- writes `image_url`, `image_local_path`, `image_alt_text`
- conditionally writes `image_scraped_url`

Recommended behavior after migration:
- keep the current payload
- do not add extra validation logic unless the live Supabase write still rejects one of the fields

### 4) Schema file cleanup

Repair or avoid depending on:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/supabase/schema.sql`

Why:
- it contains unresolved conflict markers
- that makes it unsafe as a canonical schema reference

Minimum safe choice:
- treat the new migration as the canonical change
- defer schema file cleanup to a separate small task

## Exact files that would change

If implemented fully, the change set should be limited to:

- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/supabase/migrations/002_product_image_fields.sql`
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/app/api/settings/sync/route.ts`
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/app/api/products/[id]/image/route.ts` only if a live write test still fails after migration
- `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/supabase/schema.sql` only if we choose to clean the conflict markers in the canonical schema file

## Direct-write readiness criteria

The product image write-back path is safe when:

- the Supabase `products` table has all four image columns
- the sync route includes the same columns
- the image upload route succeeds on a live `PATCH`
- a round-trip GET confirms the fields persist

## Recommended next step

Apply the migration first, then run one live product-image write on a known SKU to confirm the write path before bulk staging.
