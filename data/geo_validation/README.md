# Geography validation process

Validate a list of items against the **canonical geography taxonomy**
(`data/taxonomy/{countries,regions,subregions}.json`) and the **live product
database** (`data/db/products.json`), then get a validated `.csv` back to
process further.

## Run it

```bash
python3 scripts/validate_geography_list.py INPUT [-o OUTPUT]
```

- `INPUT` — a `.csv` or `.json` list of items. Column / key names are
  auto-detected, so any of these work:
  - country column: `country`, `country_name`, `origin_country`
  - region column: `region`, `region_name`, `wine_region`
  - subregion column: `subregion`, `sub_region`, `sub region`, `subzone`
  - id column (optional, passed through): `sku`, `id`, `name`
- `OUTPUT` — defaults to `<input>.validated.csv` next to the input.

Example:

```bash
python3 scripts/validate_geography_list.py data/geo_validation/sample_items.csv
```

## What it checks (hierarchy-aware)

| Level     | Rule                                                              |
|-----------|------------------------------------------------------------------|
| country   | known country? (accent/case-insensitive, ISO codes + aliases)    |
| region    | known region **and** belongs to the stated country               |
| subregion | known subregion **and** belongs to the stated region             |

Each level gets a status:

- `valid` — exact match to the canonical name
- `corrected` — matched after fixing case/accents/alias; canonical name filled in
- `wrong_parent` — exists in the taxonomy but under a different parent
- `unknown` — no match anywhere in the taxonomy
- `blank` — nothing supplied

`overall_status` rolls these up to `valid`, `corrected`, or `invalid`.

## Output columns

`row, item, input_country, input_region, input_subregion, country, region,
subregion, country_status, region_status, subregion_status, country_id,
region_id, subregion_id, in_database, overall_status, notes`

- The `country` / `region` / `subregion` columns hold the **canonical** values
  (corrected spelling/accents) — feed these downstream.
- `*_id` are the taxonomy primary keys, ready for joins.
- `in_database = yes` means that exact country/region/subregion combo already
  ships in `data/db/products.json`.

## Extending

- New country/region spelling variants → add to `COUNTRY_ALIASES` /
  `REGION_ALIASES` in `scripts/validate_geography_list.py`.
- `sample_items.csv` is a tiny fixture covering valid, accent-correction,
  alias, wrong-parent, and unknown cases.
