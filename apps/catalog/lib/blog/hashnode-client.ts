// apps/catalog/lib/blog/hashnode-client.ts
const ENDPOINT = 'https://gql.hashnode.com';

export async function hashnodeQuery<T>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`Hashnode API error: ${res.status} ${res.statusText}`);

  const json = await res.json();
  if (json.errors?.length) throw new Error(`Hashnode GQL error: ${json.errors[0].message}`);

  return json.data as T;
}
