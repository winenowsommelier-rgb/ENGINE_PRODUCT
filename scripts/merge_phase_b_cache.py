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

    raw = []
    for i, l in enumerate(a.sidecar.read_text().splitlines(), start=1):
        if not l.strip():
            continue
        try:
            raw.append(json.loads(l))
        except json.JSONDecodeError as err:
            raise ValueError(f"sidecar line {i}: {err}") from err

    # FIX A: dedupe by sku, keeping the LAST occurrence per sku, so each sku is
    # processed exactly once. DB sku is unique, so apply-rowcount (=1) and the
    # dry-run eligible-sku count agree. Also count rows with no sku (key mismatch
    # visibility, Rule 2).
    skipped_no_sku = 0
    by_sku = {}
    for r in raw:
        sku = r.get("sku")
        if not sku:
            skipped_no_sku += 1
            continue
        by_sku[sku] = r          # last occurrence wins
    rows = list(by_sku.values())

    if a.apply:
        bak = a.db.with_name(f"{a.db.name}.bak-pre-phaseB-{a.ts}")
        shutil.copy2(a.db, bak); print(f"backup → {bak}")

    conn = sqlite3.connect(a.db)

    def populated(field):
        return conn.execute(
            f"SELECT COUNT(*) FROM products WHERE {field} IS NOT NULL AND {field}!=''"
        ).fetchone()[0]

    before = {f: populated(f) for f in FIELDS}  # FIX B: real SELECT before write

    filled = {f: 0 for f in FIELDS}
    matched_zero = 0
    for r in rows:
        sku = r.get("sku")
        sku_hit = False
        for f in FIELDS:
            val = r.get(f)
            if not val:
                continue
            if a.apply:
                cur = conn.execute(
                    f"UPDATE products SET {f}=? WHERE sku=? AND ({f} IS NULL OR {f}='')",
                    (val, sku))
                if cur.rowcount:
                    filled[f] += cur.rowcount
                    sku_hit = True
            else:
                cur = conn.execute(
                    f"SELECT 1 FROM products WHERE sku=? AND ({f} IS NULL OR {f}='')", (sku,))
                if cur.fetchone():
                    filled[f] += 1
                    sku_hit = True
        # a sidecar sku that matched 0 DB rows for any field signals a key mismatch
        present = conn.execute(
            "SELECT 1 FROM products WHERE sku=?", (sku,)).fetchone()
        if not present:
            matched_zero += 1

    if a.apply:
        conn.commit()

    print(f"{'APPLIED' if a.apply else 'dry-run'} — would fill: " +
          ", ".join(f"{f}={filled[f]}" for f in FIELDS))
    print(f"skipped (no sku)={skipped_no_sku}; sidecar SKUs matched 0 DB rows={matched_zero}")

    # FIX B: post-write verification (Rule 1) — real SELECT against the committed DB.
    after = {f: populated(f) for f in FIELDS}
    print(f"verify: variety populated {before['variety']} -> {after['variety']}; "
          f"body {before['body']} -> {after['body']}")

    conn.close()

    # FIX C: Rule-9 reminder — DB write alone does NOT reach the UI.
    if a.apply:
        print("NEXT: run scripts/refresh_live_export.py then verify variety/body in "
              "live_products_export.json (Rule 9) — DB write alone does NOT reach the UI.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
