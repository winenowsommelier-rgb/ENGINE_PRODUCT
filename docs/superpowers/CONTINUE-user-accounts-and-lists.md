# Continue: User Accounts + Lists

## Start here

Read the approved spec first: `docs/superpowers/specs/2026-08-22-user-accounts-and-lists-design.md`

It covers Supabase auth (email/password + verification), profile settings
(username + avatar), and full list CRUD (create/name/add/remove items with
quantity, public/private toggle, screenshot-friendly `public_id` codes like
`WNL-7K2Q9`). The spec was reviewed twice by a spec-document-reviewer
subagent — two CRITICAL RLS/trigger-failure gaps were found and fixed, then
re-reviewed to PASS. Don't re-run brainstorming or spec review; the spec is
done. Go straight to implementation planning.

## What's already decided (don't re-ask)

- **Backend:** reuse the existing Supabase project `dsyplzckfezcxiuikkfm`
  ("WNLQ9 PI DB") — do NOT create a new project. This was a deliberate
  choice after discovering 3 existing Supabase projects in the org; see
  memory `project_intelligence_engine_app_discovered.md` for why.
- Price/total on a list respects the site's existing ฿-tier unlock gate
  **even for the list's own owner** — being logged in does not bypass it.
  Confirmed explicitly with the user twice.
- New lists default to **public**, not private.
- Unlimited lists per user; same SKU can appear in multiple lists.
- Item removal = hard delete, no undo. Whole-list delete = instant, no
  confirm dialog. Both explicitly requested ("easy like a cart").
- Initial username at signup = derived from email local-part; user edits
  later in `/account/settings`.
- Avatar: upload to Supabase Storage, or a generated identicon default.

## Next concrete step

1. Apply the `profiles` / `lists` / `list_items` migration (schema is fully
   specified in the spec doc, including RLS policies) to
   `dsyplzckfezcxiuikkfm` via the Supabase MCP `apply_migration` tool.
2. Verify the migration with `list_tables` / `execute_sql` before writing
   any app code — confirm RLS is enabled and the policies match the spec
   (especially: `profiles` must NOT have a blanket table-level `select`
   grant — only `id`/`username`/`avatar_url` are public, via a
   `public_profiles` view or column-scoped policy, per the spec's fix for
   the CRITICAL finding from review).
3. Once schema is confirmed live, invoke the `writing-plans` skill to turn
   the spec into a step-by-step implementation plan (auth pages, middleware,
   `@supabase/ssr` wiring in `apps/catalog`, list CRUD UI, etc.).

## Known unresolved item (separate from this feature, don't block on it)

`.env.local` and `lib/supabase/config.ts`/README disagree on which Supabase
project is canonical (`dsyplzckfezcxiuikkfm` vs `xfcvliyxxguhihehqwkg` —
the env var wins at runtime, docs are stale). Since this feature is
deliberately using `dsyplzckfezcxiuikkfm` by explicit choice, this config
split doesn't block the accounts/lists work — but flag it to the user if it
becomes relevant (e.g. if `apps/catalog`'s own `.env.local` needs new
Supabase keys added for auth, make sure they point at
`dsyplzckfezcxiuikkfm` too, not the stale fallback ref).

## Full context

Memory entries with more detail: `project_user_accounts_and_lists.md`,
`project_intelligence_engine_app_discovered.md`,
`bug_dossier_sync_never_bumped_updated_at.md` (a tangential production bug
found and fixed while provisioning Supabase for this feature — already
resolved, no action needed, just context for why this session got paused
partway through).
