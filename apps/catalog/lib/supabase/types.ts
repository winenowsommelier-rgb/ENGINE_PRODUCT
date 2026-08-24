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
