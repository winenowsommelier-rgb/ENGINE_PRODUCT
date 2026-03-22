# Quick Start Guide - Local Database System

## 🚀 Start Here (5 Minutes)

### Step 1: Open the Application
```
Client: http://localhost:3000
If not running, start with: npm run dev:vscode
```

### Step 2: Go to Data Hub
```
1. Click "Data Hub" in left sidebar
2. You'll see the load screen with two options:
   - Upload CSV
   - Load from Magento feed
```

### Step 3: Load Products
```
Click: "Load Magento rows 1–200"
Wait: 2-5 seconds
See: 200 products appear in the left panel
```

### Step 4: Select & Process
```
1. Click: "✓ All 200" (select all products)
2. Click: "Process 200 selected" (blue button)
3. Watch: Processing status with 🔄 animation
4. See: "Processed Collection" summary showing:
   - Total: 200
   - Ready: ~150-160
   - Review: ~30-40
   - Blocked: ~5-10
```

### Step 5: View Your Data
```
1. Click: "Data Catalog" in sidebar
2. See: All 200 products in table
3. Search: Try searching for "wine" or a country
4. Click: Any product to see full details
```

## 📊 Understanding the Dashboard

### Data Hub Sections

**Top Stats Bar**:
- 🟢 **Ready**: Can be exported, high confidence
- 🟡 **Review**: Flagged for verification, medium confidence
- 🔴 **Blocked**: Errors, needs manual fixing

**Left Panel**:
- Search bar - find by SKU, name, country, grape
- Filters - status, category, type, sorting
- Row list - scrollable with confidence bars

**Right Panel**:
- Empty state: Click a rowto see details
- Row details: Shows all fields, suggestions, auto-corrections
- Flavor profile: Assigned notes & families
- Taxonomy suggestions: AI recommendations with confidence %

### Data Catalog Sections

**Statistics**:
- 📊 Total items - all processed products
- ✅ Validated - ready to export
- 📋 Needs Review - manual check needed
- ⚠️ Avg Confidence - overall data quality

**Product Table**:
- Sortable columns: SKU, Name, Country, Classification, Confidence, Status
- Click any row - detailed product modal
- Modal shows: All fields, descriptions, flavor profile

## 🎯 Common Tasks

### Task: Process All Remaining Products
```
1. Go to Data Hub
2. Click "Load Magento rows 1–200" (loads next batch)
3. Click "✓ All 200"
4. Click "Process 200 selected"
5. Wait for completion
6. Repeat for all 11,187 products (56 total batches)
```

### Task: Export Validated Products
```
1. Go to Data Hub
2. Load or access batch
3. Click "Export Magento CSV (all ready)"
4. CSV downloads to your computer
5. Use in Magento import tool
```

### Task: Find Products from Specific Country
```
1. Go to Data Catalog
2. In search: Type country name or filter dropdown
3. See filtered results instantly
4. Click product details to inspect
```

### Task: Check Validation Issues
```
1. Go to Data Catalog
2. Center-click a product
3. In modal, see:
   - **Errors** (red) - critical issues
   - **Warnings** (yellow) - minor issues
   - Confidence scores
```

### Task: Download All Processed Data
```
1. Go to Data Hub
2. After processing, scroll to "Processed Collection"
3. Click "↓ Download Collection JSON"
4. JSON file downloads with all product details
```

## 📈 What Getting Stored?

All data automatically saved to: `data/db/`

**Files Created**:
- `products.json` - All cleaned products (main database)
- `batch-logs.json` - What was processed when
- `data-issues.json` - Validation errors found

**You Can**:
- 📂 Inspect files anytime (they're just JSON)
- 💾 Backup by copying `data/db/` folder
- 📤 Import elsewhere by reading JSON files

## ✅ Checklist: First-Time Setup

- [ ] Dev server running on port 3000?
- [ ] Open http://localhost:3000
- [ ] See WineNow PIM dashboard
- [ ] Data Hub section visible in sidebar
- [ ] Load Magento products works
- [ ] Batch processing completes
- [ ] Data Catalog shows products
- [ ] Search/filter works
- [ ] Can view product details
- [ ] Can export CSV/JSON

## 🆘 Troubleshooting

### "Dev server not running"
```bash
cd /Users/admin/WNLQ9\ PIE/ENGINE_PRODUCT
npm run dev:vscode
#ORnpm run dev
```

### "Magento products won't load"
```
Check:
1. data/taxonomy/magento_item_data.json exists?
2. Run Python extraction script first:
   python scripts/extract_taxonomy.py
3. Check browser console for errors (F12)
```

### "Process button doesn't work"
```
Check:
1. Selected at least 1 row?
2. Browser console (F12) for errors
3. Try refreshing page
4. Check data/db/ directory exists
```

### "Data not showing in catalog"
```
Check:
1. Batch processing completed?
2. data/db/products.json file created?
3. Try refreshing Data Catalog page
4. Check browser DevTools Network tab
```

## 📚 Documentation

For detailed information, see:
- `docs/local-database.md` - Complete technical guide
- `IMPLEMENTATION_SUMMARY.md` - What was built & why
- This file - Quick start & FAQs

## 🎓 Understanding the Process

### Data Transformation Pipeline
```
Raw Magento Data (11,187 rows)
           ↓
      AI Analysis
      - Detect fields
      - Match taxonomy
      - Score confidence
           ↓
      Normalization
      - Clean values
      - Standardize format
      - Add descriptions
           ↓
      Validation
      - Check required fields
      - Flag issues
      - Assign status
           ↓
      Database Storage
      - Save to products.json
      - Log operations
      - Track issues
           ↓
      Data Catalog
      - Full product database
      - Searchable & filterable
      - Exportable
```

## 💡 Tips & Tricks

### Pro Tip 1: Batch Selection
- Click first row, then Shift+Click last row = **select entire range**
- Much faster than clicking each one individually!

### Pro Tip 2: Export Format
- **Magento CSV**: Use for importing to Magento
- **Review CSV**: Use for analysis/spreadsheets
- **Collection JSON**: Keep as backup, most complete

### Pro Tip 3: Data Quality
- Focus on **"Ready" products** first (highest confidence)
- **"Needs Review"** items need manual attention
- **"Blocked"** items have errors to fix

### Pro Tip 4: Pagination
- Data Catalog shows 50 rows/page
- Use search to narrow down
- Confidence scores help prioritize

### Pro Tip 5: Manual Override
- View field suggestions (right panel, "Taxonomy suggestions")
- Click suggestion buttons to apply manually
- Overrides update confidence tracking

## 🔐 Data Storage & Backup

**Important**: All data stored locally in `data/db/`
- 📂 Location: `/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/data/db/`
- 💾 Size: ~2-5 MB per 1000 products
- 🔒 No cloud sync (all local)

**Backup**:
```bash
# Backup to ZIP
zip -r backup.zip data/db/

# Or copy folder
cp -r data/db/ backup-folder/
```

## 🚀 Next Steps After First Run

1. **Process More Data**: Continue loading & processing batches until all 11,187 items done
2. **Fix Blocked Items**: Review "Blocked" products, apply manual fixes
3. **Scraping**: Real product descriptions (framework ready, API implementation needed)
4. **Export**: Download cleaned data as CSV or JSON
5. **Import**: Use Magento CSV in your Magento installation

---

**Questions?** Check the full documentation in `docs/local-database.md`

**Ready?** Go to http://localhost:3000 and click Data Hub!
