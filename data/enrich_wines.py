#!/usr/bin/env python3
"""Wine enrichment CLI driver.

See docs/superpowers/specs/2026-05-12-wine-enrichment-design.md
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.enrichment.shared.client import AnthropicClient, USD_TO_THB  # noqa: E402
from data.lib.enrichment.shared.cache import CacheClient  # noqa: E402
from data.lib.enrichment.shared.taxonomies import food_pairing  # noqa: E402
from data.lib.enrichment.shared.vocab_loader import VocabLoader  # noqa: E402
from data.lib.enrichment.wine import evidence as ev  # noqa: E402
from data.lib.enrichment.wine import prompt as pr  # noqa: E402
from data.lib.enrichment.wine import validator as val  # noqa: E402
from data.lib.enrichment.wine import scoring as sc  # noqa: E402
from data.lib.enrichment.wine.output import OutputRouter, CSV_COLUMNS  # noqa: E402

DEFAULT_TASTE_VOCAB_FILE = REPO_ROOT / "data" / "lib" / "enrichment" / "shared" / "taste_vocab.yml"

DEFAULT_PRODUCTS_FILE = REPO_ROOT / "data" / "db" / "products.json"
DEFAULT_WINESENSED_FILE = REPO_ROOT / "data" / "db" / "external-winesensed-records.json"
DEFAULT_BRAND_LIBRARY_FILE = REPO_ROOT / "data" / "brand_description_library.csv"
DEFAULT_EXPORTS_DIR = REPO_ROOT / "data" / "exports"
DEFAULT_DB_PATH = REPO_ROOT / "data" / "db" / "products.db"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def fetch_critic_scores(supabase_url: str, api_key: str, skus: list[str]) -> dict[str, list[dict]]:
    if not skus or not supabase_url:
        return {}
    out: dict[str, list[dict]] = defaultdict(list)
    CHUNK = 100
    for i in range(0, len(skus), CHUNK):
        batch = skus[i : i + CHUNK]
        ids = ",".join(f'"{s}"' for s in batch)
        params = {"sku": f"in.({ids})", "select": "sku,critic,score,score_max,vintage,tasting_year"}
        qs = urllib.parse.urlencode(params, safe='",()')
        url = f"{supabase_url.rstrip('/')}/rest/v1/critic_scores?{qs}"
        req = urllib.request.Request(url, headers={"apikey": api_key, "Authorization": f"Bearer {api_key}"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"WARN: critic_scores fetch failed: {e}", file=sys.stderr)
            return {}
        for r in rows:
            out[r["sku"]].append(r)
    return dict(out)


def _needs_enrichment(p: dict) -> bool:
    """A SKU needs enrichment if it's flagged for review OR missing matrix fields."""
    if (p.get("validation_status") or "") == "needs_review":
        return True
    # Missing any of the 4 key matrix fields → needs enrichment
    required = ("wine_body", "wine_acidity", "food_matching", "full_description")
    if any(not (p.get(f) or "") for f in required):
        return True
    return False


def select_skus(
    products: list[dict], priority: str, tier: list[int] | None, limit: int,
    sku_filter: list[str] | None, only_needs: bool = True,
) -> list[dict]:
    # v2: include every classification covered by the taste-taxonomy schema
    # (wine + brown/white spirits + beer + liqueur + RTD). Classifications not
    # in CATEGORY_TO_STRUCTURE (Cigar, Mineral Water, Accessories, …) are skipped.
    from data.lib.enrichment.wine.schemas import CATEGORY_TO_STRUCTURE
    in_scope = set(CATEGORY_TO_STRUCTURE.keys())
    wines = [p for p in products if p.get("classification") in in_scope]
    if sku_filter:
        sf = set(sku_filter)
        return [p for p in wines if p.get("sku") in sf][:limit]

    # Pre-filter: skip already-good SKUs (saves ~60% on full catalog runs)
    if only_needs:
        wines = [p for p in wines if _needs_enrichment(p)]

    if tier:
        from collections import Counter
        brand_counts = Counter(p.get("brand", "") for p in wines)
        s1 = {b for b, n in brand_counts.items() if n >= 10}
        s2 = {b for b, n in brand_counts.items() if 3 <= n <= 9}
        allow = set()
        if 1 in tier: allow |= s1
        if 2 in tier: allow |= s2
        wines = [p for p in wines if p.get("brand", "") in allow]

    if priority == "popularity":
        wines.sort(key=lambda p: -(float(p.get("popularity_score") or 0)))
    return wines[:limit]


def compute_score_aggregates(scores: list[dict]) -> tuple[float | None, str]:
    if not scores:
        return None, ""
    normalized = []
    raw_pairs = []
    for s in scores:
        score = float(s.get("score") or 0)
        sm = float(s.get("score_max") or 100)
        critic = str(s.get("critic", ""))
        normalized.append(score * 100 / sm if sm > 0 else 0)
        raw_pairs.append((critic, score))
    score_max = max(normalized) if normalized else None
    abbrev = {
        "James Suckling": "JS", "Wine Advocate": "WA", "Wine Spectator": "WS",
        "Decanter": "DEC", "Jancis Robinson": "JR", "Vinous": "VIN",
        "Wine Enthusiast": "WE", "Burghound": "BH",
    }
    parts = [f"{abbrev.get(c, c[:3].upper())} {int(s) if s == int(s) else s}" for c, s in raw_pairs[:4]]
    return round(score_max, 1) if score_max is not None else None, " · ".join(parts)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Wine enrichment pipeline.")
    p.add_argument("--priority", choices=["popularity", "all"], default="popularity")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--tier", type=int, action="append", choices=[1, 2])
    p.add_argument("--write-threshold", type=float, default=0.85)
    p.add_argument("--model", default="claude-haiku-4-5-20251001")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--no-write", action="store_true")
    p.add_argument("--no-supabase", action="store_true")
    p.add_argument("--all-skus", action="store_true",
                   help="Disable the default needs-enrichment filter and run on every wine SKU.")
    p.add_argument("--sku", action="append", dest="skus")
    p.add_argument("--csv-output", type=Path)
    p.add_argument("--products-file", type=Path, default=DEFAULT_PRODUCTS_FILE)
    p.add_argument("--skus-file", type=Path,
                   help="Override products source: load fixture JSON file with SKU records.")
    p.add_argument("--winesensed-file", type=Path, default=DEFAULT_WINESENSED_FILE)
    p.add_argument("--brand-library-file", type=Path, default=DEFAULT_BRAND_LIBRARY_FILE)
    p.add_argument("--db", type=Path, default=DEFAULT_DB_PATH,
                   help="Path to local SQLite store (default: data/db/products.db).")
    p.add_argument("--also-push-supabase", action="store_true",
                   help="Legacy: also write to Supabase. Default OFF — use scripts/sync_to_supabase.py.")
    args = p.parse_args(argv)

    env = load_env(REPO_ROOT / ".env.local")
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    # Prefer service key for backend pipeline; fall back to publishable key.
    supabase_key = env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    anthropic_key = env.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY", "")

    source_path = args.skus_file or args.products_file
    if not source_path.exists():
        print(f"ERROR: products source not found: {source_path}", file=sys.stderr)
        return 1
    products = json.loads(source_path.read_text())
    if isinstance(products, dict):
        products = products.get("records", [])

    selected = select_skus(products, args.priority, args.tier, args.limit, args.skus, only_needs=not args.all_skus)
    if not selected:
        print("No SKUs to process.")
        return 0
    print(f"Selected {len(selected)} SKUs for processing.")

    winesensed_records = []
    if args.winesensed_file.exists():
        winesensed_records = json.loads(args.winesensed_file.read_text())
        # Normalize: some Winesensed exports wrap rows in a dict
        if isinstance(winesensed_records, dict):
            winesensed_records = winesensed_records.get("records", [])
    brand_library = []
    if args.brand_library_file.exists():
        with args.brand_library_file.open() as f:
            brand_library = list(csv.DictReader(f))

    critic_scores_by_sku: dict[str, list[dict]] = {}
    if not args.no_supabase and supabase_url and supabase_key:
        critic_scores_by_sku = fetch_critic_scores(
            supabase_url, supabase_key, [s["sku"] for s in selected]
        )

    collector = ev.EvidenceCollector(
        winesensed_records=winesensed_records,
        brand_library=brand_library,
        critic_scores_by_sku=critic_scores_by_sku,
    )
    food_tax = food_pairing.load_default()
    vocab = VocabLoader.from_path(DEFAULT_TASTE_VOCAB_FILE) if DEFAULT_TASTE_VOCAB_FILE.exists() else None
    from data.lib.enrichment.shared.local_store import LocalCache, FailureLogger
    cache_client = None if args.no_cache else LocalCache(db_path=args.db)
    failure_logger = FailureLogger(db_path=args.db)

    haiku = None
    if not args.dry_run:
        if not anthropic_key:
            print("ERROR: ANTHROPIC_API_KEY missing.", file=sys.stderr)
            return 1
        haiku = AnthropicClient(api_key=anthropic_key, model=args.model)

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    csv_path = args.csv_output or (DEFAULT_EXPORTS_DIR / f"wine-enrichment-{timestamp}.csv")
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_file = csv_path.open("w", encoding="utf-8-sig", newline="")
    csv_writer = csv.DictWriter(csv_file, fieldnames=CSV_COLUMNS, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    csv_writer.writeheader()

    router = OutputRouter(
        supabase_url=supabase_url, api_key=supabase_key,
        csv_writer=csv_writer, write_threshold=args.write_threshold,
    )
    from data.lib.enrichment.wine.local_router import LocalRouter
    local_router = LocalRouter(db_path=args.db, write_threshold=args.write_threshold)

    stats = {"cache_hits": 0, "api_calls": 0, "local_writes": 0, "csv_only": 0, "validation_failures": 0, "by_tier": {"A": 0, "B": 0, "C": 0}}
    total_cost_thb = 0.0
    for i, sku_row in enumerate(selected, start=1):
        sku = sku_row["sku"]
        evidence = collector.collect_evidence(sku, sku_row)
        stats["by_tier"][evidence.quality_tier] += 1
        classification = sku_row.get("classification")
        system, user, prompt_hash = pr.build_prompt(
            evidence, food_tax, vocab=vocab, classification=classification
        )

        cached = None
        validation_status_for_scoring = "passed"
        if cache_client:
            try:
                cached = cache_client.lookup(sku=sku, prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash)
            except Exception as e:
                print(f"WARN: cache lookup failed for {sku}: {e}", file=sys.stderr)

        if cached:
            response = cached["response_json"]
            validation_status_for_scoring = cached.get("validation_status", "passed")
            stats["cache_hits"] += 1
            cache_id = cached["id"]
            cost_thb = 0.0
        else:
            if args.dry_run:
                est = len(user.split()) * 1.3
                print(f"[{i}/{len(selected)}] {sku}  tier={evidence.quality_tier}  [dry-run] would call Haiku (~{est:.0f} tokens user)")
                continue
            try:
                gen = haiku.generate(system=system, user=user, max_tokens=2000, temperature=0.1)
            except Exception as e:
                # Per-SKU safety net: if AnthropicClient retries are exhausted
                # (network, rate-limit, 5xx), log and skip this SKU rather than
                # killing the whole batch. The CLI can be re-run later and the
                # cache will cover already-successful SKUs.
                print(f"[{i}/{len(selected)}] {sku}  API CALL FAILED: {type(e).__name__}: {e}", file=sys.stderr)
                try:
                    failure_logger.log(
                        sku=sku, failure_type="api_error",
                        raw_response=None, validation_issues=[f"{type(e).__name__}: {e}"],
                        prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                        model=args.model, tokens_in=None, tokens_out=None, cost_thb=None,
                    )
                except Exception:
                    pass
                stats["validation_failures"] += 1
                continue
            stats["api_calls"] += 1
            total_cost_thb += gen.cost_thb
            cost_thb = gen.cost_thb
            try:
                raw = gen.text
                start = raw.find("{")
                end = raw.rfind("}")
                response = json.loads(raw[start : end + 1])
            except Exception as e:
                print(f"[{i}/{len(selected)}] {sku}  PARSE FAIL: {e}", file=sys.stderr)
                failure_logger.log(
                    sku=sku, failure_type="parse",
                    raw_response=gen.text, validation_issues=[str(e)],
                    prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                    model=gen.model, tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
                    cost_thb=gen.cost_thb,
                )
                stats["validation_failures"] += 1
                continue
            result = val.validate(response, evidence, food_tax)
            if result.outcome == "rejected" and result.can_retry:
                failure_logger.log(
                    sku=sku, failure_type="validation_first",
                    raw_response=gen.text, validation_issues=result.issues,
                    prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                    model=gen.model, tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
                    cost_thb=gen.cost_thb,
                )
                correction = f"\n\n[Correction required — your previous response had these issues: {result.issues}. Please regenerate following the schema exactly.]"
                try:
                    gen2 = haiku.generate(system=system, user=user + correction, max_tokens=2000, temperature=0.1)
                except Exception as e:
                    print(f"[{i}/{len(selected)}] {sku}  RETRY GENERATION FAILED: {e}", file=sys.stderr)
                    failure_logger.log(
                        sku=sku, failure_type="validation_retry",
                        raw_response=None, validation_issues=[f"retry generation failed: {e}"],
                        prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                        model=args.model, tokens_in=None, tokens_out=None, cost_thb=None,
                    )
                    stats["validation_failures"] += 1
                    continue
                total_cost_thb += gen2.cost_thb
                cost_thb += gen2.cost_thb
                stats["api_calls"] += 1
                try:
                    raw2 = gen2.text
                    response = json.loads(raw2[raw2.find("{") : raw2.rfind("}") + 1])
                    result = val.validate(response, evidence, food_tax)
                    if result.outcome == "rejected":
                        failure_logger.log(
                            sku=sku, failure_type="validation_retry",
                            raw_response=gen2.text, validation_issues=result.issues,
                            prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                            model=gen2.model, tokens_in=gen2.tokens_in, tokens_out=gen2.tokens_out,
                            cost_thb=gen2.cost_thb,
                        )
                        validation_status_for_scoring = "failed"
                        stats["validation_failures"] += 1
                        continue
                    else:
                        validation_status_for_scoring = "failed_then_retried"
                except Exception as e2:
                    failure_logger.log(
                        sku=sku, failure_type="validation_retry",
                        raw_response=gen2.text, validation_issues=[str(e2)],
                        prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                        model=gen2.model, tokens_in=gen2.tokens_in, tokens_out=gen2.tokens_out,
                        cost_thb=gen2.cost_thb,
                    )
                    stats["validation_failures"] += 1
                    continue
            elif result.outcome == "rejected":
                stats["validation_failures"] += 1
                continue
            else:
                validation_status_for_scoring = result.outcome
            response = result.repaired_json

            if cache_client:
                try:
                    cache_id = cache_client.write(
                        sku=sku, category="wine",
                        prompt_hash=prompt_hash, evidence_hash=evidence.evidence_hash,
                        prompt_text=user, response_json=response,
                        response_raw=gen.text, model=gen.model,
                        tokens_in=gen.tokens_in, tokens_out=gen.tokens_out,
                        cost_thb=cost_thb,
                        confidence=float(response.get("confidence", 0)),
                        validation_status=validation_status_for_scoring,
                        validation_issues=result.issues,
                    )
                except Exception as e:
                    print(f"WARN: cache write failed for {sku}: {e}", file=sys.stderr)
                    cache_id = ""
            else:
                cache_id = ""

        ai_conf = float(response.get("confidence", 0))
        final_conf = sc.final_confidence(ai_conf, evidence.quality_tier, validation_status_for_scoring)
        score_max, score_summary = compute_score_aggregates(critic_scores_by_sku.get(sku, []))

        if not args.no_write:
            enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
            try:
                wrote_local = local_router.update_product(
                    products_id=sku_row.get("id", ""),
                    response=response, final_confidence=final_conf,
                    model=args.model, enrichment_note=f"Haiku/{evidence.quality_tier}",
                    enriched_at=enriched_at,
                    score_max=score_max, score_summary=score_summary,
                    taste_profile=response.get("taste_profile"),
                    vocab=vocab,
                )
                if wrote_local:
                    stats["local_writes"] += 1
                else:
                    stats["csv_only"] += 1
                if wrote_local and args.also_push_supabase:
                    router._write_to_products(
                        sku_row.get("id", ""), response, final_conf, args.model,
                        f"Haiku/{evidence.quality_tier}", enriched_at, score_max, score_summary,
                    )
            except Exception as e:
                print(f"WARN: local route failed for {sku}: {e}", file=sys.stderr)
            try:
                router.route(
                    sku=sku, products_id=sku_row.get("id", ""),
                    response=response, final_confidence=final_conf,
                    tier=evidence.quality_tier, cache_id=cache_id,
                    current_values=sku_row, enrichment_note=f"Haiku/{evidence.quality_tier}",
                    model=args.model, enriched_at=enriched_at,
                    score_max=score_max, score_summary=score_summary,
                )
            except Exception as e:
                print(f"WARN: csv route failed for {sku}: {e}", file=sys.stderr)

        decision = "DIRECT WRITE" if final_conf >= args.write_threshold else "CSV ONLY"
        print(f"[{i}/{len(selected)}] {sku}  tier={evidence.quality_tier}  ai_conf={ai_conf:.2f}  final={final_conf:.2f}  → {decision}  (THB {cost_thb:.4f})")

    csv_file.close()

    print()
    print("───── Run summary ─────")
    print(f"SKUs processed:           {len(selected)}")
    print(f"  Cache hits:             {stats['cache_hits']}")
    print(f"  API calls:              {stats['api_calls']}")
    print(f"  Local DB writes:        {stats['local_writes']}")
    print(f"  CSV-only:               {stats['csv_only']}")
    print(f"  Validation failures:    {stats['validation_failures']}")
    print(f"Cost (this run):          THB {total_cost_thb:.2f}")
    print(f"By evidence tier:         A: {stats['by_tier']['A']}  B: {stats['by_tier']['B']}  C: {stats['by_tier']['C']}")
    if not args.dry_run:
        print(f"\n  ✓ {csv_path.name}: {len(selected)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
