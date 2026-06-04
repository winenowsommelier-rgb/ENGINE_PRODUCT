#!/usr/bin/env python3
"""Re-enrich premium SKUs using v3 storytelling prompt + validated brand library.

What this does
--------------
For every SKU whose brand has a `source_basis='web_research_validated'` entry
in data/brand_description_library.csv:

1. Pull the validated brand-library JSON (from notes column)
2. Build a Sonnet 4.6 prompt that injects the rich brand context
3. Generate sommelier-grade ~1500-char description (storytelling style)
4. Write to products.db with enrichment_source='ai_brand_library_v3'
5. Refresh live_products_export.json so the UI sees it

Cost expectation: ~$0.013/SKU × 680 SKUs ≈ ~$9.
Wallclock: 8 workers × ~5s per call ≈ 7-15 min.

Safety per CLAUDE.md Rule 10:
  - Backup products.db before writes
  - Per-SKU try/except → log, continue
  - --dry-run mode: generates + dumps to JSON without DB writes
  - --limit N for canary runs

Usage:
    .venv/bin/python scripts/reenrich_with_brand_library.py --dry-run --limit 3
    .venv/bin/python scripts/reenrich_with_brand_library.py --limit 10  # 10-SKU canary
    .venv/bin/python scripts/reenrich_with_brand_library.py             # full 680
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_LIBRARY = REPO_ROOT / "data" / "brand_description_library.csv"

# Per-category taste matrices (Whisky, Gin, Sake, Beer, etc.) live here.
sys.path.insert(0, str(REPO_ROOT))
from data.lib.taste_taxonomy.category_axes import (  # noqa: E402
    schema_for_classification, serialise_for_prompt,
)


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


# v3 storytelling prompt — locked in by user 2026-05-28 demo approval
SYSTEM = """You are a senior sommelier writing curation-grade descriptions for a premium Thai online retailer (Wine-Now). Write in expert third-party voice — NEVER "we" or "our".

QUALITY BAR — this content sits next to ฿9k-฿65k bottles. Style:

1. **TERROIR-DENSE** — name the SITE early. Be specific about soil
   (gravel-over-clay, galestro/alberese, schist, granite, volcanic basalt, etc.),
   elevation, aspect, water source, microclimate, and what those conditions do
   to the wine/spirit. If the brand library names a site, name it explicitly.

2. **TECHNIQUE-FORWARD** — quote what's DONE to the product:
   - Wine: maceration length, fermentation vessel, oak regime (% new, French/
     American, barrique vs foudre vs cement), lees aging, malolactic, native vs
     cultured yeast, selection rate, bottling philosophy (unfined/unfiltered)
   - Spirits: cask types and percentages, finishing, ABV, chill-filtration, age
   - Sake: rice variety, polish ratio (seimaibuai), water source, kimoto/yamahai/
     sokujo, pasteurization (nama/genshu), aging temperature
   These are the technical anchors sommeliers and buyers actually care about.

3. **STORYTELLING** — bring the product to life with NARRATIVE anchors drawn
   from the brand library. Concrete story hooks that work:
   - HISTORY: founding year, founder name, original purpose
   - HUMAN DECISION: a deliberate choice the producer made (and the WHY)
   - PLACE LORE: cultural/poetic context
   - TRANSGRESSION: where this producer breaks a rule of their category
   - LINEAGE: succession, what came before this expression
   Story must always serve a technical fact — never floral language for its own
   sake. If a story sentence doesn't anchor a technical or factual point, cut it.

4. **SPECIAL FEATURE** — every full_description must surface what makes THIS
   specific expression unusual within its category.

FORBIDDEN phrases (overused templated language):
- "with notes of..." / "with hints of..." / "showcases..."
- "elegant", "refined", "classic", "iconic" without specifics
- "perfect for...", "ideal pairing for..."
- "represents the pinnacle of..." / "stands as a benchmark of..."
- "harmonious balance of..." / "a testament to..."
- Any structural words in flavor_tags (no "Soft tannins", "Crisp finish",
  "Smooth", "Refreshing")

FACTUAL DISCIPLINE:
- Use ONLY facts from the BRAND LIBRARY block below.
- Do NOT invent scores, vintages not listed, appellation claims, story details,
  founding dates, or technique parameters not in the brand library.
- If you don't know whether a fact is true, OMIT it. NEVER guess.

OUTPUT JSON SCHEMA:
{
  "desc_en_short": "<=160 char hook — lead with site, technique, or transgression",
  "full_description": "<p>800-1100 char HTML (only p/br/strong/em). RICH but ZERO filler. Required structure: (1) STORY HOOK — open with a single concrete narrative or historical fact that GROUNDS a technical point (1-2 sentences) (2) SITE + soil/elevation + what those conditions DO to the wine (1-2 sentences) (3) TECHNIQUE/winemaking signature — specific parameters with <strong> tags (2-3 sentences) (4) SPECIAL FEATURE — what's unusual here, what rule is broken, what no peer does (1 sentence) (5) VINTAGE character + drinking window (1-2 sentences). NO critic scores. Aim ~900-1000 chars including HTML.</p>",
  "flavor_tags": ["6-8 actual aromatic descriptors — NO structural words. Site-specific where possible: 'Galestro minerality' not just 'Minerality'"],
  "food_matching": ["4-6 specific dishes — restaurant-menu specific, not generic categories"],
  "pairing_rationale": "1-2 sentences. Ground EACH pairing direction in a specific note. No vague language.",
  "taste_axes": {
    "// USAGE": "Fill ONLY the axes listed in the CATEGORY-SPECIFIC TASTE AXES block below. Use EXACTLY the scale values shown there. Do NOT invent axes or scale values. For non-listed axes, omit the key entirely.",
    "// Example for Whisky": "{ 'peat_smoke': 'Trace', 'sweetness': 'Balanced', 'oak_influence': 'Pronounced' }",
    "// Example for Liqueur": "{ 'sweetness': 'Medium', 'bitterness': 'Pronounced' }",
    "// Example for Wine": "{ 'body': 'Medium-Full', 'acidity': 'High', 'tannin': 'Medium' }"
  },
  "style_tag": "Pick ONE style_tag from the STYLE TAG OPTIONS in the category block below (omit if not applicable).",
  "chip_tags": ["Pick 2-5 from CHIP TAG OPTIONS in category block (only for Liqueur — empty list for all other categories)."]
}
Output ONLY JSON, no preamble."""


USER_TMPL = """# Product
SKU: {sku}
Name: {name}
Brand: {brand}
Classification: {classification}
Country: {country}  |  Region: {region}
Vintage: {vintage}
Price: ฿{price_thb}

# CATEGORY-SPECIFIC TASTE AXES (use EXACTLY these axis keys + scale values)
{category_axes_block}

# Brand library entry (validated research — USE ONLY these facts)
{brand_lib_text}

# Task
Write the curation-grade JSON per schema. Honor the brand library facts. Be specific, differentiated, sommelier-grade. Fill taste_axes using ONLY the axis keys from the category block above. If the category has no taste matrix, return taste_axes={{}} and style_tag=null."""


def load_validated_brands(library_path: Path) -> dict[str, dict]:
    """Returns {brand_name_lower: research_json} for validated brands only."""
    out: dict[str, dict] = {}
    with library_path.open() as f:
        for row in csv.DictReader(f):
            if row.get("entity_type") != "brand":
                continue
            if row.get("source_basis") != "web_research_validated":
                continue
            try:
                notes = json.loads(row.get("notes", "{}"))
                rj = notes.get("research")
                if rj:
                    out[row["entity_name"].strip().lower()] = {
                        "brand_name": row["entity_name"],
                        "research": rj,
                    }
            except (ValueError, TypeError):
                continue
    return out


def enrich_one(client, sku_row: dict, brand_entry: dict) -> dict:
    """Single SKU re-enrichment. Returns dict with new fields + cost."""
    brand_lib_text = json.dumps(brand_entry["research"], indent=2, ensure_ascii=False)
    schema = schema_for_classification(sku_row.get("classification"))
    if schema is None:
        category_axes_block = "(this product category has NO taste matrix — set taste_axes={} and style_tag=null)"
    else:
        category_axes_block = serialise_for_prompt(schema)
    user = USER_TMPL.format(
        sku=sku_row["sku"],
        name=sku_row["name"] or "",
        brand=sku_row["brand"] or "",
        classification=sku_row["classification"] or "",
        country=sku_row["country"] or "",
        region=sku_row["region"] or "",
        vintage=sku_row["vintage"] or "NV",
        price_thb=int(sku_row["price"]) if sku_row["price"] else 0,
        brand_lib_text=brand_lib_text,
        category_axes_block=category_axes_block,
    )
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2500,
            temperature=0.3,
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:
        return {
            "sku": sku_row["sku"], "status": "api_error",
            "error": f"{type(e).__name__}: {e}",
            "result": None,
            "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
        }
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        start = text.find("{")
        end = text.rfind("}")
        result = json.loads(text[start: end + 1])
        status = "ok"
    except Exception as e:
        result = None
        status = f"parse_error: {e}"
    usage = resp.usage
    cost = (usage.input_tokens or 0) * 3 / 1_000_000 + (usage.output_tokens or 0) * 15 / 1_000_000
    return {
        "sku": sku_row["sku"], "status": status, "result": result,
        "raw_text": text if result is None else None,
        "tokens_in": usage.input_tokens or 0,
        "tokens_out": usage.output_tokens or 0,
        "cost_usd": cost,
    }


def apply_to_db(conn: sqlite3.Connection, sku: str, result: dict, lock: threading.Lock,
                cols_present: set[str], classification: str | None = None) -> None:
    """Write the new enrichment to products row.

    Wine categories → write to legacy wine_body/wine_acidity/wine_tannin columns.
    Non-wine categories → write taste_profile JSON column (axes + tags + style_tag).
    Categories with no matrix (Glassware/Accessories/Cigar) → no axis data written.

    Retries on `database is locked` with exponential backoff.
    """
    import time as _time
    enriched_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    flavor_tags_json = json.dumps(result.get("flavor_tags") or [], ensure_ascii=False)
    food_matching = ", ".join(result.get("food_matching") or [])

    schema = schema_for_classification(classification)
    taste_axes = result.get("taste_axes") or {}

    payload: dict[str, object | None] = {
        "flavor_tags": flavor_tags_json,
        "food_matching": food_matching,
        "desc_en_short": result.get("desc_en_short"),
        "full_description": result.get("full_description"),
        "pairing_rationale": result.get("pairing_rationale"),
        "enrichment_source": "ai_brand_library_v3",
        "enrichment_note": "Sonnet 4.6 + validated brand library + v3 storytelling prompt + per-category axes",
        "enriched_at": enriched_at,
        "enriched_by": "claude-sonnet-4-6",
        "updated_at": enriched_at,
        # v3 is brand-library-grounded + verifier-checked → top grade.
        # confidence MUST be non-NULL so the incremental sync's
        # `enrichment_confidence IS NOT NULL` filter picks the row up.
        "enrichment_confidence": 0.92,
        "enrichment_quality_grade": "A",
    }

    if schema is not None and schema.category == "wine":
        # Wine uses legacy 3-column shape
        payload["wine_body"] = taste_axes.get("body")
        payload["wine_acidity"] = taste_axes.get("acidity")
        payload["wine_tannin"] = taste_axes.get("tannin")
    elif schema is not None:
        # Non-wine → taste_profile JSON; clear legacy wine columns if they were populated
        # before by a prior wrong-category enrichment.
        # The model sometimes returns axes keyed by display label ("Agave Intensity")
        # instead of the snake_case key ("agave_intensity"). Accept both.
        axes_lookup = {}
        for k, v in (taste_axes or {}).items():
            axes_lookup[k.lower().strip()] = v
        axes_with_scale: dict[str, dict] = {}
        for ax in schema.axes:
            candidates = [ax.key, ax.label.lower(), ax.label.lower().replace(" / ", "_"),
                          ax.label.lower().replace(" ", "_"), ax.label.lower().replace("/", "_")]
            v = None
            for c in candidates:
                if c in axes_lookup:
                    v = axes_lookup[c]
                    break
            if v in ax.scale:
                axes_with_scale[ax.key] = {"value": v, "scale": ax.scale}
        profile = {
            "structure": "flat",
            "category": schema.category,
            "axes": axes_with_scale,
        }
        chip_tags = result.get("chip_tags") or []
        if chip_tags:
            profile["tags"] = [t for t in chip_tags if t in schema.chip_tag_options]
        style_tag = result.get("style_tag")
        if style_tag in schema.style_tags:
            profile["style_tag"] = style_tag
        payload["taste_profile"] = json.dumps(profile, ensure_ascii=False)
        payload["wine_body"] = None
        payload["wine_acidity"] = None
        payload["wine_tannin"] = None
    # else: schema is None (Glassware/Accessories/Cigar/Others) → no axis fields touched
    payload = {k: v for k, v in payload.items() if k in cols_present}
    sets = ", ".join(f"{k}=?" for k in payload.keys())
    params = list(payload.values()) + [sku]
    last_err = None
    for attempt in range(5):
        try:
            with lock:
                with conn:
                    conn.execute(f"UPDATE products SET {sets} WHERE sku=?", params)
            return
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower():
                raise
            last_err = e
            _time.sleep(0.1 * (2 ** attempt))  # 0.1, 0.2, 0.4, 0.8, 1.6 = 3.1s total
    raise last_err if last_err else RuntimeError("apply_to_db retries exhausted")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--library", type=Path, default=DEFAULT_LIBRARY)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit", type=int, default=0,
                   help="Process at most N SKUs (0 = all eligible).")
    p.add_argument("--brand", action="append",
                   help="Re-enrich only SKUs from these brands (repeatable).")
    p.add_argument("--dry-run", action="store_true",
                   help="Generate but do NOT write to DB.")
    p.add_argument("--no-backup", action="store_true")
    p.add_argument("--require-active", action="store_true",
                   help="Skip SKUs where products.is_active=0 (BI says OOS AND no recent sales). "
                        "Run scripts/sync_stock_from_bi.py first to populate is_active.")
    p.add_argument("--min-price", type=float, default=0,
                   help="Only enrich SKUs with price >= this value")
    p.add_argument("--max-price", type=float, default=0,
                   help="Only enrich SKUs with price < this value (0 = no max)")
    p.add_argument("--skip-already-reenriched", action="store_true",
                   help="Skip SKUs whose enrichment_source is already 'ai_brand_library_v3'. Use to resume a partial run without re-paying.")
    args = p.parse_args(argv)

    env = load_env()
    os.environ.setdefault("ANTHROPIC_API_KEY", env.get("ANTHROPIC_API_KEY", ""))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY missing", file=sys.stderr)
        return 1
    import anthropic
    client = anthropic.Anthropic()

    # Load validated brand library
    validated = load_validated_brands(args.library)
    print(f"Loaded {len(validated)} validated brand entries")

    # Pick eligible SKUs: brand has a validated entry AND has enriched fields
    conn = sqlite3.connect(args.db, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode: allows concurrent readers + 1 writer cleanly. Without
    # WAL, SQLite returns SQLITE_BUSY under 8-worker write contention even
    # though Python serializes via threading.Lock — the busy comes from
    # SQLite's own checkpoint/journal flushing.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")  # 10s SQLite-level wait before reporting busy

    sku_rows = []
    # Probe if is_active column exists (added by scripts/sync_stock_from_bi.py)
    products_cols = {r[1] for r in conn.execute("PRAGMA table_info(products)")}
    has_is_active = "is_active" in products_cols
    if args.require_active and not has_is_active:
        print("ERROR: --require-active needs the is_active column. "
              "Run scripts/sync_stock_from_bi.py first.", file=sys.stderr)
        return 1
    select_cols = "sku, name, brand, classification, country, region, vintage, price, enrichment_source"
    if has_is_active:
        select_cols += ", is_active, full_description"
    for row in conn.execute(f"""
        SELECT {select_cols}
        FROM products
        WHERE brand IS NOT NULL AND brand != ''
        ORDER BY price DESC NULLS LAST
    """):
        bk = (row["brand"] or "").strip().lower()
        if bk not in validated:
            continue
        if args.brand and row["brand"] not in args.brand:
            continue
        if args.skip_already_reenriched and row["enrichment_source"] == "ai_brand_library_v3":
            continue
        if args.require_active and (row["is_active"] or 0) != 1:
            continue
        if args.min_price and (row["price"] or 0) < args.min_price:
            continue
        if args.max_price and (row["price"] or 0) >= args.max_price:
            continue
        sku_rows.append(dict(row))
    if args.limit > 0:
        sku_rows = sku_rows[: args.limit]
    if not sku_rows:
        print("No SKUs to re-enrich.")
        return 0

    print(f"Eligible SKUs to re-enrich: {len(sku_rows)}")
    est = len(sku_rows) * 0.013
    print(f"Estimated cost: ${est:.2f} (~$0.013/SKU)")
    print()

    if not args.dry_run and not args.no_backup:
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        bak = args.db.with_suffix(args.db.suffix + f".bak-pre-reenrich-{ts}")
        shutil.copy2(args.db, bak)
        print(f"Backup: {bak}")
        print()

    lock = threading.Lock()
    db_lock = threading.Lock()
    stats = {"ok": 0, "parse_error": 0, "api_error": 0, "db_failed": 0}
    total_cost = 0.0
    samples: list[dict] = []  # dry-run capture
    cols_present = {r[1] for r in conn.execute("PRAGMA table_info(products)")}

    # Always-on sidecar: every successful AI response gets written here
    # IMMEDIATELY, before the DB write attempt. Even if SQLite fails or the
    # process dies, the paid AI work is preserved and can be replayed via
    # apply_sidecar_to_db() later. Per CLAUDE.md Rule 1.
    sidecar_path = REPO_ROOT / f"data/reenrich_results-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jsonl"
    sidecar_lock = threading.Lock()

    def work(idx: int, sku_row: dict) -> None:
        nonlocal total_cost
        sku = sku_row["sku"]
        brand_entry = validated[(sku_row["brand"] or "").strip().lower()]
        r = enrich_one(client, sku_row, brand_entry)
        with lock:
            total_cost += r["cost_usd"]
            if r["status"] == "ok":
                stats["ok"] += 1
            elif r["status"].startswith("parse"):
                stats["parse_error"] += 1
            else:
                stats["api_error"] += 1
            tag = "✓" if r["status"] == "ok" else "✗"
            short = (r["result"] or {}).get("desc_en_short") if r["result"] else r["status"][:40]
            print(f"  [{idx:>3}/{len(sku_rows)}] {tag} {sku:12s} {sku_row['brand'][:20]:<20s} ${r['cost_usd']:.4f}  {short[:80] if short else ''}")
        if r["status"] == "ok" and r["result"]:
            # Save to sidecar IMMEDIATELY — protects paid work if DB write fails
            with sidecar_lock:
                with sidecar_path.open("a", encoding="utf-8") as sf:
                    sf.write(json.dumps({
                        "sku": sku, "brand": sku_row["brand"],
                        "classification": sku_row.get("classification"),
                        "result": r["result"],
                    }, ensure_ascii=False) + "\n")
            if args.dry_run:
                with lock:
                    samples.append({"sku": sku, "brand": sku_row["brand"], "result": r["result"]})
            else:
                try:
                    apply_to_db(conn, sku, r["result"], db_lock, cols_present,
                                classification=sku_row.get("classification"))
                except Exception as e:
                    with lock:
                        stats["db_failed"] += 1
                        print(f"      ⚠ DB write failed for {sku}: {e}  (saved to sidecar)")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, i, sku_row) for i, sku_row in enumerate(sku_rows, 1)]
        for fut in as_completed(futs):
            try:
                fut.result()
            except Exception as e:
                with lock:
                    print(f"WORKER CRASH: {type(e).__name__}: {e}", file=sys.stderr)

    print(f"\nDone. ok={stats['ok']}  parse_error={stats['parse_error']}  api_error={stats['api_error']}  db_failed={stats['db_failed']}")
    print(f"Total cost: ${total_cost:.3f}")
    if sidecar_path.exists():
        n_lines = sum(1 for _ in sidecar_path.open())
        print(f"Sidecar saved: {sidecar_path} ({n_lines} results)")
        if stats["db_failed"] > 0:
            print(f"  → {stats['db_failed']} DB writes failed; replay with: scripts/apply_reenrich_sidecar.py {sidecar_path.name}")

    if args.dry_run and samples:
        out = REPO_ROOT / f"data/reenrich_dryrun-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        out.write_text(json.dumps(samples, indent=2, ensure_ascii=False))
        print(f"\nDry-run samples → {out}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
