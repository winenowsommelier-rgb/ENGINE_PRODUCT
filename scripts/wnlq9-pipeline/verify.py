# -*- coding: utf-8 -*-
"""
verify.py — the §7 checklist, re-implemented and run against whatever directory
is passed in. Reports per-check pass/fail with numbers, never a bare "ok".

The two known traps are handled explicitly:
  · the Thai-leak scan must exclude U+0E3F (฿, which sits in the Thai block) and
    the language switcher itself, and must be parser-based so nested spans count
    against the *innermost* enclosing language span;
  · the margin/cost scan must run on RENDERED TEXT, not raw HTML, or the CSS
    declaration `margin:0` matches.
"""
import sys, os, re, json, subprocess, html as H
from html.parser import HTMLParser
from collections import defaultdict

DIR   = sys.argv[1] if len(sys.argv) > 1 else os.environ.get(
    'WNLQ9_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
PAGES = ['wine.html', 'liquor.html', 'wnlq9.html', 'clearance-wn-liq9.html', 'unmet-demand.html']
PAGES = [p for p in PAGES if os.path.exists(os.path.join(DIR, p))]

# A verifier that finds no pages has verified nothing. Reporting "0/0 passing"
# reads as success to any caller matching on passed==total, which is how a run
# that built nothing was recorded as "verification passed" on 4 Sep 2026.
# Verifying nothing is a failure, not a pass.
if not PAGES:
    print(f'\nVERIFY FAILED — no pages found in {DIR}\n'
          f'  expected any of: wine.html, liquor.html, wnlq9.html, unmet-demand.html\n'
          f'  nothing was checked, so nothing is proven. Check the build wrote where\n'
          f'  this is reading (WNLQ9_OUT), and that the build ran at all.\n')
    sys.exit(1)

results = []          # (check, page, passed, detail)
def rec(check, page, ok, detail=''):
    results.append((check, page, ok, detail))

VOID = {'br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'col', 'wbr', 'area', 'base', 'embed'}


class Reader(HTMLParser):
    """Collects rendered text per language context, plus tag balance and anchors."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.lang_stack = [], []
        self.text_all, self.text_en, self.text_th = [], [], []
        self.unbalanced, self.anchors, self.imgs = [], [], []
        self.in_script = self.in_style = 0
        self.script_src, self.style_src = [], []
        self.span_th = self.span_en = 0
        self.switcher = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get('class') or '').split()
        if tag == 'script':
            self.in_script = 1
        if tag == 'style':
            self.in_style = 1
        if tag == 'a':
            self.anchors.append(a)
        if tag == 'img':
            self.imgs.append(a)
        # language switcher buttons are chrome, not content — they legitimately
        # carry Thai in both modes
        sw = 1 if ('lang' in cls or 'langsw' in cls or a.get('id') == 'lang' or
                   a.get('data-lang') is not None) else 0
        lang = 'th' if 'th' in cls else ('en' if 'en' in cls else None)
        if tag not in VOID:
            self.stack.append((tag, lang, sw))
            if lang:
                self.lang_stack.append(lang)
            if sw:
                self.switcher += 1
        if tag == 'span':
            if lang == 'th':
                self.span_th += 1
            elif lang == 'en':
                self.span_en += 1

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = 0
        if tag == 'style':
            self.in_style = 0
        if tag in VOID:
            return
        if not self.stack or self.stack[-1][0] != tag:
            found = None
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    found = i
                    break
            if found is None:
                self.unbalanced.append(('stray close', tag))
                return
            self.unbalanced.append(('implicit close', self.stack[found + 1][0]))
            while len(self.stack) > found:
                self._pop()
            return
        self._pop()

    def _pop(self):
        tag, lang, sw = self.stack.pop()
        if lang and self.lang_stack:
            self.lang_stack.pop()
        if sw:
            self.switcher -= 1

    def handle_data(self, d):
        if self.in_script:
            self.script_src.append(d)
            return
        if self.in_style:
            self.style_src.append(d)
            return
        if not d.strip():
            return
        self.text_all.append(d)
        if self.switcher > 0:
            return                       # chrome, excluded from the leak scan
        ctx = self.lang_stack[-1] if self.lang_stack else None
        (self.text_en if ctx == 'en' else self.text_th if ctx == 'th' else self.text_all).append(d)
        if ctx == 'en':
            self.text_en.append(d)
        elif ctx == 'th':
            self.text_th.append(d)


THAI = re.compile(r'[\u0E00-\u0E7F]')
BAHT = '\u0E3F'          # ฿ — Thai block, but a currency mark, not Thai text

for page in PAGES:
    raw = open(os.path.join(DIR, page), encoding='utf-8').read()
    p = Reader()
    p.feed(raw)

    # 1 — every <script> parses
    scripts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', raw, re.S)
    bad = 0
    for n, s in enumerate(scripts):
        if not s.strip():
            continue
        f = f'/tmp/{page}.{n}.js'
        open(f, 'w', encoding='utf-8').write(s)
        r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
        if r.returncode:
            bad += 1
            print('   node --check FAILED', page, r.stderr.splitlines()[:3])
    rec('node --check on every script', page, bad == 0, f'{len(scripts)-bad}/{len(scripts)} parse')

    # 2 — CSS braces + tag structure
    css = ''.join(p.style_src)
    cb = css.count('{') - css.count('}')
    rec('CSS braces balanced', page, cb == 0, f'delta {cb}')
    rec('tag structure balanced', page, not p.unbalanced and not p.stack,
        f'{len(p.unbalanced)} mismatch, {len(p.stack)} unclosed')

    # 3 — anchors
    ext = [a for a in p.anchors if (a.get('href') or '').startswith('http')]
    noblank = [a for a in ext if a.get('target') != '_blank']
    top = [a for a in p.anchors if a.get('target') == '_top']
    rec('every external anchor target=_blank', page, not noblank,
        f'{len(ext)} external, {len(noblank)} without')
    rec('no target=_top', page, not top, f'{len(top)} found')

    # 4 — storage
    st = len(re.findall(r'\b(?:local|session)Storage\b', raw))
    rec('no localStorage / sessionStorage', page, st == 0, f'{st} refs')

    # 5 — bare object-fit
    bare = [m for m in re.findall(r'object-fit\s*:\s*[a-z-]+', css)]
    rec('no bare object-fit', page, not bare, f'{len(bare)} found')

    # 6 — type floor and touch targets
    sizes = [float(x) for x in re.findall(r'font-size\s*:\s*([\d.]+)px', css)]
    small = [s for s in sizes if s < 12]
    rec('type floor >= 12px', page, not small,
        f'{len(sizes)} declarations, min {min(sizes) if sizes else "-"}px')
    ctl = re.findall(r'(?:\.tab|\.sw|button|\.pill|\.chipbtn|\.pg)[^{}]*\{[^}]*\}', css)
    hits = re.findall(r'min-height\s*:\s*([\d.]+)px', css)
    bad_ctl = [h for h in hits if float(h) < 44]
    rec('controls >= 44px', page, not bad_ctl,
        f'{len(hits)} min-height decls, {len(bad_ctl)} under 44px')

    # 7 — no Thai inside an EN context
    leaks = [t for t in p.text_en if THAI.sub('', t.replace(BAHT, ''))
             != t.replace(BAHT, '')]
    rec('no Thai renders in EN mode', page, not leaks, f'{len(leaks)} leaks')

    # 8 — TH / EN spans in step
    rec('TH/EN spans in step', page, p.span_th == p.span_en,
        f'{p.span_th} th / {p.span_en} en')

    # 10 — margin / cost / sales quantity, on RENDERED text only
    rendered = ' '.join(p.text_all)
    money = re.findall(r'\b(?:margin|cost|กำไร|ต้นทุน)\b', rendered, re.I)
    qty = re.findall(r'(?:ขายไป|ขายแล้ว|sold|units sold|ลูกค้า\s*\d+\s*ราย)', rendered, re.I)
    rec('no margin / cost in rendered content', page, not money, f'{len(money)} hits')
    # unmet-demand.html is the INTERNAL buying report — client counts are its
    # whole point. The no-demand-numbers rule is a customer-page rule.
    if page != 'unmet-demand.html':
        rec('no sales quantity in rendered content', page, not qty, f'{len(qty)} hits')
    payload = ''.join(p.script_src)
    leak2 = re.findall(r'"?(?:margin_thb|cost|sold_qty|popularity_qty|clients)"?\s*[:=]', payload)
    rec('no margin / sales field in payload', page, not leak2, f'{len(leak2)} hits')

    # 11 — exact stock figures only at 1..12
    ex = [int(n) for n in re.findall(r'เหลือ\s*(\d+)\s*ขวด', rendered)]
    ex += [int(n) for n in re.findall(r'(\d+)\s*(?:bottles?|left)\b', rendered)]
    bad_ex = [n for n in ex if not 1 <= n <= 12]
    rec('exact stock only 1-12', page, not bad_ex,
        f'{len(ex)} exact figures, {len(bad_ex)} out of range')

    # 12 — host routing by SKU prefix, paired WITHIN one card block.
    # Hero cards are <a href><img></a> (href first) and list rows are
    # <li><img>...<a href></a></li> (img first) — pairing across the whole
    # document silently couples card N's image to card N+1's link.
    wrong, cards = 0, []
    blocks = re.findall(r'<li class="row"[^>]*>.*?</li>', raw, re.S)
    blocks += re.findall(r'<a class="hcard"[^>]*>.*?</a>', raw, re.S)
    blocks += re.findall(r'<tr[^>]*>.*?</tr>', raw, re.S)
    for b in blocks:
        sk = re.search(r'/media/catalog/product/[^"]*?/([a-z]{3}\d{4}[a-z]{2})', b)
        hr = re.search(r'href="(https://[^"]+)"', b)
        if not (sk and hr):
            continue
        cards.append((sk.group(1), hr.group(1)))
    for sku, url in cards:
        host = 'th.liq9.asia' if sku[0] == 'l' else 'th.wine-now.com'
        if not url.startswith('https://' + host):
            wrong += 1
            print('   host mismatch', page, sku, url[:80])
    rec('host routing per SKU prefix', page, wrong == 0, f'{len(cards)} pairs, {wrong} wrong')

# 9 — duplicate product family within any one list (needs the build helper)
sys.path.insert(0, os.environ.get(
    'WNLQ9_CLR', os.path.dirname(os.path.abspath(__file__))))
try:
    from build5 import family
except Exception:
    def family(n):
        n = re.sub(r'\((?:[^()]*)\)', '', n)
        n = re.sub(r'\b(?:19|20)\d{2}\b', '', n)
        return re.sub(r'[^a-z0-9 ]', ' ', n.lower()).split().__str__()

for page in PAGES:
    raw = open(os.path.join(DIR, page), encoding='utf-8').read()
    dupes = 0
    lists = 0
    for lst in re.findall(r'<(?:ul|ol)[^>]*class="[^"]*(?:list|lb|grid)[^"]*"[^>]*>(.*?)</(?:ul|ol)>',
                          raw, re.S):
        lists += 1
        names = re.findall(r'<a class="(?:rname|bname|lname)"[^>]*>([^<]+)</a>', lst)
        fams = [family(H.unescape(n)) for n in names]
        seen = defaultdict(int)
        for f in fams:
            seen[f] += 1
        dupes += sum(v - 1 for v in seen.values() if v > 1)
    rec('no duplicate product family in any list', page, dupes == 0,
        f'{lists} lists, {dupes} duplicates')

# ---- report ----
by_check = defaultdict(list)
for c, pg, ok, d in results:
    by_check[c].append((pg, ok, d))

npass = sum(1 for *_, ok, _ in ((None, *r) for r in results) if ok)
npass = sum(1 for r in results if r[2])
print(f'\n{npass}/{len(results)} checks passing across {len(PAGES)} pages  [{DIR}]\n')
w = max((len(c) for c in by_check), default=1)
for c, rows in by_check.items():
    ok = all(o for _, o, _ in rows)
    print(('  PASS  ' if ok else '  FAIL  ') + c.ljust(w) + '   ' +
          '; '.join(f'{pg.split(".")[0]}: {d}' for pg, o, d in rows if not ok or True))

# Exit code, so callers do not have to scrape stdout to learn whether this passed.
sys.exit(0 if npass == len(results) and results else 1)
