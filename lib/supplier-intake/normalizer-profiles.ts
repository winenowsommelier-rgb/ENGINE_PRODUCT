// Maps supplier_code → Python normalizer profile ID.
// Profile IDs must match the keys in NORMALIZERS dict in normalize_supplier_file.py.
// Add new entries here when a new supplier file structure is learned.
export const SUPPLIER_DEFAULT_PROFILE: Record<string, string> = {
  // ── XLSX normalizers (fully automated) ────────────────────────────────────
  'GE':   'ge_tabular_xlsx',           // Great Wine — Code/Wholesale/RSP, Wine+SPIRITS sheets
  'EQ':   'eq_quotation_xlsx',         // United Beverage — Thai quotation, ex/inc VAT + RSP
  'AA':   'aa_repeated_headers_xlsx',  // Italasia — repeated brand headers, FB Price/Retail Price
  'AA2':  'aa_repeated_headers_xlsx',
  'AA4':  'aa_repeated_headers_xlsx',
  'AF':   'af_multisheet_xlsx',        // Vanichwattana — 13 country sheets, Price/Bottle + SRP

  // ── PDF stubs (manual extraction required) ────────────────────────────────
  'AB':   'ab_pdf',
  'AB2':  'ab_pdf',
  'AB3':  'ab_pdf',
  'AD':   'ad_pdf',
  'AD2':  'ad_pdf',
  'AD3':  'ad_pdf',
  'AC':   'ac_pdf',
  'AH':   'ah_pdf',
  'AE':   'ae_pdf',
  'BU':   'bu_pdf',
  'BU(2)': 'bu_pdf',
  'BU(4)': 'bu_pdf',
  'BU(9)': 'bu_pdf',
  'FS':   'fs_pdf',
};
