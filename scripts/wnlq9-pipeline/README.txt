WNLQ9 pipeline — see HANDOFF.md for the full brief.

NOT IN THIS REPOSITORY: stock_checks.csv
  It carries 169 named trade clients and this repository is PUBLIC. It is
  deliberately gitignored. Supply it locally before running prep3/unmet:
  export the Stock_Checks tab, or set STOCK_CHECKS_CSV to the published-CSV
  link and let refresh.py pull it. Everything else runs without it; prep3.py
  and unmet.py are the only consumers.
  Per SYNC-SPEC §3.3 this data must never reach a customer page unaggregated.
  trending_demand.json is the aggregated form and is safe: it stores a client
  COUNT, never a name.

Run order:
  prep3.py    Stock_Checks -> demand scores
  build5.py   -> wine.html, liquor.html
  build6.py   -> wnlq9.html   (imports build5)
  prep_clr.py -> items.json ; build_clr2.py -> clearance page
  unmet.py    -> internal unmet-demand report

Paths default to the directory this file is in, so an unzip-and-run works with
no editing. Override with environment variables if you need to:

    WNLQ9_CLR   input/data dir   (default: this directory)
    WNLQ9_OUT   built pages      (default: ./out, created on demand)
    WNLQ9_LINKS_CSV_GLOB  product URL export winenow-base-images-*.csv

WNLQ9_OUT is read by build5, build6, unmet, refresh AND verify, so the build and
the verifier cannot drift apart. Do not hardcode one of them to something else:
a verifier pointed at an empty directory proves nothing, and used to say so in
language that read as success.

blurbs.json is generated from blurbs.tsv:
  python3 -c "import json;d={}
  [d.update({p[0]:{'body':p[1],'tags':p[2],'en':p[3]}}) for p in
   (l.rstrip(chr(10)).split('|') for l in open('blurbs.tsv',encoding='utf-8') if l.strip())]
  json.dump(d,open('blurbs.json','w'),ensure_ascii=False)"

AUTOMATION  (refresh.py + sql/ + run_weekly.sh)

  refresh.py does in one command what used to be a chat session: pull every
  feed from Supabase, rewrite the derived files, restamp feeds.json, rebuild
  all three pages, run verification.

      ./refresh.py              pull, rebuild, verify
      ./refresh.py --offline    rebuild from the files already on disk
      ./refresh.py --dry-run    report what would change, write nothing

  It needs a host with network access to Supabase — the Claude sandbox has
  none, which is why these data files exist as files at all:

      export DATABASE_URL='postgresql://...@db.dsyplzckfezcxiuikkfm.supabase.co:5432/postgres'
      export STOCK_CHECKS_CSV='https://docs.google.com/.../pub?gid=...&output=csv'
      pip install "psycopg[binary]"

  STOCK_CHECKS_CSV is the Stock_Checks tab published as CSV. Set it and the
  weekly manual export disappears — that is the last hand step in the pipeline.

  sql/ holds every query as a versioned file. They were previously typed into a
  chat session, which meant nobody but that session could reproduce a build.

  refresh.py exits 1 when a feed is stale or verification fails. run_weekly.sh
  does NOT set WNLQ9_ALLOW_STALE, on purpose: the override belongs in a human's
  hand for one deliberate build, never in a cron line.

  As of 31 Aug 2026 a real run stops at build5/build6 because popularity is
  41 days old. That is the correct behaviour and it will keep happening until
  the popularity job in SYNC-SPEC.md §3.2 exists.

BEST SELLERS NOW RANK ON REAL ORDERS  (mreport.py)

  Source: the 'MReport Item Performance' tab of DATA: WNLQ9 Performance —
  monthly Orders and Qty Ordered per SKU back to Jan 2023, refreshed weekly,
  and the same data behind the BI API.

  This replaces products.popularity_qty_90d, frozen at 21 July with no job
  behind it. SYNC-SPEC §3.2 is no longer needed.

  Setup, one step: publish that tab as CSV (File > Share > Publish to web >
  MReport Item Performance > CSV) and set MREPORT_CSV to the link. Until then
  bsdata falls back to the old frozen columns and says so.

  Window: mreport.WINDOW_MONTHS, default 3 complete months. The current month is
  excluded — a month in progress always looks like a sales collapse, and a
  ranking that demotes everything for three weeks of every month is worse than
  one that lags by one. Because the window is now a decision rather than a
  mystery, the pages can finally state the period out loud.

  PARSING: Total (THB) carries a thousands separator and is not always quoted,
  so '...,40.68%,3,439' is one value. mreport.parse reads the head from the left
  and the tail from the right. Fourth file in this stack with an unquoted
  delimiter inside a field — assume every export from here is unquoted until
  proven otherwise.

  Orders and Qty rank only. Total (THB) and Gross Margin % are never read into
  the build at all, let alone rendered.
