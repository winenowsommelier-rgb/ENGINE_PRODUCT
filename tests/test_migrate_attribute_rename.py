import sqlite3, tempfile, os
from scripts.migrate_attribute_rename import migrate
from data.lib.taxonomy.attribute_map import ATTRIBUTE_MAP, NEW_COLUMNS, DROPPED_COLUMNS

def _make_db(path, dead_value=None):
    c = sqlite3.connect(path)
    cols = ", ".join(f"{old} TEXT" for old in ATTRIBUTE_MAP) + ", wine_type TEXT, other_type TEXT, sku TEXT"
    c.execute(f"CREATE TABLE products ({cols})")
    c.execute("INSERT INTO products (sku, grape_variety, wine_body) VALUES ('X','Chardonnay','Full')")
    if dead_value is not None:
        c.execute("UPDATE products SET wine_type=? WHERE sku='X'", (dead_value,))
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

def test_drops_empty_dead_columns():
    # wine_type/other_type are empty here → guarded drop SHOULD remove them.
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p)  # dead columns left empty
    migrate(p)
    cols = {r[1] for r in sqlite3.connect(p).execute("PRAGMA table_info(products)")}
    for dead in DROPPED_COLUMNS:
        assert dead not in cols, f"{dead} should be dropped when empty"

def test_keeps_dead_column_when_it_holds_data():
    # Guard: a non-empty dead column must NOT be dropped (no data destruction).
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p, dead_value="Red Wine")  # wine_type populated
    migrate(p)
    cols = {r[1] for r in sqlite3.connect(p).execute("PRAGMA table_info(products)")}
    assert "wine_type" in cols, "non-empty wine_type must be preserved"

def test_idempotent():
    d = tempfile.mkdtemp(); p = os.path.join(d, "t.db")
    _make_db(p); migrate(p); migrate(p)  # second run must not raise
