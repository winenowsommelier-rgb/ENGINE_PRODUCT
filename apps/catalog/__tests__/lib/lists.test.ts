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
