# User Accounts + Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Supabase-backed email/password accounts, profile settings, and full list CRUD (save-to-list "pin" action, list detail page, public profile page) to `apps/catalog`, the first live backend this static/JSON-driven storefront has ever had.

**Architecture:** `@supabase/ssr` cookie-based sessions via Next.js App Router middleware, layered alongside (not replacing) the existing bot-redirect middleware. Server actions do all Supabase writes; server components do reads. Product data for list items continues to resolve against the existing `data/live_products_export.json` via `getProductBySku`/`getAllProducts` (`lib/catalog-data.ts`) — Postgres never becomes a second source of truth for product data. Price display reuses the existing `PriceDisplay`/`usePriceUnlock` gate unmodified.

**Tech Stack:** Next.js 14 App Router, `@supabase/ssr` + `@supabase/supabase-js`, Postgres (already migrated — see `docs/superpowers/specs/2026-08-22-user-accounts-and-lists-design.md`), Vitest, Tailwind (existing utility patterns), `lucide-react` icons (existing convention).

**Database status:** The `profiles`/`lists`/`list_items` schema, RLS policies, `public_id` generator, and `handle_new_user` signup trigger are ALREADY LIVE on Supabase project `dsyplzckfezcxiuikkfm` ("WNLQ9 PI DB") — applied and security-hardened in a prior session (migrations `add_user_accounts_and_lists`, `fix_public_profiles_security_advisors`, `revoke_handle_new_user_public_execute`). This plan is app-code only. Do not re-run migrations; Task 1 only wires the client to the existing schema.

**Plan review status:** Reviewed twice by a plan-document-reviewer subagent; findings incorporated below (not a separate changelog — each fix is inline at its point of relevance with a comment explaining why). Notable fixes across both passes: `upsertListItem`, `setItemQuantityAction`, AND `removeItemAction` all explicitly bump the parent list's `updated_at` (Task 6) because the DB trigger only fires on `lists` table updates, not on child `list_items` writes — without this, "most-recently-used list" resolution would silently go stale (the second review pass caught that the first fix missed `removeItemAction`); avatar upload enforces a fixed MIME-type allowlist instead of trusting the client-supplied filename (Task 5); list item/total pricing goes through `resolveSale` to match sale-price handling used everywhere else in the codebase (Task 7); mutation server actions check affected-row-count so a stale/tampered list ID fails loudly instead of silently no-op'ing under RLS (Task 6); `SaveToListButton` gained a list-picker chevron (shown when the user has 2+ lists) that calls `addItemToListAction` directly, alongside a minimal "+ New list" form (both Task 7) — together these give the spec's "same SKU across multiple lists" requirement an actual reachable UI path, which the second review pass found was still missing after the first fix (the "+ New list" form alone let you create a second list, but nothing could target a SPECIFIC non-default list); Task 9 (header auth affordances) is resequenced before Task 10 (browser walkthrough) so the walkthrough's logout step doesn't need a dev-tools workaround.

---

## File Structure

```
apps/catalog/
  .env.local                          # MODIFY: add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
  .env.example                        # MODIFY: document the two new vars (no secrets)
  middleware.ts                       # MODIFY: compose session-refresh with existing bot-redirect
  package.json                        # MODIFY: add @supabase/ssr, @supabase/supabase-js

  lib/supabase/
    client.ts                         # CREATE: browser client factory
    server.ts                         # CREATE: server component/action client factory (cookies)
    middleware.ts                     # CREATE: session-refresh helper used by middleware.ts
    types.ts                          # CREATE: hand-written row types (Profile, ListRow, ListItemRow)

  lib/
    lists.ts                          # CREATE: server-only list/list_items read+write functions
    profiles.ts                       # CREATE: server-only profile read+write functions
    username.ts                       # CREATE: pure username-derivation/validation helpers (shared client+server)

  app/
    register/page.tsx                 # CREATE: signup form
    login/page.tsx                    # CREATE: login form (?next= redirect support)
    auth/callback/route.ts            # CREATE: email verification link handler
    account/settings/page.tsx         # CREATE: username + avatar edit
    account/lists/page.tsx            # CREATE: owner's private list view (all lists, not just public)
    lists/[public_id]/page.tsx        # CREATE: list detail page
    u/[username]/page.tsx             # CREATE: public profile page (public lists only)

  components/
    auth/RegisterForm.tsx             # CREATE
    auth/LoginForm.tsx                # CREATE
    account/SettingsForm.tsx          # CREATE
    account/AvatarUpload.tsx          # CREATE
    lists/SaveToListButton.tsx        # CREATE: the "pin" icon + popover, used on ProductCard + PDP
    lists/ListItemRow.tsx             # CREATE: one row in a list detail page (thumbnail, qty, remove)
    lists/ListCard.tsx                # CREATE: list summary card, used on profile page + /account/lists
    lists/DeleteListButton.tsx        # CREATE: instant hard-delete, no confirm dialog (per spec)
    lists/NewListForm.tsx             # CREATE: minimal "+ New list" form on /account/lists (added after
                                       #   plan review -- gives the "same sku across multiple lists" spec
                                       #   requirement a reachable UI path; see Task 7)
    ProductCard.tsx                   # MODIFY: add SaveToListButton to the top-right overlay stack

  actions/
    auth.ts                          # CREATE: registerAction, loginAction, logoutAction (server actions)
    lists.ts                          # CREATE: createListAction, addItemAction, removeItemAction,
                                       #         setQuantityAction, toggleVisibilityAction, deleteListAction,
                                       #         renameListAction
    profile.ts                       # CREATE: updateUsernameAction, updateAvatarAction

  __tests__/
    lib/username.test.ts             # CREATE
    lib/lists.test.ts                # CREATE (mocks Supabase client)
    lib/profiles.test.ts             # CREATE (mocks Supabase client)
    rls/list_visibility.test.ts      # CREATE: RLS invariant tests via anon + authenticated clients
```

Rationale for the split: `lib/supabase/*` is pure plumbing (client construction), never imported by tests directly. `lib/lists.ts` / `lib/profiles.ts` hold all Postgres query logic so server actions and pages stay thin and the query logic is unit-testable with a mocked client. `actions/*` are the only files marked `'use server'` — keeping mutations in one place makes the "which writes touch the DB" question answerable by `ls actions/`.

---

## Task 1: Supabase client wiring

**Files:**
- Create: `apps/catalog/lib/supabase/client.ts`
- Create: `apps/catalog/lib/supabase/server.ts`
- Create: `apps/catalog/lib/supabase/types.ts`
- Modify: `apps/catalog/package.json`
- Modify: `apps/catalog/.env.local`
- Modify: `apps/catalog/.env.example`

- [ ] **Step 1: Install dependencies**

```bash
cd apps/catalog && npm install @supabase/ssr @supabase/supabase-js
```

- [ ] **Step 2: Get project URL and anon key**

Use the Supabase MCP tools (already available in this environment):
```
mcp__claude_ai_Supabase__get_project_url({ id: "dsyplzckfezcxiuikkfm" })
mcp__claude_ai_Supabase__get_publishable_keys({ ... })
```
Add to `apps/catalog/.env.local` (create the file's Supabase section if absent):
```
NEXT_PUBLIC_SUPABASE_URL=<from get_project_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from get_publishable_keys>
```
Add the same two keys (blank values) to `apps/catalog/.env.example` with a one-line comment: `# Supabase project — see docs/superpowers/specs/2026-08-22-user-accounts-and-lists-design.md`. These are anon/publishable keys, safe to reference in example files (not secrets), but leave the actual values only in `.env.local` (gitignored).

- [ ] **Step 3: Write the row types**

```typescript
// apps/catalog/lib/supabase/types.ts
export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface ListRow {
  id: string;
  public_id: string;
  owner_id: string;
  name: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListItemRow {
  id: string;
  list_id: string;
  sku: string;
  quantity: number;
  added_at: string;
}
```

- [ ] **Step 4: Write the browser client factory**

```typescript
// apps/catalog/lib/supabase/client.ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 5: Write the server client factory**

```typescript
// apps/catalog/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers. Must be called fresh per-request (never module-scoped —
 * cookies() is request-bound).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component (not a Server Action/Route
            // Handler) — cookies() is read-only there. Safe to ignore: the
            // middleware's session refresh (Task 2) already keeps the
            // session cookie current for the next request.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 6: Verify the package compiles**

Run: `cd apps/catalog && npx tsc --noEmit`
Expected: no new errors from the three new files (pre-existing errors elsewhere, if any, are out of scope).

- [ ] **Step 7: Commit**

```bash
git add apps/catalog/package.json apps/catalog/package-lock.json apps/catalog/lib/supabase apps/catalog/.env.example
git commit -m "feat(accounts): add Supabase client wiring"
```

Note: `.env.local` is gitignored and must NOT be committed — verify with `git status` that it does not appear staged.

---

## Task 2: Middleware session refresh

**Files:**
- Create: `apps/catalog/lib/supabase/middleware.ts`
- Modify: `apps/catalog/middleware.ts`
- Test: `apps/catalog/lib/supabase/__tests__/middleware.test.ts`

- [ ] **Step 1: Write the session-refresh helper**

```typescript
// apps/catalog/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session cookie on every request. Must run before
 * any other middleware logic that might return early, otherwise sessions
 * silently expire for paths that short-circuit (e.g. the bot-redirect).
 *
 * Returns the (possibly cookie-mutated) response to continue with, plus the
 * resolved user (or null) so callers can gate routes without a second round
 * trip to Supabase.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: this call is required — it's what actually refreshes the
  // token and triggers setAll above if the session needs updating. Do not
  // remove it as unused-looking code.
  const { data: { user } } = await supabase.auth.getUser();

  return { response, user };
}
```

- [ ] **Step 2: Write a test for the matcher config (not the Supabase call itself — that needs a live/mocked network and is covered by the RLS integration tests in Task 8)**

```typescript
// apps/catalog/lib/supabase/__tests__/middleware.test.ts
import { describe, it, expect } from 'vitest';

describe('middleware matcher', () => {
  it('excludes static assets and images from the matcher pattern', async () => {
    const { config } = await import('../../../middleware');
    const pattern = config.matcher[0];
    // Matcher is a string path pattern per Next.js middleware config format.
    expect(pattern).toContain('_next/static');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run lib/supabase/__tests__/middleware.test.ts`
Expected: FAIL (middleware.ts doesn't have this matcher yet)

- [ ] **Step 4: Update the root middleware to compose both concerns**

```typescript
// apps/catalog/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const GROUP_SLUGS: Record<string, string> = {
  'wine': 'Wine',
  'whisky': 'Whisky',
  'spirits': 'Spirits',
  'sake--asian': 'Sake & Asian',
  'liqueur': 'Liqueur',
  'beer--rtd': 'Beer & RTD',
  'non-alcoholic': 'Non-Alcoholic',
  'cigars': 'Cigars',
  'events': 'Events',
  'accessories': 'Accessories',
};

export async function middleware(request: NextRequest) {
  // Session refresh must run first and unconditionally -- every response
  // path below needs the (possibly refreshed) cookies attached.
  const { response } = await updateSession(request);

  const { pathname } = request.nextUrl;
  const match = pathname.match(/^\/shop\/([^/]+)$/);
  if (match) {
    const slug = match[1];
    const groupName = GROUP_SLUGS[slug];
    if (groupName) {
      const ua = request.headers.get('user-agent') ?? '';
      const isBot = /bot|crawler|spider|facebookexternalhit|Twitterbot|LinkedInBot/i.test(ua);
      if (!isBot) {
        const url = request.nextUrl.clone();
        url.pathname = '/shop';
        url.searchParams.set('group', groupName);
        return NextResponse.redirect(url, { status: 302 });
      }
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/shop/:group*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
```

Note: the matcher now runs on nearly every path (needed for session refresh sitewide), not just `/shop/:group*`. This is a real behavior change — confirm with Rule 7 browser verification (Task 10) that existing bot-redirect and static pages still work identically.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run lib/supabase/__tests__/middleware.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/catalog/middleware.ts apps/catalog/lib/supabase/middleware.ts apps/catalog/lib/supabase/__tests__/middleware.test.ts
git commit -m "feat(accounts): add Supabase session refresh to middleware"
```

---

## Task 3: Username helpers (pure functions, TDD)

**Files:**
- Create: `apps/catalog/lib/username.ts`
- Test: `apps/catalog/__tests__/lib/username.test.ts`

This mirrors the DB trigger's derivation logic client-side, purely for instant UI feedback (e.g. showing the derived username before signup completes) and for settings-page validation. The DB trigger remains the source of truth for the actual insert.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/catalog/__tests__/lib/username.test.ts
import { describe, it, expect } from 'vitest';
import { deriveUsernameFromEmail, isValidUsername } from '@/lib/username';

describe('deriveUsernameFromEmail', () => {
  it('lowercases and strips non-alphanumerics from the local part', () => {
    expect(deriveUsernameFromEmail('John.Doe+wine@example.com')).toBe('johndoewine');
  });

  it('falls back to "user" when local part has no alphanumerics', () => {
    expect(deriveUsernameFromEmail('...@example.com')).toBe('user');
  });
});

describe('isValidUsername', () => {
  it('accepts lowercase alphanumerics and hyphens, 3-30 chars', () => {
    expect(isValidUsername('john-doe-2')).toBe(true);
  });

  it('rejects usernames shorter than 3 chars', () => {
    expect(isValidUsername('ab')).toBe(false);
  });

  it('rejects usernames with spaces or uppercase', () => {
    expect(isValidUsername('John Doe')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/catalog && npx vitest run __tests__/lib/username.test.ts`
Expected: FAIL with "Cannot find module '@/lib/username'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/catalog/lib/username.ts

/**
 * Client-side mirror of the DB trigger's derivation (handle_new_user in the
 * user-accounts-and-lists migration). Used only for instant UI preview
 * before signup completes -- the trigger is the actual source of truth and
 * independently handles collision suffixing, which this function does not.
 */
export function deriveUsernameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const stripped = localPart.toLowerCase().replace(/[^a-z0-9]/g, '');
  return stripped || 'user';
}

/** Matches the DB's `username unique not null` constraint's expected shape. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9-]{3,30}$/.test(username);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/catalog && npx vitest run __tests__/lib/username.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/catalog/lib/username.ts apps/catalog/__tests__/lib/username.test.ts
git commit -m "feat(accounts): add username derivation/validation helpers"
```

---

## Task 4: Auth pages (register, login, verification callback)

**Files:**
- Create: `apps/catalog/actions/auth.ts`
- Create: `apps/catalog/components/auth/RegisterForm.tsx`
- Create: `apps/catalog/components/auth/LoginForm.tsx`
- Create: `apps/catalog/app/register/page.tsx`
- Create: `apps/catalog/app/login/page.tsx`
- Create: `apps/catalog/app/auth/callback/route.ts`

- [ ] **Step 1: Write the server actions**

```typescript
// apps/catalog/actions/auth.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function registerAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wnlq9.shop'}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
```

- [ ] **Step 2: Write the register form**

```tsx
// apps/catalog/components/auth/RegisterForm.tsx
'use client';

import { useState } from 'react';
import { registerAction } from '@/actions/auth';

export function RegisterForm() {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await registerAction(formData);
    setState(result);
    setPending(false);
  }

  if (state.success) {
    return (
      <p className="text-sm text-muted-foreground">
        Check your email to verify your account before logging in.
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input
        type="email"
        name="email"
        placeholder="Email"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        type="password"
        name="password"
        placeholder="Password"
        required
        minLength={8}
        className="rounded-md border border-border px-3 py-2"
      />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Write the login form (with `?next=` support per spec's "pin" flow)**

```tsx
// apps/catalog/components/auth/LoginForm.tsx
'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { loginAction } from '@/actions/auth';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    formData.set('next', next);
    const result = await loginAction(formData);
    if (result?.error) {
      setError(result.error);
      setPending(false);
    }
    // On success, loginAction redirects server-side; this component unmounts.
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <input
        type="email"
        name="email"
        placeholder="Email"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      <input
        type="password"
        name="password"
        placeholder="Password"
        required
        className="rounded-md border border-border px-3 py-2"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Write the page shells**

```tsx
// apps/catalog/app/register/page.tsx
import { RegisterForm } from '@/components/auth/RegisterForm';

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Create an account</h1>
      <RegisterForm />
    </div>
  );
}
```

```tsx
// apps/catalog/app/login/page.tsx
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Log in</h1>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
```

Note: `LoginForm` uses `useSearchParams`, which requires a `Suspense` boundary in the App Router or the page fails to statically render — do not omit the `Suspense` wrapper.

- [ ] **Step 5: Write the email verification callback route**

```typescript
// apps/catalog/app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Nudge to settings once after verification, per spec -- does not
      // hard-block browsing (user can navigate away freely from there).
      return NextResponse.redirect(`${origin}/account/settings`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=verification_failed`);
}
```

- [ ] **Step 6: Manual verification (no automated test for live email flow — covered by Rule 7 browser walkthrough in Task 10)**

Run: `cd apps/catalog && npm run dev` (port 3100), then visit `http://localhost:3100/register`, submit a real test email, confirm the verification-sent message renders.

- [ ] **Step 7: Commit**

```bash
git add apps/catalog/actions/auth.ts apps/catalog/components/auth apps/catalog/app/register apps/catalog/app/login apps/catalog/app/auth
git commit -m "feat(accounts): add register/login pages and verification callback"
```

---

## Task 5: Profile settings page

**Files:**
- Create: `apps/catalog/lib/profiles.ts`
- Create: `apps/catalog/actions/profile.ts`
- Create: `apps/catalog/components/account/SettingsForm.tsx`
- Create: `apps/catalog/components/account/AvatarUpload.tsx`
- Create: `apps/catalog/app/account/settings/page.tsx`
- Test: `apps/catalog/__tests__/lib/profiles.test.ts`

- [ ] **Step 1: Write the failing test for the profile query layer**

```typescript
// apps/catalog/__tests__/lib/profiles.test.ts
import { describe, it, expect, vi } from 'vitest';
import { isUsernameAvailable } from '@/lib/profiles';

describe('isUsernameAvailable', () => {
  it('returns false when a row with that username already exists', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'other-user' }, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'taken-name', 'current-user-id');
    expect(result).toBe(false);
  });

  it('returns true when the only match is the current user themselves', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'current-user-id' }, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'my-name', 'current-user-id');
    expect(result).toBe(true);
  });

  it('returns true when no row matches', async () => {
    const mockClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    const result = await isUsernameAvailable(mockClient as any, 'free-name', 'current-user-id');
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run __tests__/lib/profiles.test.ts`
Expected: FAIL with "Cannot find module '@/lib/profiles'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/catalog/lib/profiles.ts
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Checks username availability, excluding the current user's own existing
 * row (so re-saving your own unchanged username doesn't false-positive as
 * "taken"). Used both at settings-edit time and (via a thin RPC-less
 * client-side check) is NOT used at signup -- the trigger owns that path.
 */
export async function isUsernameAvailable(
  client: SupabaseClient,
  username: string,
  currentUserId: string,
): Promise<boolean> {
  const { data } = await client
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  return !data || data.id === currentUserId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run __tests__/lib/profiles.test.ts`
Expected: PASS

- [ ] **Step 5: Write the update-username / update-avatar server actions**

```typescript
// apps/catalog/actions/profile.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { isUsernameAvailable } from '@/lib/profiles';
import { isValidUsername } from '@/lib/username';
import { revalidatePath } from 'next/cache';

export async function updateUsernameAction(formData: FormData) {
  const username = String(formData.get('username') ?? '').trim().toLowerCase();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not logged in.' };

  if (!isValidUsername(username)) {
    return { error: 'Username must be 3-30 characters, lowercase letters, numbers, and hyphens only.' };
  }

  const available = await isUsernameAvailable(supabase, username, user.id);
  if (!available) {
    return { error: 'That username is already taken.' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ username })
    .eq('id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/account/settings');
  return { success: true };
}

// Fixed allowlist -- do NOT derive the extension/content-type from the
// client-supplied filename or File.type. This is a public-read storage
// bucket (avatar_public_read policy grants anon select on the whole
// bucket); trusting a client-controlled extension would let a user upload
// e.g. "avatar.svg" or "avatar.html" to their own folder and have it served
// back over the public CDN, which is a content-type/XSS-adjacent risk in a
// CLAUDE.md-designated high-risk zone (file upload + public serving).
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export async function updateAvatarAction(formData: FormData) {
  const file = formData.get('avatar') as File | null;
  if (!file || file.size === 0) return { error: 'No file selected.' };

  const ext = ALLOWED_AVATAR_TYPES[file.type];
  if (!ext) {
    return { error: 'Only JPEG, PNG, or WebP images are allowed.' };
  }
  if (file.size > 5 * 1024 * 1024) {
    return { error: 'Image must be under 5MB.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not logged in.' };

  const path = `${user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { error: uploadError.message };

  const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: urlData.publicUrl })
    .eq('id', user.id);

  if (updateError) return { error: updateError.message };

  revalidatePath('/account/settings');
  return { success: true, avatarUrl: urlData.publicUrl };
}
```

**Pre-requisite check before this step works end-to-end:** the spec calls for a Supabase Storage bucket `avatars` (public-read, `{user_id}/avatar.{ext}` path). Verify it exists:
```
mcp__claude_ai_Supabase__execute_sql({ project_id: "dsyplzckfezcxiuikkfm", query: "select id, name, public from storage.buckets where name = 'avatars';" })
```
If it returns no rows, create it via the Supabase dashboard or:
```
mcp__claude_ai_Supabase__execute_sql({ project_id: "dsyplzckfezcxiuikkfm", query: "insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);" })
```
Then add the storage RLS policy restricting upload to the user's own `{user_id}/` prefix — this is a `storage.objects` policy, not a `public.*` table policy, so it's a separate migration from Task 0's schema work:
```sql
create policy "avatar_upload_own_folder"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_update_own_folder"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');
```
Apply via `apply_migration` with name `add_avatars_storage_bucket_policies` before testing avatar upload.

- [ ] **Step 6: Write the settings form + avatar upload components**

```tsx
// apps/catalog/components/account/SettingsForm.tsx
'use client';

import { useState } from 'react';
import { updateUsernameAction } from '@/actions/profile';

export function SettingsForm({ currentUsername }: { currentUsername: string }) {
  const [state, setState] = useState<{ error?: string; success?: boolean }>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await updateUsernameAction(formData);
    setState(result);
    setPending(false);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <label className="text-sm font-medium">Username</label>
      <input
        type="text"
        name="username"
        defaultValue={currentUsername}
        required
        minLength={3}
        maxLength={30}
        pattern="[a-z0-9-]+"
        className="rounded-md border border-border px-3 py-2"
      />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state.success ? <p className="text-sm text-emerald-600">Saved.</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save username'}
      </button>
    </form>
  );
}
```

```tsx
// apps/catalog/components/account/AvatarUpload.tsx
'use client';

import { useState } from 'react';
import { updateAvatarAction } from '@/actions/profile';

export function AvatarUpload({ currentAvatarUrl }: { currentAvatarUrl: string | null }) {
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.set('avatar', file);

    setPending(true);
    const result = await updateAvatarAction(formData);
    if (result.error) {
      setError(result.error);
    } else if (result.avatarUrl) {
      setAvatarUrl(result.avatarUrl);
      setError(undefined);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, not build-time optimizable
        <img src={avatarUrl} alt="Your avatar" className="h-20 w-20 rounded-full object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
          No avatar
        </div>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        disabled={pending}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 7: Write the settings page (server component, gates on auth)**

```tsx
// apps/catalog/app/account/settings/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SettingsForm } from '@/components/account/SettingsForm';
import { AvatarUpload } from '@/components/account/AvatarUpload';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/settings');

  const { data: profile } = await supabase
    .from('profiles')
    .select('username, avatar_url')
    .eq('id', user.id)
    .single();

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Account settings</h1>
      <div className="flex flex-col gap-8">
        <AvatarUpload currentAvatarUrl={profile?.avatar_url ?? null} />
        <SettingsForm currentUsername={profile?.username ?? ''} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run full test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all PASS, no regressions

- [ ] **Step 9: Commit**

```bash
git add apps/catalog/lib/profiles.ts apps/catalog/actions/profile.ts apps/catalog/components/account apps/catalog/app/account/settings apps/catalog/__tests__/lib/profiles.test.ts
git commit -m "feat(accounts): add profile settings page (username + avatar)"
```

---

## Task 6: List CRUD data layer + server actions (TDD)

**Files:**
- Create: `apps/catalog/lib/lists.ts`
- Create: `apps/catalog/actions/lists.ts`
- Test: `apps/catalog/__tests__/lib/lists.test.ts`

- [ ] **Step 1: Write the failing tests for the pure/mockable query functions**

```typescript
// apps/catalog/__tests__/lib/lists.test.ts
import { describe, it, expect, vi } from 'vitest';
import { defaultListName, upsertListItem, getMostRecentList } from '@/lib/lists';

describe('defaultListName', () => {
  it('formats as "{username}\'s list"', () => {
    expect(defaultListName('sarah')).toBe("sarah's list");
  });
});

/**
 * These two cases cover Finding 5 and Finding 2 from the plan review: (a)
 * upsertListItem must touch the parent list's updated_at, since that's the
 * ONLY thing that makes getMostRecentList's ordering correspond to "most
 * recently pinned into" rather than "most recently renamed," and (b) the
 * same sku must be independently upsertable into two different lists
 * (spec: "the same sku can appear in multiple different lists for one
 * user") without one write clobbering the other.
 */
describe('upsertListItem', () => {
  it('touches the parent list updated_at on every call, not just on insert', async () => {
    const listsUpdateEq = vi.fn().mockResolvedValue({ data: [{ id: 'list-1' }], error: null });
    const mockClient = {
      from: (table: string) => {
        if (table === 'list_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
            insert: async () => ({ data: null, error: null }),
          };
        }
        // table === 'lists'
        return { update: () => ({ eq: listsUpdateEq }) };
      },
    };

    await upsertListItem(mockClient as any, 'list-1', 'SKU-A');

    expect(listsUpdateEq).toHaveBeenCalledWith('id', 'list-1');
  });

  it('does not let a write to one list affect item state in another list for the same sku', async () => {
    // Two independent mock "databases" keyed by list id, to prove the
    // (list_id, sku) scoping in the query builder is respected rather than
    // some shared/global keying by sku alone.
    const state: Record<string, Record<string, number>> = { 'list-1': {}, 'list-2': {} };

    function makeClient() {
      return {
        from: (table: string) => {
          if (table === 'list_items') {
            let scopedListId = '';
            let scopedSku = '';
            return {
              select: () => ({
                eq: (col: string, val: string) => {
                  if (col === 'list_id') scopedListId = val;
                  if (col === 'sku') scopedSku = val;
                  return {
                    eq: (col2: string, val2: string) => {
                      if (col2 === 'sku') scopedSku = val2;
                      return {
                        maybeSingle: async () => {
                          const qty = state[scopedListId]?.[scopedSku];
                          return { data: qty ? { quantity: qty } : null, error: null };
                        },
                      };
                    },
                  };
                },
              }),
              insert: async ({ list_id, sku, quantity }: any) => {
                state[list_id][sku] = quantity;
                return { data: null, error: null };
              },
              update: () => ({
                eq: () => ({
                  eq: async () => ({ data: null, error: null }),
                }),
              }),
            };
          }
          return { update: () => ({ eq: async () => ({ data: [{}], error: null }) }) };
        },
      };
    }

    const client = makeClient();
    await upsertListItem(client as any, 'list-1', 'SKU-A');
    await upsertListItem(client as any, 'list-2', 'SKU-A');

    expect(state['list-1']['SKU-A']).toBe(1);
    expect(state['list-2']['SKU-A']).toBe(1);
  });

  /**
   * Regression guard: upsertListItem used to await the insert/update calls
   * without checking their `error`, so a failed write (RLS denial, a
   * unique_violation from the TOCTOU race between the read and the insert,
   * or any transient DB error) was silently swallowed -- the caller saw a
   * resolved promise and treated the item as saved even though nothing
   * landed. This proves a failing insert now throws instead of resolving.
   */
  it('throws when the insert fails instead of silently succeeding', async () => {
    const mockClient = {
      from: (table: string) => {
        if (table === 'list_items') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
            insert: async () => ({ data: null, error: { message: 'unique_violation' } }),
          };
        }
        return { update: () => ({ eq: async () => ({ data: [{}], error: null }) }) };
      },
    };

    await expect(upsertListItem(mockClient as any, 'list-1', 'SKU-A')).rejects.toThrow(
      'unique_violation',
    );
  });
});

describe('getMostRecentList', () => {
  it('orders by updated_at descending, not created_at', async () => {
    const orderSpy = vi.fn().mockReturnValue({
      limit: () => ({ maybeSingle: async () => ({ data: { id: 'list-2' }, error: null }) }),
    });
    const mockClient = {
      from: () => ({ select: () => ({ eq: () => ({ order: orderSpy }) }) }),
    };

    await getMostRecentList(mockClient as any, 'user-1');

    expect(orderSpy).toHaveBeenCalledWith('updated_at', { ascending: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/catalog && npx vitest run __tests__/lib/lists.test.ts`
Expected: FAIL with "Cannot find module '@/lib/lists'"

- [ ] **Step 3: Write `lib/lists.ts`**

```typescript
// apps/catalog/lib/lists.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListRow, ListItemRow } from '@/lib/supabase/types';

export function defaultListName(username: string): string {
  return `${username}'s list`;
}

/**
 * The user's most-recently-used list, or null if they have none yet.
 *
 * IMPORTANT: "most-recently-used" means most recently ADDED TO, not most
 * recently created or renamed. `lists.updated_at` is only bumped by the
 * `lists_set_updated_at` trigger, which fires on UPDATE of the `lists` row
 * itself (rename/visibility toggle) -- it does NOT fire when a `list_items`
 * row is inserted/updated/deleted, because that's a different table. Relying
 * on `lists.updated_at` alone would silently resolve to whatever list was
 * last renamed/toggled, not the list the user is actually pinning into.
 *
 * Fix: `upsertListItem` (below) explicitly bumps the parent list's
 * `updated_at` after every write, so ordering by `lists.updated_at` here is
 * correct AS LONG AS every list_items mutation goes through upsertListItem
 * (or otherwise re-touches the parent list). Do not add a new list_items
 * write path without this.
 */
export async function getMostRecentList(
  client: SupabaseClient,
  ownerId: string,
): Promise<ListRow | null> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as ListRow | null;
}

export async function getOrCreateDefaultList(
  client: SupabaseClient,
  ownerId: string,
  username: string,
): Promise<ListRow> {
  const existing = await getMostRecentList(client, ownerId);
  if (existing) return existing;

  const { data, error } = await client
    .from('lists')
    .insert({ owner_id: ownerId, name: defaultListName(username) })
    .select('*')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to create default list');
  return data as ListRow;
}

export async function getListByPublicId(
  client: SupabaseClient,
  publicId: string,
): Promise<ListRow | null> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('public_id', publicId)
    .maybeSingle();

  return data as ListRow | null;
}

export async function getListItems(
  client: SupabaseClient,
  listId: string,
): Promise<ListItemRow[]> {
  const { data } = await client
    .from('list_items')
    .select('*')
    .eq('list_id', listId)
    .order('added_at', { ascending: true });

  return (data as ListItemRow[]) ?? [];
}

export async function getUserLists(
  client: SupabaseClient,
  ownerId: string,
): Promise<ListRow[]> {
  const { data } = await client
    .from('lists')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  return (data as ListRow[]) ?? [];
}

/**
 * Upserts (list_id, sku): adds if absent, else bumps quantity by 1.
 *
 * Also touches the parent list's `updated_at` explicitly -- the
 * `lists_set_updated_at` trigger only fires on UPDATE of the `lists` table
 * itself, never on writes to the child `list_items` table, so without this
 * explicit touch `getMostRecentList`'s ordering would silently go stale the
 * moment a user pins into an existing (not just-renamed) list. Any future
 * list_items write path (bulk import, admin tooling, etc.) must do the same
 * touch or "most recently used" resolution breaks again.
 *
 * Every write below checks `error` and throws rather than swallowing it.
 * This isn't just style: the read-then-write here is two round trips, not
 * atomic, so two near-simultaneous calls for the same (list_id, sku) can
 * both read "no existing row" and both attempt an insert -- the
 * `unique(list_id, sku)` constraint is the intended backstop that makes the
 * race loser's insert fail rather than double-insert. Before this fix that
 * failure was silently discarded, so the loser's caller (and any caller hit
 * by an RLS denial or transient DB error) would proceed as if the item had
 * been saved when it hadn't -- exactly the "optimistic UI says saved, DB
 * write actually failed" gap CLAUDE.md Rule 2 warns about. Throwing here
 * makes that failure visible to the caller instead.
 */
export async function upsertListItem(
  client: SupabaseClient,
  listId: string,
  sku: string,
): Promise<void> {
  const { data: existing } = await client
    .from('list_items')
    .select('quantity')
    .eq('list_id', listId)
    .eq('sku', sku)
    .maybeSingle();

  if (existing) {
    const { error } = await client
      .from('list_items')
      .update({ quantity: existing.quantity + 1 })
      .eq('list_id', listId)
      .eq('sku', sku);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await client.from('list_items').insert({ list_id: listId, sku, quantity: 1 });
    if (error) throw new Error(error.message);
  }

  const { error: touchError } = await client
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', listId);
  if (touchError) throw new Error(touchError.message);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/catalog && npx vitest run __tests__/lib/lists.test.ts`
Expected: PASS

- [ ] **Step 5: Write the server actions**

```typescript
// apps/catalog/actions/lists.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { getOrCreateDefaultList, upsertListItem } from '@/lib/lists';
import { revalidatePath } from 'next/cache';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in.');
  return { supabase, user };
}

/**
 * Every mutation below relies on RLS (owner_id = auth.uid()) to reject
 * writes against a list_id the caller doesn't own -- verified safe because
 * lib/supabase/server.ts's client always uses the anon key, never the
 * service role key, so RLS is genuinely enforced per-request. But Supabase
 * does NOT raise an error when an UPDATE/DELETE matches zero rows under
 * RLS -- it just silently affects nothing. Without this helper, a stale or
 * tampered listId would produce no error and no effect, and the caller
 * (and revalidatePath) would proceed as if it had succeeded. This helper
 * makes that failure visible instead of silent, by checking the mutation
 * actually touched a row.
 */
async function assertRowAffected<T>(
  result: { data: T[] | T | null; error: { message: string } | null; count?: number | null },
  actionDescription: string,
) {
  if (result.error) throw new Error(result.error.message);
  const affected = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0;
  if (affected === 0) {
    throw new Error(`${actionDescription} affected no rows -- list not found or not owned by you.`);
  }
}

export async function pinToDefaultListAction(sku: string) {
  const { supabase, user } = await requireUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .single();

  const list = await getOrCreateDefaultList(supabase, user.id, profile?.username ?? 'my');
  await upsertListItem(supabase, list.id, sku);

  revalidatePath('/account/lists');
  return { listId: list.id, listPublicId: list.public_id };
}

export async function createListAction(name: string) {
  const { supabase, user } = await requireUser();

  const { data, error } = await supabase
    .from('lists')
    .insert({ owner_id: user.id, name })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  revalidatePath('/account/lists');
  return data;
}

export async function addItemToListAction(listId: string, sku: string) {
  const { supabase } = await requireUser();
  await upsertListItem(supabase, listId, sku);
  revalidatePath('/account/lists');
}

export async function setItemQuantityAction(listId: string, sku: string, quantity: number) {
  const { supabase } = await requireUser();
  if (quantity <= 0) {
    const result = await supabase.from('list_items').delete().eq('list_id', listId).eq('sku', sku).select();
    await assertRowAffected(result, 'Remove item');
  } else {
    const result = await supabase
      .from('list_items')
      .update({ quantity })
      .eq('list_id', listId)
      .eq('sku', sku)
      .select();
    await assertRowAffected(result, 'Update item quantity');
  }
  // Bump parent list's updated_at -- see upsertListItem's comment; this
  // write path bypasses upsertListItem so it must do the same touch itself.
  await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', listId);
  revalidatePath('/account/lists');
}

export async function removeItemAction(listId: string, sku: string) {
  const { supabase } = await requireUser();
  const result = await supabase.from('list_items').delete().eq('list_id', listId).eq('sku', sku).select();
  await assertRowAffected(result, 'Remove item');
  // Same updated_at touch as setItemQuantityAction's zero-quantity branch --
  // removing a row via this button and removing it by stepping quantity to
  // 0 are the same underlying mutation from the user's point of view, and
  // must agree on whether it counts as "using" the list.
  await supabase.from('lists').update({ updated_at: new Date().toISOString() }).eq('id', listId);
  revalidatePath('/account/lists');
}

export async function toggleListVisibilityAction(listId: string, isPublic: boolean) {
  const { supabase } = await requireUser();
  const result = await supabase.from('lists').update({ is_public: isPublic }).eq('id', listId).select();
  await assertRowAffected(result, 'Toggle list visibility');
  revalidatePath('/account/lists');
}

export async function renameListAction(listId: string, name: string) {
  const { supabase } = await requireUser();
  const result = await supabase.from('lists').update({ name }).eq('id', listId).select();
  await assertRowAffected(result, 'Rename list');
  revalidatePath('/account/lists');
}

export async function deleteListAction(listId: string) {
  const { supabase } = await requireUser();
  // No confirm step, hard delete, per spec's "easy like a cart" decision.
  const result = await supabase.from('lists').delete().eq('id', listId).select();
  await assertRowAffected(result, 'Delete list');
  revalidatePath('/account/lists');
}
```

Note: every mutation relies on RLS (`owner_id = auth.uid()`) to reject cross-user writes at the DB layer — these actions do not re-check ownership in app code, by design, per the spec's "enforcement lives in Postgres RLS, not just app-layer checks."

- [ ] **Step 6: Run full test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/catalog/lib/lists.ts apps/catalog/actions/lists.ts apps/catalog/__tests__/lib/lists.test.ts
git commit -m "feat(lists): add list CRUD data layer and server actions"
```

---

## Task 7: Save-to-list UI (ProductCard integration + list detail page)

**Files:**
- Create: `apps/catalog/components/lists/SaveToListButton.tsx`
- Create: `apps/catalog/components/lists/ListItemRow.tsx`
- Create: `apps/catalog/components/lists/DeleteListButton.tsx`
- Create: `apps/catalog/components/lists/ListCard.tsx`
- Create: `apps/catalog/app/lists/[public_id]/page.tsx`
- Create: `apps/catalog/app/account/lists/page.tsx`
- Modify: `apps/catalog/components/ProductCard.tsx`
- Test: `apps/catalog/components/lists/__tests__/SaveToListButton.test.tsx`

- [ ] **Step 1: Write the save-to-list button (client component, optimistic add)**

```tsx
// apps/catalog/components/lists/SaveToListButton.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Bookmark, BookmarkCheck, ChevronDown } from 'lucide-react';
import { pinToDefaultListAction, addItemToListAction } from '@/actions/lists';
import { cn } from '@/lib/utils';
import type { ListRow } from '@/lib/supabase/types';

/**
 * The "pin" icon on ProductCard/PDP. Logged-out click redirects to
 * /login?next=<current path>. Logged-in click optimistically adds to the
 * user's most-recently-used list (auto-creating a default list if none
 * exists), per spec.
 *
 * When the caller has 2+ lists (userLists.length > 1), a small chevron
 * appears next to the bookmark icon opening a lightweight dropdown to pick
 * a SPECIFIC target list instead of the default -- this is the minimal
 * reachable UI path for the spec's "same sku can appear in multiple
 * different lists" requirement (a plan review caught that without this,
 * addItemToListAction had no caller anywhere in the app and the
 * requirement was unreachable/untestable in the browser walkthrough). The
 * richer full popover (checkmarks per list already containing the item,
 * inline quantity stepper, inline "+ New list") remains a deferred
 * follow-up -- this is deliberately just enough to make the underlying
 * requirement real, not the full designed UX.
 */
export function SaveToListButton({
  sku,
  isLoggedIn,
  userLists = [],
  className,
}: {
  sku: string;
  isLoggedIn: boolean;
  /** Caller's own lists, needed only to decide whether to show the list-picker chevron. Omit/empty for logged-out or single-list users. */
  userLists?: ListRow[];
  className?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function goToLoginIfLoggedOut(e: React.MouseEvent): boolean {
    if (!isLoggedIn) {
      e.preventDefault();
      e.stopPropagation();
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return true;
    }
    return false;
  }

  function handlePinClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (goToLoginIfLoggedOut(e)) return;

    setSaved(true); // optimistic
    startTransition(async () => {
      try {
        await pinToDefaultListAction(sku);
      } catch {
        setSaved(false); // revert on failure
      }
    });
  }

  function handlePickList(listId: string) {
    setPickerOpen(false);
    setSaved(true); // optimistic
    startTransition(async () => {
      try {
        await addItemToListAction(listId, sku);
      } catch {
        setSaved(false);
      }
    });
  }

  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={handlePinClick}
        disabled={pending}
        aria-label={saved ? 'Saved to list' : 'Save to list'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-border transition-colors hover:bg-background',
          className,
        )}
      >
        {saved ? (
          <BookmarkCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        ) : (
          <Bookmark className="h-4 w-4 text-foreground" aria-hidden="true" />
        )}
      </button>

      {isLoggedIn && userLists.length > 1 ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPickerOpen((open) => !open);
          }}
          aria-label="Choose a list"
          className="flex h-9 w-6 items-center justify-center rounded-full bg-background/90 shadow-sm ring-1 ring-border hover:bg-background"
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}

      {pickerOpen ? (
        <div
          className="absolute right-0 top-full z-10 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          {userLists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => handlePickList(list.id)}
              className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              {list.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write a test for the logged-out redirect behavior**

```tsx
// apps/catalog/components/lists/__tests__/SaveToListButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SaveToListButton } from '../SaveToListButton';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock('@/actions/lists', () => ({
  pinToDefaultListAction: vi.fn(),
}));

describe('SaveToListButton', () => {
  it('redirects to /login with a next param when logged out', () => {
    render(<SaveToListButton sku="ABC123" isLoggedIn={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/login?next='));
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `cd apps/catalog && npx vitest run components/lists/__tests__/SaveToListButton.test.tsx`
Expected: FAIL first (component doesn't exist / redirect logic not wired), then PASS after Step 1's code is in place. If already passing after Step 1, that's fine — confirm by temporarily commenting out the `if (!isLoggedIn)` branch and re-running to see it fail, then restore.

- [ ] **Step 4: Wire into ProductCard**

Modify `apps/catalog/components/ProductCard.tsx`: add `isLoggedIn?: boolean` and `userLists?: ListRow[]` to `ProductCardProps` (both default to `false`/`[]`), and render `<SaveToListButton sku={product.sku} isLoggedIn={isLoggedIn} userLists={userLists} className="absolute right-2 top-12" />` inside the image overlay div (below the existing `CriticScoreStrip` positioned at `top-2`, hence `top-12` to avoid collision — adjust after visual check in Task 10).

Callers of `ProductCard` (shop grid, homepage, finder results) need to pass `isLoggedIn` and, when logged in, `userLists` — resolve both once per page via `const { data: { user } } = await supabase.auth.getUser()` plus `getUserLists(supabase, user.id)` (from `lib/lists.ts`, Task 6) in each server component page, and thread them down as props. This plan does not enumerate every call site; grep for `<ProductCard` and update each render site to pass the resolved values (defaults are safe if a call site is missed — the button just shows as a plain pin with no list-picker chevron).

- [ ] **Step 5: Write the list item row + delete button + list card components**

```tsx
// apps/catalog/components/lists/ListItemRow.tsx
'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { setItemQuantityAction, removeItemAction } from '@/actions/lists';
import { PriceDisplay } from '@/components/PriceDisplay';
import { resolveSale } from '@/lib/price-tiers';
import type { PublicProduct } from '@/lib/types';

export function ListItemRow({
  listId,
  sku,
  quantity,
  product,
  isOwner,
}: {
  listId: string;
  sku: string;
  quantity: number;
  product: PublicProduct | null;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!product) {
    return (
      <div className="flex items-center justify-between border-b border-border py-3 text-sm text-muted-foreground">
        <span>{sku} — no longer available</span>
        {isOwner ? (
          <button onClick={() => startTransition(() => removeItemAction(listId, sku))} aria-label="Remove">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3">
      <Link href={`/product/${product.sku}`} className="flex-1 text-sm font-medium hover:underline">
        {product.name}
      </Link>
      {isOwner ? (
        <input
          type="number"
          min={1}
          defaultValue={quantity}
          disabled={pending}
          onBlur={(e) => {
            const qty = parseInt(e.target.value, 10);
            if (!Number.isNaN(qty)) startTransition(() => setItemQuantityAction(listId, sku, qty));
          }}
          className="w-14 rounded border border-border px-2 py-1 text-center text-sm"
        />
      ) : (
        <span className="text-sm text-muted-foreground">×{quantity}</span>
      )}
      <span className="w-20 text-right text-sm tabular-nums">
        {/* Respects sale pricing the same way ProductCard/PDP do -- a
            discounted SKU must show its special_price here too, not just
            on the grid/detail pages, or the list total (computed in the
            page below) would silently disagree with what's displayed. */}
        <PriceDisplay price={resolveSale(product.price, product.special_price)?.special ?? product.price} />
      </span>
      {isOwner ? (
        <button
          onClick={() => startTransition(() => removeItemAction(listId, sku))}
          disabled={pending}
          aria-label={`Remove ${product.name}`}
        >
          <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </button>
      ) : null}
    </div>
  );
}
```

```tsx
// apps/catalog/components/lists/DeleteListButton.tsx
'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteListAction } from '@/actions/lists';

/** Instant hard delete, no confirm dialog -- explicit spec decision ("easy like a cart"). */
export function DeleteListButton({ listId }: { listId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await deleteListAction(listId);
          router.push('/account/lists');
        })
      }
      disabled={pending}
      className="text-sm text-destructive hover:underline"
    >
      Delete list
    </button>
  );
}
```

```tsx
// apps/catalog/components/lists/ListCard.tsx
import Link from 'next/link';
import type { ListRow } from '@/lib/supabase/types';

export function ListCard({ list, itemCount }: { list: ListRow; itemCount: number }) {
  return (
    <Link
      href={`/lists/${list.public_id}`}
      className="flex flex-col gap-1 rounded-xl border border-border p-4 transition-colors hover:border-primary"
    >
      <span className="font-medium">{list.name}</span>
      <span className="text-sm text-muted-foreground">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} · {list.is_public ? 'Public' : 'Private'}
      </span>
      <span className="text-xs text-muted-foreground">{list.public_id}</span>
    </Link>
  );
}
```

```tsx
// apps/catalog/components/lists/NewListForm.tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createListAction } from '@/actions/lists';

/**
 * Minimal "+ New list" affordance. Deliberately not the full popover the
 * spec describes as the richer follow-on UI (checkmarks per list, inline
 * creation from the save-to-list popover) -- this is the smallest UI that
 * gives the spec's "unlimited lists per user, same SKU can appear in
 * multiple lists" requirement an actual reachable path to create a SECOND
 * list, so that behavior can be exercised in Task 10's browser walkthrough
 * (combined with SaveToListButton's list-picker chevron, Task 7) instead of
 * being both untested and unreachable.
 */
export function NewListForm() {
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      const list = await createListAction(name.trim());
      setName('');
      router.refresh();
      void list;
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New list name"
        className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending || !name.trim()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {pending ? 'Creating…' : '+ New list'}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Write the list detail page**

```tsx
// apps/catalog/app/lists/[public_id]/page.tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getListByPublicId, getListItems } from '@/lib/lists';
import { getProductBySku } from '@/lib/catalog-data';
import { ListItemRow } from '@/components/lists/ListItemRow';
import { DeleteListButton } from '@/components/lists/DeleteListButton';
import { resolveSale } from '@/lib/price-tiers';

export default async function ListDetailPage({
  params,
}: {
  params: Promise<{ public_id: string }>;
}) {
  const { public_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const list = await getListByPublicId(supabase, public_id);
  // RLS already hides private lists from non-owners at the query layer above
  // (getListByPublicId uses the request-scoped client) -- a null here means
  // either "doesn't exist" or "exists but not visible to you," and both
  // cases render the same 404, which is the correct behavior (no leaking
  // "this list exists but is private" via a different error state).
  if (!list) notFound();

  const isOwner = user?.id === list.owner_id;
  const items = await getListItems(supabase, list.id);

  const itemsWithProducts = items.map((item) => ({
    ...item,
    product: getProductBySku(item.sku) ?? null,
  }));

  // Rule 6 invariant: every list_items row either renders with product data
  // or explicitly as "no longer available" (handled inside ListItemRow) --
  // never silently dropped.
  //
  // Uses resolveSale's special price when on sale, matching ListItemRow's
  // per-row display (Task 7) -- the total must never disagree with the sum
  // of what's actually shown on each row above it.
  const total = itemsWithProducts.reduce((sum, i) => {
    if (!i.product) return sum;
    const unitPrice = resolveSale(i.product.price, i.product.special_price)?.special ?? i.product.price;
    return sum + unitPrice * i.quantity;
  }, 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{list.name}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{list.public_id}</p>
        </div>
        {isOwner ? <DeleteListButton listId={list.id} /> : null}
      </div>

      <div className="flex flex-col">
        {itemsWithProducts.map((item) => (
          <ListItemRow
            key={item.id}
            listId={list.id}
            sku={item.sku}
            quantity={item.quantity}
            product={item.product}
            isOwner={isOwner}
          />
        ))}
      </div>

      {itemsWithProducts.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">This list is empty.</p>
      ) : (
        <div className="mt-4 flex justify-between border-t border-border pt-4 font-medium">
          <span>Estimated total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>
      )}
    </div>
  );
}
```

**Important gap to flag, not silently fix:** the total line above uses `formatPrice` directly (bypassing the ฿-tier unlock gate) because it's a plain server component sum, not per-item `PriceDisplay`. Per spec §"Total = sum of product.price × quantity... Price/total display goes through the same ฿-tier public unlock gate." Fix: extract the total into a small client component that reads `usePriceUnlock()` and renders either the real total or a tier icon, mirroring `PriceDisplay`'s own logic. Add this as its own step:

- [ ] **Step 6b: Fix the total to respect the unlock gate**

```tsx
// apps/catalog/components/lists/ListTotal.tsx
'use client';

import { usePriceUnlock } from '@/components/PriceUnlockProvider';
import { formatPrice } from '@/lib/price-tiers';

export function ListTotal({ total }: { total: number }) {
  const { unlocked, openModal } = usePriceUnlock();

  if (unlocked) {
    return <span className="tabular-nums">{formatPrice(total)}</span>;
  }

  return (
    <button type="button" onClick={openModal} className="underline decoration-dotted underline-offset-4">
      Unlock to see total
    </button>
  );
}
```

Replace the inline `<span className="tabular-nums">{formatPrice(total)}</span>` in the list detail page with `<ListTotal total={total} />`.

- [ ] **Step 7: Write the owner's private list view**

```tsx
// apps/catalog/app/account/lists/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserLists, getListItems } from '@/lib/lists';
import { ListCard } from '@/components/lists/ListCard';
import { NewListForm } from '@/components/lists/NewListForm';

export default async function AccountListsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/account/lists');

  const lists = await getUserLists(supabase, user.id);
  const listsWithCounts = await Promise.all(
    lists.map(async (list) => ({
      list,
      itemCount: (await getListItems(supabase, list.id)).length,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Your lists</h1>
      <div className="mb-8">
        <NewListForm />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {listsWithCounts.map(({ list, itemCount }) => (
          <ListCard key={list.id} list={list} itemCount={itemCount} />
        ))}
      </div>
      {listsWithCounts.length === 0 ? (
        <p className="text-muted-foreground">No lists yet — save a product to get started.</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Run full test suite**

Run: `cd apps/catalog && npx vitest run`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add apps/catalog/components/lists apps/catalog/components/ProductCard.tsx apps/catalog/app/lists apps/catalog/app/account/lists
git commit -m "feat(lists): add save-to-list button and list detail/account pages"
```

---

## Task 8: Public profile page + RLS invariant tests

**Files:**
- Create: `apps/catalog/app/u/[username]/page.tsx`
- Create: `apps/catalog/__tests__/rls/list_visibility.test.ts`

- [ ] **Step 1: Write the public profile page**

```tsx
// apps/catalog/app/u/[username]/page.tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUserLists, getListItems } from '@/lib/lists';
import { ListCard } from '@/components/lists/ListCard';

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (!profile) notFound();

  // is_public filter happens via RLS automatically (anon/other-user select
  // policy on `lists` only returns is_public=true rows for a non-owner) --
  // no need to filter client-side.
  const lists = await getUserLists(supabase, profile.id);
  const publicLists = lists.filter((l) => l.is_public);

  const listsWithCounts = await Promise.all(
    publicLists.map(async (list) => ({
      list,
      itemCount: (await getListItems(supabase, list.id)).length,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-6 flex items-center gap-4">
        {profile.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt={profile.username} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-medium">
            {profile.username.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="text-2xl font-semibold">{profile.username}</h1>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {listsWithCounts.map(({ list, itemCount }) => (
          <ListCard key={list.id} list={list} itemCount={itemCount} />
        ))}
      </div>
      {listsWithCounts.length === 0 ? (
        <p className="text-muted-foreground">No public lists yet.</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write the RLS invariant tests against the live Supabase project**

This is the Rule 6 end-to-end invariant test the spec calls for. Uses two real Supabase clients (anon key, no session) to verify policy behavior directly — not mocked, because the whole point is confirming Postgres enforces this, not app code.

```typescript
// apps/catalog/__tests__/rls/list_visibility.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Requires a real (test) Supabase user's credentials to exercise the
// authenticated-write path. Set these in .env.local for local runs; CI
// should use a dedicated test account, never a real user's.
const TEST_EMAIL = process.env.TEST_SUPABASE_EMAIL;
const TEST_PASSWORD = process.env.TEST_SUPABASE_PASSWORD;

describe.skipIf(!TEST_EMAIL)('list RLS invariants', () => {
  let ownerClient: ReturnType<typeof createClient>;
  let anonClient: ReturnType<typeof createClient>;
  let privateListId: string;
  let publicListId: string;

  beforeAll(async () => {
    ownerClient = createClient(url, anonKey);
    anonClient = createClient(url, anonKey);

    await ownerClient.auth.signInWithPassword({ email: TEST_EMAIL!, password: TEST_PASSWORD! });

    const { data: pub } = await ownerClient
      .from('lists')
      .insert({ name: 'RLS test public list', is_public: true })
      .select()
      .single();
    publicListId = pub!.id;

    const { data: priv } = await ownerClient
      .from('lists')
      .insert({ name: 'RLS test private list', is_public: false })
      .select()
      .single();
    privateListId = priv!.id;
  });

  afterAll(async () => {
    await ownerClient.from('lists').delete().eq('id', publicListId);
    await ownerClient.from('lists').delete().eq('id', privateListId);
  });

  it('anonymous read of a public list succeeds', async () => {
    const { data, error } = await anonClient.from('lists').select().eq('id', publicListId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(publicListId);
  });

  it('anonymous read of a private list returns nothing (not an error, just filtered)', async () => {
    const { data } = await anonClient.from('lists').select().eq('id', privateListId).maybeSingle();
    expect(data).toBeNull();
  });

  it('anonymous write to any list is rejected', async () => {
    const { error } = await anonClient.from('lists').update({ name: 'hacked' }).eq('id', publicListId);
    // RLS silently filters to zero affected rows rather than throwing in
    // some Postgres/PostgREST configurations -- assert no actual mutation
    // happened rather than asserting on `error` alone.
    const { data: check } = await ownerClient.from('lists').select('name').eq('id', publicListId).single();
    expect(check?.name).not.toBe('hacked');
  });
});
```

- [ ] **Step 3: Run the RLS test suite (requires TEST_SUPABASE_EMAIL/PASSWORD env vars for a dedicated test account — skip locally if not configured, per `describe.skipIf`)**

Run: `cd apps/catalog && npx vitest run __tests__/rls/list_visibility.test.ts`
Expected: SKIP if no test credentials configured (acceptable for this task); PASS if configured. Do not use a real user's credentials for this — create a dedicated test account first via `/register` if you want this suite to run.

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/app/u apps/catalog/__tests__/rls
git commit -m "feat(accounts): add public profile page and RLS invariant tests"
```

---

## Task 9: Header auth affordances (login/logout/account links)

**Files:**
- Modify: `apps/catalog/components/Header.tsx`

Sequenced BEFORE the Task 10 browser walkthrough (swapped from this plan's original ordering after review) so the walkthrough's logout step has a real UI path to exercise instead of falling back to a dev-tools workaround.

- [ ] **Step 1: Read the existing Header component to find the right insertion point**

Run: `cat apps/catalog/components/Header.tsx` and identify where existing nav links/icons live (likely near a search or menu icon).

- [ ] **Step 2: Add a server-resolved auth state and account menu**

Since `Header.tsx` is likely a client component already (confirm first), fetching the user requires either lifting auth state to a server-component wrapper that passes `user`/`profile` down, or a small client-side `useEffect` + Supabase browser client call. Prefer the server-component wrapper approach for consistency with the rest of this plan (avoids a client-side auth flash). Exact implementation depends on Header's current structure — read it first, then add:
- Logged out: a "Log in" link to `/login`.
- Logged in: a small account menu (username + avatar) linking to `/account/settings`, `/account/lists`, and a logout button wired to `logoutAction`.

- [ ] **Step 3: Manually verify in the browser**

Reload the dev server, confirm the header shows the correct state logged-in vs logged-out, and that logout actually clears the session (subsequent page load shows logged-out state).

- [ ] **Step 4: Commit**

```bash
git add apps/catalog/components/Header.tsx
git commit -m "feat(accounts): add login/account/logout affordances to header"
```

---

## Task 10: Rule 7 browser verification (required — do not skip)

No files change in this task. This is the mandatory end-to-end walkthrough per CLAUDE.md Rule 7 and the spec's own Testing section.

- [ ] **Step 1: Start the dev server**

Run: `cd apps/catalog && npm run dev`
Confirm it starts on port 3100 (per project convention — see memory `project_catalog_dev_port.md`).

- [ ] **Step 2: Walk through the full flow as a logged-out visitor**

1. Visit `http://localhost:3100/` — confirm homepage renders unchanged (middleware matcher change from Task 2 didn't break anything).
2. Visit `http://localhost:3100/shop/wine` — confirm the existing bot-redirect still 302s to `/shop?group=Wine` for a browser UA (this is the regression risk from widening the matcher).
3. Click a product's save/pin icon on a shop grid card — confirm it redirects to `/login?next=<path>`.
4. Visit `/register`, sign up with a real test email you control.
5. Check the inbox, click the verification link — confirm it lands you on `/account/settings`.

- [ ] **Step 3: Walk through the logged-in flow**

6. On `/account/settings`, change the username, save, confirm it persists on reload.
7. Upload an avatar image, confirm it renders immediately and persists on reload.
8. Go to a product page or shop grid, click the save/pin icon — confirm it shows saved state instantly (optimistic UI) and does not error.
9. Visit `/account/lists` — confirm the auto-created default list appears with the item you just saved.
10. Open the list detail page — confirm the item shows with correct name, quantity stepper, and price respects the ฿-tier gate (shows tier icon, not raw price, until you click unlock).
11. Adjust the quantity stepper — confirm it persists.
12. Remove the item — confirm instant removal, no confirm dialog.
13. Toggle the list to private, then back to public — confirm the toggle persists.
14. On `/account/lists`, use the "+ New list" form to create a second list. Confirm it appears immediately and defaults to public (per spec: "new lists default to public").
15. Now that you have 2+ lists, fully reload the page (not just client-side navigate) before going back to the SAME product you pinned in step 8 (shop grid or its product page) — the chevron's visibility depends on `userLists`, which is resolved server-side per page load, so a stale cached render from before you created the second list won't show it yet. `SaveToListButton` should now show the chevron next to the bookmark icon (only appears when `userLists.length > 1`) — click it, and click the second list's name in the dropdown to add that SAME sku into the second list via `addItemToListAction`. Confirm: (a) both lists show correct, independent quantities for that identical SKU on their respective detail pages, (b) adding to the second list does NOT change the first list's item, (c) after this action, `/account/lists` re-sorts with the second list now most-recently-used (this exercises the `updated_at` bump fix from Task 6 — without it, the default-list pin would silently keep targeting the first list even after you've added to the second). This step is the actual verification of the spec's "same sku can appear in multiple different lists" requirement — do not substitute pinning a *different* product into the second list, which would not test the same thing.
16. Delete a list — confirm instant deletion, no confirm dialog, redirect to `/account/lists`.

- [ ] **Step 4: Repeat key steps logged out to confirm gating**

17. Log out via the header's logout link (added by Task 9, which runs before this task specifically so this step has a real UI path — do not fall back to hitting the server action route directly except as a last resort if Task 9 was skipped).
18. Visit your own private list's URL directly while logged out — confirm 404 (not a leaked "private" message, not a 500).
19. Visit your own public list's URL while logged out — confirm it renders read-only (no quantity stepper, no remove button, no delete button).
20. Visit `/u/<your-username>` while logged out — confirm only public lists show.

- [ ] **Step 5: Record results**

If any step fails, fix the root cause before proceeding — do not mark this task's checkbox complete with a known-broken step. If a gap is found that's genuinely out of scope for this plan, note it explicitly as a follow-up rather than silently leaving it undiscoverable.

- [ ] **Step 6: Commit any fixes made during verification**

```bash
git add -A
git commit -m "fix(accounts): address issues found during Rule 7 browser verification"
```

(Only if fixes were needed — skip this commit if verification passed clean.)

---

## Open items intentionally deferred (per spec's "Open items carried to later specs")

- Full multi-list popover on the save-to-list button (checkmarks per list already containing the item, quantity stepper inline, "+ New list" inline within the SAME popover) — this plan ships the simpler "pin to most-recent list" version as the base behavior (Task 7), plus a separate minimal "+ New list" form on `/account/lists` (also Task 7, added after plan review so the spec's "same sku across multiple lists" requirement has a reachable UI path and isn't left both untested and unbuildable-around). The richer single-popover UX that combines all of this in one control is a natural follow-up but was not blocking for a working v1.
- Public feed page ("Users Collection").
- Likes / like-history.
- Structured per-item reviews.

Do not build these now — flag to the user if this plan's scope needs revisiting before execution.
