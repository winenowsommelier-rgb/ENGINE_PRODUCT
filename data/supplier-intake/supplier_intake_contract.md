# Supplier Intake Contract

## Purpose

Supplier intake must produce an approved masterfile update, not directly import supplier files into the product database.

The safe flow is:

```text
Drive source file
-> preserved evidence
-> normalized draft CSV
-> product identity matching
-> normalized product-name proposal
-> online research when needed
-> human validation queue
-> approved masterfile update
-> audit log
```

## Product Identity

Use `product_identity_id` to represent the real-world item independent of supplier.

Identity inputs:

- brand
- product name
- category/type
- bottle size
- vintage
- country
- region
- barcode when available
- previous approved supplier mappings

SKU remains the commercial/system code. When a product changes supplier, the identity can remain the same while the SKU suffix changes.

## Supplier Change SKU Rule

When the same product changes supplier, keep the product prefix and running number, and change only the last two supplier-code characters.

Example:

```text
old active SKU: WRW1001AA
new supplier: AB
new SKU: WRW1001AB
old SKU status: inactive
```

The new SKU retains the old product information and product identity. The old SKU is not deleted; it is marked inactive so sales, cost, and supplier history remain auditable.

## Review Statuses

- `exact_match`: strong supplier item code, barcode, or approved mapping match
- `probable_match`: high-confidence product identity match, requires review
- `possible_duplicate`: multiple existing SKUs may be the same item
- `supplier_changed`: same product identity found under a different supplier suffix
- `new_product`: no existing product identity match; propose new SKU
- `blocked`: missing critical fields or extraction is too uncertain

Only `exact_match` should be eligible for auto-apply. All other statuses require human review.

## Product Name Normalization

Before product_admin approval, every row must have a proposed product name.

The proposed name should follow the current masterfile structure:

```text
Brand + cuvee/product expression + style/appellation/designation
```

Vintage and bottle size stay in their own fields, but can be included in SEO title and slug.

Examples:

```text
Brand: Batasiolo
Name: Batasiolo Moscato Spumante Dolce
Vintage: NV
Bottle size: 750ml
SEO title: Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now
```

For new products, the process must create:

- `proposed_item_name`
- `proposed_seo_title`
- `proposed_slug`
- `name_confidence_score`
- `name_review_status`
- `name_review_reasons`
- `online_research_query`

Rows should be marked `needs_online_research` when brand, origin, appellation/designation, size, or product identity is incomplete or uncertain. Online research findings must be treated as evidence for product_admin review, not as direct approval.

Approved source policy starts from:

```text
data/supplier-intake/product_name_research_sources_template.csv
```

Official producer and supplier sources should outrank retailer/database sources.

## Required Normalized Row Fields

The normalizer output should include:

- source evidence: `intake_batch_id`, `source_file_id`, `source_file_name`, `source_sheet`, `source_row_number`
- supplier: `supplier_code`, `supplier_name`, `supplier_item_code`
- product identity: `barcode`, `product_name`, `brand`, `category`, `country`, `region`, `volume_ml`, `vintage`
- commercial data: `cost_ex_vat`, `cost_inc_vat`, `supplier_cost`, `rsp_price`, `currency`, `vat_status`, `discount_pct`
- workflow data: `match_status`, `matched_sku`, `proposed_sku`, `parse_confidence`, `needs_human_review`, `validation_errors`

## Audit Requirements

Every approved change must store:

- original Drive file ID and name
- normalized CSV filename
- row number or source line number
- previous value and new value
- matching decision reason
- reviewer/approver role: `product_admin`
- approval timestamp

## Production Google Drive Access

The application should use the configured Google service account with readonly Drive access for supplier intake.

Required setup:

- Google Cloud project has Google Drive API enabled.
- Environment contains `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Supplier Drive root folder is shared with the service account email.
- App uses scope `https://www.googleapis.com/auth/drive.readonly`.

Current check result on 2026-05-27:

- Service account configuration exists.
- Drive API is not enabled for the project yet, so production Drive import cannot read the folder until that API is enabled.
