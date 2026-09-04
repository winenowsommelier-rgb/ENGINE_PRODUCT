#!/bin/bash
# Scheduled sync — runs via launchd daily at 03:00
# 0. Push fresh price/cost/stock from the Masterfile (published CSV) → Supabase
# 1. Sync products.db → Supabase (delta only)
# 2. Regenerate AI knowledge base files + upload to Drive

set -uo pipefail

REPO="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
PYTHON="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT/.venv/bin/python3"
LOG="$REPO/data/sync.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

cd "$REPO"

# Load env (.env.local) so SUPABASE_* + MASTERFILE_CSV_URL are available.
if [ -f "$REPO/.env.local" ]; then
  set -a; . "$REPO/.env.local"; set +a
fi
# nightly_price_sync.py reads SUPABASE_URL; .env.local exposes NEXT_PUBLIC_SUPABASE_URL.
export SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"

log "=== Scheduled sync started ==="

# Step 0: Masterfile price/cost/stock → Supabase (published CSV, no Google auth).
# This is what carries a Magento price/stock edit into Supabase. Only runs if
# MASTERFILE_CSV_URL is set; price-only, never overwrites enriched fields.
if [ -n "${MASTERFILE_CSV_URL:-}" ]; then
  log "Step 0: Syncing Masterfile prices (published CSV) → Supabase"
  if "$PYTHON" scripts/nightly_price_sync.py >> "$LOG" 2>&1; then
    log "Masterfile price sync OK"
  else
    log "ERROR: Masterfile price sync failed (see above)"
  fi
else
  log "Step 0: skipped — MASTERFILE_CSV_URL not set in .env.local"
fi

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

# Step 3: Build & sync the Drive export bundle (in-stock, tiered, manifest, verify).
# Prune is intentionally OFF until the first watched run is confirmed; then add
# --prune here to auto-trash stale files (see drive-export-v2 spec sec 6).
log "Step 3: Building & syncing Drive export bundle"
if "$PYTHON" scripts/export_drive_bundle.py >> "$LOG" 2>&1; then
  log "Drive bundle sync OK"
else
  log "ERROR: Drive bundle sync failed"
fi

log "=== Scheduled sync complete ==="

# Keep log under 5000 lines
tail -5000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
