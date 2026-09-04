# -*- coding: utf-8 -*-
"""
prep3.py — Stock_Checks -> trending candidates.

Source: "WNLQ9 Internal Team Ticket Stock Check", tab Stock_Checks.
A row is a stock-check ticket line: a salesperson asked the product team to
confirm availability because a *client asked for that bottle*. That makes it a
DEMAND signal, and it leads sales — the check happens before the order.

Design decisions and why:
  · 30-day rolling window, last 7 days weighted x2.  The page is weekly; a
    60-day window keeps a bottle "trending" two months after its moment.
  · Score on DISTINCT CLIENTS, not rows.  One ticket can be 17 rows from a
    single wholesale buyer (TCK-1110).  Raw row counts would
    make "trending" mean "what one account asked for on Friday".
  · Minimum 2 distinct clients to qualify.  A single ask is noise.
  · Rows answered OOS / catalog / discontinued are EXCLUDED from the published
    list and routed to an internal unmet-demand report instead.
  · Premium cut is taken from the same real demand, filtered on catalog price
    — never hand-seeded.  See pick_premium().

Stock Status is free text in the same forms prep.py already parses
(§5 of the build spec): มีของ, stock 100+ ร้าน 24, 100/2020, WN=10, oos, catalog.
"""
import csv, json, os, re, unicodedata
from collections import defaultdict
from datetime import datetime, timedelta

_HERE     = os.path.dirname(os.path.abspath(__file__))
_CLR      = os.environ.get('WNLQ9_CLR', _HERE)
CSV_PATH  = os.path.join(_CLR, 'stock_checks.csv')
CATALOG   = os.path.join(_CLR, 'catalog.json')   # sku -> {c,r,v,t,i,m,cr,sp}
WINDOW    = 30          # days
RECENT    = 7           # days weighted x2
MIN_CLIENTS = 2         # a SKU needs this many distinct clients to qualify
PREMIUM_FLOOR = 5000    # THB — a "cellar icon" for the benchmark band
# The window anchor. This was hardcoded to datetime(2026, 8, 26) — the date of
# the last hand-made export — which silently dropped every ticket newer than
# that as "outside_window". With the feed pulled live that was 412 of 833 rows:
# the freshest half of the demand signal, discarded, while the run still
# reported success. A rolling window has to roll.
# WNLQ9_TODAY (YYYY-MM-DD) pins it for reproducible builds and tests.
TODAY     = (datetime.strptime(os.environ['WNLQ9_TODAY'], '%Y-%m-%d')
             if os.environ.get('WNLQ9_TODAY') else
             datetime.now().replace(hour=0, minute=0, second=0, microsecond=0))

# ---------------------------------------------------------------- parsing

UNAVAILABLE = re.compile(r'\b(oos|out of stock|catalog|discontinued)\b', re.I)

def stock_state(raw):
    """Returns 'unavailable' | 'available' | 'unknown'. Mirrors spec §5 forms."""
    s = (raw or '').strip()
    if not s:
        return 'unknown'
    if UNAVAILABLE.search(s):
        return 'unavailable'
    if s == '0':
        return 'unavailable'
    if re.match(r'^\d', s) or 'มีของ' in s or 'stock' in s.lower() or 'WN=' in s:
        return 'available'
    return 'unknown'

def norm_client(name):
    """
    An order reference (OR2608210391, #WNLQ925402) is anonymous but it is still
    ONE distinct buying occasion, so it counts as an identity. This also
    correctly collapses duplicate tickets raised against the same order —
    TCK-1154 and TCK-1157 are both OR2608210391 and must count once, not twice.
    """
    s = unicodedata.normalize('NFKC', (name or '')).strip().lower()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'^#', '', s)
    return s or None

SKU_RE = re.compile(r'^[A-Z]{3}\d{4}[A-Z]{2}(-\d+)?$')

def clean_sku(raw):
    s = (raw or '').strip().upper()
    return s if SKU_RE.match(s) else None

def parse_date(s):
    for fmt in ('%m/%d/%Y', '%Y-%m-%d'):
        try:    return datetime.strptime(s.strip(), fmt)
        except: pass
    return None

# ---------------------------------------------------------------- scoring

def load(path=CSV_PATH):
    rows, skipped = [], defaultdict(int)
    for r in csv.DictReader(open(path, encoding='utf-8')):
        d   = parse_date(r.get('date', ''))
        sku = clean_sku(r.get('sku', ''))
        if d is None:  skipped['bad_date'] += 1;  continue
        if sku is None: skipped['bad_sku'] += 1;  continue
        age = (TODAY - d).days
        if age > WINDOW or age < 0:
            skipped['outside_window'] += 1; continue
        rows.append({
            'ticket': r['ticket'].strip(),
            'date': d, 'age': age, 'sku': sku,
            'name': r.get('name', '').strip(),
            'client': norm_client(r.get('client', '')),
            'state': stock_state(r.get('stock', '')),
        })
    return rows, skipped

def score(rows):
    """weight = 2 for the last 7 days, 1 for days 8-30. Counted per client."""
    agg = defaultdict(lambda: {'clients': {}, 'tickets': set(), 'rows': 0,
                               'name': '', 'unavail': 0, 'avail': 0,
                               'last': None, 'first': None})
    for r in rows:
        a = agg[r['sku']]
        a['rows']    += 1
        a['name']     = a['name'] or r['name']
        a['tickets'].add(r['ticket'])
        a['last']     = max(a['last'], r['date']) if a['last'] else r['date']
        a['first']    = min(a['first'], r['date']) if a['first'] else r['date']
        a['unavail'] += r['state'] == 'unavailable'
        a['avail']   += r['state'] == 'available'
        if r['client']:
            w = 2 if r['age'] <= RECENT else 1
            a['clients'][r['client']] = max(a['clients'].get(r['client'], 0), w)
    out = []
    for sku, a in agg.items():
        out.append({
            'sku': sku, 'name': a['name'],
            'clients': len(a['clients']),
            'tickets': len(a['tickets']),
            'rows': a['rows'],
            'demand': sum(a['clients'].values()),
            'sellable': a['avail'] > 0 and a['unavail'] == 0,
            'unavail_hits': a['unavail'],
            'avail_hits': a['avail'],
            'last_seen': a['last'].strftime('%Y-%m-%d'),
            'first_seen': a['first'].strftime('%Y-%m-%d'),
            # first asked for inside the last 7 days => genuinely new interest
            'is_new': (TODAY - a['first']).days <= RECENT,
        })
    out.sort(key=lambda x: (-x['demand'], -x['clients'], x['sku']))
    return out

# ---------------------------------------------------------------- outputs

def enrich(items):
    cat = json.load(open(CATALOG))
    for it in items:
        c = cat.get(it['sku'], {})
        it['country'] = c.get('c'); it['price'] = c.get('sp')
        it['in_catalog'] = it['sku'] in cat
    return items

def pick_premium(qualified, catalog_price, floor=PREMIUM_FLOOR, share=0.20):
    """
    The benchmark band. Every bottle here was GENUINELY checked by a real
    client — we only filter the same demand list on price. Nothing is seeded,
    so nothing on the page claims something untrue.
    Returns (premium, standard) sized so premium is ~`share` of the total.
    """
    prem = [i for i in qualified if (catalog_price.get(i['sku']) or 0) >= floor]
    std  = [i for i in qualified if i not in prem]
    cap  = max(1, round(len(qualified) * share))
    return prem[:cap], std

def report():
    rows, skipped = load()
    scored = score(rows)

    qualified = [s for s in scored if s['clients'] >= MIN_CLIENTS and s['sellable']]
    unmet     = [s for s in scored if s['unavail_hits'] > 0]
    thin      = [s for s in scored if s['clients'] < MIN_CLIENTS]

    print(f"window           {WINDOW}d to {TODAY:%Y-%m-%d}  (last {RECENT}d weighted x2)")
    print(f"rows in window   {len(rows)}   skipped {dict(skipped)}")
    print(f"distinct SKUs    {len(scored)}")
    print(f"qualified        {len(qualified)}   (>= {MIN_CLIENTS} distinct clients, sellable)")
    print(f"below threshold  {len(thin)}   (single-client asks — correctly excluded)")
    print(f"unmet demand     {len(unmet)}   (OOS/catalog — internal report, not the page)")

    print(f"\n-- what the ranking would publish (top 12 by demand) --")
    print(f"{'sku':<12} {'cl':>3} {'tk':>3} {'rw':>3} {'sc':>3}  name")
    for s in qualified[:12]:
        print(f"{s['sku']:<12} {s['clients']:>3} {s['tickets']:>3} "
              f"{s['rows']:>3} {s['demand']:>3}  {s['name'][:44]}")

    print(f"\n-- the dedup working: biggest row counts vs their client counts --")
    for s in sorted(scored, key=lambda x: -x['rows'])[:6]:
        flag = 'PUBLISHED' if s in qualified else 'held back'
        print(f"{s['sku']:<12} rows={s['rows']:<3} tickets={s['tickets']:<3} "
              f"clients={s['clients']:<3} -> {flag:<10} {s['name'][:34]}")

    print(f"\n-- unmet demand, for the buying team (top 8) --")
    for s in sorted(unmet, key=lambda x: -x['clients'])[:8]:
        print(f"{s['sku']:<12} clients={s['clients']}  {s['name'][:50]}")

    return qualified, unmet

if __name__ == '__main__':
    report()
