#!/usr/bin/env python3
"""One-time downloader: fetch wine appellations from Wikidata SPARQL.

Writes data/lib/enrichment/taxonomy/wikidata_appellations.json.

Usage:
    python data/build_wikidata_appellations.py
"""
from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT_FILE = Path(__file__).resolve().parent / "lib/enrichment/taxonomy/wikidata_appellations.json"

SPARQL_QUERY = """
SELECT DISTINCT ?appellation ?appellationLabel ?country ?countryLabel ?region ?regionLabel ?subregion ?subregionLabel WHERE {
  ?appellation wdt:P31/wdt:P279* wd:Q56122 .
  OPTIONAL { ?appellation wdt:P17 ?country . }
  OPTIONAL { ?appellation wdt:P131 ?region . }
  OPTIONAL { ?appellation wdt:P131 ?subregion .
             ?subregion wdt:P31/wdt:P279* wd:Q56122 . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
LIMIT 3000
"""


def run_sparql(query: str) -> list[dict]:
    url = "https://query.wikidata.org/sparql"
    params = urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(
        f"{url}?{params}",
        headers={"User-Agent": "WineNowTaxonomyBot/1.0 (winenowsommelier@gmail.com)"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("results", {}).get("bindings", [])


def parse_binding(b: dict) -> dict:
    def val(key: str) -> str:
        return b.get(key, {}).get("value", "")
    wikidata_id = val("appellation").split("/")[-1] if val("appellation") else ""
    return {
        "name":        val("appellationLabel"),
        "country":     val("countryLabel"),
        "region":      val("regionLabel"),
        "subregion":   val("subregionLabel"),
        "wikidata_id": wikidata_id,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=3000)
    args = ap.parse_args()

    print(f"Querying Wikidata SPARQL for wine appellations...")
    try:
        bindings = run_sparql(SPARQL_QUERY)
    except Exception as e:
        print(f"ERROR: SPARQL query failed: {e}")
        print("Writing empty cache — pipeline will skip Layer 0.")
        OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        OUT_FILE.write_text("[]", encoding="utf-8")
        return

    records = []
    seen: set[str] = set()
    for b in bindings[:args.limit]:
        r = parse_binding(b)
        if not r["name"] or r["name"] in seen:
            continue
        seen.add(r["name"])
        records.append(r)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(records)} appellations to {OUT_FILE}")


if __name__ == "__main__":
    main()
