"""Production-data invariants for critic-sourced flavor attributes.

Guards the 2026-07-27 promotion of 414 SKUs from AI-generated flavor_tags to
tier 'critic', extracted verbatim from vintage-matched critic tasting notes in
critic_scores.notes (scripts/extract_flavor_from_critic_notes.py).

The load-bearing claims, each asserted below:
  * a 'critic' row is never empty and never loses its attribution
  * a 'critic' row's vintage is MATCHED — the note describes the same vintage the
    catalog sells, otherwise it describes a different wine
  * every emitted token survives canonicalization (a token the vocabulary drops is
    invisible on the product page, so promoting it would be a silent downgrade)
  * the two known false-positive classes stay fixed: 'bitter chocolate' must yield
    Cocoa rather than the Bitter axis, and 'pine' in a wine note must NOT emit the
    beer note 'Piney Hops'

Rule 6: read-only against the live DB and the live export. DO NOT skip without an
equivalent replacement.
"""
from __future__ import annotations

import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
DB = REPO / "data" / "db" / "products.db"
EXPORT = REPO / "data" / "live_products_export.json"

_spec = importlib.util.spec_from_file_location(
    "extract_flavor_from_critic_notes",
    REPO / "scripts" / "extract_flavor_from_critic_notes.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

MIN_CRITIC_ROWS = 414


def _real(p: Path) -> bool:
    return p.exists() and p.stat().st_size > 0


@pytest.fixture(scope="module")
def conn():
    if not _real(DB):
        pytest.skip(f"live db not present: {DB}")
    c = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    yield c
    c.close()


@pytest.fixture(scope="module")
def extractor():
    return _mod.Extractor(_mod.load_vocab())


def test_critic_rows_present(conn):
    n = conn.execute(
        "SELECT COUNT(*) FROM products WHERE attr_evidence_tier='critic'").fetchone()[0]
    assert n >= MIN_CRITIC_ROWS, (
        f"only {n} critic-tier rows, expected >= {MIN_CRITIC_ROWS} — a later write "
        f"may have downgraded sourced attributes back to AI data")


def test_critic_rows_are_complete(conn):
    """No critic row may lack tags, attribution, or a verification timestamp."""
    bad = conn.execute("""
        SELECT sku FROM products
         WHERE attr_evidence_tier='critic'
           AND (COALESCE(flavor_tags,'') IN ('','[]')
                OR COALESCE(attr_sources,'') = ''
                OR COALESCE(attr_verified_at,'') = '')
         LIMIT 5""").fetchall()
    assert not bad, f"incomplete critic rows: {[r['sku'] for r in bad]}"


def test_critic_rows_have_a_matched_vintage(conn):
    """A critic note for another vintage describes a different wine."""
    missing = conn.execute(
        "SELECT COUNT(*) FROM products WHERE attr_evidence_tier='critic' "
        "AND vintage_year IS NULL").fetchone()[0]
    assert missing == 0, (
        f"{missing} critic rows have no parsed vintage_year — vintage matching "
        f"cannot have been enforced for them")

    drift = []
    for r in conn.execute("""
            SELECT p.sku, p.vintage_year, cs.vintage AS cv
              FROM products p JOIN critic_scores cs ON cs.sku = p.sku
             WHERE p.attr_evidence_tier='critic' AND COALESCE(cs.notes,'') <> ''"""):
        cy = _mod.year_of(r["cv"])
        # At least one critic row for this SKU must match the sold vintage.
        drift.append((r["sku"], cy == r["vintage_year"]))
    by_sku: dict[str, bool] = {}
    for sku, ok in drift:
        by_sku[sku] = by_sku.get(sku, False) or ok
    unmatched = [s for s, ok in by_sku.items() if not ok]
    assert not unmatched, (
        f"{len(unmatched)} critic-tier SKUs have no vintage-matched critic note, "
        f"e.g. {unmatched[:5]}")


def test_every_critic_token_survives_canonicalization(conn, extractor):
    """A token the taste vocabulary drops is invisible in the UI."""
    from data.lib.enrichment.shared.flavor_canonicalizer import canonicalize_tag
    vocab = extractor.vocab
    dead = []
    for r in conn.execute(
            "SELECT sku, flavor_tags FROM products WHERE attr_evidence_tier='critic'"):
        try:
            tags = json.loads(r["flavor_tags"] or "[]")
        except (ValueError, TypeError):
            dead.append((r["sku"], "invalid JSON"))
            continue
        for t in tags:
            if not canonicalize_tag(t, vocab):
                dead.append((r["sku"], t))
    assert not dead, f"critic tokens that canonicalize to nothing: {dead[:8]}"


def test_bitter_chocolate_yields_cocoa_not_bitter(extractor):
    """Regression: the bare 'bitter' alias fired inside 'bitter chocolate'."""
    got = extractor.canonical_notes(
        "Aromas of fresh blackberries, dried leaves, bitter chocolate and walnuts.")
    assert "Cocoa" in got, got
    assert "Bitter" not in got, f"'bitter chocolate' must not emit the Bitter axis: {got}"


def test_standalone_bitter_still_extracts(extractor):
    """The guard must not suppress a genuine bitterness claim."""
    assert "Bitter" in extractor.canonical_notes("Firm, bitter finish with grip.")


def test_pine_does_not_emit_a_beer_note(extractor):
    """Regression: 'pine' is a Piney Hops alias and fired on wine notes."""
    got = extractor.canonical_notes("Notes of pine and cedar on the nose.")
    assert "Piney Hops" not in got, f"'pine' in a wine note must not emit Piney Hops: {got}"


def test_explicit_hops_still_maps(extractor):
    assert "Piney Hops" in extractor.canonical_notes("Resinous hops and citrus.")


def test_critic_rows_reach_the_export():
    """Rule 9: the UI reads the export, not the DB."""
    if not _real(EXPORT):
        pytest.skip("export not present")
    data = json.loads(EXPORT.read_text(encoding="utf-8"))
    rows = data["products"] if isinstance(data, dict) and "products" in data else data
    critic = [p for p in rows if p.get("attr_evidence_tier") == "critic"]
    assert len(critic) >= MIN_CRITIC_ROWS, (
        f"only {len(critic)} critic rows in the export — run "
        f"scripts/refresh_live_export.py")
    blank = [p["sku"] for p in critic if not p.get("flavor_tags_canonical")]
    assert not blank, f"critic rows with an empty canonical note list: {blank[:5]}"
    unattributed = [p["sku"] for p in critic if not p.get("attr_sources")]
    assert not unattributed, (
        f"critic rows missing attribution in the export (check EXPORT_COLS): "
        f"{unattributed[:5]}")
