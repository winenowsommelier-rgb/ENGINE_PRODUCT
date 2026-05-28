# Supplier Intake Run Workflow — Design Spec

**Date:** 2026-05-29
**Branch:** feat/taste-taxonomy-v2
**Scope:** Run workflow UI and the three missing API routes that support it

---

## 1. Problem

The supplier intake pipeline has a complete backend (normalize / match / price / approve / commit routes all working), and an existing `SupplierIntakePage` dashboard with 4 tabs (control / suppliers / review / pim). What is missing is the **human-facing run workflow** — a step-by-step panel where a user picks a supplier, selects a file from Drive, triggers the auto-chain, reviews the priced rows, exports a team CSV, and commits approved rows to the PIM.

Without this, the pipeline can only be driven by API calls; there is no browser UI for the intake operator.

---

## 2. Decisions Made

| Decision | Choice | Reason |
|---|---|---|
| File source | Drive-first | Drive is the source of truth; files arrive there before email |
| Step progression | Auto-chain normalize→match→price, then stop for human review | Intermediate steps need no human input |
| Row approval | Checkbox per row + "Approve all" | Simple; flagged rows are locked out entirely |
| Needs-review default | Unchecked | User must consciously approve uncertain matches |
| Flagged rows | Locked out — not committed this round | Handled in the next run after investigation |
| CSV export | At review stage, before commit | Team can audit offline and request re-run with adjusted settings |
| Settings adjustment | "Adjust Settings" link → opens supplier settings panel | No inline edit; change settings then re-run |
| Entry point | New 5th tab "Run intake" in existing SupplierIntakePage | Keeps dashboard intact; no page replacement |

---

## 3. What to Build

### 3a. New API routes

#### `GET /api/supplier-intake/drive-files`

Query param: `folder_id` (string, required).

Calls `listSupplierDriveFiles(folder_id)` and returns the file list. Used by the UI to browse the supplier's Drive folder before registering a run.

Response shape:
```json
{
  "files": [
    { "id": "...", "name": "supplier_a_may.xlsx", "mimeType": "...", "modifiedTime": "...", "size": "..." }
  ]
}
```

Error: 400 if `folder_id` missing, 500 with message on Drive failure.

---

#### `POST /api/supplier-intake/runs` — extend existing route

Current body: `{ supplier_id }`.

Extended body (use the exact field names the route already writes to `SupplierIntakeRun`):
```json
{
  "supplier_id": "...",
  "source_drive_file_id": "...",   // optional — Drive source file ID
  "source_filename": "...",        // optional — Drive file name
  "source_format": "xlsx"          // optional, defaults to extension detection
}
```

When `source_drive_file_id` is provided, write it plus `source_filename` onto the created `SupplierIntakeRun`. This links the run to its source file at creation time so the normalize step can pull it from Drive without a second upload.

Response envelope: `{ run: SupplierIntakeRun }`

---

#### `GET /api/supplier-intake/runs/[id]/export-csv`

Serializes all priced rows for the run to CSV and returns it as a file download (`Content-Type: text/csv`, `Content-Disposition: attachment; filename="intake-[id]-review.csv"`).

Columns (in order):
`row_number`, `supplier_item_code`, `name`, `matched_sku`, `match_confidence`, `match_status`, `cost`, `supplier_rsp`, `calculated_price`, `final_selling_price`, `margin_pct`, `price_status`, `issues`

Column notes:

- `row_number` maps to `SupplierNormalizedRow.row_number`
- `issues` maps to `SupplierNormalizedRow.issues` (a `string[]`) — serialize by joining with ` | ` (pipe with spaces)

Blocked/flagged rows are included in the CSV (marked in `price_status`) so the team can see what was excluded and why.

---

### 3b. Fix existing routes

#### `POST /api/supplier-intake/runs/[id]/normalize`

Current issue: the route calls `req.formData()` unconditionally at the top before checking for `source_drive_file_id`. An empty POST with no multipart body throws and returns an unhandled error.

Fix: wrap the `formData()` call in a try/catch and fall through to the Drive path if it fails, OR check `Content-Type` header first. Specifically:

```ts
let uploadedFile: File | null = null;
const ct = req.headers.get('content-type') ?? '';
if (ct.includes('multipart/form-data')) {
  const form = await req.formData();
  uploadedFile = form.get('file') as File | null;
}
// then proceed with: if uploadedFile → use it, else if run.source_drive_file_id → use Drive
```

The auto-chain UI will call normalize with `Content-Type: application/json` and no body (omit body entirely, not `{}`). This fix ensures that path works without touching the existing multipart upload behavior.

---

#### `POST /api/supplier-intake/runs/[id]/approve`

Current bug: sets `run.status = 'approved'` unconditionally even for partial approval.

Fix: exclude both `blocked` and `new_code_required` rows from the "committable" count — the commit route silently skips `new_code_required` rows anyway (no `selected_product_id`), so approving them does not actually write anything. Treat them as non-committable like blocked rows.

```ts
const committable = rows.filter(r => r.status !== 'blocked' && r.status !== 'new_code_required').length;
const approvedCount = nextRows.filter(r => r.status === 'approved').length;
const runStatus = approvedCount >= committable && committable > 0 ? 'approved' : 'priced';
```

---

### 3c. New UI — "Run intake" tab

Fifth tab added to `SupplierIntakePage`. Tab label: `Run intake`. The tab renders a single `<IntakeRunWorkflow />` component, defined in the same file (under 500 lines total; if needed extract to `components/supplier-intake/IntakeRunWorkflow.tsx`).

#### Component signature

```ts
interface IntakeRunWorkflowProps {
  onNavigateToSettings: () => void; // wired to setView('settings') in parent
}
function IntakeRunWorkflow({ onNavigateToSettings }: IntakeRunWorkflowProps)
```

#### States the component manages

```ts
type WorkflowPhase = 'setup' | 'processing' | 'review' | 'committed';

{
  phase: WorkflowPhase;
  suppliers: SupplierDefinition[];
  selectedSupplierId: string | null;
  driveFiles: DriveFile[];           // loaded when supplier selected
  selectedFileId: string | null;
  selectedFileName: string | null;
  run: SupplierIntakeRun | null;
  rows: SupplierNormalizedRow[];
  checkedIds: Set<string>;           // approval checkboxes
  processing: boolean;
  error: string | null;
}
```

#### Phase: setup

- Supplier dropdown loads from `GET /api/settings/suppliers` — response envelope is `{ suppliers: SupplierDefinition[] }`, read `data.suppliers`
- When supplier selected:
  - If `supplier.drive_folder_id` is undefined/empty: show inline warning "This supplier has no Drive folder configured — go to Settings to add one." Disable file list fetch and "Start Run" button.
  - If `supplier.drive_folder_id` is set: call `GET /api/supplier-intake/drive-files?folder_id={supplier.drive_folder_id}` to populate file list
  - If Drive returns 0 files: show "No files found in this supplier's Drive folder."
- File list rendered as a simple radio-list with name + modified date
- "Start Run" button: disabled until supplier + file both selected
- On click: POST to `/api/supplier-intake/runs` with `{ supplier_id, source_drive_file_id, source_filename, source_format }`, then immediately trigger auto-chain

#### Phase: processing

- Stepper bar: Normalize → Match → Price → Review → Commit
  - Each step ticks green as it completes
  - Active step shows a spinner
- Auto-chain: after run created, sequentially call:
  1. `POST /api/supplier-intake/runs/[id]/normalize` (no body, `Content-Type: application/json` — Drive file already linked to run)
  2. `POST /api/supplier-intake/runs/[id]/match`
  3. `POST /api/supplier-intake/runs/[id]/price`
- On any step error: stop, show error message, offer "Retry from this step"
- On success: transition to `review` phase with the priced rows

#### Phase: review

Header bar (right-aligned):
- Row counts: `N rows · X flagged · Y needs review`
- `Export CSV` button → `GET /api/supplier-intake/runs/[id]/export-csv` → triggers browser download
- `Adjust Settings` link → calls `onNavigateToSettings()` prop (see component signature below), which the parent `SupplierIntakePage` wires to `setView('settings')`
- `Approve Selected (N)` button → calls `POST /api/supplier-intake/runs/[id]/approve` with checked IDs

Review table columns:
| Col | Source | Notes |
|---|---|---|
| ☐ | checkbox | Pre-checked if `price.status !== 'needs_review'` and not blocked |
| # | row_number | |
| Name | normalized_payload.name | |
| Matched SKU | match.selected_sku | grey "—" if no match |
| Conf. | match.confidence | color: green ≥100, amber 55–99, red <55 |
| Cost | normalized_payload.cost | formatted with currency |
| Supp RSP | normalized_payload.rsp | "—" if absent |
| Calc Price | price.calculated_price | |
| Margin % | price.margin_pct | color: green ≥target, amber ≥min, red <min |
| Status badge | row.status | auto ✓ / review ⚑ / flagged ✗ |
| Issues | row.issues | collapsed; expand on hover |

Row styling:
- `blocked` rows: greyed out, no checkbox, strikethrough name, locked `flagged ✗` badge
- `matched_needs_review` / `needs_review` price rows: amber background tint, unchecked by default
- Clean rows: normal

After "Approve Selected" succeeds: re-fetch rows, show "N rows approved. Ready to commit."

Commit button: full-width green `Commit N approved rows to PIM →` 
- Calls `POST /api/supplier-intake/runs/[id]/commit`
- On success: transition to `committed` phase

#### Phase: committed

Summary card:
- Committed row count
- Changelog entries written
- Flagged rows count (excluded)
- "Start another run" button → resets to `setup` phase

---

## 4. What Does NOT Change

- `SupplierIntakePage` control / suppliers / review / pim tabs — untouched
- All existing lib files (types, matching, pricing, normalization, google-drive) — untouched
- `SupplierSettingsPage` — untouched (linked from "Adjust Settings" only)
- Commit route — untouched (already correct)

---

## 5. File Map

| File | Action |
|---|---|
| `app/api/supplier-intake/drive-files/route.ts` | **Create** |
| `app/api/supplier-intake/runs/route.ts` | **Edit** — extend POST body |
| `app/api/supplier-intake/runs/[id]/normalize/route.ts` | **Edit** — add content-type guard before formData() |
| `app/api/supplier-intake/runs/[id]/export-csv/route.ts` | **Create** |
| `app/api/supplier-intake/runs/[id]/approve/route.ts` | **Edit** — fix partial approval status |
| `components/pages/SupplierIntakePage.tsx` | **Edit** — add 5th tab + IntakeRunWorkflow component |

Total: 2 new files, 3 edited files. No new pages, no schema changes.

---

## 6. Success Criteria

1. User can select a supplier, browse their Drive folder, pick a file, and click "Start Run" — all in the browser
2. Normalize → Match → Price runs automatically with a visible progress stepper
3. Review table shows all priced rows with correct checkbox defaults (auto ✓ pre-checked, needs_review unchecked, blocked locked)
4. "Export CSV" downloads a CSV with all 13 columns that the team can open in Excel
5. "Approve Selected" only sends checked row IDs; run status reflects partial vs full approval
6. "Commit" writes cost + price to products and creates changelog entries
7. Flagged rows never appear in the commit payload — they stay in the run as `blocked`
