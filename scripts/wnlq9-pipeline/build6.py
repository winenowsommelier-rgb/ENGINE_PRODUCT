# -*- coding: utf-8 -*-
"""
build6.py — wnlq9.html, the combined store.

Both catalogs in one page. The navigation problem this solves: 13 product
types in a single rail is unusable on a phone, so a brand control filters
WHICH type chips are shown — ทั้งหมด 13, ไวน์ 5, สุรา 8. The chips themselves
never change meaning, only how many are on screen.

Reuses the helpers, design system and data rules from build5 unchanged.
"""
import csv, json, os, re, sys
sys.path.insert(0, os.environ.get(
    'WNLQ9_CLR', os.path.dirname(os.path.abspath(__file__))))
import build5 as B
import prep3

CLR, OUT = B.CLR, B.OUT
TYPES = B.TYPES
WINE_TYPES = ['red', 'white', 'sparkling', 'rose', 'dessert']
SPIRIT_TYPES = ['whisky', 'gin', 'rum', 'agave', 'liqueur', 'brandy', 'vodka', 'sake']

two, esc, baht = B.two, B.esc, B.baht
LIVE = {'WN': 'https://sites.google.com/view/wine-now-trending/home',
        'LQ': 'https://sites.google.com/view/liq9-trending/home'}

def brand_of(sku):
    return 'WN' if sku[:1] == 'W' else 'LQ'

# ---------------------------------------------------------------- trending

def combined_trending():
    cat = json.load(open(CLR + 'cat_trending.json'))
    cat.update(json.load(open(CLR + 'cat_fill.json')))
    cat.update(json.load(open(CLR + 'cat_types.json')))
    cat.update(json.load(open(CLR + 'cat_more.json')))
    scored = prep3.score(prep3.load()[0])
    score_of = {x['sku']: x for x in scored}

    core = [x for x in scored if x['sellable'] and x['clients'] >= 2 and x['sku'] in cat]
    core.sort(key=lambda x: (-x['demand'], -x['clients']))
    have = {x['sku'] for x in core}
    fill = [x for x in scored if x['sellable'] and x['sku'] not in have and x['sku'] in cat]
    fill.sort(key=lambda x: (-B.stock_tier(x['sku']),
                             -(cat[x['sku']].get('sp') or cat[x['sku']]['p']),
                             -x['demand']))

    pooled = [(x, True) for x in core] + [(x, False) for x in fill]
    pooled, dropped = B.dedupe(pooled,
                               key=lambda p: (p[0]['sku'], cat[p[0]['sku']]['n']),
                               pop=lambda p: p[0]['demand'])
    pooled, capped = B.cap_producers(pooled, cat)
    # alternate brands near the top so the combined list does not open all-wine
    wn = [p for p in pooled if brand_of(p[0]['sku']) == 'WN']
    lq = [p for p in pooled if brand_of(p[0]['sku']) == 'LQ']
    seq, i = [], 0
    while len(seq) < B.LIST_SIZE and (wn or lq):
        src = wn if (i % 2 == 0 and wn) or not lq else lq
        seq.append(src.pop(0)); i += 1

    n_new = sum(1 for x, _ in seq if x.get('is_new'))
    if n_new > len(seq) * 0.5:
        for x, _ in seq:
            x['is_new'] = False

    icons = {x['sku'] for x, _ in seq
             if (cat[x['sku']].get('sp') or cat[x['sku']]['p']) >= B.PREMIUM_FLOOR}
    rows = ''.join(
        B.trend_row(x['sku'], cat[x['sku']], x, brand_of(x['sku']), i + 1,
                    x['sku'] in icons, is_core).replace(
            '<li class="row"', f'<li class="row" data-b="{brand_of(x["sku"])}"')
        for i, (x, is_core) in enumerate(seq))

    by_type = json.load(open(CLR + 'trend_types.json'))
    # same top-up source build5 uses: the best-seller ranking for that type,
    # so a thin demand pool still fills a 20-row tab without inventing demand
    import bsdata
    bs_topup = {k: [r[2] for r in v]
                for k, v in bsdata.rows_for('all', B.BS_DEPTH).get('type', {}).items()}
    tsecs, ttabs = '', ''
    for tk, skus in by_type.items():
        if tk not in TYPES:
            continue
        keep = [s for s in skus if s in cat and s in score_of]
        keep, _ = B.dedupe(keep, key=lambda s: (s, cat[s]['n']),
                           pop=lambda s: score_of[s]['demand'])
        if len(keep) < 3:
            continue
        bg = 'WN' if tk in WINE_TYPES else 'LQ'
        ttabs += (f'<button type="button" class="tab ttab" data-k="{tk}" data-b="{bg}" '
                  f'aria-pressed="false">{two(*TYPES[tk])}</button>')
        # producer cap across the whole tab — see the note in build5
        used = B.brand_count()
        keep = [s for s in keep if used(B.brand_of_sku(s, cat))][:B.TYPE_DEPTH]
        topup, seen = [], set(keep)
        for sk in bs_topup.get(tk, []):
            if len(keep) + len(topup) >= B.TYPE_DEPTH:
                break
            if sk in seen or sk not in bsdata.products():
                continue
            if not used(B.brand_of_sku(sk, cat,
                                       (bsdata.products()[sk] or {}).get('name', ''))):
                continue
            seen.add(sk)
            topup.append(sk)
        li = ''.join(
            B.trend_row(s, cat[s], score_of[s], brand_of(s), n + 1,
                        (cat[s].get('sp') or cat[s]['p']) >= B.PREMIUM_FLOOR,
                        score_of[s]['clients'] >= 2)
            for n, s in enumerate(keep))
        if topup:
            li += ('<li class="divider">' + two(
                     'จากนี้คือรายการขายดีในหมวดเดียวกัน ไม่ใช่รายการที่ลูกค้าถามหาในรอบนี้',
                     'From here down: best sellers in the same category, '
                     'not bottles asked for in this period.') + '</li>')
            li += ''.join(B.bs_topup_row(s, bsdata.products()[s], brand_of(s),
                                         len(keep) + n + 1)
                          for n, s in enumerate(topup))
        tsecs += (f'<section class="tsec" data-k="{tk}">'
                  f'<p class="seghead">{two(*TYPES[tk])}</p><ul class="list">{li}</ul></section>')
    return rows, ttabs, tsecs, len(seq), len(icons), dropped, capped

# ---------------------------------------------------------------- best sellers

def best_sellers():
    import bsdata
    fresh = bsdata.rows_for('all', B.BS_DEPTH)
    segs = {'band': {}, 'type': {}}
    if fresh:
        # a segment only appears once both catalogs behind it have been
        # refreshed onto bs_rank.tsv; the rest fall back below
        for lk in ('band', 'type'):
            segs[lk] = fresh.get(lk, {})
    rows = [r for r in csv.reader(open(CLR + 'bs2_all.tsv', encoding='utf-8'),
                                  delimiter='~') if r]
    done = {(lk, seg) for lk in segs for seg in segs[lk]}   # decide BEFORE appending,
    for r in rows:                                          # or row 1 blocks rows 2-10
        if (r[0], r[1]) not in done:
            segs[r[0]].setdefault(r[1], []).append(r[1:])

    label = lambda k: two(*B.BANDS[k]) if k in B.BANDS else two(*TYPES[k])
    order = ['b1', 'b2', 'b3', 'b4', 'b5']
    torder = [t for t in WINE_TYPES + SPIRIT_TYPES if t in segs['type']]

    rails, body, first = '', '', True
    for lens, keys in (('band', order), ('type', torder)):
        chips = ''
        for j, k in enumerate(keys):
            bg = 'WN' if k in WINE_TYPES else ('LQ' if k in SPIRIT_TYPES else 'all')
            on = 'true' if (lens == 'band' and j == 0) else 'false'
            chips += (f'<button type="button" class="tab" data-k="{lens}:{k}" '
                      f'data-b="{bg}" aria-pressed="{on}">{label(k)}</button>')
            lis = ''.join(B.bs_row(r, brand_of(r[2]), k, n + 1)
                          for n, r in enumerate(segs[lens][k]))
            cls = ' on' if first else ''
            first = False
            body += (f'<section class="seg{cls}" data-k="{lens}:{k}">'
                     f'<p class="seghead">{label(k)}</p><ul class="list">{lis}</ul></section>')
        rails += (f'<div class="rail lensrail{" on" if lens == "band" else ""}" '
                  f'data-l="{lens}">{chips}</div>')
    # count what was actually rendered, not the raw fallback file: with the
    # 20-deep data in place len(rows) reports the old bs2_all.tsv length
    n_rows = sum(len(v) for lk in segs for v in segs[lk].values())
    n_seg  = sum(len(segs[lk]) for lk in segs)
    return rails, body, n_rows, n_seg

# ---------------------------------------------------------------- page

EXTRA_CSS = '''
.brandbar{display:flex;gap:0;border:1px solid #111110;width:fit-content;max-width:100%;margin:0 0 9px}
.bfil{min-height:44px;padding:0 16px;background:none;border:0;border-right:1px solid #111110;
 font:500 13px/1 inherit;color:#111110;white-space:nowrap}
.bfil:last-child{border-right:0}
.bfil[aria-pressed=true]{background:#111110;color:#fff}
.tab[hidden],.row[hidden],.brandbar[hidden]{display:none}
.tag{display:inline-flex;align-items:center;font-size:12px;letter-spacing:.1em;
 text-transform:uppercase;color:#6E6A63;border:1px solid #E5E2DA;padding:2px 6px;margin-left:8px}
.storenote{font-size:13px;color:#4C4A45;margin-top:8px}
'''

EXTRA_JS = '''
 // brand filter: narrows which type chips and which combined rows are shown.
 // 13 type chips in one rail is unusable on a phone; 5 or 8 is fine.
 var brand='all';
 function applyBrand(){
  d.querySelectorAll('.tab[data-b]').forEach(function(t){
   t.hidden = !(brand==='all' || t.dataset.b===brand || t.dataset.b==='all');
  });
  d.querySelectorAll('.tsec[data-k="all"] .row[data-b]').forEach(function(r){
   r.hidden = !(brand==='all' || r.dataset.b===brand);
  });
  // if the open segment's chip is now hidden, fall back to the first visible one
  ['.tab:not(.ttab)','.ttab'].forEach(function(sel){
   var cur=d.querySelector(sel+'[aria-pressed="true"]');
   if(cur && cur.hidden){
    var vis=[].slice.call(d.querySelectorAll(sel)).filter(function(x){return !x.hidden;})[0];
    if(vis) vis.click();
   }
  });
 }
 d.querySelectorAll('.bfil').forEach(function(b){
  b.addEventListener('click',function(){
   brand=b.dataset.v;
   d.querySelectorAll('.bfil').forEach(function(x){
    x.setAttribute('aria-pressed',String(x===b));});
   applyBrand();
  });
 });
 applyBrand();

 // The price-band lens ranks wine and spirits together, so the brand filter has
 // nothing to act on there — hide it rather than leave a dead control on screen.
 // Per-brand band rankings live on the wine and spirits pages.
 function syncBrandBar(){
  var L=d.querySelector('.lens[aria-pressed="true"]');
  var bb=d.querySelector('.brandbar.bb2');
  if(bb) bb.hidden = !L || L.dataset.l!=='type';
 }
 d.querySelectorAll('.lens').forEach(function(L){
  L.addEventListener('click',syncBrandBar);
 });
 syncBrandBar();
'''

def build():
    trows, ttabs, tsecs, n_tr, n_ic, dropped, capped = combined_trending()
    rails, bbody, n_rows, n_seg = best_sellers()

    css = B.CSS + EXTRA_CSS
    # Splice EXTRA_JS inside build5's IIFE. Match the closing sequence explicitly —
    # a character-count slice silently ate one brace here and killed every listener.
    tail = '})();'
    base = B.JS.rstrip()
    assert base.endswith(tail), 'build5.JS no longer ends with the IIFE close'
    js = base[:-len(tail)] + EXTRA_JS + tail

    brandbar = (f'<div class="brandbar" role="group">'
                f'<button type="button" class="bfil" data-v="all" aria-pressed="true">'
                f'{two("ทั้งหมด", "All")}</button>'
                f'<button type="button" class="bfil" data-v="WN" aria-pressed="false">'
                f'{two("ไวน์", "Wine")}</button>'
                f'<button type="button" class="bfil" data-v="LQ" aria-pressed="false">'
                f'{two("สุรา", "Spirits")}</button></div>')

    lens_tabs = ''.join(
        f'<button type="button" class="lens" data-l="{lk}" '
        f'aria-pressed="{"true" if i == 0 else "false"}">{two(th, en)}</button>'
        for i, (lk, th, en) in enumerate([('band', 'ช่วงราคา', 'Price'),
                                          ('type', 'ประเภท', 'Type')]))

    import explorer, bsdata
    ecat = json.load(open(CLR + 'cat_all.json'))
    used_e = B.brand_count()
    picked = {'W': [], 'L': []}
    for pref in ('W', 'L'):
        for sku, reason, nth, nen in explorer.candidates(
                pref, bsdata.products(), bsdata.stories(), lambda s: B.STOCK.get(s, 0)):
            c = bsdata.products().get(sku)
            if not c:
                continue
            picked[pref].append((sku, reason, nth, nen, c))
    # interleave wine and spirits so the combined shelf opens mixed
    erows, i, n_exp = [], 0, 0
    while n_exp < explorer.DEPTH and (picked['W'] or picked['L']):
        src = picked['W'] if (i % 2 == 0 and picked['W']) or not picked['L'] else picked['L']
        sku, reason, nth, nen, c = src.pop(0)
        i += 1
        if not used_e(B.brand_of_sku(sku, ecat, c.get('name', ''))):
            continue
        n_exp += 1
        erows.append(B.explorer_row(sku, c, brand_of(sku), n_exp, reason, nth, nen))
    ebody = ''.join(erows)

    doc = f'''<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>WNLQ9 — ไวน์และสุรา มาแรงและขายดี · Wine &amp; spirits trending &amp; best sellers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Noto+Serif+Thai:wght@400;500&display=swap" rel="stylesheet">
<style>{css}</style></head><body>

<header class="top"><div class="wrap topin">
 <p class="mark">WNLQ9</p>
 <div class="right">
  <a class="swap" href="{LIVE['WN']}" target="_blank" rel="noopener">{two('ไวน์', 'Wine')} &rsaquo;</a>
  <a class="swap" href="{LIVE['LQ']}" target="_blank" rel="noopener">{two('สุรา', 'Spirits')} &rsaquo;</a>
  <div class="lang"><button type="button" data-l="th" aria-pressed="true">ไทย</button>
  <button type="button" data-l="en" aria-pressed="false">EN</button></div>
 </div>
</div></header>

<div class="views"><div class="wrap in">
 <button type="button" data-v="t" aria-pressed="true">{two('มาแรง', 'Trending')}</button>
 <button type="button" data-v="b" aria-pressed="false">{two('ขายดี', 'Best sellers')}</button>
 <button type="button" data-v="e" aria-pressed="false">{two('น่าค้นหา', 'Explorer')}</button>
</div></div>

<main>
<section class="view on" data-v="t">
 <div class="wrap"><div class="hero">
  <p class="kicker">{two('30 วันล่าสุด · ไวน์และสุรารวมกัน', 'Last 30 days · wine and spirits together')}</p>
  <h1>{two('ที่ลูกค้าถามหามากที่สุด', 'What customers keep asking for')}</h1>
  <p class="lede">{two(
    'รวมไวน์และสุราไว้ในที่เดียว อันดับมาจากสิ่งที่ลูกค้าถามหาจริงผ่านทีมขายของเรา '
    'ในรอบ 30 วันล่าสุด เลือกดูเฉพาะไวน์หรือสุราได้จากปุ่มด้านล่าง',
    'Wine and spirits in one place, ranked on what customers actually asked our team for '
    'over the last 30 days. Use the buttons below to narrow to one or the other.')}</p>
 </div>
 {brandbar}
 </div>
 <div class="segbar"><div class="wrap"><div class="rail">
  <button type="button" class="tab ttab" data-k="all" data-b="all" aria-pressed="true">{two('ทั้งหมด', 'All')}</button>
  {ttabs}</div></div></div>
 <div class="wrap">
  <section class="tsec on" data-k="all"><ul class="list">{trows}</ul></section>
  {tsecs}
 </div>
</section>

<section class="view" data-v="b">
 <div class="wrap"><div class="hero">
  <p class="kicker">{two('ขายดีที่สุดในร้าน', 'Best sellers')}</p>
  <h1>{two('ไวน์และสุราขายดี', 'Wine &amp; spirits best sellers')}</h1>
  <p class="lede">{two(
    'จัดอันดับจากยอดขายจริงของร้าน แยกตามช่วงราคาและประเภทสินค้า อันดับละ 10 รายการ '
    'ทั้งไวน์และสุราอยู่ในอันดับเดียวกัน',
    'Ranked on our own sales, split by price band and by product type, ten in each. '
    'Wine and spirits are ranked together.')}</p>
 </div></div>
 <div class="segbar"><div class="wrap">
  {brandbar.replace('brandbar', 'brandbar bb2')}
  <div class="lensrow">{lens_tabs}</div>{rails}
 </div></div>
 <div class="wrap">{bbody}</div>
</section>

<section class="view" data-v="e">
 <div class="wrap"><div class="hero">
  <p class="kicker">{two('คัดมาเล่า', 'Worth a mention')}</p>
  <h1>{two('ไวน์และสุราที่น่าค้นหา', 'Bottles worth exploring')}</h1>
  <p class="lede">{two(
    'ไม่ใช่อันดับขายดีและไม่ใช่รายการที่ถามหามากที่สุด แต่คือขวดที่มีเรื่องให้เล่า '
    'ทุกรายการบอกเหตุผลกำกับไว้ว่าทำไมถึงอยู่ในหน้านี้',
    'Not a sales ranking and not a demand list — bottles with something to say '
    'about them. Every one states the reason it is here.')}</p>
 </div></div>
 <div class="wrap"><ul class="list">{ebody}</ul></div>
</section>

<div class="wrap"><footer>
<p>{two('ราคาและจำนวนคงเหลือเป็นข้อมูล ณ วันที่จัดทำรายการ และอาจเปลี่ยนแปลงได้',
        'Prices and remaining quantities are correct as at the date this list was prepared and may change.')}</p>
<p>{two('คะแนนนักวิจารณ์ที่แสดงเป็นคะแนนของขวดและวินเทจนั้นโดยเฉพาะ พร้อมระบุชื่อผู้ให้คะแนน',
        'Any critic score shown belongs to that specific bottle and vintage, credited to the critic who gave it.')}</p>
<div class="fl"><a href="https://th.wine-now.com" target="_blank" rel="noopener">th.wine-now.com</a>
<a href="https://th.liq9.asia" target="_blank" rel="noopener">th.liq9.asia</a></div>
</footer></div>
</main><script>{js}</script></body></html>'''

    open(OUT + 'wnlq9.html', 'w', encoding='utf-8').write(doc)
    print(f'  wnlq9.html   {len(doc)/1024:>5.0f} KB')
    print(f'  trending     {n_tr} combined ({n_ic} icons, {dropped} variants deduped,'
          f' {capped} producer-capped)')
    print(f'  best sellers {n_seg} segments / {n_rows} rows  (5 bands + 13 types)')

if __name__ == '__main__':
    import sys, freshness
    try:
        freshness.check(['trending', 'bestsellers'])
    except freshness.StaleFeed as e:
        print(e); sys.exit(2)
    build()
