import sqlite3, json, uuid
from lib.critic_reviews.refresh_products_summary import refresh_all

SCHEMA = """
CREATE TABLE products (sku TEXT PRIMARY KEY, score_max REAL, score_summary TEXT);
CREATE TABLE critic_scores (
  id TEXT PRIMARY KEY, sku TEXT, critic TEXT NOT NULL, score REAL NOT NULL,
  score_max REAL DEFAULT 100, vintage TEXT, tasting_year INTEGER, source_url TEXT,
  notes TEXT, added_by TEXT, added_at TEXT, source TEXT, score_native TEXT,
  score_scale TEXT, signal_class TEXT, signal_tier INTEGER, supporting_text TEXT,
  confidence REAL, producer TEXT, cuvee TEXT, fetched_at TEXT
);
"""

def _conn():
    c = sqlite3.connect(":memory:")
    c.executescript(SCHEMA)
    return c

def _ins(c, **kw):
    kw.setdefault("id", str(uuid.uuid4()))
    cols = ",".join(kw); ph = ",".join("?" for _ in kw)
    c.execute(f"INSERT INTO critic_scores ({cols}) VALUES ({ph})", tuple(kw.values()))

def test_refresh_writes_score_max_and_summary():
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku="SKU1", critic="James Suckling", score=91.0, source="magento_csv",
         added_by="magento_csv_2026-06-15", score_native="91", score_scale="100pt",
         signal_tier=1, confidence=1.0, fetched_at="2026-01-01T00:00:00Z")
    n = refresh_all(c)
    row = c.execute("SELECT score_max, score_summary FROM products WHERE sku='SKU1'").fetchone()
    assert row[0] == 91.0
    data = json.loads(row[1])
    assert data["critics"][0]["abbr"] == "JS"
    assert data["primary_source"] == "magento_csv_2026-06-15"
    assert n == 1

def test_curated_beats_scraped_endtoend():
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku="SKU1", critic="Wine Spectator", score=90.0, source="magento_csv",
         added_by="magento_csv_2026-06-15", score_native="90", score_scale="100pt",
         signal_tier=1, confidence=1.0, fetched_at="2026-01-01T00:00:00Z")
    _ins(c, sku="SKU1", critic="Wine Spectator", score=93.0, source="wine_enthusiast",
         score_native="93", score_scale="100pt", signal_tier=2, confidence=0.6,
         fetched_at="2026-06-01T00:00:00Z")
    refresh_all(c)
    summ = json.loads(c.execute("SELECT score_summary FROM products WHERE sku='SKU1'").fetchone()[0])
    ws = [x for x in summ["critics"] if x["critic"] == "Wine Spectator"]
    assert len(ws) == 1 and ws[0]["score_value"] == 90.0  # curated kept, scraped dropped

def test_self_healing_clears_orphaned_summary():
    c = _conn()
    c.execute("INSERT INTO products(sku, score_max, score_summary) VALUES ('STALE', 88.0, '{\"x\":1}')")
    refresh_all(c)
    row = c.execute("SELECT score_max, score_summary FROM products WHERE sku='STALE'").fetchone()
    assert row == (None, None)

def test_nullable_sku_rows_ignored_for_product_update():
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('SKU1')")
    _ins(c, sku=None, critic="Distiller", score=92.0, source="distiller",
         score_native="92", score_scale="100pt", signal_tier=2, confidence=0.6,
         fetched_at="2026-06-01T00:00:00Z")
    n = refresh_all(c)  # must not raise; SKU1 has no rows -> NULL
    assert c.execute("SELECT score_summary FROM products WHERE sku='SKU1'").fetchone()[0] is None

def test_orphan_critic_sku_not_counted():
    # a critic_scores row whose sku has no products row must not inflate the count
    c = _conn()
    c.execute("INSERT INTO products(sku) VALUES ('REAL1')")
    _ins(c, sku="REAL1", critic="James Suckling", score=91.0, source="magento_csv",
         added_by="magento_csv_2026-06-15", score_native="91", score_scale="100pt",
         signal_tier=1, confidence=1.0, fetched_at="2026-01-01T00:00:00Z")
    _ins(c, sku="ORPHAN9", critic="Wine Spectator", score=90.0, source="magento_csv",
         added_by="magento_csv_2026-06-15", score_native="90", score_scale="100pt",
         signal_tier=1, confidence=1.0, fetched_at="2026-01-01T00:00:00Z")
    n = refresh_all(c)
    assert n == 1  # only REAL1 shipped; ORPHAN9 has no product row
