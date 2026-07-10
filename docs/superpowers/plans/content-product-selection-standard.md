# WNLQ9 Journal — Product Selection Standard (mandatory for ALL blog content)

Every product embedded in a post goes through this process. No exceptions —
including updates to existing posts. This codifies the 2026-07-09 upgrade pass.

## 1. Generate candidates mechanically (never hand-pick from memory)

```
.venv/bin/python scripts/content_product_picker.py --prefix WRW --country France --limit 15
```

Ranking is premium-first: `reputation_tier` (iconic > premium > established >
everyday > unrated) → `score_max` → `popularity_qty_window` → `price`.
Filter to the post's topic (prefix/country/region/variety/price band) BEFORE
looking at names. In-stock only (the picker already enforces this).

## 2. Filter for narrative fit like a sommelier (the human-judgment gate)

A higher tier/score NEVER overrides fit. Reject a candidate if:

- **Wrong origin for the slot** — no Chilean wine in an Argentina section, no
  Johnnie Walker in a Japanese-whisky roster, no Blue Nun for a Mosel-estates slot.
- **Wrong style for the slot** — no coffee liqueur in a tequila slot, no
  non-rosé Champagne in a rosé slot, no oaked monster in an "unoaked" section.
- **Wrong price bracket** — a "under ฿1,500" post takes nothing above the cap;
  a step-up recommendation should still sit within ~2× the post's core band.
- **The slot is definitionally specific** — sake grade-ladders, sommelier-picks,
  new-arrivals and vintage-specific slots name a particular bottle for a reason;
  don't swap them for a generically "better" one.

Expect to reject ~half of mechanical candidates. That is the process working.

## 3. Prefer, in order, when candidates tie on fit

1. Iconic/premium `reputation_tier`
2. Real critic score (from `score_summary` — attribute the actual critic and
   vintage: James Suckling / Wine Advocate / Wine Enthusiast; NEVER invent)
3. Recognizable estate/producer story that supports the post's argument
4. Popularity (`popularity_qty_window`), then price position

## 4. Rewrite the prose honestly for the chosen bottle

The paragraph around an embed must describe THAT bottle — producer, style,
score with named critic, current ฿ price. No recycled adjectives from the
product it replaced. Fallback price line goes AFTER the embed.

## 5. Gate before publish (all three, every batch)

```
.venv/bin/python scripts/validate_blog_embeds.py   # missing/OOS/no-image/no-price → hard fail
.venv/bin/python scripts/audit_blog_content.py     # price drift, compliance, links, FAQ
```

Plus Rule 9: if the DB changed, refresh the live export first (after applying
the nightly bot's price/stock diffs to the DB — see project memory).

## 6. Monthly archive re-run

Products go out of stock and prices move. Re-run both gates on the whole
archive monthly and swap dead embeds using steps 1–4.
