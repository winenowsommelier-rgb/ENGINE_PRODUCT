# Supplier File Learning Notes

This is the working analysis log for supplier intake automation. The goal is to learn each supplier's file shape, assign a parser profile, and produce a normalized CSV that can feed SKU matching, cost updates, RSP/pricing rules, and human approval.

## Learned So Far

### Italasia

- Supplier codes: `AA`, `AA2`, `AA4`
- Drive folder: `Italasia (Update)`
- Sample: `Wine Price List 20.04.26 update.xlsx`
- File shape: workbook-style price list with repeated section headers.
- Useful columns: `Code`, product description, `Type`, `Vol.`, `Vintage`, `Rating`, `FB Price`, `Retail Price`, `Remark`.
- Automation level: high for spreadsheet sections, medium for assigning AA/AA2/AA4 without category rules.
- Parser profile: `italasia_repeated_headers`

### BB&B

- Supplier codes: `AB`, `AB2`, `AB3`
- Drive folder: `BB&B`
- Sample: `Coravin BB&B 11.05.27.xlsx`
- File shape: clean table.
- Columns: `ID`, `Code`, `Product`, `Normal Price`, `Discount`.
- Cost rule: `Normal Price * (1 - Discount)`.
- Pricing rule: no RSP bucket, so website selling price should come from supplier formula settings.
- Parser profile: `bb_and_b_simple_discount`

### United Beverage

- Supplier code: `EQ`
- Drive folder: `United Beverage (Update)`
- Sample: `4. Quotation May 2026.xlsx`
- File shape: Thai quotation with header around row 12/13.
- Useful columns: product name, cost ex-VAT, cost inc-VAT, retail/RSP.
- Open decision: confirm whether the product database stores VAT-included or ex-VAT supplier cost.
- Parser profile: `united_beverage_thai_quote`

### Universal Fine Wine & Spirit

- Supplier code: `AC`
- Drive folder: `Universal Wine (Update)`
- Sample: `PDF.pdf`
- File shape: PDF catalogue with country/region sections and product blocks.
- Useful data: product name, size, region, product type, vintage, listed price.
- VAT note: prices are subject to 7% VAT.
- Automation level: low until human-reviewed normalized CSV is available because item codes are not visible in the extracted text.
- Parser profile: `universal_pdf_catalog_draft`

### Ambrose

- Supplier code: `AH`
- Drive folder: `Ambrose (Update)`
- Sample: `Winenow price lsit UPDATE.pdf`
- File shape: PDF table with repeated headers.
- Useful columns: item code, type, product, vintage, Wine-Now NTT, RSP incl VAT, RSP excl VAT, Wine-Now margin.
- Automation level: medium; supplier item codes make matching much safer, but PDF extraction still needs validation.
- Parser profile: `ambrose_pdf_winenow_table`

### Great Wine

- Supplier code: `GE`
- Drive folder: `Great wine (Update)`
- Sample: `List Catalog Greatwine Thailand 3.2026.xlsx`
- File shape: clean spreadsheet table.
- Useful columns: `Code`, `Type`, `Names`, `Grapes` or `Ingredient`, `Region`, `Country`, `Vintage`, `Wholesale Price (THB)`, `RSP (THB)`, optional `Promotion (THB)`.
- Automation level: high for rows with codes, medium for rows with blank supplier code.
- Parser profile: `great_wine_tabular_rsp`

### SK Liquor

- Supplier code: `FS`
- Drive folder: `SK Liqour (Update)`
- Sample: `SK WINE PRice List2026-2(1).pdf`
- File shape: PDF/catalog with item codes, barcode text, product storytelling, pack details, and prices.
- Automation level: low until a human-reviewed normalized CSV is produced.
- Parser profile: `sk_liquor_pdf_catalog_draft`

### Surawong Store

- Supplier codes: `BU`, `BU(2)`, `BU(4)`, `BU(9)`
- Drive folder: `Surawong Store (Update)`
- Sample: `ใบราคา1.5.69 ราคาที่2 (1).pdf`
- File shape: PDF table with category, product, size, pack, price/bottle ex-VAT.
- Automation level: medium draft extraction, but human review is required because supplier item codes are missing.
- Parser profile: `surawong_pdf_table_draft`

### Chalamnimit

- Supplier code: `BU(8)`
- Drive folder: `Chalamnimit (Update)`
- Status: mapped but pending file profiling.

## Next Learning Queue

Prioritize suppliers that already have mapped Drive folders and existing SKU/sales metrics:

1. `AC` Universal Wine
2. `AE` Gfour
3. `AH` Ambrose
4. `BN` IQ Wine
5. `BS` Texica
6. `CH` Siam Winery
7. `FN` Enoteca
8. `GE` Great Wine
9. `HI` Orion Fine Wines
10. `HD` Sake Merchant

For each supplier, capture:

- pricing bucket
- Drive folder name and latest month folder
- latest representative file name and ID
- file type
- header pattern
- supplier item code column
- product name column
- cost column
- RSP column if present
- VAT behavior
- parser profile name
- automation confidence
- human-review rules
