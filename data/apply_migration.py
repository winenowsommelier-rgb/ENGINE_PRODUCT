#!/usr/bin/env python3
"""Apply a SQL migration file to Supabase via the direct postgres connection.

Usage:
    .venv/bin/python3 data/apply_migration.py data/migrations/<file>.sql
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg2  # type: ignore

REPO = Path(__file__).resolve().parent.parent
ENV = REPO / ".env.local"


def load_env(p: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <migration-file.sql>", file=sys.stderr)
        return 2
    sql_path = Path(sys.argv[1]).resolve()
    if not sql_path.exists():
        print(f"ERROR: {sql_path} not found", file=sys.stderr)
        return 1

    env = load_env(ENV)
    db_url = env.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: SUPABASE_DB_URL missing from .env.local", file=sys.stderr)
        return 1

    sql = sql_path.read_text()
    print(f"Applying {sql_path.name} ({len(sql)} bytes) to Supabase...")
    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
