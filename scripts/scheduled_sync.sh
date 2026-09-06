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

# Step 0: Recompute reputation tiers (sold_qty/acclaim drift). Was a manual/
# onboarding-only trigger until 2026-09-05 — see memory
# project_reputation_v1_expert_review finding #5 ("no refresh mechanism").
# Runs FIRST, before every Supabase/Drive push (automated review caught
# this: running it last meant a same-night tier change never reached
# Supabase and shipped in that night's Drive bundle with the stale tier —
# both consumers had already run against the pre-recompute state). Backs
# up products.db itself (phase0_backup_and_ddl). Writes
# live_products_export.json itself too (phase3_verify_and_export), so
# Step 2's own refresh_live_export.py call below is a cheap, idempotent
# re-run in the common case, not redundant work that matters.
log "Step 0: Recomputing reputation tiers"
if "$PYTHON" scripts/compute_reputation.py >> "$LOG" 2>&1; then
  log "Reputation recompute OK"
else
  log "ERROR: Reputation recompute failed"
fi

# Step 0b: Masterfile price/cost/stock → Supabase (published CSV, no Google auth).
# This is what carries a Magento price/stock edit into Supabase. Only runs if
# MASTERFILE_CSV_URL is set; price-only, never overwrites enriched fields.
if [ -n "${MASTERFILE_CSV_URL:-}" ]; then
  log "Step 0b: Syncing Masterfile prices (published CSV) → Supabase"
  if "$PYTHON" scripts/nightly_price_sync.py >> "$LOG" 2>&1; then
    log "Masterfile price sync OK"
  else
    log "ERROR: Masterfile price sync failed (see above)"
  fi
else
  log "Step 0b: skipped — MASTERFILE_CSV_URL not set in .env.local"
fi

# Step 1: Supabase sync (delta — only rows updated since last run). Runs
# AFTER reputation recompute so any tier change this run (which bumps
# updated_at only for changed SKUs, see phase2_rollup) is picked up by
# this same incremental push, not stranded until the next run happens to
# also touch that SKU for an unrelated reason.
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
