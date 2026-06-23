"""NULL-only merge of Phase B variety/body from a JSONL sidecar into products.db.

Rule 5: NEVER overwrites an existing value — UPDATE ... WHERE col IS NULL OR col=''.
Rule 10: backs up the canonical DB before writing.
Do NOT reuse backfill_from_cache.py's write loop — it is an unconditional clobbering UPDATE.
"""
from __future__ import annotations
import argparse, json, shutil, sqlite3, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "data" / "db" / "products.db"
FIELDS = ("variety", "body")

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--sidecar", type=Path, required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--ts", default="manual")
    a = ap.parse_args(argv)

    rows = [json.loads(l) for l in a.sidecar.read_text().splitlines() if l.strip()]
    if a.apply:
        bak = a.db.with_name(f"{a.db.name}.bak-pre-phaseB-{a.ts}")
        shutil.copy2(a.db, bak); print(f"backup → {bak}")

    conn = sqlite3.connect(a.db)
    filled = {f: 0 for f in FIELDS}
    for r in rows:
        sku = r.get("sku")
        for f in FIELDS:
            val = r.get(f)
            if not val:
                continue
            if a.apply:
                cur = conn.execute(
                    f"UPDATE products SET {f}=? WHERE sku=? AND ({f} IS NULL OR {f}='')",
                    (val, sku))
                filled[f] += cur.rowcount
            else:
                cur = conn.execute(
                    f"SELECT 1 FROM products WHERE sku=? AND ({f} IS NULL OR {f}='')", (sku,))
                if cur.fetchone():
                    filled[f] += 1
    if a.apply:
        conn.commit()
    print(f"{'APPLIED' if a.apply else 'dry-run'} — would fill: " +
          ", ".join(f"{f}={filled[f]}" for f in FIELDS))
    conn.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
