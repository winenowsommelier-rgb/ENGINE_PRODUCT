#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
refresh.py — pull every feed, rebuild every page, verify, in one command.

This is the script a cron entry runs. Everything it does was, until now, me
running queries by hand in a chat session and pasting the results into files.
That is the manual step this removes.

    ./refresh.py                 pull, rebuild, verify
    ./refresh.py --offline       rebuild from the files already on disk
    ./refresh.py --pull-only     refresh the data files, do not build
    ./refresh.py --dry-run       report what would change, write nothing

WHERE IT RUNS
  Not in the Claude sandbox — that has no route to Supabase, which is why the
  data files exist as files at all. It needs a host with network access and:

    export DATABASE_URL='postgresql://...@db.dsyplzckfezcxiuikkfm.supabase.co:5432/postgres'
    export STOCK_CHECKS_CSV='https://docs.google.com/.../pub?gid=...&single=true&output=csv'
    pip install psycopg[binary]

  STOCK_CHECKS_CSV is optional. Set it to the File > Share > Publish to web CSV
  link for the Stock_Checks tab and the weekly manual export disappears. Without
  it the script uses whatever stock_checks.csv is already on disk and says so.

WHAT IT WILL NOT DO
  It will not paper over stale data. After pulling it rewrites feeds.json with
  the real timestamps, and the builds then gate themselves. If popularity is
  still frozen the best-seller pages refuse to build, and that refusal is the
  script working correctly — not a bug to route around with WNLQ9_ALLOW_STALE
  in the cron line.
"""
import argparse, csv, datetime, hashlib, io, json, os, re, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SQL  = os.path.join(HERE, 'sql')
# Where the built pages land. Must agree with build5.OUT / unmet.OUT, or verify
# reads an empty directory and proves nothing. One env var keeps them in step.
OUT  = os.environ.get('WNLQ9_OUT', os.path.join(HERE, 'out'))
DB   = os.environ.get('DATABASE_URL', '')
SHEET   = os.environ.get('STOCK_CHECKS_CSV', '')
MREPORT = os.environ.get('MREPORT_CSV', '')


def sheet_csv(url, gid=None):
    """Turn a Google Sheets link into a CSV endpoint a script can read.

    The point of this function: the interface should be "paste the link", the
    same way it works in a chat. Paste an /edit link and this builds the export
    URL for the tab.

        https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing
          -> https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>

    Two things this does NOT solve, and pretending otherwise would waste a day:

    · The sheet must be readable without a login. A link with ?usp=sharing is
      usually already set to "anyone with the link can view", in which case this
      works with no credentials at all. If it is restricted to named accounts,
      the export returns Google's sign-in HTML instead of CSV — the parser will
      see zero rows and stop rather than overwrite good data.
    · gid identifies the TAB. Without it Google exports the first tab, which on
      DATA: WNLQ9 Performance is 'SKU Read', not the report we want. Open the
      tab and copy the #gid= number out of the address bar.
    """
    m = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url or '')
    if not m:
        return url
    base = f'https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv'
    if gid is None:
        g = re.search(r'[#&?]gid=(\d+)', url or '')
        gid = g.group(1) if g else None
    return base + (f'&gid={gid}' if gid else '')


# Paste links here (or set the env vars). A link with a #gid= on the end is
# enough — the tab number comes out of it.
if SHEET:
    SHEET = sheet_csv(SHEET, os.environ.get('STOCK_CHECKS_GID'))
if MREPORT:
    MREPORT = sheet_csv(MREPORT, os.environ.get('MREPORT_GID'))

SITES = (('WN', 'W%', 'wn'), ('LQ', 'L%', 'lq'))


def log(msg):
    print(f'  {msg}', flush=True)


def sql(name):
    return open(os.path.join(SQL, name), encoding='utf-8').read()


def digest(path):
    if not os.path.exists(path):
        return None
    return hashlib.md5(open(path, 'rb').read()).hexdigest()[:8]


def write(path, lines, dry):
    """Write only when the content actually changed, and say which."""
    body = '\n'.join(lines).rstrip('\n') + '\n'
    before = digest(path)
    if dry:
        after = hashlib.md5(body.encode()).hexdigest()[:8]
        log(f'{os.path.basename(path):<22} {before} -> {after} '
            f'{"(unchanged)" if before == after else "(WOULD CHANGE)"}')
        return before != after
    tmp = path + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(body)
    os.replace(tmp, path)
    after = digest(path)
    log(f'{os.path.basename(path):<22} {len(lines):>5} rows  '
        f'{"unchanged" if before == after else "CHANGED"}')
    return before != after


# ----------------------------------------------------------------- database

def connect():
    if not DB:
        sys.exit('DATABASE_URL is not set. See the docstring at the top of this file.')
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg is not installed:  pip install "psycopg[binary]"')
    return psycopg.connect(DB, connect_timeout=20)


def rows(cur, query, params=None):
    cur.execute(query, params or {})
    return cur.fetchall()


# ------------------------------------------------------------------- feeds

def pull(dry=False):
    changed = {}
    # order data first — the ranking depends on it
    changed['mreport'] = pull_mreport(dry)
    with connect() as conn, conn.cursor() as cur:

        # 1. product URLs and images
        lines = [r[0] for r in rows(cur, sql('01_links.sql'))]
        header = [f'# generated: {datetime.date.today().isoformat()}  '
                  f'source: supabase  rows: {len(lines)}',
                  '# format: sku|slug|image']
        changed['links'] = write(os.path.join(HERE, 'links_cache.tsv'),
                                 header + lines, dry)

        # 2. best-seller ranking.
        #
        # Ranked in Python from real order data, not in SQL from
        # products.popularity_qty_90d. That column is frozen at 21 July with no
        # job behind it; MReport Item Performance is refreshed weekly and holds
        # actual orders. If the MReport feed has not been pulled the old SQL
        # path still runs, so a half-configured install degrades rather than
        # breaks — but it degrades to a July ranking, and says so.
        import mreport
        orders, wlabel = mreport.load_cache()
        rank_lines, skus = [], set()
        if orders:
            attrs = {r[0]: {'name': r[1], 'price': r[2], 'country': r[3],
                            'margin': r[4], 'score': r[5], 'catalog_only': r[6]}
                     for r in rows(cur, sql('07_attrs.sql'))}
            rank_lines = mreport.rank(orders, attrs)
            log(f'ranking                 real orders, window {wlabel}, '
                f'{len(orders)} SKUs sold')
        else:
            log('ranking                 FALLING BACK to products.popularity_qty_90d '
                '(frozen 21 Jul). Set MREPORT_CSV to fix this.')
            for site, prefix, tag in SITES:
                got = rows(cur, sql('02_bestsellers.sql'), {'prefix': prefix})
                by_seg = {}
                for lens, seg, rk, sku in got:
                    by_seg.setdefault((lens, seg), []).append((rk, sku))
                for (lens, seg), rs in sorted(by_seg.items()):
                    rank_lines.append(f'{tag}|{lens}|{seg}|'
                                      + ','.join(s for _, s in sorted(rs)))
            rank_lines += combined_rows(rank_lines)
        for line in rank_lines:
            skus.update(line.split('|', 3)[3].split(','))
        changed['rank'] = write(os.path.join(HERE, 'bs_rank.tsv'),
                                ['# site|lens|segment|sku,sku,...  (rank order, 20 deep)']
                                + rank_lines, dry)

        skus = sorted(skus)
        for site, prefix, tag in SITES:
            mine = [s for s in skus if s.startswith(prefix[0])]
            lines = [r[0] for r in rows(cur, sql('03_prod.sql'), {'skus': mine})]
            changed[f'prod_{tag}'] = write(
                os.path.join(HERE, f'bs_prod_{tag}.tsv'),
                ['# sku~name~price~special~country~style~reputation~vintage~score~critic']
                + lines, dry)

        # 3. story line and 4. gauges, for everything any page can render
        wanted = sorted(set(skus) | trending_skus())
        lines = [r[0] for r in rows(cur, sql('04_story.sql'), {'skus': wanted})]
        changed['story'] = write(os.path.join(HERE, 'bs_story.tsv'),
                                 ['# sku~region~designation~top_sales_pct~top_critic_pct']
                                 + lines, dry)

        lines = [r[0] for r in rows(cur, sql('05_gauge.sql'), {'skus': wanted})]
        changed['gauge'] = write(os.path.join(HERE, 'bs_gauge.tsv'),
                                 ['# sku~body~tannin~acidity~sweetness~peat  (1-5, 0 = absent)']
                                 + lines, dry)

        # 5. the freshness stamps
        f = rows(cur, sql('06_freshness.sql'))[0]
        stamp_feeds(f, dry)

    changed['stock_checks'] = pull_stock_checks(dry)
    return changed


def pull_mreport(dry):
    """Real order data — the source best sellers should rank on.

    This is the 'MReport Item Performance' tab of DATA: WNLQ9 Performance,
    monthly orders and quantity per SKU back to January 2023, refreshed weekly,
    and the same data the BI API serves. It replaces products.popularity_qty_90d,
    which has been frozen since 21 July with no job behind it.
    """
    import mreport
    if not MREPORT:
        log('mreport                 MREPORT_CSV not set — best sellers still rank on '
            'the frozen Supabase popularity columns. This is the one that matters.')
        return False
    with urllib.request.urlopen(MREPORT, timeout=90) as r:
        text = r.read().decode('utf-8-sig')
    rows, bad = mreport.parse(text)
    if not rows:
        head = text.split('\n', 1)[0][:200]
        sys.exit('MReport export parsed to zero rows. Not overwriting the file on disk.\n'
                 f'  first line was: {head}\n'
                 '  Expected: YEAR, MONTH, SKU, Product Name, Orders, Qty Ordered, ...\n'
                 '  If that looks like a different tab, open the MReport Item Performance\n'
                 '  tab, copy the #gid= number from the address bar, and set MREPORT_GID.\n'
                 '  If it looks like HTML, the sheet is not link-readable — open sharing\n'
                 '  to "anyone with the link can view".')
    agg, label = mreport.window(rows)
    if not agg:
        sys.exit('MReport has no complete month before today. Not overwriting.')
    if dry:
        log(f'mreport                 would write {len(agg)} SKUs, window {label}')
        return True
    n, label = mreport.write_cache(agg, label)
    log(f'mreport.tsv             {n} SKUs over {label}'
        + (f'  ({bad} unparseable rows skipped)' if bad else ''))
    # the ranking is now as fresh as this sheet, so say so
    path = os.path.join(HERE, 'feeds.json')
    doc = json.load(open(path, encoding='utf-8'))
    doc['feeds']['popularity']['as_of'] = datetime.date.today().isoformat()
    doc['feeds']['popularity']['source'] = (
        f'MReport Item Performance ({label}, {n} SKUs) — real orders, not '
        f'products.popularity_qty_90d')
    json.dump(doc, open(path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    return True


def combined_rows(site_lines):
    """Derive the 'all' rows from the per-site ones."""
    merged = {}
    for line in site_lines:
        tag, lens, seg, skus = line.split('|', 3)
        if lens == 'country':
            continue                     # the combined page has no country lens
        merged.setdefault((lens, seg), []).extend(skus.split(','))
    out = []
    for (lens, seg), skus in sorted(merged.items()):
        seen, keep = set(), []
        for s in skus:
            if s not in seen:
                seen.add(s)
                keep.append(s)
        out.append(f'all|{lens}|{seg}|' + ','.join(keep[:20]))
    return out


def trending_skus():
    """Every SKU the demand feed mentions, so story and gauge cover it too."""
    path = os.path.join(HERE, 'stock_checks.csv')
    if not os.path.exists(path):
        return set()
    return {r['sku'].strip() for r in csv.DictReader(open(path, encoding='utf-8'))
            if r.get('sku', '').strip()}


def pull_stock_checks(dry):
    """The demand feed. A published-CSV link removes the weekly manual export."""
    if not SHEET:
        log('stock_checks.csv        STOCK_CHECKS_CSV not set — using the file on disk. '
            'This is the one feed still refreshed by hand.')
        return False
    with urllib.request.urlopen(SHEET, timeout=45) as r:
        body = r.read().decode('utf-8-sig')
    got = list(csv.DictReader(io.StringIO(body)))
    if not got:
        sys.exit('Stock_Checks export came back empty. Not overwriting the file on disk.')

    # The sheet's own headers are not the pipeline's. Map them, and fail loudly
    # if the sheet has been re-columned rather than silently writing a file the
    # rest of the pipeline cannot read.
    #
    # Note on parsing: item names in this sheet contain unquoted-looking commas
    # ("Chateau Grand Corbin, Saint-Emilion ..."). csv.DictReader handles them
    # correctly as long as the source is a real CSV export — Google quotes the
    # field. A hand-saved or copy-pasted CSV may not, which is exactly how the
    # product-URL export ended up with 14 broken rows. Prefer the published-CSV
    # link over anything a person saves by hand.
    COLS = {'ticket': 'Ticket ID', 'date': 'Timestamp', 'sku': 'SKU',
            'name': 'Item Name', 'qty': 'QTY', 'stock': 'Stock Status',
            'client': 'Client Name'}
    have = set(got[0].keys())
    missing = {v for v in COLS.values() if v not in have}
    if missing:
        sys.exit(f'Stock_Checks sheet is missing columns: {sorted(missing)}.\n'
                 f'It has: {sorted(have)}\n'
                 f'If those are a different tab\'s headers, set STOCK_CHECKS_GID to the\n'
                 f'#gid= of the ticket line-item tab.\n'
                 f'Fix the mapping in refresh.py COLS rather than the sheet, if the '
                 f'sheet changed on purpose. Not overwriting the good file on disk.')

    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=list(COLS.keys()))
    w.writeheader()
    kept = 0
    for r in got:
        sku = (r.get(COLS['sku']) or '').strip()
        if not sku or sku == '-':          # a ticket line for a product we do not list
            continue
        w.writerow({k: (r.get(v) or '').strip() for k, v in COLS.items()})
        kept += 1
    log(f'stock_checks            {kept} usable lines of {len(got)} in the sheet')
    return write(os.path.join(HERE, 'stock_checks.csv'),
                 out.getvalue().rstrip('\n').split('\n'), dry)


def stamp_feeds(f, dry):
    """Rewrite feeds.json from what the database actually reports.

    The thresholds and severities are kept; only the dates move. That matters —
    if this function also relaxed the limits, the gate would congratulate itself
    every week instead of catching anything.
    """
    (pop_as_of, pop_stamped, prod_as_of, prod_stamped,
     cat_as_of, active, with_stock) = f
    path = os.path.join(HERE, 'feeds.json')
    doc = json.load(open(path, encoding='utf-8'))
    d = lambda x: (x.date().isoformat() if hasattr(x, 'date')
                   else str(x)[:10] if x else '1970-01-01')

    doc['feeds']['popularity']['as_of'] = d(pop_as_of)
    doc['feeds']['popularity']['source'] = (
        f'Supabase products.popularity_qty_90d / _orders_90d '
        f'(popularity_synced_at set on {pop_stamped} of {active} rows)')
    doc['feeds']['catalog']['as_of'] = d(cat_as_of)
    doc['feeds']['catalog']['source'] = (
        f'Supabase products (max updated_at; synced_at is {d(prod_as_of)} '
        f'on {prod_stamped} of {active} rows)')
    doc['feeds']['links']['as_of'] = datetime.date.today().isoformat()

    sc = os.path.join(HERE, 'stock_checks.csv')
    if os.path.exists(sc):
        dates = []
        for r in csv.DictReader(open(sc, encoding='utf-8')):
            try:
                m, dd, y = r['date'].strip().split('/')
                dates.append(datetime.date(int(y), int(m), int(dd)))
            except Exception:
                pass
        if dates:
            doc['feeds']['stock_checks']['as_of'] = max(dates).isoformat()

    if dry:
        log('feeds.json              would be restamped')
        return
    json.dump(doc, open(path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
    log(f'feeds.json              restamped  (popularity {d(pop_as_of)}, '
        f'{pop_stamped}/{active} rows carry a sync stamp)')
    if with_stock == 0:
        log('NOTE  quantity_in_stock is 0 on every active product. The ticket '
            'sheet is still the only real stock figure.')


# ------------------------------------------------------------------ builds

def build():
    steps = [('prep3.py',     'demand scores'),
             ('build5.py',    'wine.html + liquor.html'),
             ('build6.py',    'wnlq9.html'),
             ('unmet.py',     'internal unmet-demand report')]
    failed = []
    for script, what in steps:
        print(f'\n== {script}  ({what})', flush=True)
        r = subprocess.run([sys.executable, os.path.join(HERE, script)],
                           cwd=HERE, capture_output=True, text=True)
        sys.stdout.write(r.stdout)
        if r.returncode == 2:
            # the freshness gate stopped it. Not an error — the intended outcome
            # when a feed is older than the page would imply.
            failed.append((script, 'stale feed'))
        elif r.returncode:
            sys.stderr.write(r.stderr)
            failed.append((script, f'exit {r.returncode}'))
    return failed


def verify():
    print('\n== verify.py', flush=True)
    r = subprocess.run([sys.executable, os.path.join(HERE, 'verify.py'), OUT],
                       cwd=HERE, capture_output=True, text=True)
    sys.stdout.write(r.stdout)
    if r.returncode:
        sys.stderr.write(r.stderr)
        return False
    # Trust the exit code, but still refuse a vacuous pass: "0/0 checks passing"
    # satisfies passed==total while proving nothing.
    m = re.search(r'(\d+)/(\d+) checks passing', r.stdout)
    if not m:
        return False
    npass, ntotal = int(m.group(1)), int(m.group(2))
    return ntotal > 0 and npass == ntotal


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='skip the pull')
    ap.add_argument('--pull-only', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    print(f'WNLQ9 refresh — {datetime.datetime.now():%Y-%m-%d %H:%M}')
    if not a.offline:
        print('\n== pull')
        pull(dry=a.dry_run)
    if a.pull_only or a.dry_run:
        return 0

    failed = build()
    ok = verify()

    print('\n== summary')
    if failed:
        for s, why in failed:
            log(f'{s}: {why}')
        log('A stale-feed stop means the data behind those pages is older than '
            'the pages would imply. Fix the feed. Do not add WNLQ9_ALLOW_STALE '
            'to the cron line — that turns the alarm off, not the problem.')
    log('verification passed' if ok else 'VERIFICATION FAILED — do not publish')
    return 0 if (ok and not failed) else 1


if __name__ == '__main__':
    sys.exit(main())
