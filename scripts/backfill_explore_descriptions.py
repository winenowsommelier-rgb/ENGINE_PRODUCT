#!/usr/bin/env python3
"""
backfill_explore_descriptions.py — generate region/subregion descriptions for the
catalog Explore-by-Region map, for the map-visible set that lacks one in
data/taxonomy.db (taxonomy_contexts.description_en).

Voice is matched to the existing curated descriptions (Bordeaux/Champagne/Burgundy):
factual sommelier prose, ~180-260 chars, name the key grapes/styles/classification,
no marketing fluff. Writes back to taxonomy.db (taxonomy_contexts.description_en +
description_short). Idempotent: only fills rows where description_en is missing/short.

CLAUDE.md Rule 10: run `--canary N` first, eyeball the output, get sign-off, THEN
run the full job. Rule 1/4: prints a populated-count + per-row cost at the end and
verifies the write landed in taxonomy.db.

Usage:
  .venv/bin/python scripts/backfill_explore_descriptions.py --canary 3   # 3 samples, NO write
  .venv/bin/python scripts/backfill_explore_descriptions.py --run        # full job, writes db
"""
import argparse
import json
import os
import sqlite3
import sys
import time

DB = "data/taxonomy.db"
MAP_DATA = "apps/catalog/data/explore-map-data.json"
MODEL = "claude-sonnet-4-6"  # high-volume, low-complexity classification-style task; user is paying
IN_PRICE = 3.0 / 1e6   # $/token
OUT_PRICE = 15.0 / 1e6

SYSTEM = (
    "You are a master sommelier writing short, factual reference descriptions for a "
    "premium wine & spirits retailer's region map. Match this voice exactly:\n"
    "- 'Bordeaux is the reference point for fine wine. Left Bank produces Cabernet-dominant "
    "blends from gravel. Right Bank favours Merlot on clay-limestone.'\n"
    "- 'Champagne's cool climate and chalk soils produce base wines with high acidity. "
    "Chardonnay, Pinot Noir, and Pinot Meunier are the three main grapes.'\n"
    "Rules: 180-260 characters. Name the signature grape(s)/spirit/style and what makes the "
    "place distinctive (climate, soil, classification, tradition). Factual, specific, no "
    "marketing adjectives ('stunning', 'world-class'), no first person, no emoji."
)


def load_targets():
    """Return [(entity_id, name, entity_type, parent_name)] for the map-visible set
    that lacks a description: curated regions + subregions under curated regions +
    curated countries. Skips anything that already has description_en > 40 chars."""
    con = sqlite3.connect(DB)
    data = json.load(open(MAP_DATA))
    curated_regions = {r["name"] for r in data["regions"]}
    curated_countries = {r["country"] for r in data["regions"] if r["country"]}

    def needs(name, etype):
        row = con.execute(
            """SELECT te.id, tc.description_en FROM taxonomy_entities te
               LEFT JOIN taxonomy_contexts tc ON tc.entity_id = te.id
               WHERE lower(te.name)=lower(?) AND te.entity_type=? LIMIT 1""",
            (name, etype),
        ).fetchone()
        if not row:
            return None  # entity not in taxonomy at all — skip (can't write a context)
        eid, desc = row
        if desc and len(desc) > 40:
            return None  # already has one
        return eid

    targets = []
    for c in sorted(curated_countries):
        eid = needs(c, "country")
        if eid:
            targets.append((eid, c, "country", None))
    for rname in sorted(curated_regions):
        eid = needs(rname, "region")
        if eid:
            targets.append((eid, rname, "region", None))
        # subregions under this region
        rid = con.execute(
            "SELECT id FROM taxonomy_entities WHERE lower(name)=lower(?) AND entity_type='region' LIMIT 1",
            (rname,),
        ).fetchone()
        if rid:
            for sid, sname in con.execute(
                "SELECT id, name FROM taxonomy_entities WHERE parent_id=? AND entity_type='subregion'",
                (rid[0],),
            ):
                d = con.execute(
                    "SELECT description_en FROM taxonomy_contexts WHERE entity_id=? LIMIT 1", (sid,)
                ).fetchone()
                if not (d and d[0] and len(d[0]) > 40):
                    targets.append((sid, sname, "subregion", rname))
    con.close()
    return targets


def generate(client, name, etype, parent):
    where = f"the {etype} of {name}" + (f", in {parent}" if parent else "")
    user = (
        f"Write a reference description for {where}. Return ONLY a JSON object: "
        '{"short": "<one sentence, <=100 chars>", "full": "<180-260 chars, see rules>"}'
    )
    resp = client.messages.create(
        model=MODEL,
        max_tokens=400,
        system=SYSTEM,
        messages=[{"role": "user", "content": user}],
    )
    text = next(b.text for b in resp.content if b.type == "text").strip()
    # tolerate code fences
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[1].rsplit("```", 1)[0]
    obj = json.loads(text)
    usage = resp.usage
    return obj["short"], obj["full"], usage.input_tokens, usage.output_tokens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--canary", type=int, metavar="N", help="generate N samples, DO NOT write")
    ap.add_argument("--run", action="store_true", help="full job, writes to taxonomy.db")
    args = ap.parse_args()
    if not args.canary and not args.run:
        ap.error("pass --canary N or --run")

    import anthropic

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from env

    targets = load_targets()
    print(f"map-visible entities missing a description: {len(targets)}")
    if args.canary:
        targets = targets[: args.canary]
        print(f"CANARY: generating {len(targets)} samples (NO DB WRITE)\n")

    con = sqlite3.connect(DB) if args.run else None
    in_tok = out_tok = 0
    written = 0
    for eid, name, etype, parent in targets:
        try:
            short, full, it, ot = generate(client, name, etype, parent)
        except Exception as e:
            print(f"  [SKIP] {name} ({etype}): {e}")
            continue
        in_tok += it
        out_tok += ot
        print(f"--- {name} ({etype}{', '+parent if parent else ''}) [{len(full)} chars] ---")
        print(f"  short: {short}")
        print(f"  full:  {full}")
        if args.run:
            # upsert into taxonomy_contexts. scope_id: reuse the entity's existing context
            # scope if present, else default scope 1 (wine). Keep it simple — one row per entity.
            row = con.execute("SELECT id FROM taxonomy_contexts WHERE entity_id=? LIMIT 1", (eid,)).fetchone()
            if row:
                con.execute(
                    "UPDATE taxonomy_contexts SET description_short=?, description_en=? WHERE id=?",
                    (short, full, row[0]),
                )
            else:
                con.execute(
                    "INSERT INTO taxonomy_contexts (entity_id, scope_id, description_short, description_en, status) "
                    "VALUES (?, 1, ?, ?, 'ai_generated')",
                    (eid, short, full),
                )
            con.commit()
            written += 1
        time.sleep(0.2)  # gentle pacing

    cost = in_tok * IN_PRICE + out_tok * OUT_PRICE
    print("\n==== COST REPORT (CLAUDE.md Rule 4) ====")
    print(f"  model:           {MODEL}")
    print(f"  API calls:       {len(targets)}")
    print(f"  input tokens:    {in_tok}")
    print(f"  output tokens:   {out_tok}")
    print(f"  total spend:     ${cost:.4f}")
    if args.run:
        # Rule 1: verify the write landed in the destination.
        con2 = sqlite3.connect(DB)
        ids = tuple(t[0] for t in targets) or (0,)
        q = "SELECT count(*) FROM taxonomy_contexts WHERE entity_id IN (%s) AND length(coalesce(description_en,''))>40" % (
            ",".join("?" * len(ids))
        )
        populated = con2.execute(q, ids).fetchone()[0]
        con2.close()
        print(f"  rows written:    {written}")
        print(f"  VERIFIED populated in taxonomy.db: {populated}/{len(targets)}")
        per = cost / written if written else 0
        print(f"  per-successful-row cost: ${per:.4f}")
        if populated < written:
            print("  WARNING: fewer populated than written — investigate before claiming done.")
    else:
        print("  (canary — nothing written; re-run with --run after sign-off)")


if __name__ == "__main__":
    main()
