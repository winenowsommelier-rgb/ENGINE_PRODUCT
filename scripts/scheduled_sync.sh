#!/bin/bash
# Scheduled sync — runs via launchd daily at 03:00
# 1. Sync products.db → Supabase (delta only)
# 2. Regenerate AI knowledge base files + upload to Drive

set -euo pipefail

REPO="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
PYTHON="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python3"
LOG="$REPO/data/sync.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

log "=== Scheduled sync started ==="

# Step 1: Supabase sync (delta — only rows updated since last run)
log "Step 1: Syncing products.db → Supabase"
cd "$REPO"
if "$PYTHON" scripts/sync_to_supabase.py >> "$LOG" 2>&1; then
  log "Supabase sync OK"
else
  log "ERROR: Supabase sync failed (see above)"
fi

# Step 2: Refresh live export from SQLite
log "Step 2: Refreshing live_products_export.json"
if "$PYTHON" scripts/refresh_live_export.py >> "$LOG" 2>&1; then
  log "Live export refresh OK"
else
  log "ERROR: Live export refresh failed"
fi

# Step 3: Sync AI knowledge base files to Google Drive
log "Step 3: Syncing AI knowledge base to Google Drive"
if "$PYTHON" scripts/sync_ai_knowledge_base_to_drive.py >> "$LOG" 2>&1; then
  log "Drive sync OK"
else
  log "ERROR: Drive sync failed"
fi

log "=== Scheduled sync complete ==="

# Keep log under 5000 lines
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
