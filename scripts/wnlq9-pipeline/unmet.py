# -*- coding: utf-8 -*-
"""
unmet.py — INTERNAL report. Demand we could not fill.

Every SKU a client asked for in the last 30 days where the product team came
back OOS / catalog-only / discontinued. This never goes on a customer page —
it goes to whoever does the buying.

Ranked by distinct clients, because two different accounts asking for the same
out-of-stock bottle is a buying signal; one account asking twice is not.
"""
import csv, json, html, os
import prep3, links

OUT = os.environ.get('WNLQ9_OUT', os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'out')).rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)

def build():
    rows = prep3.load()[0]
    scored = prep3.score(rows)
    unmet = [s for s in scored if s['unavail_hits'] > 0]
    unmet.sort(key=lambda x: (-x['clients'], -x['unavail_hits'], x['name']))

    # CSV for the buyer to work from
    with open(OUT + 'unmet-demand.csv', 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.writer(fh)
        w.writerow(['sku', 'name', 'distinct_clients', 'tickets', 'times_unavailable',
                    'partial_stock_seen', 'first_asked', 'last_asked', 'product_url'])
        for s in unmet:
            w.writerow([s['sku'], s['name'], s['clients'], s['tickets'],
                        s['unavail_hits'], 'yes' if s['avail_hits'] else 'no',
                        s['first_seen'], s['last_seen'],
                        links.LINKS.get(s['sku'], {}).get('url', '')])

    esc = lambda x: html.escape(str(x))
    hot = [s for s in unmet if s['clients'] >= 2]
    body = ''.join(f'''<tr>
<td class="n">{s['clients']}</td>
<td><a href="{links.LINKS.get(s['sku'],{}).get('url') or '#'}" target="_blank" rel="noopener">{esc(s['name'])}</a>
<span class="sku">{esc(s['sku'])}</span></td>
<td class="n">{s['tickets']}</td><td class="n">{s['unavail_hits']}</td>
<td>{'บางรอบมีของ' if s['avail_hits'] else '—'}</td>
<td class="d">{s['last_seen']}</td></tr>''' for s in unmet)

    doc = f'''<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ดีมานด์ที่ยังไม่ได้เติม — ภายในเท่านั้น</title>
<style>
body{{margin:0;font:400 15px/1.5 "IBM Plex Sans Thai",-apple-system,sans-serif;color:#111110;background:#fff}}
.wrap{{max-width:900px;margin:0 auto;padding:28px 20px 64px}}
.tag{{display:inline-block;background:#111110;color:#fff;font-size:12px;letter-spacing:.16em;
 text-transform:uppercase;padding:5px 9px;margin-bottom:14px}}
h1{{font-family:"Noto Serif Thai",serif;font-weight:500;font-size:28px;margin:0 0 8px}}
p.l{{color:#4C4A45;max-width:64ch;margin:0 0 22px;font-size:14px}}
table{{width:100%;border-collapse:collapse;font-size:14px}}
th{{text-align:left;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#4C4A45;
 border-bottom:1px solid #111110;padding:8px 8px 8px 0;font-weight:500}}
td{{border-bottom:1px solid #E5E2DA;padding:10px 8px 10px 0;vertical-align:top}}
td.n,th.n{{text-align:right;font-variant-numeric:tabular-nums;width:56px}}
td.d{{color:#6E6A63;font-variant-numeric:tabular-nums;white-space:nowrap}}
.sku{{display:block;font-size:12px;color:#6E6A63;letter-spacing:.06em}}
a{{color:#111110}}
.k{{display:flex;gap:0;border:1px solid #E5E2DA;margin-bottom:24px}}
.k div{{flex:1;padding:14px;border-right:1px solid #E5E2DA}}
.k div:last-child{{border-right:0}}
.k b{{display:block;font-family:"Cormorant Garamond",serif;font-size:30px;line-height:1}}
.k span{{font-size:12px;color:#4C4A45}}
</style></head><body><div class="wrap">
<span class="tag">Internal — do not publish</span>
<h1>ดีมานด์ที่ยังไม่ได้เติม</h1>
<p class="l">รายการที่ลูกค้าถามหาผ่านทีมขายในรอบ 30 วันล่าสุด แต่ทีมสินค้าตอบกลับว่าไม่มีของ
หรืออยู่ในแคตตาล็อกเท่านั้น เรียงตามจำนวนลูกค้าที่ถามหา — สองรายขึ้นไปคือสัญญาณให้พิจารณาสั่งเข้า</p>
<div class="k">
 <div><b>{len(unmet)}</b><span>รายการที่เติมไม่ได้</span></div>
 <div><b>{len(hot)}</b><span>ถามหาโดยลูกค้า 2 รายขึ้นไป</span></div>
 <div><b>{sum(s['unavail_hits'] for s in unmet)}</b><span>ครั้งที่ตอบว่าไม่มีของ</span></div>
</div>
<table><thead><tr><th class="n">ลูกค้า</th><th>สินค้า</th><th class="n">ทิกเก็ต</th>
<th class="n">ไม่มีของ</th><th>หมายเหตุ</th><th>ถามล่าสุด</th></tr></thead>
<tbody>{body}</tbody></table>
</div></body></html>'''
    open(OUT + 'unmet-demand.html', 'w', encoding='utf-8').write(doc)

    print(f'  unmet SKUs            {len(unmet)}')
    print(f'  asked by >=2 clients  {len(hot)}')
    print(f'  total OOS answers     {sum(s["unavail_hits"] for s in unmet)}')
    print(f'  with a product URL    {sum(1 for s in unmet if links.LINKS.get(s["sku"],{}).get("url"))}')
    print('\n  top by distinct clients:')
    for s in unmet[:8]:
        print(f'    {s["clients"]} client(s)  {s["sku"]:<12} {s["name"][:46]}')
    return unmet

if __name__ == '__main__':
    import sys, freshness
    try:
        freshness.check(['unmet'])
    except freshness.StaleFeed as e:
        print(e); sys.exit(2)
    build()
