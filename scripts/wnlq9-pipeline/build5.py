# -*- coding: utf-8 -*-
"""
build5.py — one page per brand, both rankings on it.

  wine.html    trending (demand) + best sellers (sales), Wine-Now
  liquor.html  same, LIQ9

Replaces the four separate pages. Two Google Sites embeds instead of four.

RANK MOVEMENT
  Loaded from prev_ranks.json: {"WN": {"<segment>": {"<sku>": prev_rank}}}.
  The file is written by the weekly job in rank_snapshot_setup_v2.sql.
  When a segment has no previous snapshot, NOTHING renders — we never guess
  movement, and a first-published ranking is not "new entry" for every row.
"""
import csv, json, html, re, os, sys
import links
import freshness
import bsdata
import explorer

_HERE     = os.path.dirname(os.path.abspath(__file__))
CLR       = os.environ.get('WNLQ9_CLR', _HERE).rstrip('/') + '/'
OUT       = os.environ.get('WNLQ9_OUT', os.path.join(_HERE, 'out')).rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)
IMG       = 'https://th.wine-now.com/media/catalog/product/'
PREV_JSON = CLR + 'prev_ranks.json'
LOW_EXACT = 12
PREMIUM_FLOOR = 5000
LIST_SIZE = 50
BS_DEPTH  = 20      # best sellers per segment
TYPE_DEPTH = 20     # trending rows per type tab

BANDS = {'b1': ('ต่ำกว่า 1,500', 'Under ฿1,500'), 'b2': ('1,500–3,000', '฿1,500–3,000'),
         'b3': ('3,000–5,000', '฿3,000–5,000'),  'b4': ('5,000–10,000', '฿5,000–10,000'),
         'b5': ('10,000 ขึ้นไป', '฿10,000+')}

# live is the Google Sites page each file is embedded in. The cross-link MUST use
# the absolute Sites URL: a relative href resolves against the embed sandbox host,
# not the site, so it goes nowhere. Best-seller pages are retired — both rankings
# now live on these two.
TYPES = {
 'red':('ไวน์แดง','Red'), 'white':('ไวน์ขาว','White'), 'sparkling':('สปาร์กลิง','Sparkling'),
 'rose':('โรเซ่','Rosé'), 'dessert':('ไวน์หวาน','Dessert'),
 'whisky':('วิสกี้','Whisky'), 'gin':('จิน','Gin'), 'rum':('รัม','Rum'),
 'agave':('เตกีล่า & เมซคาล','Agave'), 'vodka':('วอดก้า','Vodka'),
 'liqueur':('ลิเคียว & อมาโร','Liqueur'), 'brandy':('บรั่นดี & คอนญัก','Brandy'),
 'sake':('สาเก','Sake'), 'other':('อื่น ๆ','Other'),
}
LENSES = [('band','ช่วงราคา','Price'), ('country','ประเทศ','Country'), ('type','ประเภท','Type')]

PAGES = {'WN': {'file': 'wine.html',   'shop': 'th.wine-now.com', 'th': 'ไวน์', 'en': 'Wine',
                'live': 'https://sites.google.com/view/wine-now-trending/home'},
         'LQ': {'file': 'liquor.html', 'shop': 'th.liq9.asia',     'th': 'สุรา', 'en': 'Spirits',
                'live': 'https://sites.google.com/view/liq9-trending/home'}}

esc  = lambda s: html.escape(str(s)) if s else ''
baht = lambda n: f"{int(round(float(n))):,}"

def two(th, en, cls=''):
    c = (cls + ' ') if cls else ''
    return f'<span class="{c}th">{th}</span><span class="{c}en">{en}</span>'

def buy(sku, site):
    # real product page from the catalog export; catalogsearch only if absent
    return links.product_url(sku, PAGES[site]['shop'])

# ------------------------------------------------------------------ data

def load_stock():
    from datetime import datetime as dt
    out = {}
    for r in csv.DictReader(open(CLR + 'stock_checks.csv', encoding='utf-8')):
        v = r['stock'].strip()
        if not re.match(r'^\d+$', v):
            continue
        d = dt.strptime(r['date'].strip(), '%m/%d/%Y')
        s = r['sku'].strip()
        if s not in out or d > out[s][1]:
            out[s] = (int(v), d)
    return {k: v[0] for k, v in out.items()}

def load_oos():
    return {l.strip() for l in open(CLR + 'oos.txt', encoding='utf-8') if l.strip()}

def load_prev():
    if not os.path.exists(PREV_JSON):
        return {}
    return json.load(open(PREV_JSON, encoding='utf-8'))

MARGIN_ML = json.load(open(CLR + 'margin_ml.json'))
BLURBS = json.load(open(CLR + 'blurbs.json'))

# Body is a fixed catalog vocabulary, so it maps 1:1. Flavour tags stay in the
# original script, exactly as grape and region names already do (spec §7).
BODY_TH = {'Light': 'บอดี้เบา', 'Medium-Light': 'บอดี้ค่อนข้างเบา', 'Medium': 'บอดี้ปานกลาง',
           'Medium-Full': 'บอดี้ค่อนข้างเต็ม', 'Full': 'บอดี้เต็ม'}

def blurb(sku):
    """Selling point, straight from the catalog — never composed by us.

    TH shows the structured character line (body + flavour tags); EN adds the
    written sentence from desc_en_short. The English copy is NOT translated:
    the spec requires hand-written English, and the same rule forbids me
    machine-translating it the other way. Thai prose needs the team.
    """
    d = BLURBS.get(sku)
    if not d:
        return ''
    th_bits = [x for x in (BODY_TH.get(d['body'], ''), d['tags']) if x]
    en_bits = [x for x in (d['body'], d['tags']) if x]
    th = ' · '.join(th_bits)
    en = ' · '.join(en_bits)
    if d['en']:
        en = (en + ' — ' if en else '') + d['en']
    if not th and not en:
        return ''
    return f'<p class="blurb">{two(esc(th), esc(en))}</p>' 

SKU_TYPE = {'WRW': 'red', 'WWW': 'white', 'WSP': 'sparkling', 'WRS': 'rose',
            'WDW': 'dessert', 'LWH': 'whisky', 'LGN': 'gin', 'LRM': 'rum',
            'LTQ': 'agave', 'LVK': 'vodka', 'LBD': 'brandy', 'LSK': 'sake',
            'LLQ': 'liqueur'}


def type_of(sku):
    """Category from the SKU prefix — the same mapping the ranking query uses."""
    return SKU_TYPE.get(sku[:3], '')


def family(name):
    """Product identity ignoring bottle size and vintage year, so
    'Clerc Milon 2015/2019/2023' and 'Aperol 700ml/1L' each collapse to one."""
    s = re.sub(r'\([^)]*(?:ml|ML|litre|liter|\bL\b)[^)]*\)', ' ', name)
    s = re.sub(r'\b(?:19|20)\d{2}\b', ' ', s)
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()

def size_pref(sku):
    """Standard bottle wins: 750 ml for wine, 700 ml for spirits."""
    ml = MARGIN_ML.get(sku, (0, 0))[1]
    want = 750 if sku[:1] == 'W' else 700
    if ml == want:       return 3
    if not ml:           return 2
    if 600 <= ml <= 1000: return 2
    return 1

def stock_tier(sku):
    """How likely the bottle is still there to sell. Used to order the fill
    slots — the ranked core stays ordered on demand, which is the whole point
    of a demand ranking."""
    q = STOCK.get(sku)
    if q is None: return 1          # confirmed in stock, quantity not stated
    if q >= 12:   return 2
    if q >= 6:    return 1
    return 0                        # 1-5 left: real, but may not last the week

def margin_of(sku):
    return MARGIN_ML.get(sku, (0, 0))[0]

def dedupe(items, key, pop):
    """One bottle per product family. Winner: standard size, then popularity,
    then margin. Margin ranks only — it is never rendered."""
    best, dropped = {}, 0
    for it in items:
        sku, nm = key(it)
        f = family(nm)
        cand = (size_pref(sku), pop(it), margin_of(sku))
        if f not in best or cand > best[f][0]:
            if f in best: dropped += 1
            best[f] = (cand, it)
        else:
            dropped += 1
    order = {id(v[1]): i for i, v in enumerate(best.values())}
    keep = [v[1] for v in best.values()]
    return keep, dropped

STOCK, OOS, PREV = load_stock(), load_oos(), load_prev()


BRAND_CAP = 2


_BRANDS = None


def brand_of_sku(sku, cat, name=''):
    """Producer for a SKU. cat_all carries `b` for anything in the demand pool;
    a top-up bottle may not be in there, so fall back to the longest known
    producer name the product name starts with. That is enough to catch
    'Bols Triple Sec' and 'Hiram Walker Triple Sec' without a brand table."""
    global _BRANDS
    b = (cat.get(sku, {}) or {}).get('b')
    if b:
        return b
    if _BRANDS is None:
        _BRANDS = sorted({(v or {}).get('b') for v in cat.values() if (v or {}).get('b')},
                         key=len, reverse=True)
    low = (name or '').lower()
    for cand in _BRANDS:
        if low.startswith(cand.lower()):
            return cand
    return (name or '').split(' (')[0].split()[0] if name else ''


def brand_count(limit=None):
    """A stateful gate: call it with a brand, get True while that house is still
    under the cap. Used where the list is assembled item by item rather than
    reordered in one pass, so the count has to carry across demand rows and
    top-up rows in the same tab."""
    limit = BRAND_CAP if limit is None else limit
    seen = {}

    def allow(brand):
        if not brand:
            return True
        seen[brand] = seen.get(brand, 0) + 1
        return seen[brand] <= limit
    return allow


def cap_producers(pooled, cat, limit=None):
    """No producer takes more than BRAND_CAP slots in the ranked list.

    Why this exists: on the 26 Aug data Monsoon Valley held 3 of the wine 50 and
    Bols held 4 of the spirits 50, each on the minimum qualifying signal of two
    distinct clients. Nothing about that is false — those requests happened —
    but a list whose job is to show a customer what is moving stops doing that
    job when one house owns three rows of it. Thirty producers across fifty
    slots is the point of the page.

    Deferred, not deleted. A bottle pushed out here still appears in its type
    tab, where seeing three gins from one distiller is the category working
    normally rather than a discovery list narrowing. And the cap applies ONLY
    here: a best-seller leaderboard is a statement about what sold, so capping
    a producer there would make the ranking say something untrue.
    """
    limit = BRAND_CAP if limit is None else limit
    seen, keep, deferred = {}, [], []
    for p in pooled:
        sku = p[0]['sku'] if isinstance(p, tuple) else p['sku']
        brand = (cat.get(sku, {}) or {}).get('b') or ''
        if not brand:
            keep.append(p)
            continue
        seen[brand] = seen.get(brand, 0) + 1
        (keep if seen[brand] <= limit else deferred).append(p)
    return keep + deferred, len(deferred)

# ------------------------------------------------------------------ chips

def gauge(qty):
    if qty is None:
        return ''
    if qty <= 0:
        return '<span class="chip req">' + two('สั่งจองล่วงหน้า', 'On request') + '</span>'
    if qty <= LOW_EXACT:
        lit, th, en = 1, f'เหลือ {qty} ขวด', ('1 bottle left' if qty == 1 else f'{qty} bottles left')
    elif qty < 49:
        lit, th, en = 2, 'สต็อกจำกัด', 'Limited'
    else:
        lit, th, en = 3, 'มีสต็อกเหลือมาก', 'Plenty in stock'
    bars = ''.join(f'<i class="{"on" if n < lit else ""}"></i>' for n in range(3))
    return (f'<span class="gauge g{lit}"><span class="bars">{bars}</span>'
            f'{two(th, en)}</span>')

def stock_chip(sku):
    return ('<span class="chip req">' + two('สั่งจองล่วงหน้า', 'On request') + '</span>'
            if sku in OOS else gauge(STOCK.get(sku)))

def demand_tier(score, core=True):
    if not core:                       # one client asked, in the last 30 days
        return 't4', 'เพิ่งถูกถามหา', 'Recently requested'
    if score >= 6: return 't1', 'ถามหามากที่สุด', 'Most requested'
    if score >= 5: return 't2', 'ถามหาบ่อย', 'Frequently requested'
    return 't3', 'กำลังมาแรง', 'Gaining interest'

def movement(site, seg, sku, rank):
    """Real snapshot data only. No snapshot -> no arrow, no placeholder."""
    prev = PREV.get(site, {}).get(seg, {}).get(sku)
    if prev is None:
        return ''
    d = prev - rank
    if d > 0:
        return (f'<span class="mv up" title="up {d}"><svg viewBox="0 0 10 10" aria-hidden="true">'
                f'<path d="M5 1L9 7H1z"/></svg>{d}</span>')
    if d < 0:
        return (f'<span class="mv dn" title="down {-d}"><svg viewBox="0 0 10 10" aria-hidden="true">'
                f'<path d="M5 9L1 3h8z"/></svg>{-d}</span>')
    return '<span class="mv fl" aria-label="no change">—</span>'

# ------------------------------------------------------------------ rows

def trend_row(sku, c, dem, site, rank, is_icon, core=True):
    origin = ' · '.join(x for x in [c.get('r'), c.get('c')] if x)
    bits = [esc(origin)] if origin else []
    if c.get('v'): bits.append(esc(c['v']))
    # trending rows already carry region and country in the meta, so the story
    # line here adds only what is missing: the designation and the rarity
    # clause. Region is not repeated.
    d = bsdata.stories().get(sku) or {}
    if d.get('designation'):
        bits.append(esc(d['designation']))
    sc  = f'<span class="score">{int(c["m"])}<em>{esc(c["cr"])}</em></span>' if c.get('m') else ''
    rare_th = rare_en = ''
    if d.get('critic_pct') and d['critic_pct'] <= bsdata.CRITIC_PCT_MAX and c.get('cr'):
        rare_th = f'{d["critic_pct"]}% แรกของคะแนน {c["cr"]}'
        rare_en = f'top {d["critic_pct"]}% of {c["cr"]} scores'
    elif d.get('sales_pct') and d['sales_pct'] <= bsdata.SALES_PCT_MAX:
        rare_th = f'ยอดขาย {d["sales_pct"]}% แรกของหมวด'
        rare_en = f'top {d["sales_pct"]}% by sales in its category'
    rare = f'<span class="chip rare">{two(rare_th, rare_en)}</span>' if rare_th else ''

    gz = bsdata.gauge_html(sku, type_of(sku), two)
    cls, tth, ten = demand_tier(dem['demand'], core)
    tier = f'<span class="chip {cls}">{two(tth, ten)}</span>'
    ico  = f'<span class="chip icon">{two("ไอคอนประจำร้าน", "cellar icon")}</span>' if is_icon else ''
    new  = (f'<span class="chip new">{two("ใหม่สัปดาห์นี้", "New this week")}</span>'
            if dem.get('is_new') else '')
    price = c.get('sp') or c['p']
    was   = f'<s>{baht(c["p"])}</s>' if c.get('sp') else ''
    src   = links.product_image(sku, (IMG + c['i']) if c.get('i') else None)
    shot  = (f'<img src="{src}" alt="{esc(c["n"])}" loading="lazy" decoding="async">'
             if src else '<span class="noimg" aria-hidden="true"></span>')
    return f'''<li class="row">
<p class="rank"><b>{rank}</b></p><div class="shot">{shot}</div>
<div class="info"><p class="brand">{esc(c.get("b",""))}</p>
<a class="rname" href="{buy(sku, site)}" target="_blank" rel="noopener">{esc(c["n"])}</a>
<p class="meta">{" · ".join(bits)}</p>
{blurb(sku)}{gz}
<p class="chips">{sc}{rare}{new}{tier}{ico}{stock_chip(sku)}</p></div>
<p class="price"><strong>฿{baht(price)}</strong>{was}</p></li>'''

def explorer_row(sku, c, site, rank, reason, note_th='', note_en=''):
    """An Explorer row. Same anatomy as a top-up row plus the reason chip.

    No demand tier and no sales rank, because this shelf makes neither claim.
    What it does carry is the stated reason it is here — and Pawin's own line
    when he has written one, which then replaces the generated story line
    rather than sitting on top of it.
    """
    name = c['name']
    src = links.product_image(sku, None)
    shot = (f'<img src="{src}" alt="{esc(name)}" loading="lazy" decoding="async">'
            if src else '<span class="noimg" aria-hidden="true"></span>')
    price, sp = c.get('price') or '0', c.get('sp') or ''
    was = off = ''
    try:
        p_i, s_i = int(price), int(sp or 0)
    except ValueError:
        p_i = s_i = 0
    if s_i and p_i and s_i < p_i:
        was = f'<s>{baht(price)}</s>'
        pct = round((p_i - s_i) * 100 / p_i)
        if pct >= 3:
            off = f'<span class="off">-{pct}%</span>'

    sc = ''
    if c.get('score') and c.get('critic'):
        sc = f'<span class="score">{esc(c["score"])}<em>{esc(c["critic"])}</em></span>'
    badge = ''
    if c.get('rep') in REP:
        badge = f'<span class="rep rep-{c["rep"]}">{two(*REP[c["rep"]])}</span>'

    if note_th or note_en:
        body = f'<p class="story ed">{two(esc(note_th), esc(note_en))}</p>'
    else:
        st_th, st_en = bsdata.story_bits(sku, c.get('style') or '', c.get('critic') or '')
        body = f'<p class="story">{two(esc(st_th), esc(st_en))}</p>' if (st_th or st_en) else ''
    gz = bsdata.gauge_html(sku, type_of(sku), two)
    meta = ' · '.join(x for x in (esc(c.get('country') or ''),
                                  esc(c.get('style') or '')) if x)
    rth, ren = explorer.REASON[reason]
    return f'''<li class="row exp">
<p class="rank"><b>{rank}</b></p><div class="shot">{shot}</div>
<div class="info">
<a class="rname" href="{buy(sku, site)}" target="_blank" rel="noopener">{esc(name)}</a>
<p class="meta">{meta}</p>{body}{gz}
<p class="chips"><span class="chip why why-{reason}">{two(rth, ren)}</span>{badge}{sc}{stock_chip(sku)}</p></div>
<p class="price"><strong>฿{baht(sp or price)}</strong>{was}{off}</p></li>'''


def bs_topup_row(sku, c, site, rank):
    """A trending-tab row that came from the best-seller ranking, not from demand.

    It carries no demand tier chip, because it has no demand behind it in this
    window. Giving it one would be the whole point of the divider defeated.
    """
    name = c['name']
    price, sp = c['price'], c.get('sp')
    src  = links.product_image(sku, None)
    shot = (f'<img src="{src}" alt="{esc(name)}" loading="lazy" decoding="async">'
            if src else '<span class="noimg" aria-hidden="true"></span>')
    was  = f'<s>{baht(price)}</s>' if sp else ''
    meta = ' \u00b7 '.join(x for x in (esc(c.get('country') or ''),
                                        esc(c.get('style') or '')) if x)
    st_th, st_en = bsdata.story_bits(sku, c.get('style') or '', c.get('critic') or '')
    story = f'<p class="story">{two(esc(st_th), esc(st_en))}</p>' if (st_th or st_en) else ''
    gz = bsdata.gauge_html(sku, type_of(sku), two)
    return f'''<li class="row topup">
<p class="rank"><b>{rank}</b></p><div class="shot">{shot}</div>
<div class="info">
<a class="rname" href="{buy(sku, site)}" target="_blank" rel="noopener">{esc(name)}</a>
<p class="meta">{meta}</p>{story}{gz}<p class="chips"><span class="chip seller">{two("ขายดีในหมวดนี้", "Category best seller")}</span>{stock_chip(sku)}</p></div>
<p class="price"><strong>\u0e3f{baht(sp or price)}</strong>{was}</p></li>'''


REP = {'iconic':      ('ระดับตำนาน',   'Icon'),
       'premium':     ('ระดับพรีเมียม', 'Premium'),
       'established': ('เป็นที่ยอมรับ',  'Established')}
# 'everyday' and 'unrated' get no badge. A badge every row wears is not a signal.


def bs_row(r, site, seg, rank):
    """One leaderboard row.

    Kept deliberately scannable: a reader comparing twenty bottles is scanning,
    not reading. Everything here is one glance wide — no selling-point sentences,
    those stay on the trending rows where there are fewer of them.

    Signals, all from stored catalog fields:
      reputation tier   only for iconic / premium / established
      critic score      exactly as stored, critic always named
      discount          the real percentage, not just a struck-through price
      style / variety   what it actually is, so a name alone need not carry it
      vintage           only when confirmed; provisional years are suppressed
    """
    sku, name, price, sp = r[2], r[3], r[4], r[5]
    if len(r) >= 12:
        img, score, country, rep, style, vint = r[6], r[7], r[8], r[9], r[10], r[11]
    elif len(r) >= 9:
        img, score, country = r[6], r[7], r[8]
        rep = style = vint = ''
    else:
        img, score, country = '', r[6], r[7]
        rep = style = vint = ''

    sc = ''
    if score:
        parts = score.split(None, 1)
        if len(parts) == 2:
            sc = f'<span class="score">{esc(parts[0])}<em>{esc(parts[1])}</em></span>'

    badge = ''
    if rep in REP:
        badge = f'<span class="rep rep-{rep}">{two(*REP[rep])}</span>'

    src  = links.product_image(sku, (IMG + img) if img else None)
    shot = (f'<img src="{src}" alt="{esc(name)}" loading="lazy" decoding="async">'
            if src else '<span class="noimg" aria-hidden="true"></span>')

    # price: anchor on the original, state the saving as a number people can act on
    was, off = '', ''
    try:
        p_i, s_i = int(price or 0), int(sp or 0)
    except ValueError:
        p_i = s_i = 0
    if s_i and p_i and s_i < p_i:
        was = f'<s>{baht(price)}</s>'
        pct = round((p_i - s_i) * 100 / p_i)
        if pct >= 3:
            off = f'<span class="off">-{pct}%</span>'

    meta = ' · '.join(x for x in (esc(country), esc(vint)) if x)

    # One compact provenance line: where it is from, what it is, and — only when
    # the catalog actually says so — how rare it is. Still one glance wide: a
    # reader working down twenty bottles is scanning, and a second sentence per
    # row is what would break that.
    critic = score.split(None, 1)[1] if score and len(score.split(None, 1)) == 2 else ''
    st_th, st_en = bsdata.story_bits(sku, style, critic)
    story = f'<p class="story">{two(esc(st_th), esc(st_en))}</p>' if (st_th or st_en) else ''
    gz = bsdata.gauge_html(sku, type_of(sku), two)

    top  = ' top3' if rank <= 3 else ''
    return f'''<li class="row">
<p class="rank{top}"><b>{rank}</b>{movement(site, seg, sku, rank)}</p><div class="shot">{shot}</div>
<div class="info">
<a class="rname" href="{buy(sku, site)}" target="_blank" rel="noopener">{esc(name)}</a>
<p class="meta">{meta}</p>{story}{gz}<p class="chips">{badge}{sc}{stock_chip(sku)}</p></div>
<p class="price"><strong>฿{baht(sp or price)}</strong>{was}{off}</p></li>'''

# ------------------------------------------------------------------ CSS / JS

CSS = '''
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:#fff;color:#111110;font:400 16px/1.55 "IBM Plex Sans Thai",
 -apple-system,BlinkMacSystemFont,sans-serif;-webkit-font-smoothing:antialiased}
p{margin:0}a{color:inherit;text-decoration:none}button,select{font-family:inherit}
button{touch-action:manipulation;cursor:pointer}
.en{display:none}body.lang-en .th{display:none}body.lang-en .en{display:inline}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px}
:where(button,a,select):focus-visible{outline:2px solid #111110;outline-offset:2px}
button:active{background:#F0EEE8}.row:active{background:#FAF9F6}

.story{font-size:13px;line-height:1.45;color:#4C4A45;margin-top:2px;
 display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gauges{display:flex;flex-wrap:wrap;gap:14px;margin-top:5px}
.gz{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6E6A63}
.gz b{font-weight:500}
.gzb{display:inline-flex;gap:2px}
.gzb i{width:9px;height:5px;background:#E5E2DA;border-radius:1px}
.gzb i.on{background:#8A7B4F}

.chip.why{background:#111110;border-color:#111110;color:#fff;font-weight:600}
.chip.why-editor{background:#5B4A2E;border-color:#5B4A2E}
.chip.why-low{background:#7A3B2E;border-color:#7A3B2E}
.story.ed{color:#111110}
.row.exp .rank b{color:#8A857A}

.chip.rare{background:#F5F1E6;border-color:#D8CFB4;color:#6B5B2E;font-weight:600}

.top{border-bottom:1px solid #E5E2DA;background:#fff;position:sticky;top:0;z-index:40}
.topin{display:flex;align-items:center;justify-content:space-between;height:52px;gap:10px}
.mark{font:600 12px/1 inherit;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
.mark i{font-style:normal;color:#6E6A63}
.right{display:flex;align-items:center;gap:4px;flex:0 0 auto}
.swap{min-height:44px;padding:0 10px;background:none;border:1px solid #E5E2DA;
 font:500 12px/1 inherit;color:#4C4A45;display:inline-flex;align-items:center;white-space:nowrap}
.lang{display:flex}
.lang button{min-height:44px;min-width:46px;background:none;border:1px solid transparent;
 font:500 13px/1 inherit;color:#4C4A45}
.lang button[aria-pressed=true]{color:#111110;border-color:#111110}

.views{position:sticky;top:52px;z-index:30;background:#fff;border-bottom:1px solid #E5E2DA}
.views .in{display:flex}
.views button{flex:1 1 0;min-height:50px;background:none;border:0;border-bottom:2px solid transparent;
 font:500 15px/1 inherit;color:#6E6A63}
.views button[aria-pressed=true]{color:#111110;border-bottom-color:#111110}

.hero{padding:30px 0 22px}
.kicker{font:500 11px/1 inherit;letter-spacing:.2em;text-transform:uppercase;color:#4C4A45;margin-bottom:10px}
h1{margin:0 0 10px;font-family:"Noto Serif Thai",serif;font-weight:500;
 font-size:clamp(26px,6.2vw,46px);line-height:1.12}
body.lang-en h1{font-family:"Cormorant Garamond",serif;font-weight:400}
.lede{max-width:56ch;color:#4C4A45;font-size:15px}
.note{margin-top:16px;padding:11px 13px;border:1px solid #E5E2DA;background:#FAF9F6;
 font-size:13px;color:#4C4A45;max-width:62ch}
.view{display:none}.view.on{display:block}

.segbar{position:sticky;top:102px;z-index:20;background:#fff;border-bottom:1px solid #E5E2DA;padding:9px 0}
.rail{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.rail::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;min-height:44px;padding:0 14px;background:#fff;border:1px solid #E5E2DA;
 font:400 14px/1 inherit;color:#111110;white-space:nowrap}
.tab[aria-pressed=true]{background:#111110;border-color:#111110;color:#fff}
.seg{display:none}.seg.on{display:block}
.tsec{display:none}.tsec.on{display:block}
.lensrow{display:flex;gap:0;border:1px solid #111110;width:fit-content;max-width:100%;margin-bottom:9px}
.lens{min-height:44px;padding:0 15px;background:none;border:0;border-right:1px solid #111110;
 font:500 13px/1 inherit;color:#111110;white-space:nowrap}
.lens:last-child{border-right:0}
.lens[aria-pressed=true]{background:#111110;color:#fff}
.lensrail{display:none}.lensrail.on{display:flex}
.seghead{padding:22px 0 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#4C4A45}

ul.list{list-style:none;margin:14px 0 0;padding:0;border-top:1px solid #E5E2DA}
.row{display:flex;gap:14px;align-items:center;padding:13px 0;position:relative;
 border-bottom:1px solid rgba(17,17,16,.08)}
.rank{flex:0 0 40px;display:flex;flex-direction:column;align-items:center;gap:3px}
.rank b{font-family:"Cormorant Garamond",serif;font-size:23px;line-height:1;font-weight:500;
 color:#6E6A63;font-variant-numeric:tabular-nums}
.mv{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:600;
 font-variant-numeric:tabular-nums;line-height:1}
.mv svg{width:8px;height:8px;fill:currentColor}
.mv.up{color:#111110}.mv.dn{color:#8F8B81}.mv.fl{color:#B8B4AA;font-weight:400}
.shot{flex:0 0 52px;height:70px;display:flex;align-items:center;justify-content:center}
.shot img{max-width:100%;max-height:100%;width:auto;height:auto}
.noimg{width:22px;height:52px;border:1px dashed #E5E2DA;display:block}
.info{flex:1 1 auto;min-width:0}
.brand{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4C4A45}
.rname{display:block;font-family:"Cormorant Garamond",serif;font-size:19px;line-height:1.3;
 font-weight:500;margin:2px 0 3px}
.rname::after{content:"";position:absolute;inset:0}
.rname:hover{text-decoration:underline;text-underline-offset:3px}
.meta{font-size:13px;color:#4C4A45;margin-bottom:6px}
.blurb{font-size:13px;line-height:1.5;color:#4C4A45;margin:0 0 7px;max-width:66ch}
.blurb .en,.blurb .th{display:block}
body.lang-en .blurb .en{display:block}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.price{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px;
 font-variant-numeric:tabular-nums;text-align:right}
.price strong{font-size:18px;font-weight:600}.price s{color:#6E6A63;font-size:13px}

.chip,.score{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 8px;
 border:1px solid #E5E2DA;color:#4C4A45;line-height:1.4}
.score{font-variant-numeric:tabular-nums;font-weight:600;border-color:#111110;color:#111110}
.rep{display:inline-flex;align-items:center;font-size:12px;letter-spacing:.04em;padding:3px 8px;
 border:1px solid #C9C3B4;color:#4C4A45;background:#FAF8F3}
.rep-iconic{border-color:#8A6A2F;color:#6E5423;background:#FBF6EA;font-weight:600}
.rep-premium{border-color:#111110;color:#111110}
.off{font-size:12px;font-weight:600;color:#8A2F2F;font-variant-numeric:tabular-nums}
.rank.top3 b{font-size:20px}
.divider{list-style:none;padding:14px 0 10px;font-size:13px;color:#4C4A45;
 border-top:1px solid #E5E2DA;margin-top:6px}
.row.topup{background:#FCFBF8}
.chip.seller{border-color:#C9C3B4;color:#4C4A45}
.score em{font-style:normal;font-weight:400;color:#4C4A45;font-size:12px;letter-spacing:.06em}
.chip.t1{background:#111110;border-color:#111110;color:#fff;font-weight:500}
.chip.t2{border-color:#111110;color:#111110;font-weight:500}
.chip.t3{border-color:#8F8B81;color:#4C4A45}
.chip.t4{border-color:#E5E2DA;color:#6E6A63}
.chip.new{background:#FAF9F6;border-color:#111110;color:#111110;font-weight:600}
.chip.icon{border-color:#111110;color:#111110}
.chip.req{border-color:#8F8B81;color:#4C4A45;font-style:italic}
.gauge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 8px;
 border:1px solid #E5E2DA;color:#4C4A45;line-height:1.4}
.gauge .bars{display:inline-flex;gap:2px}
.gauge i{width:4px;height:11px;background:#E5E2DA;display:block}
.gauge i.on{background:#6E6A63}
.gauge.g1{border-color:#111110;color:#111110;font-weight:500}
.gauge.g1 i.on{background:#111110}

footer{margin-top:40px;border-top:1px solid #E5E2DA;padding:24px 0 56px;font-size:13px;color:#4C4A45}
footer p{margin-bottom:8px;max-width:68ch}
footer .fl{margin-top:14px;display:flex;gap:18px;flex-wrap:wrap}
footer .fl a{border-bottom:1px solid #E5E2DA;min-height:44px;display:inline-flex;align-items:center}

@media(max-width:640px){
 .wrap{padding:0 15px}
 .hero{padding:22px 0 18px}
 .mark{font-size:12px;letter-spacing:.1em}
 .swap{padding:0 8px;font-size:12px}
 .segbar{top:102px}
 .row{display:grid;grid-template-columns:32px 46px minmax(0,1fr);
  grid-template-areas:"rank shot info" ". shot price";column-gap:10px;row-gap:7px;align-items:start}
 .rank{grid-area:rank;flex-direction:row;gap:4px;justify-content:flex-start;padding-top:3px}
 .rank b{font-size:18px}
 .shot{grid-area:shot;flex:none;height:64px}
 .info{grid-area:info}
 .price{grid-area:price;flex-direction:row;align-items:baseline;justify-content:flex-start;gap:10px;text-align:left}
 .price strong{order:1;font-size:17px}.price s{order:2}
 .rname{font-size:17px}
 .chips{gap:6px}
}
@media(prefers-reduced-motion:reduce){
 html{scroll-behavior:auto}*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
'''

JS = '''
(function(){
 var d=document,body=d.body;
 function setLang(l){
  body.classList.toggle('lang-en',l==='en');
  d.documentElement.lang=(l==='en')?'en':'th';
  d.querySelectorAll('.lang button').forEach(function(b){
   b.setAttribute('aria-pressed',String(b.dataset.l===l));});
 }
 setLang((navigator.language||'th').toLowerCase().indexOf('th')===0?'th':'en');
 d.querySelectorAll('.lang button').forEach(function(b){
  b.addEventListener('click',function(){setLang(b.dataset.l);});});

 var vb=d.querySelectorAll('.views button');
 vb.forEach(function(b){
  b.addEventListener('click',function(){
   vb.forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});
   d.querySelectorAll('.view').forEach(function(v){
    v.classList.toggle('on',v.dataset.v===b.dataset.v);});
   window.scrollTo({top:0});
  });
 });

 // best-seller segment tabs (scoped per lens) and trending type tabs
 function wire(sel,target){
  var tabs=d.querySelectorAll(sel);
  tabs.forEach(function(t){
   t.addEventListener('click',function(){
    tabs.forEach(function(x){x.setAttribute('aria-pressed',String(x===t));});
    d.querySelectorAll(target).forEach(function(s){
     s.classList.toggle('on',s.dataset.k===t.dataset.k);});
    t.scrollIntoView({block:'nearest',inline:'center'});
   });
  });
 }
 wire('.tab:not(.ttab)','.seg');
 wire('.ttab','.tsec');

 // lens switch: show that lens's rail and select its first segment
 d.querySelectorAll('.lens').forEach(function(L){
  L.addEventListener('click',function(){
   d.querySelectorAll('.lens').forEach(function(x){
    x.setAttribute('aria-pressed',String(x===L));});
   d.querySelectorAll('.lensrail').forEach(function(r){
    r.classList.toggle('on',r.dataset.l===L.dataset.l);});
   var rail=d.querySelector('.lensrail[data-l="'+L.dataset.l+'"]');
   var first=rail && rail.querySelector('.tab');
   if(first){
    d.querySelectorAll('.tab:not(.ttab)').forEach(function(x){
     x.setAttribute('aria-pressed',String(x===first));});
    d.querySelectorAll('.seg').forEach(function(s){
     s.classList.toggle('on',s.dataset.k===first.dataset.k);});
    rail.scrollLeft=0;
   }
  });
 });
})();
'''

# ------------------------------------------------------------------ build

def build(site):
    p = PAGES[site]
    page, th, en = p['file'], p['th'], p['en']
    other = PAGES['LQ' if site == 'WN' else 'WN']

    # -- trending
    import prep3
    cat  = json.load(open(CLR + 'cat_trending.json'))
    cat.update(json.load(open(CLR + 'cat_fill.json')))
    cat.update(json.load(open(CLR + 'cat_types.json')))
    cat.update(json.load(open(CLR + 'cat_more.json')))
    scored = prep3.score(prep3.load()[0])
    pref = 'W' if site == 'WN' else 'L'

    # CORE — >=2 distinct clients, sellable. Ranked purely on demand.
    core = [x for x in scored if x['sku'].startswith(pref) and x['sellable']
            and x['clients'] >= 2 and x['sku'] in cat]
    core.sort(key=lambda x: (-x['demand'], -x['clients']))

    # FILL — single-client asks from the same 30 days, taken PREMIUM FIRST so the
    # slots added to reach LIST_SIZE are the icon bottles. Still real demand:
    # every one was requested by a customer. Tagged 'เพิ่งถูกถามหา', never 't1'.
    have = {x['sku'] for x in core}
    fill = [x for x in scored if x['sku'].startswith(pref) and x['sellable']
            and x['sku'] not in have and x['sku'] in cat]
    # fill: interesting AND likely still in stock. Availability first, then the
    # premium bottles, then how recently it was asked for.
    fill.sort(key=lambda x: (-stock_tier(x['sku']),
                             -(cat[x['sku']].get('sp') or cat[x['sku']]['p']),
                             -x['demand']))

    # collapse size and vintage variants before cutting to LIST_SIZE, so the
    # 25 are 25 different products rather than one wine in four vintages
    pooled = [(x, True) for x in core] + [(x, False) for x in fill]
    pooled, n_dropped = dedupe(pooled,
                               key=lambda p: (p[0]['sku'], cat[p[0]['sku']]['n']),
                               pop=lambda p: p[0]['demand'])
    pooled, n_capped = cap_producers(pooled, cat)
    seq = pooled[:LIST_SIZE]
    if n_dropped:
        print(f'    dedupe {site}: dropped {n_dropped} size/vintage variants from trending')
    if n_capped:
        print(f'    producer cap {site}: deferred {n_capped} rows so no house takes '
              f'more than {BRAND_CAP} of the {LIST_SIZE}')

    # "New this week" only carries meaning when most of the list is NOT new.
    # With a shallow ticket history nearly every first_seen lands in the last
    # 7 days and the marker becomes noise, so suppress it wholesale.
    n_new = sum(1 for x, _ in seq if x.get('is_new'))
    if n_new > len(seq) * 0.5:
        print(f'    ! new-this-week suppressed on {site}: {n_new}/{len(seq)} would '
              f'carry it - ticket history too shallow to separate new from ongoing')
        for x, _ in seq:
            x['is_new'] = False
    ic  = [x['sku'] for x, _ in seq if (cat[x['sku']].get('sp') or cat[x['sku']]['p']) >= PREMIUM_FLOOR]
    icons = set(ic)
    items = [(x['sku'], cat[x['sku']], x) for x, _ in seq]
    trows = ''.join(trend_row(x['sku'], cat[x['sku']], x, site, i + 1,
                              x['sku'] in icons, is_core)
                    for i, (x, is_core) in enumerate(seq))

    # best-seller pool per type, used to top up thin trending tabs (see below)
    bs_topup = {seg: [x[2] for x in rws] for seg, rws
                in bsdata.rows_for('wn' if site == 'WN' else 'lq',
                                   BS_DEPTH).get('type', {}).items()}

    # TYPE VIEWS — 'all' stays the ranked 25. A type tab does NOT filter those
    # 25 down (white would show one bottle); it opens the top of that type from
    # the whole 30-day demand pool. Still real requests, tier chip still shows
    # how strong. Types with under 3 items are omitted, not shown empty.
    by_type = json.load(open(CLR + 'trend_types.json'))
    score_of = {x['sku']: x for x in scored}
    ttabs = (f'<button type="button" class="tab ttab" data-k="all" aria-pressed="true">'
             f'{two("ทั้งหมด", "All")}</button>')
    tsecs = f'<section class="tsec on" data-k="all"><ul class="list">{trows}</ul></section>'
    for tk, skus in by_type.items():
        have = [s for s in skus if s in cat and s in score_of]
        have, _ = dedupe(have, key=lambda s: (s, cat[s]['n']),
                         pop=lambda s: score_of[s]['demand'])
        if len(have) < 3 or not tk in TYPES:
            continue
        if not any(s.startswith(pref) for s in have):
            continue
        # TOP-UP. The August ticket slice only holds so many distinct bottles per
        # type — 8 gins, 6 rums, 9 dessert wines. Rather than show a short tab or
        # pad it with bottles nobody asked for, fill the remainder from that
        # type's best-seller ranking and SAY SO. The two groups never mix: the
        # demand-ranked bottles come first, then a labelled divider, then the
        # sellers. A reader can always tell which is which.
        # The producer cap applies inside a type tab too. Bols alone held 7 of
        # the 20 liqueur rows — real demand (a bar orders half the Bols range on
        # one ticket, and the ticket counts once per line), but half a tab from
        # one house is not a list anyone browses. The cap counts across the
        # WHOLE tab, demand rows and top-ups together, or the same house simply
        # reappears below the divider.
        used = brand_count()
        have = [s for s in have if used(brand_of_sku(s, cat))][:TYPE_DEPTH]

        topup = []
        if len(have) < TYPE_DEPTH:
            seen = set(have)
            for sk in bs_topup.get(tk, []):
                if len(have) + len(topup) >= TYPE_DEPTH:
                    break
                if sk in seen or not sk.startswith(pref) or sk not in bsdata.products():
                    continue
                if not used(brand_of_sku(sk, cat,
                                         (bsdata.products()[sk] or {}).get('name', ''))):
                    continue
                seen.add(sk)
                topup.append(sk)
        ttabs += (f'<button type="button" class="tab ttab" data-k="{tk}" aria-pressed="false">'
                  f'{two(*TYPES[tk])}</button>')
        li = ''.join(trend_row(s, cat[s], score_of[s], site, n + 1,
                               (cat[s].get('sp') or cat[s]['p']) >= PREMIUM_FLOOR,
                               score_of[s]['clients'] >= 2)
                     for n, s in enumerate(have[:TYPE_DEPTH]))
        if topup:
            li += ('<li class="divider">' + two(
                     'จากนี้คือรายการขายดีในหมวดเดียวกัน ไม่ใช่รายการที่ลูกค้าถามหาในรอบนี้',
                     'From here down: best sellers in the same category, '
                     'not bottles asked for in this period.') + '</li>')
            li += ''.join(bs_topup_row(s, bsdata.products()[s], site,
                                       len(have[:TYPE_DEPTH]) + n + 1)
                          for n, s in enumerate(topup))
        tsecs += (f'<section class="tsec" data-k="{tk}">'
                  f'<p class="seghead">{two(*TYPES[tk])}</p><ul class="list">{li}</ul></section>')
    n_core, n_fill = sum(1 for _, c in seq if c), sum(1 for _, c in seq if not c)
    n_shown_new = sum(1 for x, _ in seq if x.get('is_new'))
    inote = ('<div class="note">' + two(
      'ขวดที่ติดป้าย “ไอคอนประจำร้าน” คือรายการระดับพรีเมียมที่ลูกค้าถามหาจริงในรอบเดียวกัน '
      'ไม่ใช่รายการที่เราเพิ่มเข้ามาเอง',
      'Bottles marked “cellar icon” are premium listings that were genuinely requested in '
      'the same period — not entries we added ourselves.') + '</div>') if icons else ''

    # -- best sellers
    # one file per site, already deduped in SQL: lens~segment~rank~sku~name~
    # price~special~score~country. No two rows in a segment share a family.
    skey = 'wn' if site == 'WN' else 'lq'
    lens_segs = {'band': {}, 'country': {}, 'type': {}}
    fresh = bsdata.rows_for(skey, BS_DEPTH)
    if fresh:
        for lk, segs in fresh.items():
            lens_segs[lk] = segs
        rows_raw = [[lk] + r for lk in lens_segs for k in lens_segs[lk]
                    for r in lens_segs[lk][k]]
    else:
        # site not yet refreshed onto bs_rank.tsv — old 10-deep file
        rows_raw = [r for r in csv.reader(
            open(CLR + ('bs2_wn.tsv' if site == 'WN' else 'bs2_lq.tsv'), encoding='utf-8'),
            delimiter='~') if r]
        for r in rows_raw:
            lens_segs[r[0]].setdefault(r[1], []).append(r[1:])
    base, tps = rows_raw, []

    label_of = lambda k: two(*BANDS[k]) if k in BANDS else (
                         two(*TYPES[k]) if k in TYPES else esc(k))
    lens_tabs = ''.join(
        f'<button type="button" class="lens" data-l="{lk}" '
        f'aria-pressed="{"true" if i == 0 else "false"}">{two(lth, len_)}</button>'
        for i, (lk, lth, len_) in enumerate(LENSES))

    rails, bbody, first = '', '', True
    for li, (lk, _, _) in enumerate(LENSES):
        keys_l = list(lens_segs[lk])
        rails += (f'<div class="rail lensrail{" on" if li == 0 else ""}" data-l="{lk}">'
                  + ''.join(
                      f'<button type="button" class="tab" data-k="{lk}:{esc(k)}" '
                      f'aria-pressed="{"true" if (li == 0 and j == 0) else "false"}">'
                      f'{label_of(k)}</button>' for j, k in enumerate(keys_l))
                  + '</div>')
        for j, k in enumerate(keys_l):
            lis = ''.join(bs_row(r, site, k, n + 1) for n, r in enumerate(lens_segs[lk][k]))
            on = ' on' if first else ''
            first = False
            bbody += (f'<section class="seg{on}" data-k="{lk}:{esc(k)}">'
                      f'<p class="seghead">{label_of(k)}</p><ul class="list">{lis}</ul></section>')
    tabs = lens_tabs
    keys = [k for lk in lens_segs for k in lens_segs[lk]]
    rows = rows_raw

    # EXPLORER — a curated shelf, capped like the others so it does not become
    # one producer's catalogue page.
    pref_e = 'W' if site == 'WN' else 'L'
    used_e = brand_count()
    erows, n_exp = [], 0
    for sku, reason, nth, nen in explorer.candidates(
            pref_e, bsdata.products(), bsdata.stories(), lambda s: STOCK.get(s, 0)):
        c = bsdata.products().get(sku)
        if not c or not used_e(brand_of_sku(sku, cat, c.get('name', ''))):
            continue
        n_exp += 1
        erows.append(explorer_row(sku, c, site, n_exp, reason, nth, nen))
        if n_exp >= explorer.DEPTH:
            break
    ebody = ''.join(erows)

    doc = f'''<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{th} มาแรงและขายดี · {en} trending & best sellers — Wine-Now × LIQ9</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600&family=Noto+Serif+Thai:wght@400;500&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>

<header class="top"><div class="wrap topin">
 <p class="mark">Wine-Now <i>×</i> LIQ9</p>
 <div class="right">
  <a class="swap" href="{other['live']}" target="_blank" rel="noopener"
   >{two('ดู' + other['th'], other['en'])} &rsaquo;</a>
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
  <p class="kicker">{two('30 วันล่าสุด', 'Last 30 days')}</p>
  <h1>{two(f'{th}ที่ลูกค้าถามหามากที่สุด', f'The {en.lower()} customers keep asking for')}</h1>
  <p class="lede">{two(
    'อันดับนี้มาจากสิ่งที่ลูกค้าถามหาจริงผ่านทีมขายของเราในรอบ 30 วันล่าสุด '
    'ขวดที่มีคนสอบถาม สั่งจอง และกลับมาตามหาซ้ำมากที่สุด',
    'This list comes from what customers actually asked our team for over the last 30 days '
    '— the bottles people enquired about, reserved, and came back looking for.')}</p>
  {inote}
 </div>
 </div><div class="segbar"><div class="wrap"><div class="rail">{ttabs}</div></div></div><div class="wrap">{tsecs}</div>
</section>

<section class="view" data-v="b">
 <div class="wrap"><div class="hero">
  <p class="kicker">{two('ขายดีที่สุดในร้าน', 'Best sellers')}</p>
  <h1>{two(f'{th}ขายดี', f'{en} best sellers')}</h1>
  <p class="lede">{two(
    'จัดอันดับจากยอดขายจริงของร้าน แยกตามช่วงราคาและประเทศ อันดับละ 10 รายการ',
    'Ranked on our own sales, split by price band and by country, ten bottles in each.')}</p>
 </div></div>
 <div class="segbar"><div class="wrap"><div class="lensrow">{tabs}</div>{rails}</div></div>
 <div class="wrap">{bbody}</div>
</section>

<section class="view" data-v="e">
 <div class="wrap"><div class="hero">
  <p class="kicker">{two('คัดมาเล่า', 'Worth a mention')}</p>
  <h1>{two(f'{th}ที่น่าค้นหา', f'{en} worth exploring')}</h1>
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
</main><script>{JS}</script></body></html>'''
    return doc, len(items), len(icons), len(keys), len(rows), n_core, n_fill, n_shown_new, n_exp

if __name__ == '__main__':
    # Gate first: never write a page whose data is older than the page implies.
    try:
        freshness.check(['trending', 'bestsellers'])
    except freshness.StaleFeed as e:
        print(e); sys.exit(2)

    for site in ('WN', 'LQ'):
        doc, n, ic, sg, rw, nc, nf, nn, ne = build(site)
        p = PAGES[site]['file']
        open(OUT + p, 'w', encoding='utf-8').write(doc)
        mv = sum(len(v) for v in PREV.get(site, {}).values())
        print(f'  {p:<12} {len(doc)/1024:>5.0f} KB   trending {n:>2} '
              f'({nc} core + {nf} fill, {ic} icons, {nn} new)   '
              f'best sellers {sg} segments / {rw} rows   explorer {ne}   movement {mv}')
