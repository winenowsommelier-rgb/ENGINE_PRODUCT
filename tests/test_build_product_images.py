"""Integration tests for data/build_product_images.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_CSV = REPO_ROOT / "tests" / "fixtures" / "masterfile_sample.csv"
DRIVER = REPO_ROOT / "data" / "build_product_images.py"


def run_driver(tmp_path: Path, extra_args: list[str] = None) -> dict:
    output = tmp_path / "product-images.json"
    summary = tmp_path / "product-images-summary.json"
    args = [
        sys.executable, str(DRIVER),
        "--master", str(FIXTURE_CSV),
        "--output", str(output),
        "--summary", str(summary),
        "--no-mirror",
        "--no-commit",
    ]
    if extra_args:
        args.extend(extra_args)
    result = subprocess.run(args, capture_output=True, text=True, cwd=REPO_ROOT)
    assert result.returncode == 0, f"stderr:\n{result.stderr}"
    return json.loads(output.read_text())


class TestTransform:
    def test_record_count_and_meta(self, tmp_path):
        data = run_driver(tmp_path)
        # 8 raw fixture rows; WDW0001AA is duplicated -> 7 unique SKUs written
        # (last-row-wins for collisions — duplicate also tracked in warnings.sku_collisions)
        assert data["_meta"]["row_count"] == 7
        assert data["_meta"]["missing_count"] == 1  # DELIVERY1 has no image
        # CIG has only thumbnail; NNA has only image; DELIVERY1 empty -> 2 partial-filled
        assert data["_meta"]["partial_filled_count"] == 2

    def test_wine_record(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["WDW0001AA"]
        assert rec["website"] == "wine-now"
        assert rec["name_seo"] == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"
        assert rec["name_slug"] == "batasiolo-moscato-spumante-dolce-nv-750ml"
        assert rec["image_filename_base"].endswith("-wdw0001aa")
        assert rec["vintage"] == "NV"
        assert rec["bottle_size"] == "750ml"
        assert rec["image_status"] == "legacy"
        # Duplicate row (WDW0001AA appears twice); last-row-wins -> _dup.jpg
        assert rec["images"]["image"]["url"].endswith("wdw0001aa_dup.jpg")

    def test_liq9_record(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["LWH0001AA"]
        assert rec["website"] == "liq9"
        assert rec["name_seo"] == "Glenfiddich 12 Years Old 700ml | Liq9"
        assert rec["vintage"] is None

    def test_system_record_no_suffix(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["DELIVERY1"]
        assert rec["website"] is None
        assert "|" not in rec["name_seo"]
        assert rec["images"] is None
        assert rec["image_status"] == "missing"

    def test_unknown_prefix_logged(self, tmp_path):
        data = run_driver(tmp_path)
        assert "ZZZ" in data["_meta"]["unknown_prefixes"]
        rec = data["records"]["ZZZ0001AA"]
        assert rec["website"] is None

    def test_partial_fill_uses_best_available(self, tmp_path):
        data = run_driver(tmp_path)
        rec = data["records"]["CIG0149BT"]
        assert rec["image_status"] == "legacy"
        url = rec["images"]["image"]["url"]
        assert url.endswith("cig0149bt.jpg")
        assert rec["images"]["thumbnail"]["url"] == url
        assert rec["images"]["image_hd"]["url"] == url


class TestBrandPrefixStripping:
    def test_brand_not_duplicated_in_seo_title(self, tmp_path):
        # Fixture row: brand=Batasiolo, name='Batasiolo  Moscato Spumante Dolce'
        # Expectation: SEO title contains brand exactly once.
        data = run_driver(tmp_path)
        seo = data["records"]["WDW0001AA"]["name_seo"]
        # Count case-insensitive occurrences of 'Batasiolo' in the title — should be exactly 1
        assert seo.lower().count("batasiolo") == 1
        assert seo == "Batasiolo Moscato Spumante Dolce NV 750ml | Wine-Now"

    def test_brand_preserved_in_slug(self, tmp_path):
        data = run_driver(tmp_path)
        slug = data["records"]["WDW0001AA"]["name_slug"]
        # Slug should start with the brand, not skip it
        assert slug.startswith("batasiolo-")
        assert slug == "batasiolo-moscato-spumante-dolce-nv-750ml"


class TestValidation:
    def test_sku_collision_recorded(self, tmp_path):
        data = run_driver(tmp_path)
        summary_path = tmp_path / "product-images-summary.json"
        summary = json.loads(summary_path.read_text())
        sku_coll = summary.get("warnings", {}).get("sku_collisions", [])
        assert any(c["sku"] == "WDW0001AA" for c in sku_coll)

    def test_slug_collision_recorded(self, tmp_path):
        data = run_driver(tmp_path)
        summary_path = tmp_path / "product-images-summary.json"
        summary = json.loads(summary_path.read_text())
        slug_coll = summary.get("warnings", {}).get("slug_collisions", [])
        # WDW0001AA + WDW0099AA share the slug
        hits = [c for c in slug_coll
                if c["slug"] == "batasiolo-moscato-spumante-dolce-nv-750ml"]
        assert hits and set(hits[0]["skus"]) == {"WDW0001AA", "WDW0099AA"}

    def test_summary_has_meta_counters(self, tmp_path):
        run_driver(tmp_path)
        summary = json.loads((tmp_path / "product-images-summary.json").read_text())
        assert "row_count" in summary
        assert "missing_count" in summary
        assert "by_website" in summary

    def test_duplicate_sku_last_row_wins(self, tmp_path):
        data = run_driver(tmp_path)
        url = data["records"]["WDW0001AA"]["images"]["image"]["url"]
        assert url.endswith("wdw0001aa_dup.jpg")
