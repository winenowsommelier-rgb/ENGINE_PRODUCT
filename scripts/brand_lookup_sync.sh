#!/bin/bash
# Regenerates brand_lookup.json from products.db and hot-reloads the running server.
# Run nightly via com.wnlq9.brand-lookup-sync launchd agent.

set -euo pipefail

REPO="/Users/admin/WNLQ9 PIE/ENGINE_PRODUCT"
PYTHON="$REPO/.venv/bin/python3"
LOG="$REPO/data/brand_lookup_sync.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting brand lookup sync" >> "$LOG"

cd "$REPO"

# Regenerate the JSON from the current DB state
"$PYTHON" scripts/generate_brand_lookup.py >> "$LOG" 2>&1

# Hot-reload the running server (no restart needed)
if curl -sf http://127.0.0.1:7821/reload > /dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Server reloaded OK" >> "$LOG"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: /reload failed — server may be down, launchd will restart it" >> "$LOG"
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sync complete" >> "$LOG"
