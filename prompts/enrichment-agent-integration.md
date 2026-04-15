# PIM Integration Guide for Enrichment Agents

This is the integration contract for external AI agents pushing enrichment data into the Product Engine. Share this with the agent handling flavor tags, descriptions, region/grape enrichment, etc.

**Base URL:** `http://localhost:3000` (local dev)
**Authentication:** None required for local dev. Production will require a bearer token.

---

## Step 1: Inspect a Live Record

Before pushing updates, verify field coverage on one live record:

```bash
curl -s "http://localhost:3000/api/products/lookup?sku=LGN0316DG" | python3 -m json.tool
```

This returns the product's current state including which fields are empty and which are already populated.

---

## Step 2: Single Product Update

Use `PATCH /api/products/{id}` with the `X-Source: enrichment` header:

```bash
# First get the product id from lookup
ID=$(curl -s "http://localhost:3000/api/products/lookup?sku=LGN0316DG" | python3 -c "import json,sys; d=json.load(sys.stdin); print(list(d['products'].values())[0].get('id',''))")

# Then PATCH
curl -X PATCH "http://localhost:3000/api/products/$ID" \
  -H "X-Source: enrichment" \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "flavor_tags": "[\"juniper\",\"coriander\",\"citrus peel\"]",
      "region": "Finland",
      "grape_variety": "Dry Gin",
      "desc_en_short": "Kilo Gin is a clean dry gin...",
      "validation_status": "validated",
      "enrichment_source": "t2_research_agent",
      "enrichment_note": "Expert-reviewed 2026-04-15"
    },
    "note": "Flavor + description enrichment batch 1"
  }'
```

**Response:**
```json
{
  "updated": true,
  "source": "enrichment",
  "applied": ["flavor_tags", "region", "grape_variety", "desc_en_short", "validation_status", "enrichment_source", "enrichment_note"],
  "dropped": []
}
```

---

## Step 3: Bulk Update (Recommended for your 58 live records)

Use `POST /api/products/bulk-patch` — handles up to 200 records per call:

```bash
curl -X POST "http://localhost:3000/api/products/bulk-patch" \
  -H "X-Source: enrichment" \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      {
        "sku": "LGN0316DG",
        "fields": {
          "flavor_tags": "[\"juniper\",\"coriander\"]",
          "region": "Finland",
          "desc_en_short": "..."
        }
      },
      {
        "id": "row-4957-1774263062979",
        "fields": { "region": "Mendoza", "grape_variety": "Malbec" }
      }
    ]
  }'
```

Each update can be keyed by `sku` OR `id`. The API resolves sku→id server-side.

**Response:**
```json
{
  "source": "enrichment",
  "total": 58,
  "succeeded": 57,
  "failed": 1,
  "dropped_fields_unique": ["upload_ready", "upload_notes"],
  "results": [
    { "sku": "LGN0316DG", "id": "row-...", "updated": true, "applied": [...], "dropped": [] },
    { "sku": "UNKNOWN123", "error": "product not found" }
  ]
}
```

---

## Allowed Fields for Enrichment Source

The `X-Source: enrichment` header restricts writes to these fields. Any other fields you send will be silently dropped (listed in `dropped` response field):

### Geography / Taxonomy
`country`, `region`, `subregion`, `appellation`, `classification`, `wine_classification`, `grape_variety`, `grape_class`, `style`, `liquor_main_type`, `other_type`, `wine_type`

### Tasting Profile
`wine_body`, `wine_acidity`, `wine_tannin`, `food_matching`, `flavor_tags`, `flavor_profile`, `character_traits`

### Descriptions (all variants accepted)
`full_description`, `short_description_en`, `description_en_text`, `description_en_html`, `desc_en_short`, `desc_en_full`

### Images
`image_url`, `image_alt_text`, `image_local_path`, `image_scraped_url`

### Enrichment Metadata
`validation_status`, `overall_confidence`, `taxonomy_confidence`, `description_confidence`, `enrichment_source`, `enrichment_note`, `enrichment_priority`, `research_validation`, `research_confidence_level`, `queue_priority`

### Blocked (BI-owned, not writable by enrichment)
`price`, `cost_price`, `is_in_stock`, `sku`, `name`, `brand`, `bottle_size`, `vintage`, `alcohol` — if you send these, they'll appear in the `dropped` response array.

---

## About Image Columns

All image columns (`image_url`, `image_alt_text`, `image_local_path`, `image_scraped_url`) **exist in the Supabase schema** and are writable via this enrichment source. If you're getting column-missing errors, it's likely a stale schema cache on your side — the live DB accepts them.

If you specifically want to confirm they exist:

```bash
curl -s "http://localhost:3000/api/products/lookup?sku=LGN0316DG" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p = list(d['products'].values())[0]
for f in ['image_url','image_alt_text','image_local_path','image_scraped_url']:
    print(f'{f}: {f in p}')
"
```

---

## Validation Status Values

When setting `validation_status`, use one of:
- `validated` — confidence >= 0.75, fully cleaned
- `needs_review` — medium confidence, queued for human check
- `needs_attention` — low confidence, may have errors
- `blocked` — cannot ship, critical issue
- `unvalidated` — default state (don't set this, it's the starting point)

---

## Changelog

Every PATCH (single or bulk) is logged to the changelog visible at `http://localhost:3000` → Change Log page. Your updates will appear with `source: enrichment` (or whatever you set in `X-Source`).

To view your recent pushes:

```bash
curl -s "http://localhost:3000/api/changelog?source=enrichment&limit=20"
```

---

## Recommended Workflow for Your 58 Live Records

```python
import csv, json, urllib.request

# Read CSV
updates = []
with open('data/product_engine_upload_live_records_only.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Build fields dict from only non-empty columns that are in PIM_FIELDS
        fields = {}
        for key in ['country','region','subregion','appellation','classification','grape_variety',
                    'style','wine_body','wine_acidity','wine_tannin','flavor_tags','food_matching',
                    'desc_en_short','desc_en_full','description_en_text','description_en_html',
                    'short_description_en','validation_status','overall_confidence',
                    'enrichment_source','enrichment_note','research_validation']:
            val = row.get(key, '').strip()
            if val:
                fields[key] = val
        if fields:
            updates.append({'sku': row['sku'], 'fields': fields})

# Send in batches of 50
BATCH = 50
for i in range(0, len(updates), BATCH):
    batch = updates[i:i+BATCH]
    payload = json.dumps({'updates': batch}).encode()
    req = urllib.request.Request(
        'http://localhost:3000/api/products/bulk-patch',
        data=payload,
        headers={'Content-Type': 'application/json', 'X-Source': 'enrichment'},
        method='POST',
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
    print(f'Batch {i//BATCH + 1}: {result["succeeded"]}/{result["total"]} succeeded')
    if result.get('dropped_fields_unique'):
        print(f'  Dropped fields: {result["dropped_fields_unique"]}')
```

---

## Questions Addressed

**Q: I can't write image fields — columns missing in schema?**
A: The image columns exist. If you're getting errors, check the `dropped` field in the response — if `image_url` is there, it means your source header is wrong. Use `X-Source: enrichment` (which includes image fields) not `X-Source: bi`.

**Q: Do I need elevated access / auth token?**
A: No auth on local dev. Just hit the endpoints. Production will add bearer auth but that's not deployed yet.

**Q: Which file should I push from?**
A: `data/product_engine_upload_live_records_only.csv` (58 rows, matched to live Product Engine IDs) is the right one for the first batch. The `missing_live_records.csv` should wait until those SKUs are imported via the New Products flow.
