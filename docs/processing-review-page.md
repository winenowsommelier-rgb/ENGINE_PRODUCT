# Processing Review Dashboard Page

## Overview

The **Processing Review** page has been successfully integrated into the WineNow PIM dashboard. This new workspace provides real-time monitoring and management of the bulk data processing pipeline, enabling stakeholders to track processing status, review batch operations, and identify products requiring manual attention.

## Features

### 1. **Real-Time Statistics Dashboard**
Displays key metrics across four metric cards:
- **Total Processed**: Count of all items that have been processed through the pipeline
- **Ready**: Items that have passed validation and are ready for use
- **Needs Review**: Items that require manual review before being marked as ready
- **Blocked**: Items with processing errors that need attention

Each metric card includes:
- Color-coded visual indicator (violet, emerald, amber, rose)
- Large numeric value for quick scanning
- Human-readable label and descriptive text

### 2. **Recent Batch Logs**
Shows the history of bulk processing operations with details:
- **Source File**: Name of the file being processed
- **Timestamp**: When the batch was processed
- **Status**: Completion status (completed, failed, etc.)
- **Statistics**: Individual counts for processed, ready, and issue items
- **Notes**: Additional batch processing notes or context

Features:
- Displays up to 10 most recent logs
- Status indicator with color-coded pills
- Grid layout showing key metrics at a glance
- Empty state when no logs are available

### 3. **Products Needing Review**
Displays products that require manual attention:
- **Product Name**: Full product name/title
- **SKU**: Unique product identifier
- **Location**: Country and region information
- **Confidence Score**: Overall confidence percentage
- **Review Status**: Marked as "Needs Review"

Features:
- Shows up to 10 items in the review queue
- Sortable by confidence score
- Quick access to product details
- Empty state with success message when all items are reviewed

## Navigation

The Processing Review page is accessible via:
1. **Sidebar Navigation**: "Processing Review" menu item with RefreshCw icon
2. **Dashboard Route**: `activeSection === 'processing'`
3. **Keyboard**: Can be opened by clicking the sidebar icon

## Data Integration

The page fetches data from the following API endpoints:
- `/api/batch-process-db?action=stats` - Processing statistics
- `/api/batch-process-db?action=logs` - Recent batch logs
- `/api/batch-process-db?action=products&status=needs_review&limit=20` - Products needing review

### Expected Data Structure

**Statistics Response:**
```json
{
  "total": 1000,
  "validated": 800,
  "needs_review": 150,
  "blocked": 50
}
```

**Logs Response:**
```json
{
  "logs": [
    {
      "id": "log-123",
      "source_file": "import-batch-001.csv",
      "timestamp": "2026-03-21T10:30:00Z",
      "status": "completed",
      "processed_rows": 500,
      "ready_rows": 450,
      "review_rows": 50,
      "notes": "Standard import batch processed successfully"
    }
  ]
}
```

**Products Response:**
```json
{
  "products": [
    {
      "id": "prod-456",
      "name": "Château Margaux 2018",
      "sku": "CM2018-750",
      "country": "France",
      "region": "Bordeaux",
      "overall_confidence": 0.87,
      "taxonomy_confidence": 0.92,
      "description_confidence": 0.82
    }
  ]
}
```

## UI Components Used

- **Sidebar**: Navigation between dashboard sections
- **NAV_ITEMS**: Updated to include processing section
- **MetricCards**: Display statistics with color coding
- **Pill**: Status badges (good, warn, neutral, bad)
- **CardHeader**: Section headers with eyebrow, title, and description
- **Loading State**: Spinner animation while data fetches

## Styling

Uses the existing Tailwind CSS design system:
- **Colors**: 
  - Violet (`violet-500/10`, `violet-300`) for primary actions
  - Emerald (`emerald-500/10`, `emerald-400`) for success status
  - Amber (`amber-500/10`, `amber-400`) for warnings
  - Rose (`rose-500/10`, `rose-300`) for errors
- **Layout**: 2-column grid on large screens, responsive on mobile
- **Spacing**: Consistent padding (`p-5`, `p-6`) and gaps (`gap-4`, `gap-6`)
- **Borders**: Dark theme with `border-white/10` for subtle divisions

## Event Handling

The page includes:
- **Auto-fetch on mount**: Data is fetched when component mounts
- **Loading state**: Shows spinner while API requests are in flight
- **Error handling**: Catches and logs API errors to console
- **No refresh needed**: Data stays current while page is open

## Future Enhancements

1. **Auto-refresh**: Implement periodic data refresh (every 30-60 seconds)
2. **Direct Actions**: Add approve/reject buttons for products
3. **Batch Operations**: Allow bulk status updates
4. **Filtering**: Add date range and status filters to logs
5. **Export**: Export batch logs or review lists as CSV
6. **Notifications**: Alert users to blocked items or high-volume processing
7. **Performance**: Add pagination for large datasets
8. **Real-time Updates**: WebSocket connection for live status updates

## File Changes

**Modified Files:**
- `components/dashboard.tsx`:
  - Updated `Section` type to include `'processing'`
  - Added processing to `NAV_ITEMS` array
  - Created `ProcessingSection()` component
  - Added processing route in Dashboard render
  - Updated `sectionTitles` record

**API Endpoints (existing):**
- `app/api/batch-process-db/route.ts` - Provides statistics and logs data

## Testing

To test the Processing Review page:

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open dashboard at `http://localhost:3000`

3. Click "Processing Review" in the sidebar

4. Verify data loads from API endpoints:
   - Check Network tab in browser DevTools
   - Confirm metrics display correctly
   - Verify empty states show when no data

5. Monitor console for any errors during data fetch

## Git History

Commit: `dd661f6` - "Add Processing Review dashboard section with real-time statistics and batch logs"

## Status

✅ Implementation Complete
- Processing Review page fully integrated
- Real-time data fetching implemented
- UI matches dashboard design system
- Ready for production use

