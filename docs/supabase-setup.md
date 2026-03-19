# Supabase setup

This project is pre-wired for the provided Supabase project reference `xfcvliyxxguhihehqwkg`.

## 1. Configure environment variables

Copy `.env.example` to `.env.local` and keep these values:

- `NEXT_PUBLIC_SUPABASE_URL=https://xfcvliyxxguhihehqwkg.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel`
- `SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xfcvliyxxguhihehqwkg.supabase.co:5432/postgres`

Replace `[YOUR-PASSWORD]` with the real database password only in your local environment or deployment secret store.

## 2. Apply the schema

You can apply `supabase/schema.sql` in either of these ways:

### Option A: SQL editor

1. Open the Supabase dashboard for the project.
2. Open the SQL editor.
3. Paste the contents of `supabase/schema.sql`.
4. Run the script.

### Option B: psql

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

## 3. What the app uses right now

- the public project URL and publishable key are exposed to the frontend through `lib/supabase/config.ts`
- `lib/supabase/client.ts` returns a browser-safe config object and request headers you can use for REST calls or future client wiring
- the direct database connection string is documented only for schema/application setup and should not be shipped with a real password committed to git

## 4. Recommended next step

Run the frontend first with local sample data, then add read policies or a protected backend layer before connecting live product reads.

## 5. For import saves from the frontend

If you want the Import Studio to persist validated rows from the browser:

- apply `supabase/schema.sql`
- enable insert access for the publishable key on `import_runs`, `import_run_rows`, `products`, and `flavor_profile`
- keep RLS strict for everything else, or route sensitive writes through a backend / Edge Function later
