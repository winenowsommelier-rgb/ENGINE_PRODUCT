#!/usr/bin/env python3
"""Curate brand-library entries via web research + verification.

What this does
--------------
For each brand in data/brand_curation_priorities.csv:
1. RESEARCHER call (Sonnet 4.6 + web_search tool): pulls facts from producer
   site, Wikipedia, top wine/spirits press. Drafts a structured JSON entry.
2. VERIFIER call (Haiku 4.5): cross-checks the draft against its cited
   sources. Marks claims VERIFIED / UNCERTAIN / SUSPECT.
3. If verifier confidence ≥ 0.6 and suspect_count ≤ 2 → write entry to
   brand_description_library.csv, tagged source_basis='web_research_validated'.
   Otherwise → flag for human review.

This is the upgrade path from the auto-generated stub entries to
research-grounded entries that the v3 storytelling prompt depends on.

Cost expectation: ~$0.30-0.50 per brand (Sonnet web research is input-heavy).
50 brands ≈ $15-25 total. 5-brand pilot first → review → continue.

Usage
-----
    # Pilot (5 brands, ~$2-3):
    .venv/bin/python scripts/curate_brand_library.py --limit 5

    # Full (50 brands, ~$15-25):
    .venv/bin/python scripts/curate_brand_library.py

    # Specific brands by name:
    .venv/bin/python scripts/curate_brand_library.py \\
        --brand "Chateau Margaux" --brand "Hennessy"

Concurrency: --workers N runs N research calls in parallel. Anthropic
SDK is thread-safe; default 5.

Safety per CLAUDE.md Rule 10:
  - Reads priorities from a separate CSV (not products.db) — no risk to live data
  - Brand-library CSV is backed up before writes
  - Per-brand try/except → log failure, continue
  - Verifier gate prevents low-quality entries from polluting the library
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PRIORITIES = REPO_ROOT / "data" / "brand_curation_priorities.csv"
DEFAULT_LIBRARY = REPO_ROOT / "data" / "brand_description_library.csv"
DEFAULT_FAILURES = REPO_ROOT / "data" / "brand_curation_failures.log"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    p = REPO_ROOT / ".env.local"
    if not p.exists():
        return out
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


# ── Researcher prompt ───────────────────────────────────────────────────────

RESEARCHER_SYSTEM = """You are a wine/spirits researcher producing FACTUAL brand-library entries for a premium Thai online retailer (Wine-Now). Output ONLY the JSON specified below — no preamble, no markdown.

Use the web_search tool aggressively. Source priorities (in order):
1. The producer's OFFICIAL website (.com, .fr, .it, .jp, .es, .au)
2. Wikipedia (English) — for founding dates, ownership lineage
3. CATEGORY PRESS:
   - Wine: Decanter, James Suckling, Wine Advocate (Robert Parker), Wine Spectator, Jancis Robinson
   - Spirits: Whisky Advocate, ScotchWhisky.com, Cognac.com, Diffordsguide
   - Sake: SakeTimes, JapanSake.com
4. Cross-check at least 2 sources before stating any fact.

FACTUAL DISCIPLINE — non-negotiable:
- If you cannot find solid evidence for a field, set it to null. Never guess.
- Do NOT invent founding dates, owners, scores, or appellation claims.
- If sources contradict, note the conflict in uncertainty_flags.
- Quote URLs you actually used; do not fabricate URL paths.

OUTPUT JSON (no preamble, no markdown — JUST the object):
{
  "brand": "exact brand name as given",
  "founded": "year + founder name, e.g. '1923 by Shinjiro Torii' (null if unknown)",
  "owner": "current parent company / family (null if independent / unknown)",
  "region": "specific region/appellation, e.g. 'Margaux AOC, Médoc, Left Bank Bordeaux'",
  "classification": "DOCG/AOC/grand cru classification — be precise. e.g. 'Premier Cru Classé (1855)' or 'Single malt Japanese whisky'",
  "signature_style": "2-3 sentences on what's DISTINCT about this producer's house style vs peers in the same category",
  "vineyard_or_distillery": "specific site facts: soil, elevation, aspect, water source, microclimate. Name the site if it has one.",
  "winemaking_or_production": {
    "vinification": "fermentation/distillation specifics — vessel, duration, yeast, temperature",
    "aging": "vessel type + duration + new/used wood %",
    "bottling": "unfined? unfiltered? chill-filtered? cask strength? ABV?"
  },
  "blend_typical_or_recipe": "typical varietal % / grain bill / rice type — be specific",
  "must_know": "1-2 sentences — what a sommelier should know: what's unusual, what rule does this producer break, what's pioneered here",
  "vintage_notes": {
    "year": "1-line vintage character (e.g. '2010: hot dry summer, structurally dense, drink 2025-2055')"
  },
  "sources": ["URL 1", "URL 2", "URL 3"],
  "confidence_self": 0.0-1.0,
  "uncertainty_flags": ["list specific facts you are NOT confident about — name them"]
}

Brand to research:"""


# ── Verifier prompt ─────────────────────────────────────────────────────────

VERIFIER_SYSTEM_TMPL = """You are a fact-checking verifier for a brand-library entry for __BRAND__. Your job is to assess whether the research is TRUSTWORTHY ENOUGH to use for premium-product descriptions — not to demand perfection.

CRITICAL FACTS (must verify against cited sources):
- Founding year and founder name
- Current owner / parent company
- Region/appellation/site location
- Category classification (DOCG, AOC, Single Malt, etc.)
- Specific awards, scores, or industry firsts that are mentioned

MINOR DETAILS (OK if not perfectly verified — do NOT penalize):
- Proprietary blend ratios that producers don't publish
- Internal production parameters (exact fermentation temperatures, yeast strains, cask split %)
- Personnel-history specifics (generational counts, first-woman-in-role claims)
- Stylistic/historical superlatives ("the world's largest", "single-handedly created")
- Minor numeric discrepancies across sources (e.g. 42 vs 43 stills)

If the researcher acknowledged uncertainty (in `uncertainty_flags`), that's GOOD self-awareness — don't double-penalize.

Output JSON ONLY (no markdown, no preamble):
{
  "verifier_notes": "1-3 sentences on overall quality",
  "critical_facts_verified": N,
  "critical_facts_suspect": N,
  "minor_uncertain_count": N,
  "suspect_claims": ["only CRITICAL claims that are unsupported — be specific"],
  "final_confidence": 0.0-1.0,
  "ready_for_library": true_or_false
}

Confidence calibration:
- 0.85+: critical facts all verified, only minor uncertainty
- 0.70-0.85: critical facts verified, some questionable minor claims (still acceptable)
- 0.55-0.70: 1-2 critical claims unsupported but mostly solid
- <0.55: multiple critical claims unsupported

ready_for_library = true if (critical_facts_suspect <= 1 AND final_confidence >= 0.65).

Entry to verify:"""


# ── Worker ──────────────────────────────────────────────────────────────────

def research_one(client, brand_row: dict) -> dict:
    """Call Sonnet with web_search to research one brand. Returns dict with
    keys: brand, status, research_json, raw_text, tokens_in, tokens_out, cost_usd."""
    def _int(v):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0
    user = (
        f"{brand_row['brand']}\n"
        f"  Country in catalog: {brand_row.get('country', 'unknown')}\n"
        f"  Categories in catalog: {brand_row.get('classifications', '')}\n"
        f"  Price range observed: ฿{_int(brand_row.get('avg_price_thb')):,} avg, "
        f"฿{_int(brand_row.get('max_price_thb')):,} max\n"
    )
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3500,
            temperature=0.1,
            tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}],
            system=[{"type": "text", "text": RESEARCHER_SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {
            "brand": brand_row["brand"], "status": "researcher_error",
            "research_json": None, "raw_text": "",
            "error": f"{type(e).__name__}: {e}",
            "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
        }

    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        start = text.find("{")
        end = text.rfind("}")
        research_json = json.loads(text[start: end + 1])
        status = "researched"
    except Exception as e:
        research_json = None
        status = f"parse_error: {e}"

    usage = resp.usage
    # Sonnet 4.6 pricing: $3/M in, $15/M out
    cost = (usage.input_tokens or 0) * 3 / 1_000_000 + (usage.output_tokens or 0) * 15 / 1_000_000
    return {
        "brand": brand_row["brand"], "status": status,
        "research_json": research_json, "raw_text": text,
        "tokens_in": usage.input_tokens or 0,
        "tokens_out": usage.output_tokens or 0,
        "cost_usd": cost,
    }


def verify_one(client, research: dict) -> dict:
    """Verify a researcher result. Returns dict with verifier output + cost."""
    if research.get("research_json") is None:
        return {
            "status": "skipped_no_research",
            "verifier_json": None, "cost_usd": 0.0,
        }
    sys_prompt = VERIFIER_SYSTEM_TMPL.replace("__BRAND__", research["brand"])
    user = json.dumps(research["research_json"], indent=2, ensure_ascii=False)
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            temperature=0.0,
            system=[{"type": "text", "text": sys_prompt}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {
            "status": f"verifier_error: {type(e).__name__}: {e}",
            "verifier_json": None, "cost_usd": 0.0,
        }
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        start = text.find("{")
        end = text.rfind("}")
        vj = json.loads(text[start: end + 1])
    except Exception as e:
        vj = {"verifier_parse_error": str(e), "raw": text}
    usage = resp.usage
    # Sonnet 4.6 pricing: $3/M in, $15/M out
    cost = (usage.input_tokens or 0) * 3 / 1_000_000 + (usage.output_tokens or 0) * 15 / 1_000_000
    return {
        "status": "verified", "verifier_json": vj, "cost_usd": cost,
    }


def synthesize_csv_row(research: dict, verifier: dict, brand_row: dict) -> dict:
    """Take research + verifier output → CSV row matching brand_library schema."""
    rj = research.get("research_json") or {}
    vj = verifier.get("verifier_json") or {}
    ready = bool(vj.get("ready_for_library"))
    # description_short: derived from must_know + classification
    short = (rj.get("must_know") or "").strip()
    if len(short) > 250:
        short = short[:240].rsplit(" ", 1)[0] + "…"
    # description_full: structured prose (multiple lines) summarizing all fields
    full_parts = []
    if rj.get("founded"):
        full_parts.append(f"Founded {rj['founded']}.")
    if rj.get("owner"):
        full_parts.append(f"Owner: {rj['owner']}.")
    if rj.get("region"):
        full_parts.append(f"Region: {rj['region']}.")
    if rj.get("classification"):
        full_parts.append(f"Classification: {rj['classification']}.")
    if rj.get("signature_style"):
        full_parts.append(f"Style: {rj['signature_style']}")
    if rj.get("vineyard_or_distillery"):
        full_parts.append(f"Site: {rj['vineyard_or_distillery']}")
    wp = rj.get("winemaking_or_production") or {}
    for k in ("vinification", "aging", "bottling"):
        if wp.get(k):
            full_parts.append(f"{k.capitalize()}: {wp[k]}")
    if rj.get("blend_typical_or_recipe"):
        full_parts.append(f"Blend/recipe: {rj['blend_typical_or_recipe']}")
    if rj.get("must_know"):
        full_parts.append(f"Must know: {rj['must_know']}")
    full_description = " ".join(full_parts)
    return {
        "entity_type": "brand",
        "entity_name": brand_row["brand"],
        "parent_country": brand_row.get("country", "") or rj.get("region", "").split(",")[-1].strip(),
        "parent_region": rj.get("region", ""),
        "parent_subregion": "",
        "classification_scope": brand_row.get("classifications", ""),
        "product_count": brand_row.get("total_skus", ""),
        "segments_seen": "",
        "source_basis": "web_research_validated" if ready else "web_research_flagged",
        "copy_status": "validated" if ready else "flagged_for_review",
        "description_short_en": short,
        "description_full_en": full_description,
        "notes": json.dumps({
            "research": rj,
            "verifier": vj,
            "verified_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }, ensure_ascii=False),
    }


# ── Main orchestration ─────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--priorities", type=Path, default=DEFAULT_PRIORITIES)
    p.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    p.add_argument("--limit", type=int, default=0,
                   help="Process at most N brands (0 = all in priorities file).")
    p.add_argument("--brand", action="append",
                   help="Process specific brand by name (repeatable).")
    p.add_argument("--workers", type=int, default=5,
                   help="Parallel research workers (Anthropic SDK is thread-safe).")
    p.add_argument("--dry-run", action="store_true",
                   help="Run researcher only; do NOT write to library CSV.")
    p.add_argument("--no-backup", action="store_true")
    p.add_argument("--reverify-only", action="store_true",
                   help="Skip the (expensive) research call; re-run only the verifier on existing research JSON stored in brand_library.notes. Use after improving the verifier prompt.")
    args = p.parse_args(argv)

    env = load_env()
    os.environ.setdefault("ANTHROPIC_API_KEY", env.get("ANTHROPIC_API_KEY", ""))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY missing", file=sys.stderr)
        return 1
    import anthropic
    client = anthropic.Anthropic()

    if not args.priorities.exists():
        print(f"ERROR: priorities file not found: {args.priorities}", file=sys.stderr)
        print("Run: scripts/select_priority_brands.py --top 50", file=sys.stderr)
        return 1

    with args.priorities.open() as f:
        brand_rows = list(csv.DictReader(f))
    if args.brand:
        wanted = set(args.brand)
        brand_rows = [r for r in brand_rows if r["brand"] in wanted]
    if args.limit > 0:
        brand_rows = brand_rows[: args.limit]
    if not brand_rows:
        print("No brands to process.")
        return 0

    # In --reverify-only mode, load existing research from the library CSV
    # rather than calling Sonnet+web_search again. Saves ~$0.20/brand.
    existing_research_by_brand: dict[str, dict] = {}
    if args.reverify_only:
        if not args.library.exists():
            print(f"ERROR: --reverify-only needs existing library: {args.library}", file=sys.stderr)
            return 1
        with args.library.open() as f:
            for row in csv.DictReader(f):
                if row.get("entity_type") != "brand":
                    continue
                if not row.get("notes"):
                    continue
                try:
                    notes = json.loads(row["notes"])
                    rj = notes.get("research")
                    if rj:
                        existing_research_by_brand[row["entity_name"]] = rj
                except Exception:
                    pass

    print(f"Will process {len(brand_rows)} brand(s) with {args.workers} workers.")
    if args.reverify_only:
        verifier_cost_per_brand = 0.025  # Sonnet verifier ≈ $0.02-0.03
        print(f"Mode: REVERIFY ONLY — using stored research, not re-running web research")
        print(f"Estimated cost: ${len(brand_rows) * verifier_cost_per_brand:.2f} (~$0.02-0.03/brand)")
    else:
        # Realistic estimate: ~$0.15-0.25/brand
        # Researcher (Sonnet input-heavy due to web results): ~$0.11
        # Verifier (Sonnet, switched up from Haiku for reliability): ~$0.05
        print(f"Estimated cost: ${len(brand_rows) * 0.20:.2f} (~$0.15-0.25/brand)")
    print()

    # Backup library before writes
    if not args.dry_run and not args.no_backup and args.library.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.library.with_suffix(args.library.suffix + f".bak-{ts}")
        shutil.copy2(args.library, bak)
        print(f"Backup: {bak}")

    # Process — parallel
    lock = threading.Lock()
    results: list[dict] = []
    total_cost = 0.0

    def work(brand_row: dict) -> None:
        nonlocal total_cost
        brand = brand_row["brand"]

        # Reverify mode: use stored research, skip the expensive research call
        if args.reverify_only:
            stored = existing_research_by_brand.get(brand)
            if not stored:
                with lock:
                    print(f"  ⊘ {brand}: no stored research; skipping (run without --reverify-only first)")
                return
            r = {
                "brand": brand, "status": "loaded_from_csv",
                "research_json": stored, "raw_text": "",
                "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
            }
        else:
            with lock:
                print(f"  → {brand} [research]")
            r = research_one(client, brand_row)
            with lock:
                total_cost += r["cost_usd"]

        if r.get("research_json"):
            with lock:
                print(f"    {brand} [verify]")
            v = verify_one(client, r)
            with lock:
                total_cost += v["cost_usd"]
        else:
            v = {"status": "skipped_no_research", "verifier_json": None, "cost_usd": 0.0}
        with lock:
            vj = v.get("verifier_json") or {}
            ready = vj.get("ready_for_library", False)
            conf = vj.get("final_confidence", "?")
            # New verifier prompt uses critical_facts_suspect; old used suspect_count
            sus = vj.get("critical_facts_suspect", vj.get("suspect_count", "?"))
            tag = "✓" if ready else "⚠"
            print(f"    {tag} {brand}: conf={conf} critical_suspect={sus} cost=${r['cost_usd']+v['cost_usd']:.3f}")
            results.append({"brand_row": brand_row, "research": r, "verifier": v})

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, br) for br in brand_rows]
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:
                with lock:
                    print(f"WORKER CRASH: {type(e).__name__}: {e}", file=sys.stderr)

    print(f"\n  Total cost: ${total_cost:.3f}  ({len(results)} brands processed)")

    if args.dry_run:
        # Save raw research JSON for inspection
        out = REPO_ROOT / f"data/brand_curation_dryrun-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        out.write_text(json.dumps([
            {"brand": r["brand_row"]["brand"],
             "research_json": r["research"].get("research_json"),
             "verifier_json": r["verifier"].get("verifier_json"),
             "research_status": r["research"]["status"],
             "verifier_status": r["verifier"]["status"]}
            for r in results
        ], indent=2, ensure_ascii=False))
        print(f"Dry-run output → {out}")
        return 0

    # Merge into library CSV — load existing, replace rows for selected brands
    existing_rows: list[dict] = []
    existing_columns: list[str] = []
    if args.library.exists():
        with args.library.open() as f:
            rdr = csv.DictReader(f)
            existing_columns = list(rdr.fieldnames or [])
            existing_rows = list(rdr)

    # Build new rows
    by_brand = {r["brand_row"]["brand"]: r for r in results}
    new_rows: list[dict] = []
    replaced = 0
    for row in existing_rows:
        if row["entity_type"] == "brand" and row["entity_name"] in by_brand:
            r = by_brand[row["entity_name"]]
            new_row = synthesize_csv_row(r["research"], r["verifier"], r["brand_row"])
            # Preserve any columns the new dict doesn't have
            merged = {**row, **new_row}
            new_rows.append(merged)
            replaced += 1
        else:
            new_rows.append(row)

    # Brands not in existing CSV → append
    existing_names = {r["entity_name"] for r in existing_rows if r["entity_type"] == "brand"}
    added = 0
    for brand_name, r in by_brand.items():
        if brand_name not in existing_names:
            new_row = synthesize_csv_row(r["research"], r["verifier"], r["brand_row"])
            new_rows.append({c: new_row.get(c, "") for c in existing_columns})
            added += 1

    # Write back
    cols = existing_columns or list(new_rows[0].keys())
    with args.library.open("w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        for row in new_rows:
            wr.writerow({c: row.get(c, "") for c in cols})

    flagged = sum(1 for r in results if not (r["verifier"].get("verifier_json") or {}).get("ready_for_library"))
    print(f"\nWrote {len(new_rows)} library rows ({replaced} upgraded, {added} appended).")
    print(f"Flagged for human review: {flagged} (look for source_basis='web_research_flagged')")
    return 0


if __name__ == "__main__":
    sys.exit(main())
