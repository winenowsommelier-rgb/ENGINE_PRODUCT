"""Regenerate data/b2b_products_export.json from data/db/products.db.

B2B wholesale catalog — wholesale price ONLY. Never exports retail price,
discount %, cost, or any margin field. Filtered to products with b2b_price.

Worktree note: products.db is a 0-byte placeholder in git. The script
auto-detects this and falls back to the main checkout's DB (resolved via
git common-dir) so the worktree build works without manual DB copying.
"""
import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# SKU taxonomy: derive category_group / category_type from SKU prefix.
try:
    from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_category
    _CATEGORY_AVAILABLE = True
except Exception:  # noqa: BLE001
    _CATEGORY_AVAILABLE = False

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "b2b_products_export.json"

# Minimal explicit allowlist — NOT a copy of EXPORT_COLS (which carries margin/cost).
# Uses score_summary/score_max (NOT critic_score — that column does not exist).
# Includes popularity_score for popularity_tier derivation in the app layer.
# Wholesale price only: no retail price / special_price / discount / margin / cost.
B2B_EXPORT_COLS = [
    "sku", "name", "brand", "variety", "vintage",
    "country", "region", "subregion", "appellation",
    "classification", "designation",
    "body", "acidity", "tannin", "sweetness", "intensity", "smokiness", "finish",
    "flavor_tags", "food_matching", "food_matching_detail",
    "bottle_size", "currency", "image_url",
    "is_in_stock", "wn_stock", "custom_stock_status", "quantity_in_stock",
    "score_summary", "score_max",
    "popularity_score",
    "b2b_price",
]

# Security: these fields MUST NOT appear in the B2B export under any circumstances.
_FORBIDDEN = frozenset([
    "cost", "margin_pct", "b2b_margin_pct", "b2b_margin_thb",
    "price", "special_price", "sp_discount_pct", "b2b_discount_pct",
])


def _resolve_db(path: Path) -> Path:
    """Return a populated DB path.

    If the given path is empty (0-byte git placeholder in a worktree),
    walk up via git common-dir to find the main checkout's DB.
    """
    if path.exists() and path.stat().st_size > 0:
        return path
    # Try to find the main checkout via git
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            capture_output=True, text=True, cwd=path.parent,
        )
        if result.returncode == 0:
            git_common = Path(result.stdout.strip())
            # git-common-dir is the .git dir of the main worktree
            main_root = git_common.parent
            main_db = main_root / "data" / "db" / "products.db"
            if main_db.exists() and main_db.stat().st_size > 0:
                print(f"INFO: worktree DB is empty; using main checkout DB: {main_db}")
                return main_db
    except FileNotFoundError:
        pass
    return path  # return original path and let sqlite3 raise a useful error


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Regenerate data/b2b_products_export.json"
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    db_path = _resolve_db(args.db)

    # [CRITICAL] verify no forbidden field slipped into the allowlist at definition time
    leaked = _FORBIDDEN & set(B2B_EXPORT_COLS)
    assert not leaked, f"BUG: forbidden field(s) in B2B_EXPORT_COLS: {leaked}"

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    existing = {r[1] for r in con.execute("PRAGMA table_info(products)")}

    if not existing:
        print(f"ERROR: products table has no columns in {db_path}", flush=True)
        return 1

    assert "b2b_price" in existing, f"b2b_price missing from products table in {db_path}"

    cols = [c for c in B2B_EXPORT_COLS if c in existing]
    skipped = [c for c in B2B_EXPORT_COLS if c not in existing]
    if skipped:
        print(f"WARN: skipping columns not in products table: {skipped}")

    rows = con.execute(
        f"SELECT {','.join(cols)} FROM products WHERE b2b_price IS NOT NULL"
    ).fetchall()

    records = [{k: r[k] for k in cols if r[k] is not None} for r in rows]

    # Derive category_group / category_type from SKU prefix (same drift-proofing
    # as refresh_live_export.py). These fields are NOT read from the DB column
    # (which may be stale) — always recomputed from SKU at export time.
    if _CATEGORY_AVAILABLE:
        enriched = 0
        for rec in records:
            sku = rec.get("sku", "")
            if sku:
                taxonomy = _resolve_category({"sku": sku})
                grp = taxonomy.get("group", "")
                typ = taxonomy.get("type", "")
                if grp:
                    rec["category_group"] = grp
                    enriched += 1
                if typ:
                    rec["category_type"] = typ
        print(f"  category_group/type enriched: {enriched}/{len(records)} products")
    else:
        print("  WARN: sku_taxonomy unavailable — category_group/type will be absent")

    # [CRITICAL] double-check no forbidden field leaked into output
    for rec in records[:10]:
        leaked_out = _FORBIDDEN & set(rec.keys())
        assert not leaked_out, f"CRITICAL: forbidden field leaked into output: {leaked_out}"

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(records, ensure_ascii=False))

    has_score = sum(1 for r in records if r.get("score_summary"))
    has_category = sum(1 for r in records if r.get("category_group"))
    print(f"Wrote {len(records)} B2B products → {args.out}")
    print(f"  b2b_price sample: {records[0].get('b2b_price') if records else 'N/A'}")
    print(f"  score_summary populated: {has_score}")
    print(f"  category_group populated: {has_category}/{len(records)}")
    print(f"  forbidden fields in output: NONE — clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
