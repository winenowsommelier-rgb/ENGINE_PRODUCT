# -*- coding: utf-8 -*-
"""
explorer.py — the Explorer view: bottles worth mentioning, and the reason why.

WHAT THIS IS NOT
  Trending answers "what are customers asking for". Best sellers answers "what
  sold". Explorer answers neither, and it must not pretend to. It is a curated
  discovery shelf, and every row carries a REASON chip stating exactly why it
  is there — so a reader is never left guessing whether a bottle is here
  because it is good, because it is expensive, or because we want to move it.

  A row with no statable reason does not appear. That rule is what keeps the
  shelf from quietly becoming a place to park slow stock.

THE REASONS, in the order they rank
  editor      from explorer.json — Pawin's own picks, with his own line
  iconic      products.reputation_tier = 'iconic'. 16 in a 6,388-product
              catalog, so the badge means something
  critic      inside the top 5% of a named critic's reviews
  score       a stored critic score of 95 or better, critic always named
  rare        a designation that signals scarcity or ageing — Grand Cru,
              Premier Cru, Single Malt, XO, Gran Reserva, Limited, Vintage
  low         genuinely short: 12 bottles or fewer on the ticket sheet, and
              priced in the premium band. Real scarcity only; nothing here is
              manufactured urgency

WHAT IS MISSING, AND WHY IT IS MISSING
  Pawin asked for PR highlights and "what people are talking about". There is
  no press feed and no social signal for wine and spirits in this catalog, and
  inventing a buzz metric out of sales data would be a lie dressed as a number.
  So that lane is the `editor` reason, driven by explorer.json — a file the
  team writes. Empty by default, and an empty file simply means those rows do
  not appear.

explorer.json format (all fields optional except sku):
  [{"sku": "WRW2359BN",
    "th": "ไร่เก่าแก่ในบารอสซา ผลิตปีละไม่มาก",
    "en": "Old Barossa vines, tiny production",
    "until": "2026-10-31"}]
  `until` retires a pick automatically so the shelf does not fossilise.
"""
import json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PICKS = os.path.join(HERE, 'explorer.json')

DEPTH = 20
PREMIUM_FLOOR = 3000          # matches build5's premium threshold
LOW_STOCK = 12                # matches the exact-figure rule for stock

RARE_DESIGNATIONS = {'Grand Cru', 'Premier Cru', 'Single Malt', 'XO',
                     'Gran Reserva', 'Limited', 'Vintage', 'DOCG'}

# Reason chips. Thai is a fixed glossary, same rule as the other vocabularies —
# REVIEW BEFORE PUBLISHING, Pawin.
REASON = {
    'editor': ('บรรณาธิการแนะนำ', "Editor's pick"),
    'iconic': ('ระดับไอคอน',      'Icon'),
    'critic': ('นักวิจารณ์ยกให้',  'Critic favourite'),
    'score':  ('คะแนน 95 ขึ้นไป',  'Scored 95+'),
    'rare':   ('ระดับพิเศษ',       'Special designation'),
    'low':    ('เหลือน้อย',        'Very limited'),
}
ORDER = ['editor', 'iconic', 'critic', 'score', 'rare', 'low']


def load_picks():
    """Hand-written picks. Expired ones drop out on their own."""
    if not os.path.exists(PICKS):
        return {}
    try:
        rows = json.load(open(PICKS, encoding='utf-8'))
    except Exception:
        return {}
    today, out = datetime.date.today(), {}
    for r in rows:
        sku = (r or {}).get('sku')
        if not sku:
            continue
        until = r.get('until')
        if until:
            try:
                if datetime.date.fromisoformat(until) < today:
                    continue
            except ValueError:
                pass
        out[sku] = {'th': r.get('th', ''), 'en': r.get('en', '')}
    return out


def candidates(site_prefix, products, stories, stock_of):
    """[(sku, reason, note_th, note_en)] ordered by reason strength.

    products / stories come from bsdata; stock_of(sku) returns the ticket-sheet
    quantity or 0 when unknown. Nothing here reads sales or margin.
    """
    picks = load_picks()
    seen, out = set(), []

    def add(sku, reason, th='', en=''):
        if sku in seen or not sku.startswith(site_prefix):
            return
        seen.add(sku)
        out.append((sku, reason, th, en))

    for sku, note in picks.items():
        if sku in products:
            add(sku, 'editor', note['th'], note['en'])

    for sku, p in products.items():
        if p.get('rep') == 'iconic':
            add(sku, 'iconic')

    for sku, s in stories.items():
        if sku in products and s.get('critic_pct') and s['critic_pct'] <= 5:
            add(sku, 'critic')

    for sku, p in products.items():
        try:
            if p.get('score') and int(p['score']) >= 95:
                add(sku, 'score')
        except (TypeError, ValueError):
            pass

    for sku, s in stories.items():
        if sku in products and s.get('designation') in RARE_DESIGNATIONS:
            add(sku, 'rare')

    for sku, p in products.items():
        try:
            price = int(p.get('sp') or p.get('price') or 0)
        except (TypeError, ValueError):
            price = 0
        q = stock_of(sku)
        if price >= PREMIUM_FLOOR and 0 < q <= LOW_STOCK:
            add(sku, 'low')

    rank = {r: i for i, r in enumerate(ORDER)}
    out.sort(key=lambda x: (rank.get(x[1], 99),
                            -int(products[x[0]].get('score') or 0),
                            -int(products[x[0]].get('price') or 0)))
    return out
