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

export interface PublicPinRow {
  id: string;
  sku: string;
  quantity: number;
  added_at: string;
  list: {
    public_id: string;
    name: string;
  };
  owner: PublicProfile | null; // null when Step 2's profile lookup finds no match (orphaned owner_id) — see lib/lists.ts
}
