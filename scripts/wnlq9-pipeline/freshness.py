# -*- coding: utf-8 -*-
"""
freshness.py — refuse to publish a page whose data is older than it claims.

WHY THIS EXISTS
  On 28 Aug 2026 the best-seller rankings on all three pages were built from
  `popularity_qty_90d` values whose newest sync stamp was 21 July — 38 days
  old — and every one of the 52 markup tests passed, because all 52 checked
  the HTML and none checked the age of the data behind it. A page can be
  perfectly formed and still be lying about what is selling this week.

  This module is the missing check. It runs BEFORE a build writes anything.

MODEL
  Each feed declares when it was last refreshed, how old it may get, and which
  page sections depend on it.

    blocking  the section would assert something time-sensitive that is no
              longer true — a "best sellers" ranking, a live demand list, a
              campaign price. Build stops.
    warn      the data drifts but the page stays broadly honest — catalog
              copy, product URLs. Build continues, banner printed.

  Blocking is deliberately narrow. A gate that fires on everything gets
  overridden permanently, which is the same as no gate.

OVERRIDE
  Set WNLQ9_ALLOW_STALE to a comma-separated list of feed names to build past
  a blocking feed. It is loud, it is per-feed, and it writes the override into
  build_receipt.json so there is a record of what was published from what.

    WNLQ9_ALLOW_STALE=popularity python3 build5.py

  Note what an override does NOT do: it does not make the page say how old its
  data is. If a section is going to ship stale, the honest fix is a dated
  provenance line in the section header — that is a visible design change and
  needs Pawin's sign-off before it goes in.
"""
import json, os, sys, datetime

HERE   = os.path.dirname(os.path.abspath(__file__))
FEEDS  = os.path.join(HERE, 'feeds.json')
RECEIPT = os.path.join(HERE, 'build_receipt.json')
TODAY  = datetime.date.today()


class StaleFeed(Exception):
    pass


def _age(as_of):
    return (TODAY - datetime.date.fromisoformat(as_of)).days


def load():
    with open(FEEDS, encoding='utf-8') as fh:
        return json.load(fh)['feeds']


def status():
    """Every feed with its age and verdict."""
    out = []
    for name, f in sorted(load().items()):
        age = _age(f['as_of'])
        over = age > f['max_age_days']
        out.append({'feed': name, 'as_of': f['as_of'], 'age_days': age,
                    'max_age_days': f['max_age_days'],
                    'severity': f['severity'], 'sections': f['sections'],
                    'source': f['source'], 'stale': over})
    return out


def report(rows=None):
    rows = rows or status()
    w = max(len(r['feed']) for r in rows)
    print('  feed freshness')
    for r in rows:
        mark = 'OK   ' if not r['stale'] else ('STALE' if r['severity'] == 'blocking' else 'warn ')
        print(f"    {mark} {r['feed'].ljust(w)}  {r['as_of']}  "
              f"{r['age_days']:>4}d / {r['max_age_days']}d   {', '.join(r['sections'])}")


def check(sections, quiet=False):
    """Gate a build. `sections` is what this build is about to render.

    Raises StaleFeed on a blocking feed unless it is named in WNLQ9_ALLOW_STALE.
    """
    rows = status()
    if not quiet:
        report(rows)

    allowed = {s.strip() for s in os.environ.get('WNLQ9_ALLOW_STALE', '').split(',') if s.strip()}
    wanted = set(sections)
    blocked, overridden, warned = [], [], []

    for r in rows:
        if not r['stale'] or not (wanted & set(r['sections'])):
            continue
        if r['severity'] != 'blocking':
            warned.append(r)
        elif r['feed'] in allowed:
            overridden.append(r)
        else:
            blocked.append(r)

    for r in warned:
        print(f"  ! WARN  {r['feed']} is {r['age_days']}d old (limit {r['max_age_days']}d) "
              f"— {r['source']}")
    for r in overridden:
        print(f"  !! PUBLISHING STALE  {r['feed']} is {r['age_days']}d old, override in effect.\n"
              f"     Sections affected: {', '.join(sorted(wanted & set(r['sections'])))}\n"
              f"     Recorded in build_receipt.json.")

    if blocked:
        lines = ['', '  BUILD STOPPED — data older than the pages would imply.', '']
        for r in blocked:
            lines.append(f"    {r['feed']}: last refreshed {r['as_of']} "
                         f"({r['age_days']} days ago, limit {r['max_age_days']})")
            lines.append(f"      source:   {r['source']}")
            lines.append(f"      sections: {', '.join(sorted(wanted & set(r['sections'])))}")
        lines += ['',
                  '  Refresh the feed, or publish anyway with:',
                  f"    WNLQ9_ALLOW_STALE={','.join(r['feed'] for r in blocked)} python3 "
                  f"{os.path.basename(sys.argv[0] or 'build5.py')}",
                  '']
        raise StaleFeed('\n'.join(lines))

    receipt(sections, rows, overridden)
    return rows


def receipt(sections, rows, overridden):
    """An auditable record of what was built from data of what age."""
    prev = []
    if os.path.exists(RECEIPT):
        try:
            prev = json.load(open(RECEIPT, encoding='utf-8'))
        except Exception:
            prev = []
    prev.append({'built_at': datetime.datetime.now().isoformat(timespec='seconds'),
                 'script': os.path.basename(sys.argv[0] or '?'),
                 'sections': sorted(sections),
                 'published_stale': [r['feed'] for r in overridden],
                 'feeds': {r['feed']: {'as_of': r['as_of'], 'age_days': r['age_days']}
                           for r in rows}})
    json.dump(prev[-40:], open(RECEIPT, 'w', encoding='utf-8'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    report()
