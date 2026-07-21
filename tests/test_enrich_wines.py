"""Integration test for data/enrich_wines.py using the 5-SKU fixture."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DRIVER = REPO_ROOT / "data" / "enrich_wines.py"


def test_dry_run_succeeds_with_fixture():
    """--dry-run mode + --skus-file pointing at the fixture: no API call needed."""
    result = subprocess.run(
        [
            sys.executable, str(DRIVER),
            "--dry-run",
            "--skus-file", str(REPO_ROOT / "tests" / "fixtures" / "wine_pilot_skus.json"),
            "--winesensed-file", str(REPO_ROOT / "tests" / "fixtures" / "winesensed_sample.json"),
            "--brand-library-file", str(REPO_ROOT / "tests" / "fixtures" / "brand_library_sample.csv"),
            "--no-supabase",
            "--limit", "5",
        ],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    # Driver should print per-SKU dry-run lines + summary
    assert "FX-BORDEAUX-001" in result.stdout
    assert "would call Haiku" in result.stdout or "Cache hits" in result.stdout


def test_cli_writes_to_local_sqlite(tmp_path, monkeypatch):
    """CLI with --db should write enriched fields to SQLite, not Supabase."""
    import sqlite3, json, sys
    from pathlib import Path

    REPO_ROOT = Path(__file__).resolve().parent.parent
    SCHEMA_SQL = REPO_ROOT / "data" / "migrations" / "2026-05-21_local_sqlite_schema.sql"

    # Seed a tiny DB with one wine
    db_path = tmp_path / "t.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL.read_text())
    conn.execute(
        "INSERT INTO products (id, sku, name, classification, brand) VALUES (?,?,?,?,?)",
        ("row-test", "WRW_TEST", "Test Wine", "Red Wine", "TestBrand"),
    )
    conn.commit()
    conn.close()

    fixtures = REPO_ROOT / "tests" / "fixtures"
    skus_file = tmp_path / "skus.json"
    skus_file.write_text(json.dumps([{
        "id": "row-test", "sku": "WRW_TEST", "name": "Test Wine",
        "classification": "Red Wine", "brand": "TestBrand",
        "country": "France", "region": "Bordeaux",
    }]))

    # Mock Anthropic call
    from data.enrich_wines import main
    monkeypatch.setattr("data.lib.enrichment.shared.client.AnthropicClient.generate",
                        lambda self, system, user, max_tokens=1000, temperature=0.1: _stub_high_conf_response())

    rc = main([
        "--skus-file", str(skus_file),
        "--db", str(db_path),
        "--limit", "1",
        "--no-supabase",
        "--write-threshold", "0.7",
        "--csv-output", str(tmp_path / "out.csv"),
    ])
    assert rc == 0

    conn = sqlite3.connect(db_path)
    body = conn.execute("SELECT wine_body FROM products WHERE id='row-test'").fetchone()[0]
    assert body is not None and body != ""
    n = conn.execute("SELECT COUNT(*) FROM enrichment_cache WHERE sku='WRW_TEST'").fetchone()[0]
    assert n == 1


def test_select_skus_falls_back_to_taxonomy_when_classification_is_junk():
    """RULE 12 regression guard: raw classification='Wine product' (masterfile junk
    bucket) or accent-mismatched 'Rose Wine' must not silently drop an in-scope
    SKU from enrichment. SKU-taxonomy type_for() is the fallback source of truth.
    Found 2026-07-18: 4/5 of a canary sample were invisible to select_skus because
    of this exact gap (products.json 8 days stale + classification junk compounded)."""
    from data.enrich_wines import select_skus

    products = [
        # Accent mismatch: classification says "Rose Wine" (no accent), schema
        # key is "Rosé Wine" — taxonomy type_for() resolves the accented form.
        {"sku": "WRS0075AC", "classification": "Rose Wine", "brand": "B", "popularity_score": 0},
        # Junk bucket, but SKU prefix taxonomy-resolves to an in-scope spirit.
        {"sku": "LTQ0134AD", "classification": "Wine product", "brand": "B", "popularity_score": 0},
        # Junk bucket AND taxonomy says non-beverage — correctly stays excluded.
        {"sku": "NNA0161AA", "classification": "Wine product", "brand": "B", "popularity_score": 0},
    ]
    selected_skus = {p["sku"] for p in select_skus(products, "popularity", None, 50,
                                                     sku_filter=None, only_needs=False)}
    assert "WRS0075AC" in selected_skus
    assert "LTQ0134AD" in selected_skus
    assert "NNA0161AA" not in selected_skus


def _stub_high_conf_response():
    """Helper — returns a GenerationResult with canonical vocab values that pass validation."""
    import json
    from data.lib.enrichment.shared.client import GenerationResult
    payload = {
        "wine_body": "Full", "wine_acidity": "Medium", "wine_tannin": "Medium-High",
        "grape_variety": ["Cabernet Sauvignon"], "grape_blend_type": "Single Varietal",
        "wine_production_style": [], "flavor_tags": ["dark fruit", "cedar", "tobacco", "spice", "vanilla"],
        "food_matching": ["Grilled red meat", "Aged hard cheese", "Game meats"],
        "desc_en_short": "A bold Bordeaux Cab.",
        "full_description": "<p>" + ("X" * 300) + "</p>",
        "confidence": 0.95, "confidence_notes": "rich evidence",
        "citations": {"winesensed_record_ids": [], "brand_library_match": None,
                      "grape_source": "products.grape_variety", "critic_scores": []},
    }
    return GenerationResult(
        text=json.dumps(payload), model="claude-haiku-4-5",
        tokens_in=500, tokens_out=400, cost_usd=0.005, cost_thb=0.175,
    )
