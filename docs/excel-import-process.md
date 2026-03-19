# Excel import process for WineNow

Use this flow when the source workbook cannot be uploaded directly into Codex.

## 1. Prepare the workbook

1. Keep one row per SKU.
2. Use these headers exactly:
   - `sku`
   - `name`
   - `category`
   - `type`
   - `grape`
   - `region`
   - `style`
   - `price`
   - `costPrice`
   - `currency`
   - `status`
   - `oak`
3. Save the file as `.xlsx` or export it to `.csv`.

## 2. What the importer self-heals

- trims and uppercases SKUs
- uppercases currency codes
- maps known aliases such as `cab sauv` -> `Cabernet Sauvignon`
- maps region aliases such as `marlboro` -> `Marlborough`
- maps style aliases such as `structured oak aged` -> `Structured & Oak-Aged`
- clamps sensory scores into the required `0-5` range
- infers a country from known regions where possible

## 3. What still blocks import

- missing SKU
- missing name
- invalid or negative price / cost price
- unresolved taxonomy values that remain below the confidence threshold after normalization

## 4. Suggested local workflow

1. Copy your Excel data into `public/templates/winenow-import-template.csv` columns.
2. Run the upload preview in the app.
3. Review the `Corrections` and `Issues` columns.
4. Fix blocked rows in Excel.
5. Re-run preview until the blocked count is zero.
6. Export approved rows to CSV/XLSX or Magento-ready payloads.

## 5. Taxonomy checks to do before production import

- standardize workbook tab naming (`Origin` and `Magento item data` should have stable machine names)
- fix the visible malformed country record `Other (N/A)NA` into separate `name` and `iso` values
- explicitly model geography level for mixed country / sub-country ISO codes like `GB-SCT` and `GB-ENG`
