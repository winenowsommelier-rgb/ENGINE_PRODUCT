# Phase B Run 1 — variety+body Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paid-LLM fill of `variety` + `body` for ~794 non-wine in-stock drinkables that have a critic/sales signal, so the catalog shop filter and finder body-ranking work for spirits/whisky/sake/liqueur.

**Architecture:** A cache-first enrichment script (forks the *harness* of `phase_d1_enrich_critic_scored.py`, NOT its write path) calls Haiku 4.5 per row, validates output against per-category vocab + a 4-step body scale, and writes ONLY to a JSONL sidecar + Supabase `enrichment_cache`. A SEPARATE NULL-only merge script writes products.db, then `refresh_live_export.py` ships to the UI JSON. Full Rule-10 gate: free dry-run → paid 5-SKU canary → cost estimate → **user sign-off** → full run → verify-shipped.

**Tech Stack:** Python 3.9 (`.venv`), `anthropic` SDK, sqlite3, Supabase (`enrichment_cache`), pytest. Reuses `data/lib/taxonomy/sku_taxonomy.resolve`.

**Spec:** `docs/superpowers/specs/2026-06-23-phase-b-enrichment-design.md` (APPROVED).

---

## CRITICAL GUARDRAILS (read before any task — these are why the spec was reviewed 3×)

1. **NEVER reuse the skeleton's `apply_to_db` / UPDATE block.** Both `phase_d1...py:223-235`
   and `backfill_from_cache.py:143-148` are unconditional UPDATEs that CLOBBER existing values
   (Rule 5). The merge MUST be `WHERE sku=? AND (col IS NULL OR col='')`.
2. **`--dry-run` MUST make ZERO API calls.** The skeleton's dry-run still spends. A paid
   dry-run defeats the free preview.
3. **Body scale = 4 steps only:** `["Light","Medium","Medium-Full","Full"]`. NEVER emit
   `Medium-Light` (shop remaps it to Medium → silent collapse).
4. **`category_type` is NOT a DB column.** Derive per-row via `sku_taxonomy.resolve(row)`.
   NEVER read `classification` (Rule 12).
5. **No money before user sign-off.** Stop after the canary and show the measured cost.
6. **Work in an isolated git worktree** (main is shared; parallel workflows bundle stray files
   into PRs — memory `feedback_catalog_worktree_isolation`). Verify commit scope before push.
   **Symlink `.venv` into the worktree** (`ln -s /Users/admin/WNLQ9\ PIE/ENGINE_PRODUCT/.venv .venv`)
   and invoke `./.venv/bin/python` — do NOT rely on `../../../.venv` relative depth (it depends on
   where the worktree lands). Same pattern the catalog worktree uses for node_modules. Replace
   every `../../../.venv/bin/python` in this plan with `./.venv/bin/python` after symlinking.
7. **Canonical DB is `data/db/products.db`** (NOT root). Pass it explicitly everywhere.

---

## File Structure

| File | Responsibility | New/Mod |
|------|----------------|---------|
| `data/lib/taste_taxonomy/universal_scales.py` | Body 4-step scale; per-category variety vocab; `schema_for_type(category_type)` (Rule-12 clean); `validate_body()`, `validate_variety()` | **Create** |
| `scripts/enrich_phase_b.py` | Row select (in-process resolve), Haiku call, validate, write JSONL sidecar ONLY (no DB, no cache). `--limit`/`--dry-run`(free)/`--ts` | **Create** |
| `scripts/merge_phase_b_cache.py` | NULL-only merge sidecar/cache → products.db; backs up DB first | **Create** |
| `tests/test_universal_scales.py` | Validators + `schema_for_type` Rule-12-clean | **Create** |
| `tests/test_merge_phase_b_nullonly.py` | Rule-5 non-clobber + Rule-6 invariant | **Create** |

---

## Task 1: `universal_scales.py` — scales, vocab, validators, schema_for_type

**Files:**
- Create: `data/lib/taste_taxonomy/universal_scales.py`
- Test: `tests/test_universal_scales.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_universal_scales.py
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from data.lib.taste_taxonomy.universal_scales import (
    validate_body, validate_variety, schema_for_type, BODY_SCALE,
)

def test_body_scale_is_four_step_no_medium_light():
    assert BODY_SCALE == ["Light", "Medium", "Medium-Full", "Full"]
    assert validate_body("Full") == "Full"
    # Medium-Light is the cross-consumer trap → must be rejected (None), NOT coerced
    assert validate_body("Medium-Light") is None
    assert validate_body("bogus") is None
    assert validate_body(None) is None

def test_variety_validates_against_per_category_vocab():
    # whisky vocab accepts a grain/style class, rejects off-vocab
    assert validate_variety("Whisky", "Single Malt") == "Single Malt"
    assert validate_variety("Whisky", "Chardonnay") is None
    # sake
    assert validate_variety("Sake & Asian", "Junmai Ginjo") == "Junmai Ginjo"
    # unknown group → no vocab → None (never guess)
    assert validate_variety("Accessories", "Single Malt") is None

def test_schema_for_type_is_rule12_clean():
    # keyed on SKU-derived category_type/group, returns which fields apply
    s = schema_for_type("Whisky")
    assert "variety" in s["fields"] and "body" in s["fields"]
    assert s["variety_vocab"]  # non-empty allowlist for whisky
    # never references the magento `classification` field
    import inspect, data.lib.taste_taxonomy.universal_scales as m
    src = inspect.getsource(m)
    assert "classification" not in src.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd <worktree> && ../../../.venv/bin/python -m pytest tests/test_universal_scales.py -v`
Expected: FAIL — `ModuleNotFoundError: universal_scales`

- [ ] **Step 3: Write minimal implementation**

```python
# data/lib/taste_taxonomy/universal_scales.py
"""Universal flat-attribute scales + per-category variety vocab for Phase B.

Rule-12 clean: keyed on the SKU-derived category GROUP/TYPE, NEVER the magento
`classification` field. Used by scripts/enrich_phase_b.py to constrain LLM output.
"""
from __future__ import annotations

# 4-step body scale — the intersection the SHOP filter and FINDER ladder both accept.
# Medium-Light is OUT (shop remaps it to Medium → silent collapse). See spec §4.1.
BODY_SCALE = ["Light", "Medium", "Medium-Full", "Full"]

# Per-category (group) variety allowlists. Keys are SKU-taxonomy GROUP names.
VARIETY_VOCAB: dict[str, list[str]] = {
    "Whisky": ["Single Malt", "Blended Malt", "Blended", "Bourbon", "Rye",
               "Tennessee", "Single Pot Still", "Single Grain", "Corn"],
    "Spirits": ["Agave", "Cane/Molasses", "Grain", "Grape", "Potato",
                "Juniper-Botanical", "Other"],
    "Sake & Asian": ["Junmai", "Junmai Ginjo", "Junmai Daiginjo", "Honjozo",
                     "Ginjo", "Daiginjo", "Nigori", "Shochu", "Other"],
    "Liqueur": ["Herbal", "Fruit", "Cream", "Coffee", "Nut", "Anise",
                "Bitter/Amaro", "Other"],
    "Beer & RTD": ["Lager", "Ale/IPA", "Stout", "Wheat", "RTD-Cocktail",
                   "Hard-Seltzer", "Cider", "Other"],
}

def validate_body(value):
    """Return value if it's an exact 4-step scale member, else None (drop, never coerce)."""
    return value if value in BODY_SCALE else None

def validate_variety(group, value):
    """Return value if it's in the group's allowlist, else None."""
    return value if value in VARIETY_VOCAB.get(group, []) else None

def schema_for_type(category_type):
    """Rule-12 clean lookup keyed on SKU-derived group/type. Returns applicable
    fields + the variety vocab for that group. None if not a Phase-B group."""
    vocab = VARIETY_VOCAB.get(category_type)
    if vocab is None:
        return None
    return {"fields": ["variety", "body"], "variety_vocab": vocab,
            "body_scale": BODY_SCALE}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../../../.venv/bin/python -m pytest tests/test_universal_scales.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add data/lib/taste_taxonomy/universal_scales.py tests/test_universal_scales.py
git commit -m "feat(enrich): universal body scale + per-category variety vocab (Rule-12 clean)"
```

---

## Task 2: `merge_phase_b_cache.py` — NULL-only merge (build BEFORE the paid script)

Building the safe write path first means the paid output always has a safe destination.

**Files:**
- Create: `scripts/merge_phase_b_cache.py`
- Test: `tests/test_merge_phase_b_nullonly.py`

- [ ] **Step 1: Write the failing test (Rule-5 non-clobber + Rule-6 invariant)**

```python
# tests/test_merge_phase_b_nullonly.py
import sqlite3, subprocess, sys, json
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "merge_phase_b_cache.py"

def _mkdb(p):
    c = sqlite3.connect(p)
    c.execute("CREATE TABLE products (sku TEXT, variety TEXT, body TEXT)")
    c.executemany("INSERT INTO products VALUES (?,?,?)", [
        ("LWH1", None, None),                 # both empty → both fill
        ("LWH2", "Single Malt", None),        # variety SET → must be PRESERVED
        ("LWH3", "", "Full"),                 # body SET → must be PRESERVED
    ]); c.commit(); c.close()

def test_merge_is_null_only(tmp_path):
    db = str(tmp_path / "p.db")
    _mkdb(db)
    sidecar = tmp_path / "sc.jsonl"
    sidecar.write_text("\n".join(json.dumps(r) for r in [
        {"sku": "LWH1", "variety": "Bourbon", "body": "Medium"},
        {"sku": "LWH2", "variety": "Blended", "body": "Light"},   # variety must NOT overwrite
        {"sku": "LWH3", "variety": "Rye",     "body": "Light"},   # body must NOT overwrite
    ]) + "\n")
    r = subprocess.run([sys.executable, str(SCRIPT), "--db", db,
                        "--sidecar", str(sidecar), "--apply", "--ts", "test"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    rows = dict((s, (v, b)) for s, v, b in
                sqlite3.connect(db).execute("SELECT sku,variety,body FROM products"))
    assert rows["LWH1"] == ("Bourbon", "Medium")   # filled from empty
    assert rows["LWH2"][0] == "Single Malt"        # PRESERVED, not 'Blended'
    assert rows["LWH3"][1] == "Full"               # PRESERVED, not 'Light'
    assert rows["LWH3"][0] == "Rye"                # empty-string variety DID fill
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../../../.venv/bin/python -m pytest tests/test_merge_phase_b_nullonly.py -v`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/merge_phase_b_cache.py
"""NULL-only merge of Phase B variety/body from a JSONL sidecar into products.db.

Rule 5: NEVER overwrites an existing value — UPDATE ... WHERE col IS NULL OR col=''.
Rule 10: backs up the canonical DB before writing.
Do NOT reuse backfill_from_cache.py's write loop — it is an unconditional clobbering UPDATE.
"""
from __future__ import annotations
import argparse, json, shutil, sqlite3, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "data" / "db" / "products.db"
FIELDS = ("variety", "body")

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--sidecar", type=Path, required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--ts", default="manual")
    a = ap.parse_args(argv)

    rows = [json.loads(l) for l in a.sidecar.read_text().splitlines() if l.strip()]
    if a.apply:
        bak = a.db.with_name(f"{a.db.name}.bak-pre-phaseB-{a.ts}")
        shutil.copy2(a.db, bak); print(f"backup → {bak}")

    conn = sqlite3.connect(a.db)
    filled = {f: 0 for f in FIELDS}
    for r in rows:
        sku = r.get("sku")
        for f in FIELDS:
            val = r.get(f)
            if not val:
                continue
            if a.apply:
                cur = conn.execute(
                    f"UPDATE products SET {f}=? WHERE sku=? AND ({f} IS NULL OR {f}='')",
                    (val, sku))
                filled[f] += cur.rowcount
            else:
                cur = conn.execute(
                    f"SELECT 1 FROM products WHERE sku=? AND ({f} IS NULL OR {f}='')", (sku,))
                if cur.fetchone():
                    filled[f] += 1
    if a.apply:
        conn.commit()
    print(f"{'APPLIED' if a.apply else 'dry-run'} — would fill: " +
          ", ".join(f"{f}={filled[f]}" for f in FIELDS))
    conn.close()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../../../.venv/bin/python -m pytest tests/test_merge_phase_b_nullonly.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/merge_phase_b_cache.py tests/test_merge_phase_b_nullonly.py
git commit -m "feat(enrich): NULL-only Phase B merge script (Rule-5 non-clobber)"
```

---

## Task 3: `enrich_phase_b.py` — row select + free dry-run (NO API yet)

Build selection + the FREE dry-run path first, fully testable with zero spend.

**Files:**
- Create: `scripts/enrich_phase_b.py`
- Reference: `scripts/phase_d1_enrich_critic_scored.py` (harness pattern), `data/lib/taxonomy/sku_taxonomy.py` (`resolve`)

- [ ] **Step 1: Write `select_rows()` + `build_prompt()` + a `main` whose `--dry-run` prints the plan and makes ZERO API calls.**

```python
# scripts/enrich_phase_b.py  (key parts — full harness mirrors phase_d1 EXCEPT the write path)
from __future__ import annotations
import argparse, json, sqlite3, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from data.lib.taxonomy.sku_taxonomy import resolve
from data.lib.taste_taxonomy.universal_scales import schema_for_type, validate_body, validate_variety

DEFAULT_DB = REPO / "data" / "db" / "products.db"
MODEL = "claude-haiku-4-5-20251001"
COST_IN, COST_OUT = 0.80/1_000_000, 4.00/1_000_000
NONWINE = {"Spirits", "Whisky", "Sake & Asian", "Liqueur", "Beer & RTD"}
ENRICHMENT_SOURCE = "phase_b_haiku_variety_body"

def _instock(v):  # "0"/"1"/null STRING semantics
    return str(v) in ("1", "True", "true")
def _empty(v):
    return v is None or str(v).strip() == ""

def select_rows(conn):
    conn.row_factory = sqlite3.Row
    critic = {r[0] for r in conn.execute("SELECT DISTINCT sku FROM critic_scores")}
    out = []
    for r in conn.execute("SELECT sku,name,is_in_stock,variety,body,"
                          "has_recent_sales,sold_orders FROM products"):
        if not _instock(r["is_in_stock"]):
            continue
        group = (resolve({"sku": r["sku"], "name": r["name"]}) or {}).get("group")
        if group not in NONWINE:
            continue
        signal = (str(r["has_recent_sales"]) in ("1","True","true")
                  or int(r["sold_orders"] or 0) > 0 or r["sku"] in critic)
        if not signal:
            continue
        if _empty(r["variety"]) or _empty(r["body"]):
            out.append({**dict(r), "group": group})
    return out

def build_prompt(row):
    schema = schema_for_type(row["group"])
    vocab = ", ".join(schema["variety_vocab"])
    body = ", ".join(schema["body_scale"])
    return (f"Product: {row['name']}\nCategory: {row['group']}\n\n"
            f"Return STRICT JSON {{\"variety\": <one of [{vocab}] or null>, "
            f"\"body\": <one of [{body}] or null>}}.\n"
            "Use ONLY the listed values. If unsure, use null. Never invent a value.")
```

```python
def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--dry-run", action="store_true",
                   help="NO API CALL — print prompts + selection only (free)")
    p.add_argument("--ts", default="run", help="sidecar suffix (e.g. canary/full)")
    a = p.parse_args(argv)
    conn = sqlite3.connect(a.db)
    rows = select_rows(conn)
    if a.limit:
        rows = rows[:a.limit]
    print(f"Selected {len(rows)} rows (need variety or body).")
    if a.dry_run:
        for r in rows[:5]:
            print(f"\n--- {r['sku']} {r['name']} [{r['group']}] ---")
            print(build_prompt(r))
        print("\n(dry-run — ZERO API calls made)")
        return 0
    # ... paid path added in Task 4 ...
    print("Paid path not yet enabled (Task 4)."); return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Run the free dry-run against the REAL DB (no spend)**

Run: `../../../.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db --limit 5 --dry-run`
Expected: prints "Selected 794 rows…" then 5 prompts, ends "ZERO API calls made". **No spend.**

- [ ] **Step 3: Commit**

```bash
git add scripts/enrich_phase_b.py
git commit -m "feat(enrich): Phase B row selection + FREE dry-run (no API path yet)"
```

---

## Task 4: Add the paid Haiku call + cache/sidecar write (still NO DB write)

**Files:**
- Modify: `scripts/enrich_phase_b.py` (add `enrich_one`, sidecar, cache write, `main` paid branch)

- [ ] **Step 1: Add `enrich_one(client, row)` — mirrors phase_d1's JSON-in-text parse + cost calc, then validates against the scales.**

```python
def enrich_one(client, row):
    try:
        resp = client.messages.create(
            model=MODEL, max_tokens=200, temperature=0.2,
            system=[{"type": "text",
                     "text": "You are a precise beverage attribute extractor. "
                             "Output ONLY the requested JSON, values from the allowlist or null."}],
            messages=[{"role": "user", "content": build_prompt(row)}])
    except Exception as e:
        return {"sku": row["sku"], "status": f"api_error: {e}", "variety": None,
                "body": None, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        raw = json.loads(text[text.find("{"):text.rfind("}")+1])
    except Exception:
        raw = {}
    # VALIDATE — drop anything off-scale/off-vocab (never coerce/guess)
    variety = validate_variety(row["group"], raw.get("variety"))
    body = validate_body(raw.get("body"))
    u = resp.usage
    return {"sku": row["sku"], "status": "ok",
            "variety": variety, "body": body,
            "tokens_in": u.input_tokens or 0, "tokens_out": u.output_tokens or 0,
            "cost_usd": (u.input_tokens or 0)*COST_IN + (u.output_tokens or 0)*COST_OUT}
```

- [ ] **Step 2: Wire the paid branch in `main` — thread pool, JSONL sidecar (locked), cache insert, cost summary. NO products.db UPDATE.**

```python
    # paid branch (replaces the Task-3 stub)
    import anthropic
    client = anthropic.Anthropic()
    sidecar = REPO / f"data/phase_b_results-{a.ts}.jsonl"
    lock = threading.Lock()
    total_cost = tot_in = tot_out = 0
    n_var = n_body = 0
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(enrich_one, client, r): r for r in rows}
        for f in as_completed(futs):
            res = f.result()
            with lock:
                with sidecar.open("a") as fh:
                    fh.write(json.dumps(res, ensure_ascii=False) + "\n")
            total_cost += res["cost_usd"]; tot_in += res["tokens_in"]; tot_out += res["tokens_out"]
            n_var += bool(res["variety"]); n_body += bool(res["body"])
    print(f"\nSidecar: {sidecar}")
    print(f"Calls: {len(rows)}  cost: ${total_cost:.4f}  in:{tot_in} out:{tot_out}")
    print(f"variety filled: {n_var}  body filled: {n_body}")
    print(f"Per-row: ${total_cost/max(len(rows),1):.5f}")
    # The JSONL SIDECAR is the source of truth for the merge step (Task 6 reads it).
    # We deliberately do NOT write enrichment_cache here: that table has 6 NOT NULL cols
    # (sku, prompt_hash, evidence_hash, prompt_text, response_json, model) and a cost_thb
    # (not USD) column — a naive insert would NOT-NULL-crash mid-paid-run (Rule 1) or
    # mislabel the cost ledger (Rule 4). The sidecar is durable on disk and committed, so
    # the cache copy is not load-bearing for shipping. If a durable cache copy is wanted
    # later, add it as a SEPARATE post-run step that reads the sidecar, populates ALL six
    # NOT NULL cols, converts cost to THB, and is wrapped so a cache failure can never abort
    # or follow a paid run.
```

(`--ts` was already added to the argparser in Task 3 — do not re-add it.)

- [ ] **Step 3: Verify it compiles / imports without calling the API**

Run: `../../../.venv/bin/python -c "import ast; ast.parse(open('scripts/enrich_phase_b.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add scripts/enrich_phase_b.py
git commit -m "feat(enrich): Phase B paid Haiku call + validated cache/sidecar write (no DB write)"
```

---

## Task 5: Rule-10 CANARY — 5 SKUs, then STOP for sign-off

**This task SPENDS money (~<$0.01). Do the free dry-run first; do NOT proceed past Step 4 without user sign-off.**

- [ ] **Step 1: Backup the canonical DB**

Run: `cp data/db/products.db data/db/products.db.bak-pre-phaseB-canary`

- [ ] **Step 2: Free dry-run (zero spend) to confirm selection + prompts**

Run: `../../../.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db --limit 5 --dry-run`
Expected: "Selected 794 rows…", 5 sane prompts.

- [ ] **Step 3: PAID canary — 5 SKUs to cache/sidecar only (no DB write)**

Run: `../../../.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db --limit 5 --ts canary`
Expected: sidecar `data/phase_b_results-canary.jsonl` with 5 rows; cost printed (<$0.01).

- [ ] **Step 4: Eyeball the 5 results (Rule 2 — investigate, don't trust)**

Run: `cat data/phase_b_results-canary.jsonl`
Verify: variety ∈ the row's vocab, body ∈ 4-step scale, values plausible for the named product.
Note the success/skip ratio (how many got non-null variety AND body).

- [ ] **Step 5: STOP — compute and present the full-run estimate, get sign-off**

From the canary's measured `cost_usd` per row × 794, present the number to the user.
**Do NOT run Task 6 until the user approves the number.** (Decide here whether Haiku
accuracy is adequate or a Sonnet escalation is needed — spec §4 / Run-1 model decision.)

```bash
git add data/phase_b_results-canary.jsonl
git commit -m "chore(enrich): Phase B canary results (5 SKUs, pre-signoff)"
```

---

## Task 6: Full run → merge → refresh → VERIFY-SHIPPED (only after sign-off)

- [ ] **Step 1: Full enrichment to cache/sidecar**

Run: `../../../.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db --ts full`
Expected: ~794 calls, sidecar `data/phase_b_results-full.jsonl`, cost ≈ the approved estimate.

- [ ] **Step 2: Dry-run the merge (no write) — confirm fill counts**

Run: `../../../.venv/bin/python scripts/merge_phase_b_cache.py --db data/db/products.db --sidecar data/phase_b_results-full.jsonl`
Expected: "dry-run — would fill: variety=…, body=…"

- [ ] **Step 3: Apply the NULL-only merge (backs up DB)**

Run: `../../../.venv/bin/python scripts/merge_phase_b_cache.py --db data/db/products.db --sidecar data/phase_b_results-full.jsonl --apply --ts full`
Expected: "APPLIED — would fill: variety=…, body=…"; backup created.

- [ ] **Step 4: Refresh the UI export (Rule 9)**

Run: `../../../.venv/bin/python scripts/refresh_live_export.py`
Expected: "Wrote 11436 products"; no new EXPORT_COLS warning for variety/body.

- [ ] **Step 5: VERIFY-SHIPPED (Rule 1) — merged-SKU set in the JSON, not gross totals**

```bash
../../../.venv/bin/python -c "
import json
merged=[json.loads(l)['sku'] for l in open('data/phase_b_results-full.jsonl')]
data={p['sku']:p for p in json.load(open('data/live_products_export.json'))}
v=sum(1 for s in merged if (data.get(s) or {}).get('variety'))
b=sum(1 for s in merged if (data.get(s) or {}).get('body'))
print(f'merged SKUs: {len(merged)}  variety in JSON: {v}  body in JSON: {b}')
"
```
Expected: variety/body counts match the merge's reported fill counts for the merged SKUs.

- [ ] **Step 6: UI spot-check (Rule 7)** — start catalog dev server (port 3100), open a
previously-empty whisky's /product page + the /shop body filter; confirm the value renders.

- [ ] **Step 7: Cost report (Rule 4)** — total spend, # calls, # rows where variety/body are
populated IN the export, per-successful-row cost. Then commit the regenerated export + sidecar.

```bash
git add data/live_products_export.json data/phase_b_results-full.jsonl
git commit -m "feat(enrich): Phase B variety+body shipped (verified in export)"
```

---

## Notes
- Reconcile with parked `project_finder_data_enhancements` rather than duplicating.
- Run 2 (catalog breadth: finish/intensity/smokiness DISPLAY, wider rows) is a SEPARATE spec +
  plan + Rule-10 gate. Do NOT fold it in here.
- Opportunistic: fix stale `apps/catalog/lib/taste-adapter.ts:108-109` comment (sweetness now 279).
