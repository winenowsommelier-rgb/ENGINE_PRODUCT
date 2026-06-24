"""Phase B Run 2 row-selection tests.

These exercise scripts/enrich_phase_b.py's FREE (zero-API) selection + prompt
layer. Selection MUST use the SKU-derived GROUP+TYPE from the real resolve()
(Rule 12), never the magento classification field.

Run-2 semantics (CHANGED from Run 1 — guarded below per Rule 5):
  * NO buying-signal gate. Run 1 required has_recent_sales / sold_orders /
    critic_scores; Run 2 selects every in-stock DRINKABLE row with an applicable
    empty field. The old signal-gate tests asserted Run-1 behavior that is now
    the bug-to-remove, so they are REPLACED with applicability assertions.
  * Wine is now INCLUDED (Run 1 excluded it). test_wine_excluded INVERTED.
  * 5 fields gated by applies(group, type): variety/body/acidity/tannin/sweetness.

Real-ish SKU prefixes used (verified against data/taxonomy/sku_prefix_map.json
via resolve()):  LWH* -> Whisky, LRM* -> Spirits/Rum, LGN* -> Spirits/Gin,
WRW* -> Wine/Red Wine, WWW* -> Wine/White Wine.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from scripts.enrich_phase_b import select_rows, build_prompt, DRINKABLE  # noqa: E402
from data.lib.taste_taxonomy.universal_scales import (  # noqa: E402
    applies,
    variety_vocab_for,
)


def _make_db(tmp_path):
    """Build a tmp products.db with the Run-2 taste columns.

    No signal columns are present (Run 2 has no signal gate); their absence proves
    select_rows no longer reads them. The 5 taste columns ARE present.
    """
    db = tmp_path / "t.db"
    conn = sqlite3.connect(db)
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, acidity TEXT, tannin TEXT, sweetness TEXT)"
    )
    rows = [
        # (sku, name, is_in_stock, variety, body, acidity, tannin, sweetness)
        # 1. in-stock whisky, all empty -> SELECTED (only variety applies to whisky)
        ("LWH001", "Test Whisky A", "1", None, None, None, None, None),
        # 2. out-of-stock whisky -> NOT selected (stock string "0")
        ("LWH002", "Test Whisky B", "0", None, None, None, None, None),
        # 3. in-stock gin, all empty -> SELECTED (only variety applies)
        ("LGN001", "Test Gin C", "1", None, None, None, None, None),
        # 4. in-stock RED WINE, all empty -> SELECTED (variety/body/acidity/tannin)
        ("WRW001", "Test Red Wine D", "1", None, None, None, None, None),
        # 5. in-stock spirit (rum) with its ONLY applicable field (variety) set
        #    -> NOT selected (nothing applicable left to fill). body/acidity/etc
        #    do NOT apply to a bare spirit, so their emptiness is irrelevant.
        ("LRM001", "Test Rum E", "1", "Cane/Molasses", None, None, None, None),
    ]
    conn.executemany("INSERT INTO products VALUES (?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    return conn


def test_select_rows_exact_set(tmp_path):
    conn = _make_db(tmp_path)
    selected = {r["sku"] for r in select_rows(conn)}
    # Whisky+Gin (variety only), Red Wine (4 fields). Rum E already has variety
    # (its only applicable field) -> excluded. Out-of-stock excluded.
    assert selected == {"LWH001", "LGN001", "WRW001"}, f"unexpected: {selected}"


def test_selected_whisky_resolves_to_group(tmp_path):
    """The selected row carries the SKU-derived GROUP (Rule 12)."""
    conn = _make_db(tmp_path)
    rows = {r["sku"]: r for r in select_rows(conn)}
    assert rows["LWH001"]["group"] == "Whisky"


def test_out_of_stock_string_zero_excluded(tmp_path):
    """is_in_stock '0' is a STRING; backwards-truthiness gotcha must be handled."""
    conn = _make_db(tmp_path)
    assert "LWH002" not in {r["sku"] for r in select_rows(conn)}


def test_red_wine_included_with_tannin_need(tmp_path):
    """Run-2 INVERSION of the old test_wine_excluded (Rule 5: do NOT preserve the
    Run-1 wine-exclusion behavior to keep a test green). Wine is now in scope, and
    a RED wine's `need` must include tannin (red-only per §4.0 applies())."""
    conn = _make_db(tmp_path)
    rows = {r["sku"]: r for r in select_rows(conn)}
    assert "WRW001" in rows, "red wine must now be selected"
    assert rows["WRW001"]["group"] == "Wine"
    assert "tannin" in rows["WRW001"]["need"]
    # sanity: full applicable set for a red wine, all empty
    assert set(rows["WRW001"]["need"]) == {"variety", "body", "acidity", "tannin"}


def test_gin_need_is_variety_only(tmp_path):
    """A gin (Spirits/Gin) has ONLY variety applicable -> need == ['variety'].
    Replaces the removed signal-gate tests (Rule 5) with the real §4.0 gate."""
    conn = _make_db(tmp_path)
    rows = {r["sku"]: r for r in select_rows(conn)}
    assert "LGN001" in rows
    assert rows["LGN001"]["need"] == ["variety"]


def test_no_signal_gate_in_run2(tmp_path):
    """Run-2 regression guard: there is NO buying-signal gate. A drinkable in-stock
    row with an applicable gap is selected REGARDLESS of any sales/critic signal —
    the Run-1 tests (test_no_signal_excluded / test_critic_signal_selects /
    test_sold_orders_signal_selects / test_missing_critic_scores_table_does_not_raise)
    asserted the now-removed gate and are intentionally gone (Rule 5). This also
    proves a DB with NO critic_scores table never raises."""
    db = tmp_path / "nosig.db"
    conn = sqlite3.connect(db)
    # Table deliberately has NO has_recent_sales/sold_orders, and NO critic_scores.
    conn.execute(
        "CREATE TABLE products (sku TEXT, name TEXT, is_in_stock TEXT, "
        "variety TEXT, body TEXT, acidity TEXT, tannin TEXT, sweetness TEXT)"
    )
    conn.execute(
        "INSERT INTO products VALUES "
        "('LWH900','No-signal Whisky','1',NULL,NULL,NULL,NULL,NULL)"
    )
    conn.commit()
    selected = {r["sku"] for r in select_rows(conn)}  # must not raise / not skip
    assert "LWH900" in selected


def test_already_filled_applicable_field_excluded(tmp_path):
    """A row whose ONLY applicable field is already set has nothing to enrich."""
    conn = _make_db(tmp_path)
    assert "LRM001" not in {r["sku"] for r in select_rows(conn)}


@pytest.mark.parametrize("group", sorted(DRINKABLE))
def test_build_prompt_has_variety_vocab_for_all_drinkable_groups(group):
    """Rule-6 parity guard: every DRINKABLE group has a non-empty variety vocab,
    and build_prompt for a variety-need row surfaces every vocab term. Locks the
    group-keyed variety contract (a divergent type would yield an empty vocab and
    silently strip the allowlist after the LLM is paid)."""
    vocab = variety_vocab_for(group)
    assert vocab, f"DRINKABLE group {group!r} has empty variety vocab"
    fake_row = {"sku": "XXX000", "name": "Parity Probe", "group": group,
                "wine_type": None, "need": ["variety"]}
    prompt = build_prompt(fake_row)  # must not raise
    assert group in prompt
    for term in vocab:
        assert term in prompt, f"vocab {term!r} missing from {group} prompt"


def test_applies_matrix_spot_checks():
    """Lock the §4.0 matrix at the selection boundary (defense in depth alongside
    the universal_scales unit test)."""
    assert applies("Spirits", "Gin") == {"variety"}
    assert applies("Wine", "Red Wine") == {"variety", "body", "acidity", "tannin"}
    assert applies("Wine", "White Wine") == {"variety", "body", "acidity", "sweetness"}
    assert applies("Liqueur", None) == {"variety", "body", "acidity", "sweetness"}
    assert applies("Sake & Asian", "Sake") == {"variety", "body"}
