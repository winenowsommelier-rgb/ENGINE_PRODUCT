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
    """Run the driver on the fixture, return parsed product-images.json."""
    output = tmp_path / "product-images.json"
    args = [
        sys.executable, str(DRIVER),
        "--master", str(FIXTURE_CSV),
        "--output", str(output),
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
        assert data["_meta"]["row_count"] == 6
        assert data["_meta"]["missing_count"] == 1
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
        assert rec["images"]["image"]["url"].endswith("wdw0001aa.jpg")

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
