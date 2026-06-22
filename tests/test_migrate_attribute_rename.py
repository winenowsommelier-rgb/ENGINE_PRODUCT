import sqlite3, tempfile, os
from scripts.migrate_attribute_rename import migrate
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS

def _make_db(path):
    c = sqlite3.connect(path)
    cols = ", ".join(f"{old} TEXT" for old in ATTRIBUTE_MAP) + ", wine_type TEXT, other_type TEXT, sku TEXT"
    c.execute(f"CREATE TABLE products ({cols})")
    c.execute("INSERT INTO products (sku, grape_variety, wine_body) VALUES ('X','Chardonnay','Full')")
    c.commit(); c.close()

def test_rename_preserves_data_and_adds_columns():
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p)
    migrate(p)
    c = sqlite3.connect(p); c.row_factory = sqlite3.Row
    cols = {r[1] for r in c.execute("PRAGMA table_info(products)")}
    for new in ATTRIBUTE_MAP.values():
        assert new in cols, f"{new} missing after rename"
    for old in ATTRIBUTE_MAP:
        assert old not in cols, f"{old} should be gone"
    for nc in NEW_COLUMNS:
        assert nc in cols, f"{nc} not added"
    row = c.execute("SELECT variety, body FROM products WHERE sku='X'").fetchone()
    assert row["variety"] == "Chardonnay" and row["body"] == "Full"
    c.close()

def test_idempotent():
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p); migrate(p); migrate(p)  # second run must not raise
