# Supplier Normalization Solution

## What We Can Do Now

The process should be:

1. Read each supplier folder from Google Drive.
2. Select the latest month folder and preserve the original file as evidence.
3. Extract supplier rows into the canonical normalized CSV schema.
4. Run validation on required fields, prices, duplicate codes, VAT status, and parse confidence.
5. Match normalized rows to the masterfile using supplier item code first, then product name + size + vintage.
6. Route unmatched, ambiguous, PDF-derived, or high-price-change rows to human review.
7. Only approved rows update cost, RSP, selling price, proposed SKU, and logs.

## Current Folder Status

Generated files:

- `supplier_normalization_status.csv`: all supplier-code rows with folder, parser readiness, SKU count, blocker, and solution.
- `supplier_folder_problem_list.csv`: only suppliers/folders with a blocker or review requirement.

Current readiness summary:

- `normalizable`: 4 supplier codes
- `normalizable_with_rules`: 4 supplier codes
- `draft_extract_then_review`: 7 supplier codes
- `needs_profile`: 54 supplier codes
- `blocked`: 78 supplier codes

## Normalizable Now

These have learned file shapes and can be the first automation targets:

- `AA` Italasia Head Office: spreadsheet with repeated headers
- `AB` BB&B: clean spreadsheet with normal price and discount
- `EQ` United Beverage: Thai quotation spreadsheet
- `GE` Great Wine: clean spreadsheet with wholesale and RSP

Shared-folder variants need split rules:

- `AA2`, `AA4`: share Italasia folder; need category/brand section filters
- `AB2`, `AB3`: share BB&B folder; need product-category filters

## PDF Draft Extract Then Review

These can be extracted into draft CSV, but should not directly update the database without human approval:

- `AC` Universal Fine Wine & Spirit: PDF catalogue, no reliable item code in extracted text
- `AH` Ambrose: PDF table with item code and RSP, medium confidence
- `FS` SK Liquor: noisy PDF catalogue
- `BU`, `BU(2)`, `BU(4)`, `BU(9)`: Surawong PDF tables, many rows missing item code

Solution:

- Use PDF text/OCR extraction into draft normalized CSV.
- Mark `parse_confidence` as `medium` or `low`.
- Require human approval for SKU match, proposed SKU, and price update.

## Needs Profile

These supplier folders are mapped, but we still need to inspect the latest supplier file and define a parser profile.

Examples with high priority because they have many existing SKUs:

- `AE` Gfour
- `AF` Vanichwattana
- `AJ` Lovely Wine
- `BN` IQ Wine
- `CB` Boozia
- `CN` Alchemy
- `DD` Noble Marketing
- `DH` Estella
- `DJ` Wine 5
- `FN` Enoteca
- `GW` Ideal Wine

Solution:

- For each folder, inspect latest month file.
- If XLSX/CSV: define header aliases and implement direct normalizer.
- If PDF: implement draft extractor and human-review workflow.

## Blocked

These supplier codes are in the supplier master list but do not yet have confirmed Drive folder mapping in the starter reference.

Solution:

- Add or confirm a Drive folder mapping.
- Then inspect the latest file and assign a parser profile.

See `supplier_folder_problem_list.csv` for the full list.

## SKU Match Coverage

Real match percentage can only be calculated after a supplier file has been normalized into rows. I added `match_normalized_to_master.py` for this.

Matching rules:

- exact supplier item code within SKU suffix
- exact product name + bottle size + vintage within SKU suffix
- ambiguous matches are not auto-approved
- unmatched rows become proposed new SKU or human-review tasks

Command pattern:

```bash
python3 data/supplier-intake/match_normalized_to_master.py \
  --input normalized_supplier.csv \
  --output matched_supplier.csv \
  --summary-output matched_supplier_summary.csv
```

