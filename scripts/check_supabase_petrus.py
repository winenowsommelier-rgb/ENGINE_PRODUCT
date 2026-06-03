"""One-off probe: confirm Supabase has the v3 enriched description for Petrus.

The admin /api/products/[id] route reads from Supabase, so a successful
DB→Supabase sync is the only thing that puts the rich full_description in the UI.
"""
import urllib.request, json, sys
env = {}
for p in ('.env.local', '.env'):
    try:
        for line in open(p):
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k,v = line.split('=', 1)
            env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except FileNotFoundError:
        pass
url = env.get('NEXT_PUBLIC_SUPABASE_URL') or env.get('SUPABASE_URL')
key = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
if not (url and key):
    print('Missing supabase env', file=sys.stderr); sys.exit(1)
req = urllib.request.Request(
    f'{url}/rest/v1/products?sku=eq.WRW5086AF&select=*&limit=1',
    headers={'apikey': key, 'Authorization': f'Bearer {key}'},
)
try:
    rows = json.loads(urllib.request.urlopen(req, timeout=30).read())
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read().decode('utf-8', 'replace'))
    sys.exit(3)
if not rows:
    print('No rows in Supabase for WRW5086AF')
    sys.exit(2)
p = rows[0]
print('id:', p.get('id'))
print('sku:', p.get('sku'))
print('available description columns:')
for k in sorted(p.keys()):
    if 'desc' in k.lower() or 'description' in k.lower() or 'full' in k.lower():
        v = p[k]
        if isinstance(v, str):
            print(f'  {k}: len={len(v)} preview={v[:140]!r}')
        else:
            print(f'  {k}: {v!r}')
print()
print('all columns:', sorted(p.keys()))
