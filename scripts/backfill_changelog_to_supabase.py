#!/usr/bin/env python3
"""
Backfill existing local JSON changelog (data/db/product-changelog.json)
into Supabase product_changelog table.

Prereqs:
  1. Run supabase/migrations/002_product_changelog.sql against your Supabase instance
  2. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Usage:
  python3 scripts/backfill_changelog_to_supabase.py
  python3 scripts/backfill_changelog_to_supabase.py --dry-run
  python3 scripts/backfill_changelog_to_supabase.py --batch 500
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent.parent
CHANGELOG_PATH = ROOT / 'data' / 'db' / 'product-changelog.json'
ENV_PATH = ROOT / '.env.local'


def load_env():
    """Minimal .env.local loader."""
    env = dict(os.environ)
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def upload_batch(url: str, key: str, batch: list) -> tuple[int, str]:
    data = json.dumps(batch).encode()
    req = urllib.request.Request(
        f'{url}/rest/v1/product_changelog?on_conflict=id',
        data=data,
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, ''
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='Show counts only')
    parser.add_argument('--batch', type=int, default=200, help='Rows per batch')
    parser.add_argument('--start', type=int, default=0, help='Skip first N rows (resume)')
    args = parser.parse_args()

    env = load_env()
    url = env.get('NEXT_PUBLIC_SUPABASE_URL')
    key = env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    if not url or not key:
        print('ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
        sys.exit(1)

    if not CHANGELOG_PATH.exists():
        print(f'ERROR: {CHANGELOG_PATH} not found')
        sys.exit(1)

    print(f'Loading {CHANGELOG_PATH}...')
    entries = json.loads(CHANGELOG_PATH.read_text())
    total = len(entries)
    print(f'Found {total:,} entries')

    if args.dry_run:
        from collections import Counter
        sources = Counter(e.get('source', 'unknown') for e in entries)
        print('\nBy source:')
        for src, cnt in sources.most_common():
            print(f'  {src}: {cnt:,}')
        return

    entries = entries[args.start:]
    print(f'Pushing {len(entries):,} rows in batches of {args.batch}...')

    succeeded = 0
    failed = 0
    for i in range(0, len(entries), args.batch):
        batch = entries[i:i + args.batch]
        status, err = upload_batch(url, key, batch)
        if 200 <= status < 300:
            succeeded += len(batch)
            if (i // args.batch) % 10 == 0:
                print(f'  [{i + len(batch):,}/{len(entries):,}] {succeeded:,} rows OK')
        else:
            failed += len(batch)
            print(f'  [{i + len(batch):,}] BATCH FAILED ({status}): {err}')
            if failed > args.batch * 3:
                print('Too many failures — stopping. Fix and resume with --start')
                break

    print(f'\nDone: {succeeded:,} succeeded, {failed:,} failed')


if __name__ == '__main__':
    main()
