#!/usr/bin/env python3
"""
Assign gin_style / agave_aging / rum_style / peat_level / production_method
from product name patterns. Safe to re-run (only writes when pattern matches
and field is currently NULL).

Run in canary mode first: python3 scripts/assign_spirits_fields.py --canary --db <path>
Full run:                  python3 scripts/assign_spirits_fields.py --db <path>

NOTE: Always pass --db explicitly when running from a git worktree; the
default path resolves relative to the script and can point at the wrong
DB (e.g. a stray 0-byte auto-created file in a worktree checkout).

DATA-QUALITY WARNING (peat_level): any peated whisky whose brand is missing
from PEAT_RULES falls through to the 'none' fallback, which gets WRITTEN AS
FACT — the recommendation engine will then actively pair it with genuinely
unpeated whiskies (+3 score boost). This is the same failure class as the
country-from-brand incident (19/24 wrong, PR #48 -> reverted #50). The canary
review for this script MUST cross-reference the full distinct whisky product
list against known peated producers before the full run — see Task 10 plan.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "data" / "db" / "products.db"

# category_type is NOT a stored column on products.db — it is derived from the
# SKU prefix at read-time (see data/lib/taxonomy/sku_taxonomy.py resolve()).
# The plan's literal script assumed `SELECT ... category_type FROM products`,
# which does not exist and would crash immediately (verified against main's
# real DB: PRAGMA table_info(products) has no category_type column). Rule 12
# requires routing on category_type (not raw classification), so this script
# computes it via the canonical resolver instead of reading a non-existent
# column — same pattern refresh_live_export.py uses.
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_taxonomy  # noqa: E402

# ── Gin style ──────────────────────────────────────────────────────────────
GIN_RULES = [
    ('aged_barrel',           r'\b(aged|barrel[- ]aged|cask)\b'),
    ('spiced',                r'\b(spiced|pepper|chilli|ginger)\b'),
    ('contemporary_floral',   r'\b(floral|rose|elderflower|lavender|hibiscus|jasmine)\b'),
    ('contemporary_fruit',    r'\b(berry|strawberry|raspberry|rhubarb|mango|pineapple|passion fruit)\b'),
    ('contemporary_citrus',   r'\b(citrus|lemon|lime|grapefruit|orange|yuzu|bergamot)\b'),
    ('juniper_forward',       r'\b(london dry|classic|traditional|juniper)\b'),
    ('juniper_forward',       None),   # fallback — any gin without a more specific signal
]

# ── Agave aging ────────────────────────────────────────────────────────────
AGAVE_RULES = [
    ('extra_anejo', r'\bextra\s+a[ñn]ejo\b'),
    ('anejo',       r'\ba[ñn]ejo\b'),
    ('reposado',    r'\breposado\b'),
    ('blanco',      r'\b(blanco|silver|plata|cristalino)\b'),
    ('blanco',      None),  # fallback
]

# ── Rum style ──────────────────────────────────────────────────────────────
RUM_RULES = [
    ('pot_still_funk', r'\b(pot still|funky|hogo|overproof funk)\b'),
    ('overproof',      r'\b(overproof|151|navy strength)\b'),
    ('spiced',         r'\b(spiced|captain|flavou?red)\b'),
    ('dark_aged',      r'\b(dark|aged|añejo|xo|vsop|vso|solera|vintage|mahogany)\b'),
    ('white_unaged',   r'\b(white|silver|blanco|carta blanca|light|agricole blanc)\b'),
    ('gold_light',      None),  # fallback
]

# ── Peat level ─────────────────────────────────────────────────────────────
# DATA-QUALITY WARNING on the 'none' fallback: any peated whisky whose brand is
# missing from these lists gets peat_level='none' WRITTEN AS FACT, and the
# engine will then actively pair it with unpeated drams (+3). This is the
# brand-inference failure class (country-from-brand: 19/24 wrong, PR #48->#50).
# Mitigations: (a) brand lists below include the known peated distilleries in
# the catalog — extended during canary review (see commit history / task
# report for the specific additions and why); (b) canary MUST eyeball every
# distinct whisky brand that falls through to 'none'; (c) when in doubt for a
# Scotch single malt, prefer leaving NULL (engine treats NULL as "no signal, no
# penalty") over asserting 'none'.
# EXPLICIT_UNPEATED: checked BEFORE any brand-name fallback match. Several
# brands below (Bruichladdich, Yoichi) sell both peated and explicitly
# unpeated/non-peated expressions from the SAME distillery/brand name — a bare
# brand-name match would assert 'medium'/'heavy' peat on a bottle whose own
# name says otherwise (e.g. "Bruichladdich The Classic Laddie UNPEATED",
# "Nikka YOICHI ... Non-Peated"). This is the exact brand-inference failure
# class the module docstring warns about, just triggered by a brand fallback
# instead of a missing brand. When the name explicitly disclaims peat, that
# wins over any brand match.
_EXPLICIT_UNPEATED = re.compile(r'\b(unpeated|non[- ]peated)\b', re.IGNORECASE)

PEAT_RULES = [
    ('heavy', r'\b(heavily peated|supernova|octomore|ardbeg|laphroaig|lagavulin|caol\s*ila|port charlotte|kilchoman|ledaig|longrow|smokehead)\b'),
    ('medium', r'\b(peat\w*|smok\w*|bowmore|highland park|benromach|springbank|talisker|ardmore|croftengea|yoichi|bruichladdich)\b'),
    ('light', r'\b(lightly peated|subtle smoke|bunnahabhain|jura|hakushu)\b'),
    ('none',  None),  # fallback for whisky — see warning above
]
# CANARY REVIEW ADDITIONS (2026-07-09, Task 10): cross-referenced the full
# 867-row in-stock Whisky catalog against known peated producers before the
# full run. Found and fixed two real regex gaps that would have written
# peat_level='none' as fact on genuinely peated products — the exact failure
# shape this warning is about:
#   1. 'smokehead' added explicitly: \bsmoke\b requires "smoke" as a standalone
#      word and does not match "Smokehead" (one token, no space) — 3 SKUs
#      (LWH0396AH, LWH0397AH, LWH0712AH) would have been mis-tagged 'none' for
#      a brand whose entire identity is heavy Islay peat.
#   2. 'peat' / 'smoke' widened to 'peat\w*' / 'smok\w*' (matches peaty, peated,
#      smoky, smoked, smokier, etc.) — \bpeat\b did not match "Peaty" in
#      Tomintoul's "With a Peaty Tang" (LWH0573BT), a specifically peated
#      expression from an otherwise-unpeated distillery's core range.
# Verified no other known peated distillery (Ardmore, Benromach, Springbank/
# Longrow, Bruichladdich, Bowmore, Highland Park, Talisker, Jura,
# Bunnahabhain, Hakushu, Yoichi, Kilchoman, Port Charlotte, Octomore, Ledaig,
# Ardbeg, Laphroaig, Lagavulin, Caol Ila) was missing from the catalog's 867
# whisky rows. Confirmed correct non-matches: "Unpeated" (Glen Scotia 10 YO)
# does NOT match peat\w* boundary-wise... re-verified below, and Arran /
# GlenAllachie / Glendronach / Cotswolds core ranges / Lohin McKinnon core
# range are genuinely unpeated distilleries — 'none' is correct for them.

# ── Production method (sparkling) ──────────────────────────────────────────
PRODUCTION_RULES = [
    ('traditional_method', r'\b(m[eé]thode? traditionelle?|m[eé]thode? champenoise|cap classique|cava|crémant|cremant|english sparkling|sekt b\.?a\.?)\b'),
    ('ancestral_method',   r'\b(p[eé]tillant naturel|pet nat|ancestral)\b'),
    ('tank_method',        r'\b(prosecco|asti|charmat|tank method|cuve close)\b'),
    ('traditional_method', None),  # fallback — assume traditional if we don't know
]

CATEGORY_RULES = {
    'Gin':     ('gin_style',         GIN_RULES),
    'Tequila': ('agave_aging',       AGAVE_RULES),
    'Mezcal':  ('agave_aging',       AGAVE_RULES),
    'Rum':     ('rum_style',         RUM_RULES),
    'Whisky':  ('peat_level',        PEAT_RULES),
    # Sparkling applied by category_type below
}

SPARKLING_TYPES = {'Champagne', 'Sparkling Wine', 'Crémant', 'Cava', 'Prosecco'}


def match_rules(name: str, rules: list) -> str | None:
    name_lower = name.lower()
    # Explicit "unpeated"/"non-peated" in the name overrides any brand-name
    # fallback match in PEAT_RULES (e.g. Bruichladdich Classic Laddie, Nikka
    # Yoichi Non-Peated) — the name's own claim beats an inferred brand
    # default. Only applies to peat rules (identified by the 'none' fallback
    # value, unique to PEAT_RULES among the rule sets in this script).
    if rules is PEAT_RULES and _EXPLICIT_UNPEATED.search(name_lower):
        return 'none'
    for value, pattern in rules:
        if pattern is None:
            return value   # fallback
        if re.search(pattern, name_lower, re.IGNORECASE):
            return value
    return None


def resolve_column_and_rules(category_type: str | None):
    """Rule 12: route on category_type (derived from SKU prefix via
    sku_taxonomy.resolve()) ONLY — never fall back to raw Magento
    classification (it is a stale TYPE duplicate with a 1,509-row junk
    bucket). A row without a resolvable category_type is skipped rather than
    guessed."""
    cat = category_type or ''
    if 'Gin' in cat:
        return 'gin_style', GIN_RULES
    if 'Tequila' in cat or 'Mezcal' in cat:
        return 'agave_aging', AGAVE_RULES
    if 'Rum' in cat:
        return 'rum_style', RUM_RULES
    if 'Whisky' in cat or 'Whiskey' in cat:
        return 'peat_level', PEAT_RULES
    if any(t in cat for t in SPARKLING_TYPES):
        return 'production_method', PRODUCTION_RULES
    return None, None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', type=Path, default=DEFAULT_DB)
    ap.add_argument('--canary', action='store_true')
    args = ap.parse_args(argv)

    if not args.db.exists():
        print(f"ERROR: db not found: {args.db}", file=sys.stderr)
        return 1

    # Guard against the worktree/stray-empty-DB trap: sqlite3.connect() will
    # silently auto-create an empty SQLite file if the path doesn't already
    # exist as a real DB, and a 0-byte file would pass the .exists() check
    # above. Refuse to run unless the products table actually exists AND has
    # rows. (CLAUDE.md Rule 1; same guard as scripts/migrate_spirits_fields.py.)
    probe = sqlite3.connect(args.db)
    try:
        has_table = probe.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='products'"
        ).fetchone()[0]
        row_count = (
            probe.execute("SELECT count(*) FROM products").fetchone()[0]
            if has_table else 0
        )
    finally:
        probe.close()
    if not has_table or row_count == 0:
        print(
            f"ERROR: {args.db} has no populated products table "
            f"(has_table={bool(has_table)}, rows={row_count}). Refusing to run "
            f"— pass --db with the real database path. This guards the worktree/"
            f"empty-DB trap (CLAUDE.md Rule 1).",
            file=sys.stderr,
        )
        return 1

    # Print the resolved target on every run (Rule 9: know which data source
    # you're reading/writing).
    print(f'Target DB: {args.db} ({row_count} rows)')

    conn = sqlite3.connect(args.db)
    cur = conn.cursor()
    raw_rows = cur.execute(
        'SELECT sku, name FROM products WHERE is_in_stock IS NOT NULL'
    ).fetchall()

    # Derive category_type per row via the canonical SKU-prefix resolver
    # (Rule 12) — category_type is not a stored column, see note above.
    rows = []
    for sku, name in raw_rows:
        category_type = _resolve_taxonomy({'sku': sku, 'name': name})['type']
        rows.append((sku, name, category_type))

    if args.canary:
        sample = {}
        for cat in list(CATEGORY_RULES.keys()) + ['Sparkling']:
            cat_rows = [r for r in rows if cat in (r[2] or '')]
            sample[cat] = cat_rows[:10]
        rows = [r for sub in sample.values() for r in sub]
        print(f'CANARY MODE — {len(rows)} rows across categories')

    updates = []
    for sku, name, category_type in rows:
        col, rules = resolve_column_and_rules(category_type)
        if col is None:
            continue
        value = match_rules(name or '', rules)
        if value:
            updates.append((value, sku, col))

    print(f'Matched {len(updates)} products')

    # CANARY WRITES TOO (feedback: a dry-run is not a canary — the canary must
    # exercise the SAME code path as production: real UPDATEs against the real
    # DB, verified in the export/UI afterwards). The only difference is the row
    # sample. The pre-run DB backup is the rollback.
    name_by_sku = {r[0]: r[1] for r in rows}
    written = 0
    for value, sku, col in updates:
        cur.execute(f'UPDATE products SET {col}=? WHERE sku=? AND {col} IS NULL', (value, sku))
        written += cur.rowcount
    conn.commit()

    if args.canary:
        for value, sku, col in updates[:30]:
            print(f'  {sku} | {col}={value} | {(name_by_sku.get(sku) or "")[:60]}')
        print(f'-- Canary WROTE {written} rows (matched {len(updates)}).')
        print('-- Verify with the coverage query + refresh_live_export.py + UI,')
        print('-- then re-run without --canary. Rollback = restore the backup.')
    else:
        # Report ACTUAL written rows (rowcount), not matches: the `AND col IS
        # NULL` guard means matched != written on re-runs.
        print(f'Wrote {written} rows ({len(updates)} matched). Run refresh_live_export.py next.')
    conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
