#!/usr/bin/env python3
"""Seed taxonomy_entities and taxonomy_contexts from live product data."""
import psycopg2, json, re, sys
from urllib import request
from collections import defaultdict
from pathlib import Path

BASE = "https://xfcvliyxxguhihehqwkg.supabase.co"
KEY = "sb_publishable_tJDrdH6t-CWBXgdv7bhvHQ_3bDFGdel"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Prefer": "count=none"}

def fetch_all(path):
    rows, offset = [], 0
    while True:
        url = f"{BASE}/rest/v1/{path}&limit=1000&offset={offset}"
        r = request.Request(url, headers=H)
        with request.urlopen(r) as resp:
            data = json.loads(resp.read())
            rows.extend(data)
            if len(data) < 1000: break
            offset += 1000
    return rows

def safe(v): return (v or "").strip()
def slugify(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

# Read DB URL
env_path = Path(__file__).parent.parent / ".env.local"
db_url = None
for line in env_path.read_text().splitlines():
    if line.startswith("SUPABASE_DB_URL="):
        db_url = line.split("=", 1)[1]
        break
if not db_url:
    print("ERROR: SUPABASE_DB_URL not found"); sys.exit(1)

print("Fetching products...", flush=True)
products = fetch_all("products?is_primary_variant=eq.true&select=classification,country,region,subregion,appellation,brand&order=sku.asc")
print(f"  {len(products)} products", flush=True)

# Extract unique values
countries = sorted(set(safe(p.get("country")) for p in products if safe(p.get("country"))))
regions = sorted(set(safe(p.get("region")) for p in products if safe(p.get("region"))))
subregions = sorted(set(safe(p.get("subregion")) for p in products if safe(p.get("subregion"))))
appellations = sorted(set(safe(p.get("appellation")) for p in products if safe(p.get("appellation"))))
brands = sorted(set(safe(p.get("brand")) for p in products if safe(p.get("brand"))))

print(f"Entities: {len(countries)} countries, {len(regions)} regions, {len(subregions)} subregions, {len(appellations)} appellations, {len(brands)} brands", flush=True)

# Build parent mappings
country_for_region = {}
region_for_subregion = {}
for p in products:
    c, r, s = safe(p.get("country")), safe(p.get("region")), safe(p.get("subregion"))
    if r and c: country_for_region[r] = c
    if s and r: region_for_subregion[s] = r

# Connect to DB
conn = psycopg2.connect(db_url)
conn.autocommit = True
cur = conn.cursor()

# Get classification→scope map
cur.execute("SELECT classification, scope_id FROM classification_scope_map")
class_scope = dict(cur.fetchall())

# Build entity→scope sets
entity_scopes = defaultdict(set)
for p in products:
    scope = class_scope.get(safe(p.get("classification")))
    if not scope: continue
    for field in ["country","region","subregion","appellation","brand"]:
        v = safe(p.get(field))
        if v: entity_scopes[(field, v)].add(scope)

def insert_entity(etype, name, parent_id=None):
    cur.execute("""
        INSERT INTO taxonomy_entities (entity_type, name, slug, parent_id)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (entity_type, slug) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
    """, (etype, name, slugify(name), parent_id))
    return cur.fetchone()[0]

print("Inserting entities...", flush=True)
country_ids = {c: insert_entity("country", c) for c in countries}
print(f"  Countries: {len(country_ids)}", flush=True)

region_ids = {r: insert_entity("region", r, country_ids.get(country_for_region.get(r))) for r in regions}
print(f"  Regions: {len(region_ids)}", flush=True)

subregion_ids = {s: insert_entity("subregion", s, region_ids.get(region_for_subregion.get(s))) for s in subregions}
print(f"  Subregions: {len(subregion_ids)}", flush=True)

appellation_ids = {a: insert_entity("appellation", a) for a in appellations}
print(f"  Appellations: {len(appellation_ids)}", flush=True)

brand_ids = {b: insert_entity("brand", b) for b in brands}
print(f"  Brands: {len(brand_ids)}", flush=True)

# Create contexts
print("Creating contexts...", flush=True)
ctx = 0
all_maps = {"country": country_ids, "region": region_ids, "subregion": subregion_ids, "appellation": appellation_ids, "brand": brand_ids}
for field, id_map in all_maps.items():
    for name, eid in id_map.items():
        for scope in entity_scopes.get((field, name), set()):
            cur.execute("""
                INSERT INTO taxonomy_contexts (entity_id, scope_id, status)
                VALUES (%s, %s, 'draft')
                ON CONFLICT (entity_id, scope_id) DO NOTHING
            """, (eid, scope))
            ctx += 1
print(f"  Contexts: {ctx}", flush=True)

# Summary
cur.execute("SELECT entity_type, count(*) FROM taxonomy_entities GROUP BY entity_type ORDER BY count(*) DESC")
print("\n=== FINAL COUNTS ===", flush=True)
for row in cur.fetchall():
    print(f"  {row[0]:15s} {row[1]}", flush=True)

cur.execute("SELECT scope_id, count(*) FROM taxonomy_contexts GROUP BY scope_id ORDER BY count(*) DESC")
print("\nContexts by scope:", flush=True)
for row in cur.fetchall():
    print(f"  {row[0]:15s} {row[1]}", flush=True)

cur.close()
conn.close()
print("\nDone!")
