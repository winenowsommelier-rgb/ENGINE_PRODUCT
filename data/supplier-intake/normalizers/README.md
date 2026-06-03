# Supplier Intake Normalizers

This folder defines the working contract for turning supplier files into one normalized CSV format.

## Canonical Output Schema

Every supplier normalizer should output these columns:

```csv
intake_batch_id,supplier_code,supplier_name,pricing_structure,drive_bucket,drive_supplier_folder_name,source_file_name,source_file_id,source_sheet,source_row_number,source_line_number,supplier_item_code,barcode,product_name,brand,category,sub_category,origin,country,region,grape,volume_ml,pack_size,vintage,alcohol_pct,cost_ex_vat,cost_inc_vat,supplier_cost,rsp_price,currency,vat_status,discount_pct,raw_price_text,match_key,match_status,matched_sku,proposed_sku,price_rule_id,proposed_selling_price,parse_confidence,needs_human_review,validation_errors,notes
```

## Required Stages

1. Preserve the original supplier file in Google Drive as evidence.
2. Convert the supplier file into this normalized CSV schema.
3. Validate required fields, numeric prices, duplicate supplier item codes, duplicate barcodes, and missing product names.
4. Match against the product database using SKU, barcode, supplier item code, and normalized product name/size.
5. Generate proposed normalized item name, SEO title, and slug.
6. Send low-confidence matches, new-SKU proposals, and uncertain names to human review.
7. Apply approved cost, RSP, selling price, SKU, and name changes with an audit log.

## Confidence Rules

Use `parse_confidence` as `high`, `medium`, or `low`.

Set `needs_human_review` to `true` when:

- the source is PDF/OCR and table extraction is not deterministic
- no supplier item code or barcode is present
- multiple existing SKUs match the same supplier row
- the file provides both RSP and formula-price inputs that conflict
- supplier cost changes beyond the configured threshold
- proposed SKU/category/supplier suffix cannot be derived confidently

## Current Learned Profiles

See `../supplier_file_profiles.csv`.

The first learned parsers should be:

- `bb_and_b_simple_discount`: clean XLSX columns `ID`, `Code`, `Product`, `Normal Price`, `Discount`
- `italasia_repeated_headers`: XLSX sections with repeated `Code`, item, `FB Price`, `Retail Price`
- `united_beverage_thai_quote`: Thai quotation using cost ex-VAT, cost inc-VAT, and retail/RSP columns
- `great_wine_tabular_rsp`: clean XLSX columns for code, name, wholesale, RSP, region, country, vintage
- `ambrose_pdf_winenow_table`: PDF table with item code, NTT/cost, RSP incl/excl VAT, margin
- `universal_pdf_catalog_draft`: PDF catalogue block extraction, human review required
- `iws_pdf_code_table_draft`: PDF catalogue with repeated CODE/NAME/APPELLATION/VINTAGE/RATING/UNIT/PACK/PRICE table
- `vanichwathana_repeated_headers`: XLSX repeated category headers with price expressions and SRP
- `gfour_pdf_trade_proposal_draft`: multi-PDF trade proposal block extraction, human review required
- `surawong_pdf_table_draft`: PDF table draft, human review required
- `sk_liquor_pdf_catalog_draft`: PDF/catalog draft, human review required
