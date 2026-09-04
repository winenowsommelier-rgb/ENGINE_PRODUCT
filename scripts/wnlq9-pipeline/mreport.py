# -*- coding: utf-8 -*-
"""
mreport.py — best-seller ranking from actual orders.

WHY THIS REPLACES THE SUPABASE POPULARITY COLUMNS
  Best sellers have been running on products.popularity_qty_90d, which is frozen
  at 21 July and stamped on 122 of 6,388 rows. There is no job writing to it and
  SYNC-SPEC §3.2 was written to build one.

  That job is now unnecessary. The 'MReport Item Performance' tab of
  DATA: WNLQ9 Performance carries real monthly order data per SKU, back to
  January 2023, refreshed weekly. It is also the source behind the BI API, so
  this module and the API read the same numbers — whichever route is available.

  Two things that follow, both good:
    · the ranking window becomes a decision instead of a mystery. The columns
      are named _90d while popularity_window_days says 365, and nobody could
      settle it. Here the window is whatever WINDOW_MONTHS says, and the page
      can finally state a period out loud.
    · the ranking moves weekly, because the source does.

COLUMNS
  YEAR, MONTH, SKU, Product Name, Orders, Qty Ordered, Tax, Discount,
  Refunded, Gross Margin %, Total (THB)

  Orders and Qty Ordered are the ranking. Total (THB) and Gross Margin % RANK
  ONLY — revenue and margin must never reach a rendered page or a payload, the
  same rule that already governs margin_thb.

PARSING — read this before changing it
  'Total (THB)' is written with a thousands separator and, in at least some
  exports, without quoting: `...,40.68%,3,439` is ONE value, 3439, not two
  columns. Field counts therefore vary by row.

  So this parser works from the LEFT for the fixed head (year, month, sku) and
  from the RIGHT for the fixed tail, and treats everything between as the
  product name. That is the same defence links.py needs for the product-URL
  export, and the same class of bug that put a tab inside a product name in
  Supabase. It has now bitten this business four times in four different files.
  Assume every delimited export from this stack is unquoted until proven
  otherwise.
"""
import csv, io, os, re, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'mreport.tsv')

# The trailing window the ranking covers. Three months balances "what is selling
# now" against a month being unrepresentative; anything shorter makes the list
# jump around week to week for no real reason.
WINDOW_MONTHS = 3

HEAD = 3          # YEAR, MONTH, SKU
TAIL = 7          # Orders .. Total(THB), before the name is what is left
_NUM = re.compile(r'^-?[\d.]+$')


def _num(s):
    """'42,895' -> 42895 ; '40.68%' -> 40.68 ; '' -> 0"""
    s = (s or '').strip().replace(',', '').replace('%', '')
    if not s or not _NUM.match(s):
        return 0
    return float(s) if '.' in s else int(s)


def parse(text):
    """[(year, month, sku, name, orders, qty)] from a CSV export of the tab."""
    rows, bad = [], 0
    rdr = csv.reader(io.StringIO(text))
    header = next(rdr, None)
    for f in rdr:
        if len(f) < HEAD + TAIL:
            bad += 1
            continue
        try:
            year, month, sku = int(f[0]), int(f[1]), f[2].strip()
        except ValueError:
            bad += 1
            continue
        if not sku or sku == '-':
            continue

        # If Total(THB) split across two fields the tail shifts by one: the last
        # element is then a bare 3-digit group, e.g. ...,'3','439' for 3439.
        shifted = len(f) > HEAD + TAIL and bool(re.fullmatch(r'\d{3}', f[-1].strip()))
        tail_start = len(f) - TAIL - (1 if shifted else 0)
        orders, qty = _num(f[tail_start]), _num(f[tail_start + 1])
        name = ','.join(f[HEAD:tail_start]).strip().strip('"')
        rows.append((year, month, sku, name, int(orders), int(qty)))
    return rows, bad


def window(rows, months=WINDOW_MONTHS, today=None):
    """Aggregate the trailing N complete months. Returns (totals, label).

    The current month is EXCLUDED. A month in progress always looks like a
    collapse in sales, and a ranking that quietly demotes everything for three
    weeks of every month is worse than one that lags by one.
    """
    today = today or datetime.date.today()
    ym = [(y, m) for y, m, *_ in rows]
    if not ym:
        return {}, ''
    cur = (today.year, today.month)
    done = sorted({p for p in set(ym) if p < cur}, reverse=True)[:months]
    if not done:
        return {}, ''
    keep = set(done)

    agg = collections.defaultdict(lambda: {'orders': 0, 'qty': 0, 'name': ''})
    for y, m, sku, name, orders, qty in rows:
        if (y, m) not in keep:
            continue
        a = agg[sku]
        a['orders'] += orders
        a['qty'] += qty
        a['name'] = a['name'] or name

    lo, hi = min(done), max(done)
    label = (f'{lo[0]}-{lo[1]:02d}' if lo == hi
             else f'{lo[0]}-{lo[1]:02d}..{hi[0]}-{hi[1]:02d}')
    return dict(agg), label


def write_cache(agg, label, path=CACHE):
    lines = [f'# window: {label}  months: {WINDOW_MONTHS}  '
             f'generated: {datetime.date.today().isoformat()}',
             '# sku~orders~qty   (ranking inputs only — never rendered)']
    for sku, a in sorted(agg.items(), key=lambda kv: (-kv[1]['qty'], -kv[1]['orders'], kv[0])):
        lines.append(f'{sku}~{a["orders"]}~{a["qty"]}')
    open(path, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return len(agg), label


def load_cache(path=CACHE):
    """sku -> {'orders', 'qty'} plus the window label, for the build to rank on."""
    out, label = {}, ''
    if not os.path.exists(path):
        return out, label
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if line.startswith('#'):
            m = re.search(r'window:\s*(\S+)', line)
            if m:
                label = m.group(1)
            continue
        if not line:
            continue
        f = line.split('~')
        if len(f) == 3:
            out[f[0]] = {'orders': int(f[1]), 'qty': int(f[2])}
    return out, label


# ---------------------------------------------------------------- ranking

SKU_TYPE = {'WRW': 'red', 'WWW': 'white', 'WSP': 'sparkling', 'WRS': 'rose',
            'WDW': 'dessert', 'LWH': 'whisky', 'LGN': 'gin', 'LRM': 'rum',
            'LTQ': 'agave', 'LVK': 'vodka', 'LBD': 'brandy', 'LSK': 'sake',
            'LLQ': 'liqueur'}
COUNTRIES = {
    'W': ['Argentina', 'Australia', 'Chile', 'France', 'Italy',
          'New Zealand', 'South Africa', 'Spain', 'Thailand', 'USA'],
    'L': ['England', 'France', 'Ireland', 'Italy', 'Japan',
          'Mexico', 'Netherlands', 'Scotland', 'Thailand', 'USA'],
}
DEPTH = 20


def _band(price):
    return ('b1' if price < 1500 else 'b2' if price < 3000 else
            'b3' if price < 5000 else 'b4' if price < 10000 else 'b5')


def _family(name):
    """Name with the size parenthetical and any vintage year stripped, so four
    Clerc Milon vintages collapse to one row in a list."""
    n = re.sub(r'\([^)]*\)', ' ', (name or '').lower())
    n = re.sub(r'\b(19|20)\d{2}\b', ' ', n)
    return re.sub(r'[^a-z0-9]+', ' ', n).strip()


def rank(orders, attrs, depth=DEPTH):
    """Build the bs_rank rows from real orders.

    `attrs` is {sku: {'name','price','country','margin','score','catalog_only'}}
    from the catalog. The ordering is qty, orders, critic score, MARGIN, price —
    margin still the last tie-break before price, never a reordering force.

    Ranking moved out of SQL and into here because the sales data no longer
    lives in the database. That is a better home for it anyway: the dedup rule
    and the ordering are now readable in one place instead of split between a
    query and a build script.
    """
    pool = []
    for sku, a in attrs.items():
        if a.get('catalog_only') or not a.get('price'):
            continue
        d = orders.get(sku)
        if not d or d['qty'] <= 0:
            continue                      # sold nothing in the window
        pool.append({
            'sku': sku, 'name': a.get('name', ''), 'price': a['price'],
            'country': a.get('country', ''), 'typ': SKU_TYPE.get(sku[:3], ''),
            'band': _band(a['price']), 'fam': _family(a.get('name', '')),
            'qty': d['qty'], 'orders': d['orders'],
            'score': a.get('score', 0) or 0, 'margin': a.get('margin', 0) or 0,
            'std': 0 if re.search(r'\((?:700|750) ?ml\)', (a.get('name') or '').lower()) else 1,
        })

    # one row per product family, standard bottle preferred, then best selling
    best = {}
    for p in sorted(pool, key=lambda x: (x['fam'], x['std'], -x['qty'], -x['margin'])):
        best.setdefault(p['fam'], p)
    pool = list(best.values())

    key = lambda p: (-p['qty'], -p['orders'], -p['score'], -p['margin'], -p['price'])
    lines = []
    for tag, pref in (('wn', 'W'), ('lq', 'L'), ('all', '')):
        mine = [p for p in pool if p['sku'].startswith(pref)] if pref else pool
        lenses = [('band', lambda p: p['band']), ('type', lambda p: p['typ'])]
        if pref:                          # the combined page has no country lens
            lenses.insert(1, ('country', lambda p: p['country']))
        for lens, keyfn in lenses:
            segs = {}
            for p in mine:
                k = keyfn(p)
                if not k:
                    continue
                if lens == 'country' and k not in COUNTRIES.get(pref, []):
                    continue
                segs.setdefault(k, []).append(p)
            for seg, rows in sorted(segs.items()):
                rows = sorted(rows, key=key)[:depth]
                if len(rows) >= 3:
                    lines.append(f'{tag}|{lens}|{seg}|' + ','.join(p['sku'] for p in rows))
    return lines
