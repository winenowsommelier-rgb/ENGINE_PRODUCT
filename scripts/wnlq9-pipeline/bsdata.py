# -*- coding: utf-8 -*-
"""
bsdata.py — best-seller rows for a site, 20 deep.

Two files replace the old bs2_<site>.tsv:

  bs_rank.tsv     site|lens|segment|sku,sku,...   (20 SKUs in rank order)
  bs_prod_*.tsv   sku~name~price~special~country~style~reputation~vintage~score~critic

Normalised on purpose. A bottle that appears in a price band, a country and a
type lens used to be written out three times; now it is written once. That is
what makes 20 deep across 61 segments affordable to refresh by hand each week.

RANKING, and what does not enter it
  popularity_qty_90d, then orders, then popularity_score, then score_max, then
  margin_thb, then price. Margin is the LAST tie-break before price and never
  renders — it lifts a better-margin bottle above an equal-selling one and
  cannot move a bottle above anything that outsold it. A best-seller list
  ordered by anything other than sales is not a best-seller list.

FALLBACK
  A site with no rows in bs_rank.tsv falls back to its old bs2_<site>.tsv at 10
  deep. That keeps the page building while the remaining sites are refreshed.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RANK = os.path.join(HERE, 'bs_rank.tsv')

_prod = None


def products():
    """sku -> dict, merged across every bs_prod_*.tsv present."""
    global _prod
    if _prod is not None:
        return _prod
    _prod = {}
    for fn in sorted(os.listdir(HERE)):
        if not (fn.startswith('bs_prod_') and fn.endswith('.tsv')):
            continue
        for line in open(os.path.join(HERE, fn), encoding='utf-8'):
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            f = line.split('~')
            if len(f) < 10:
                f += [''] * (10 - len(f))
            _prod[f[0]] = {'name': f[1], 'price': f[2], 'sp': f[3], 'country': f[4],
                           'style': f[5], 'rep': f[6], 'vintage': f[7],
                           'score': f[8], 'critic': f[9]}
    return _prod


def ranks():
    """(site, lens, seg) -> [sku, ...]"""
    out = {}
    if not os.path.exists(RANK):
        return out
    for line in open(RANK, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        p = line.split('|')
        if len(p) != 4:
            continue
        out[(p[0], p[1], p[2])] = [s for s in p[3].split(',') if s]
    return out


def rows_for(site, depth=20):
    """lens -> segment -> [row], row = [seg, rank, sku, name, price, sp, img,
    score, country, rep, style, vintage]. Returns {} if this site has no new data."""
    pr, rk = products(), ranks()
    segs = {}
    for (s, lens, seg), skus in rk.items():
        if s != site:
            continue
        rows = []
        for n, sku in enumerate(skus[:depth], 1):
            d = pr.get(sku)
            if not d or not d['name']:
                continue            # no product record yet — skip rather than guess
            score = f"{d['score']} {d['critic']}".strip() if d['score'] and d['critic'] else ''
            rows.append([seg, str(n), sku, d['name'], d['price'], d['sp'], '',
                         score, d['country'], d['rep'], d['style'], d['vintage']])
        # A segment is emitted only when nearly every SKU resolved. A half-filled
        # "top 20" that silently shows 3 rows is worse than the old 10-deep list,
        # so an incomplete segment falls back rather than shipping short.
        if len(rows) >= min(depth, len(skus)) * 0.9:
            for i, r in enumerate(rows, 1):
                r[1] = str(i)
            segs.setdefault(lens, {})[seg] = rows
    return segs


# ---------------------------------------------------------------- story line

STORY = os.path.join(HERE, 'bs_story.tsv')
_story = None

# Regions the catalog stores as a shrug. Printing "Other / Unspecified" under a
# bottle is worse than printing nothing, so these render as absent.
_JUNK_REGION = ('other', 'unspecified', 'n/a', '-')


def stories():
    """sku -> {region, designation, sales_pct, critic_pct}"""
    global _story
    if _story is not None:
        return _story
    _story = {}
    if not os.path.exists(STORY):
        return _story
    for line in open(STORY, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        f = line.split('~')
        if len(f) < 5:
            f += [''] * (5 - len(f))
        reg = f[1].strip()
        if reg.lower().startswith(_JUNK_REGION) or reg.lower() in _JUNK_REGION:
            reg = ''
        _story[f[0]] = {'region': reg, 'designation': f[2].strip(),
                        'sales_pct': int(f[3]) if f[3].strip().isdigit() else 0,
                        'critic_pct': int(f[4]) if f[4].strip().isdigit() else 0}
    return _story


# Thresholds. A percentile only persuades while it is rare — "top 20% of
# reviews" reads as filler, so anything weaker than these simply does not show.
SALES_PCT_MAX  = 5
CRITIC_PCT_MAX = 10


def story_bits(sku, variety='', critic=''):
    """(th, en) — one compact provenance line. Same on both sides by design.

    Regions, appellations and designations are proper nouns; Bordeaux, Speyside,
    Khao Yai, DOCG and Single Malt are what a Thai buyer reads on the label and
    searches for, so they stay in Latin rather than being transliterated. That
    is not a translation shortcut — it is how these words appear in the trade
    here, and inventing Thai spellings for them would be worse than useless.

    Nothing here is composed. Region, designation and variety are catalog
    fields, and the two percentiles are read out of reputation_summary, which
    the catalog derives. If a product has none of them, the line is omitted
    rather than padded.
    """
    d = stories().get(sku) or {}
    bits = [x for x in (d.get('region', ''), d.get('designation', ''), variety) if x]
    # variety often repeats the designation on spirits (Single Malt / Single Malt)
    seen, uniq = set(), []
    for b in bits:
        if b.lower() in seen:
            continue
        seen.add(b.lower())
        uniq.append(b)
    base = ' · '.join(uniq[:3])

    th_cred, en_cred = [], []
    if d.get('critic_pct') and d['critic_pct'] <= CRITIC_PCT_MAX and critic:
        th_cred.append(f'{d["critic_pct"]}% แรกของคะแนน {critic}')
        en_cred.append(f'top {d["critic_pct"]}% of {critic} scores')
    if d.get('sales_pct') and d['sales_pct'] <= SALES_PCT_MAX:
        th_cred.append(f'ยอดขาย {d["sales_pct"]}% แรกของหมวด')
        en_cred.append(f'top {d["sales_pct"]}% by sales in its category')

    th = ' — '.join(x for x in (base, ' · '.join(th_cred)) if x)
    en = ' — '.join(x for x in (base, ' · '.join(en_cred)) if x)
    return th, en


# ------------------------------------------------------------------- gauges

GAUGE = os.path.join(HERE, 'bs_gauge.tsv')
_gauge = None

# Thai labels are a fixed glossary, not a translation step — same rule as the
# pairing vocabulary. REVIEW BEFORE PUBLISHING, Pawin.
GAUGE_TH = {'body': 'บอดี้', 'tannin': 'แทนนิน', 'acidity': 'ความเปรี้ยว',
            'sweetness': 'ความหวาน', 'peat': 'ควันพีท'}
GAUGE_EN = {'body': 'Body', 'tannin': 'Tannin', 'acidity': 'Acidity',
            'sweetness': 'Sweetness', 'peat': 'Peat'}

# Which gauges are MEANINGFUL for which category. This is the important part.
#
# The catalog fills acidity and tannin on almost everything, including gin and
# vodka — The Botanist carries tannin 1 and acidity 3. Tannin is a grape-skin
# compound and a distilled spirit has none, so those numbers are the shape of a
# default, not a measurement. Rendering them would put a confident-looking bar
# under a number that means nothing, which is worse than leaving the row plain.
# So each category shows only the gauges that describe it.
GAUGES_FOR = {
    'red':       ('body', 'tannin', 'acidity'),
    'white':     ('body', 'acidity', 'sweetness'),
    'sparkling': ('body', 'acidity', 'sweetness'),
    'rose':      ('body', 'acidity'),
    'dessert':   ('sweetness', 'body', 'acidity'),
    'whisky':    ('body', 'peat'),
    'brandy':    ('body',),
    'rum':       ('body', 'sweetness'),
    'agave':     ('body',),
    'gin':       ('body',),
    'vodka':     ('body',),
    'liqueur':   ('sweetness', 'body'),
    'sake':      ('body', 'sweetness'),
}
_SCALE = {'sweetness': 4}          # Dry / Off-Dry / Medium-Sweet / Sweet
MAX_GAUGES = 3


def gauges():
    global _gauge
    if _gauge is not None:
        return _gauge
    _gauge, keys = {}, ('body', 'tannin', 'acidity', 'sweetness', 'peat')
    if not os.path.exists(GAUGE):
        return _gauge
    for line in open(GAUGE, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        f = line.split('~')
        if len(f) != 6:
            continue
        _gauge[f[0]] = {k: (int(v) if v.isdigit() else 0) for k, v in zip(keys, f[1:])}
    return _gauge


def gauge_html(sku, typ, two):
    """Up to three level bars, chosen by category. `two` is build5's TH/EN helper.

    Levels come straight from the PIM — body, tannin, acidity, sweetness and
    peat, normalised onto 1-5 (sweetness onto 1-4, since the catalog only
    distinguishes four steps and stretching it to five would invent precision
    the source does not have). A missing value renders nothing.
    """
    g = gauges().get(sku)
    if not g:
        return ''
    out = []
    for key in GAUGES_FOR.get(typ, ('body',)):
        v = g.get(key, 0)
        if not v:
            continue
        steps = _SCALE.get(key, 5)
        v = min(v, steps)
        segs = ''.join(f'<i class="{"on" if i < v else ""}"></i>' for i in range(steps))
        out.append(f'<span class="gz"><b>{two(GAUGE_TH[key], GAUGE_EN[key])}</b>'
                   f'<span class="gzb">{segs}</span></span>')
        if len(out) == MAX_GAUGES:
            break
    return f'<p class="gauges">{"".join(out)}</p>' if out else ''
