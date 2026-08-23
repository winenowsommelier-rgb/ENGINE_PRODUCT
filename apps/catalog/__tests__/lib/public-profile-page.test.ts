import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import PublicProfilePage from '@/app/u/[username]/page';

/**
 * Regression guard for the privacy-filter comment above the
 * `.filter((l) => l.is_public)` call in page.tsx: RLS alone does NOT
 * guarantee private lists are hidden here. If the profile owner is logged
 * in and viewing their own /u/[username] page, createClient() carries
 * their session cookie, so the `lists` select runs authenticated and the
 * `lists_select_public_or_own` policy (owner_id = auth.uid()) legitimately
 * returns ALL of their lists -- public and private both. This test mocks
 * exactly that scenario (a client that returns a public/private mix, as if
 * RLS had already run and let the private one through because the viewer
 * is the owner) and proves the component-level `.is_public` filter is the
 * thing that keeps the private list off the rendered page. If a future
 * edit removes that filter as "redundant since RLS handles it," this test
 * fails.
 */
describe('PublicProfilePage', () => {
  it('renders only public lists even when the client returns a public/private mix (owner-viewing-own-page case)', async () => {
    const profile = { id: 'user-1', username: 'sarah', avatar_url: null };
    const publicList = {
      id: 'list-public',
      public_id: 'pub-abc',
      owner_id: 'user-1',
      name: 'Public favorites',
      is_public: true,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };
    const privateList = {
      id: 'list-private',
      public_id: 'priv-xyz',
      owner_id: 'user-1',
      name: 'Secret cellar',
      is_public: false,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    const mockClient = {
      from: (table: string) => {
        if (table === 'public_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: profile, error: null }),
              }),
            }),
          };
        }
        if (table === 'lists') {
          // Simulates RLS letting BOTH lists through, as it legitimately
          // would for the owner viewing their own profile page.
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [publicList, privateList], error: null }),
              }),
            }),
          };
        }
        if (table === 'list_items') {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [], error: null }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };

    vi.mocked(createClient).mockResolvedValue(mockClient as any);

    const element = await PublicProfilePage({ params: Promise.resolve({ username: 'sarah' }) });
    const html = renderToStaticString(element);

    expect(html).toContain('Public favorites');
    expect(html).not.toContain('Secret cellar');
  });
});

// Minimal static-markup renderer so this test doesn't need a jsdom
// document/container -- we only need to inspect the text content of the
// resolved element tree for the two list names.
function renderToStaticString(element: unknown): string {
  const ReactDOMServer = require('react-dom/server');
  return ReactDOMServer.renderToStaticMarkup(element);
}
