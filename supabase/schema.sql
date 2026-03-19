create extension if not exists "pgcrypto";

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  type text not null,
  grape text not null,
  region text not null,
  style text not null,
  price numeric(10,2) not null,
  cost_price numeric(10,2),
  currency text not null default 'USD',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists flavor_profile (
  product_id uuid primary key references products(id) on delete cascade,
  body numeric(3,1) not null check (body between 0 and 5),
  acidity numeric(3,1) not null check (acidity between 0 and 5),
  tannin numeric(3,1) not null check (tannin between 0 and 5),
  sweetness numeric(3,1) not null check (sweetness between 0 and 5),
  alcohol numeric(3,1) not null check (alcohol between 0 and 5),
  intensity numeric(3,1) not null check (intensity between 0 and 5),
  finish numeric(3,1) not null check (finish between 0 and 5),
  texture numeric(3,1) not null check (texture between 0 and 5),
  oak numeric(3,1) not null check (oak between 0 and 5),
  fruit_profile numeric(3,1) not null check (fruit_profile between 0 and 5),
  floral numeric(3,1) not null check (floral between 0 and 5),
  herbal numeric(3,1) not null check (herbal between 0 and 5),
  spice numeric(3,1) not null check (spice between 0 and 5),
  earth numeric(3,1) not null check (earth between 0 and 5),
  mineral numeric(3,1) not null check (mineral between 0 and 5)
);

create table if not exists pairing (
  product_id uuid primary key references products(id) on delete cascade,
  protein text[] not null default '{}',
  cuisine text[] not null default '{}',
  dish_examples text[] not null default '{}',
  pairing_logic text not null
);

create table if not exists style_dna (
  style text primary key,
  body numeric(3,1) not null check (body between 0 and 5),
  acidity numeric(3,1) not null check (acidity between 0 and 5),
  tannin numeric(3,1) not null check (tannin between 0 and 5),
  sweetness numeric(3,1) not null check (sweetness between 0 and 5),
  intensity numeric(3,1) not null check (intensity between 0 and 5)
);

create table if not exists grape_dna (
  grape text primary key,
  body numeric(3,1) not null check (body between 0 and 5),
  acidity numeric(3,1) not null check (acidity between 0 and 5),
  tannin numeric(3,1) not null check (tannin between 0 and 5),
  fruit_profile numeric(3,1) not null check (fruit_profile between 0 and 5)
);

create table if not exists region_modifier (
  region text primary key,
  body_mod numeric(3,1) not null,
  acidity_mod numeric(3,1) not null,
  tannin_mod numeric(3,1) not null,
  intensity_mod numeric(3,1) not null
);

create index if not exists products_category_idx on products(category);
create index if not exists products_status_idx on products(status);
create index if not exists products_region_idx on products(region);
