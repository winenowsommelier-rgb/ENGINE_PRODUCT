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
- `lib/supabase/client.ts` creates a browser-safe client using the official `@supabase/supabase-js` library
- the direct database connection string is documented only for schema/application setup and should not be shipped with a real password committed to git

## 4. Recommended next step

Create read policies for the tables you want the frontend to query with the publishable key, or route writes through a secure backend layer / edge function.
