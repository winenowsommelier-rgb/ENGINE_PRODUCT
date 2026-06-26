#!/usr/bin/env python3
"""
Send nightly price sync summary email.
Called from GitHub Actions after all sync steps complete.

Required env vars:
  GMAIL_APP_PASSWORD       — Gmail app password (no spaces)
  VERCEL_STATUS            — HTTP status code from Vercel deploy hook
  RUN_ID                   — GitHub Actions run ID
"""
from __future__ import annotations

import os
import re
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from pathlib import Path


GMAIL_FROM = "winenowsommelier@gmail.com"
GMAIL_TO   = "winenowsommelier@gmail.com"
REPO_URL   = "https://github.com/winenowsommelier-rgb/ENGINE_PRODUCT"


def extract(text: str, pattern: str, default: str = "—") -> str:
    m = re.search(pattern, text, re.MULTILINE)
    return m.group(1).strip() if m else default


def fmt_int(s: str) -> str:
    try:
        return f"{int(s):,}"
    except (ValueError, TypeError):
        return s if s else "—"


def main() -> None:
    sync_raw   = Path("/tmp/sync_output.txt").read_text()   if Path("/tmp/sync_output.txt").exists()   else ""
    export_raw = Path("/tmp/export_output.txt").read_text() if Path("/tmp/export_output.txt").exists() else ""

    # --- parse price sync output ---
    upserted     = extract(sync_raw, r"Upserted:\s+(\d+)")
    skip_sku     = extract(sync_raw, r"Skipped \(no SKU\):\s+(\d+)")
    skip_price   = extract(sync_raw, r"Skipped \(no price\):(\d+)")
    error_count  = extract(sync_raw, r"Errors:\s+(\d+)")
    duration     = extract(sync_raw, r"Duration:\s+([\d.]+s)")
    error_lines  = [l.strip() for l in sync_raw.splitlines() if l.strip().startswith("•")][:5]

    # --- parse export output ---
    exported     = extract(export_raw, r"(\d+) products,")
    with_price   = extract(export_raw, r"products with price > 0: (\d+)/")
    total_export = extract(export_raw, r"products with price > 0: \d+/(\d+)")
    file_size    = extract(export_raw, r"\(([\d.]+ MB)\)")

    try:
        pct = f"{int(with_price) / int(total_export) * 100:.0f}%"
    except (ValueError, TypeError, ZeroDivisionError):
        pct = "—"

    # --- vercel & meta ---
    vercel_code  = os.environ.get("VERCEL_STATUS", "—")
    vercel_ok    = vercel_code == "201"
    vercel_label = f"OK (HTTP {vercel_code})" if vercel_ok else f"FAILED (HTTP {vercel_code})"
    run_id       = os.environ.get("RUN_ID", "")

    bkk = timezone(timedelta(hours=7))
    now_str  = datetime.now(bkk).strftime("%d %b %Y · %I:%M %p BKK")
    date_str = datetime.now(bkk).strftime("%d %b %Y")

    sync_ok   = error_count == "0"
    export_ok = exported != "—"
    all_ok    = sync_ok and export_ok and vercel_ok
    status    = "ALL OK" if all_ok else "ISSUES FOUND — check errors below"

    if error_lines:
        error_block = "\n".join(f"  {l}" for l in error_lines)
    elif not sync_ok:
        error_block = f"  {error_count} error(s) — see GitHub Actions log"
    else:
        error_block = "  None"

    SEP = "-" * 46
    body = "\n".join([
        "WNLQ9 Nightly Price Sync",
        f"{now_str}  |  Run time: {duration}",
        "",
        f"STATUS: {status}",
        "",
        SEP,
        "PRICES & STOCK  (Masterfile -> Supabase)",
        SEP,
        f"  Rows synced:        {fmt_int(upserted)}",
        f"  Skipped (no SKU):   {fmt_int(skip_sku)}",
        f"  Skipped (no price): {fmt_int(skip_price)}",
        f"  Errors:             {fmt_int(error_count)}",
        "",
        SEP,
        "LIVE CATALOG  (Supabase -> JSON -> Vercel)",
        SEP,
        f"  Products exported:  {fmt_int(exported)}",
        f"  With price > 0:     {fmt_int(with_price)} of {fmt_int(total_export)} ({pct})",
        f"  File size:          {file_size}",
        f"  Vercel deploy:      {vercel_label}",
        "",
        SEP,
        "ERRORS",
        SEP,
        error_block,
        "",
        SEP,
        f"GitHub Actions: {REPO_URL}/actions/runs/{run_id}",
    ])

    prefix  = "[OK]" if all_ok else "[FAIL]"
    subject = f"{prefix} WNLQ9 Price Sync -- {date_str}"

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"]    = GMAIL_FROM
    msg["To"]      = GMAIL_TO

    pw = os.environ["GMAIL_APP_PASSWORD"].replace(" ", "")
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(GMAIL_FROM, pw)
        s.send_message(msg)
    print("Summary email sent")


if __name__ == "__main__":
    main()
