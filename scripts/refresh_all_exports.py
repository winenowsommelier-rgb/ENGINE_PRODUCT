"""Run both public and B2B export regenerations in sequence.

After any bulk DB write, run this instead of refresh_live_export.py alone.
Rule 9: the explore UI reads live_products_export.json; the B2B catalog
reads b2b_products_export.json. Both must be refreshed together.

DB resolution: if the worktree's products.db is a 0-byte git placeholder,
both scripts resolve the real DB from the main checkout automatically.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import refresh_b2b_export  # noqa: E402 — inserted path must come first


def _resolve_db(path: Path) -> Path:
    """Resolve the real DB — handles 0-byte git-worktree placeholders."""
    if path.exists() and path.stat().st_size > 0:
        return path
    result = subprocess.run(
        ["git", "rev-parse", "--git-common-dir"],
        capture_output=True, text=True, cwd=path.parent,
    )
    if result.returncode == 0:
        main_db = Path(result.stdout.strip()).parent / "data" / "db" / "products.db"
        if main_db.exists() and main_db.stat().st_size > 0:
            print(f"INFO: worktree DB is empty; using main checkout DB: {main_db}")
            return main_db
    return path


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    db = _resolve_db(repo / "data" / "db" / "products.db")

    print("=== Refreshing public export ===")
    import refresh_live_export  # noqa: E402
    rc = refresh_live_export.main(argv=["--db", str(db)])
    if rc != 0:
        return rc

    print("=== Refreshing B2B export ===")
    return refresh_b2b_export.main(argv=["--db", str(db)])


if __name__ == "__main__":
    raise SystemExit(main())
