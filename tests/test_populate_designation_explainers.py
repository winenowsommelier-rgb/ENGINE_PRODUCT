import json
import sqlite3
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATE = REPO_ROOT / "scripts" / "migrate_dossier_schema.py"
SEED = REPO_ROOT / "scripts" / "seed_designation_reference_stub.py"
POPULATE = REPO_ROOT / "scripts" / "populate_designation_explainers.py"
CONTENT = REPO_ROOT / "data" / "dossier_content" / "designation_explainers.json"


def _make_seeded_db(tmp_path):
    db_path = tmp_path / "dossier.db"
    subprocess.run([sys.executable, str(MIGRATE), "--db", str(db_path)], check=True, capture_output=True, text=True)
    subprocess.run([sys.executable, str(SEED), "--db", str(db_path)], check=True, capture_output=True, text=True)
    return db_path


def test_populate_fills_every_row_with_explainer_and_sources(tmp_path):
    db_path = _make_seeded_db(tmp_path)
    subprocess.run(
        [sys.executable, str(POPULATE), "--db", str(db_path), "--content", str(CONTENT)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT designation, region, kind, explainer, sources_json FROM designation_reference").fetchall()
    assert len(rows) > 0
    for designation, region, kind, explainer, sources_json in rows:
        assert explainer, f"{designation}/{region} has no explainer"
        assert sources_json, f"{designation}/{region} has no sources_json"
        assert json.loads(sources_json)  # valid JSON, non-empty list
        assert kind in ("quality-rank", "dosage", "aging-class", "production-style", None)


def test_grand_cru_splits_into_three_regions_not_all(tmp_path):
    # Regression guard for the merge-hazard the spec calls out by name:
    # Grand Cru means a different thing in Burgundy/Alsace/Champagne, so the
    # generic 'ALL' stub row must be replaced, not left alongside the splits.
    db_path = _make_seeded_db(tmp_path)
    subprocess.run(
        [sys.executable, str(POPULATE), "--db", str(db_path), "--content", str(CONTENT)],
        check=True, capture_output=True, text=True,
    )
    conn = sqlite3.connect(db_path)
    regions = {
        r[0] for r in conn.execute(
            "SELECT region FROM designation_reference WHERE designation = 'Grand Cru'"
        ).fetchall()
    }
    assert regions == {"Burgundy", "Alsace", "Champagne"}


def test_populate_is_idempotent(tmp_path):
    db_path = _make_seeded_db(tmp_path)
    for _ in range(2):
        subprocess.run(
            [sys.executable, str(POPULATE), "--db", str(db_path), "--content", str(CONTENT)],
            check=True, capture_output=True, text=True,
        )
    conn = sqlite3.connect(db_path)
    n = conn.execute("SELECT COUNT(*) FROM designation_reference").fetchone()[0]
    assert n == 29  # 27 seeded - 1 Grand Cru/ALL stub + 3 Grand Cru regional rows


def test_no_price_or_banned_phrase_language_in_explainers():
    # Rule/spec §5.4: no price/investment language in any generated text.
    # Uses the real pipeline validators (data/lib/dossier/validators.py),
    # not an ad-hoc substring list -- those already correctly distinguish
    # commercial/investment framing from neutral historical fact (e.g. the
    # First Growth explainer's "trading price" refers to 1855 market
    # history, not our inventory, and must NOT trip this check).
    import sys
    sys.path.insert(0, str(REPO_ROOT))
    from data.lib.dossier.validators import contains_price_language, contains_banned_phrase

    entries = json.loads(CONTENT.read_text())
    for e in entries:
        text = e["explainer"]
        assert not contains_price_language(text), \
            f"{e['designation']}/{e['region']} explainer trips price-language validator"
        assert not contains_banned_phrase(text), \
            f"{e['designation']}/{e['region']} explainer trips banned-phrase validator"
