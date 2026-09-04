#!/usr/bin/env bash
# WNLQ9 weekly refresh. Install with:
#     crontab -e
#     0 6 * * 1  /srv/wnlq9/run_weekly.sh >> /var/log/wnlq9.log 2>&1
#
# Monday 06:00 Bangkok, ahead of the 09:00 trend briefing.
#
# Deliberately NOT in this file: WNLQ9_ALLOW_STALE. If a feed is stale the run
# stops and mails you. Putting the override here would make every future run
# publish stale data silently, which is the exact failure this was built to
# prevent — a page shipped in August carrying a July ranking, with all 52
# markup tests green.
set -euo pipefail

cd "$(dirname "$0")"

# Paste the sheet links in sheets.conf — see sheets.conf.example. That file is
# the entire configuration: two Google Sheet links and one database URL.
[ -f ./sheets.conf ] && . ./sheets.conf
export DATABASE_URL="${DATABASE_URL:?set DATABASE_URL in sheets.conf or the service environment}"
export STOCK_CHECKS_CSV="${STOCK_CHECKS_CSV:-}"
export MREPORT_CSV="${MREPORT_CSV:-}"

ALERT="${ALERT_EMAIL:-}"

if ./refresh.py; then
  echo "refresh ok $(date -Is)"
else
  echo "REFRESH FAILED $(date -Is)"
  [ -n "$ALERT" ] && ./refresh.py --dry-run 2>&1 | mail -s "WNLQ9 refresh failed" "$ALERT" || true
  exit 1
fi
