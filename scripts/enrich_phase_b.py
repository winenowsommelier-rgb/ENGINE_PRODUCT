"""Phase B Run 2 enrichment — ROW SELECTION + FREE dry-run.

This module selects ALL drinkable, in-stock products that are still missing any
of the 5 taste fields THAT APPLY to their category, and builds the constrained
LLM prompt for each. The field set is parameterized (FIELDS) and gated by the
§4.0 applicability matrix (universal_scales.applies(group, type)). There is NO
buying-signal gate in Run 2 — Run 1's critic/sales gate is gone; every drinkable
in-stock row with an applicable gap is eligible. The PAID LLM call lands in
main()'s paid branch; this selection path makes ZERO network/API calls and never
writes to the DB (read-only SELECT).

Fields (universal_scales.FIELD_SPECS): variety, body, acidity, tannin, sweetness.
applies() decides which apply per (group, wine_type) — e.g. Gin -> {variety};
a Red Wine -> {variety, body, acidity, tannin}; a Liqueur -> all but tannin.
Only the APPLICABLE-and-empty fields go in a row's `need`; the prompt, parse,
validate, and counters all iterate `need` / FIELDS — nothing is hardcoded.

Critical contracts (load-bearing — see CLAUDE.md Rules 1, 12):
  * Category comes from sku_taxonomy.resolve()["group"]/["type"], NEVER the
    magento `classification` field (Rule 12). applies()/variety_vocab_for()
    are GROUP-keyed (type only refines wine sub-gating); group and type
    DIVERGE for non-wine (group "Spirits" -> type "Rum").
  * is_in_stock is a STRING "0"/"1"/null — truthiness is backwards; only
    treat str(v) in ("1","True","true") as in-stock.

Run the FREE dry-run (no spend):
  ./.venv/bin/python scripts/enrich_phase_b.py --db data/db/products.db \
      --limit 5 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from data.lib.taxonomy.sku_taxonomy import resolve  # noqa: E402
from data.lib.taste_taxonomy.universal_scales import (  # noqa: E402
    FIELD_SPECS,
    applies,
    variety_vocab_for,
)

# Canonical DB lives at repo-root data/db/products.db. This resolves inside the
# worktree too; for the real run the operator passes --db data/db/products.db.
DEFAULT_DB = REPO / "data" / "db" / "products.db"

MODEL = "claude-haiku-4-5-20251001"
COST_IN, COST_OUT = 0.80 / 1_000_000, 4.00 / 1_000_000

# The full Run-2 field set the SELECT/prompt/parse/validate/counters iterate over.
# Per-row `applies()` decides which of these actually apply to that category.
FIELDS = ("variety", "body", "acidity", "tannin", "sweetness")

# Drinkable SKU-taxonomy GROUP names (Rule 12). Run 2 INCLUDES Wine; Beer & RTD
# is dropped from Run 2 scope.
DRINKABLE = {"Wine", "Spirits", "Whisky", "Sake & Asian", "Liqueur"}
ENRICHMENT_SOURCE = "phase_b_run2_haiku_taste"


def _instock(v) -> bool:
    """is_in_stock is a string "0"/"1"/null; only "1"/"True"/"true" = in stock."""
    return str(v) in ("1", "True", "true")


def _empty(v) -> bool:
    return v is None or str(v).strip() == ""


def resolve_group_type(row) -> tuple[str | None, str | None]:
    """Return the SKU-derived (GROUP, TYPE) (Rule 12) — NEVER the magento
    classification. applies()/variety_vocab_for() are group-keyed; the type only
    refines wine sub-gating (Red->tannin, White/dessert->sweetness)."""
    r = resolve({"sku": row["sku"], "name": row["name"]})
    return r.get("group"), r.get("type")


def select_rows(conn: sqlite3.Connection) -> list[dict]:
    """Pick in-stock, drinkable rows still missing any APPLICABLE taste field.

    Run 2 has NO buying-signal gate (Run 1's critic/sales gate is removed):
    every in-stock drinkable row with an applicable gap is eligible. For each row
    we compute the §4.0 applicable field set via applies(group, type), then the
    subset that is still empty (`need`). A row with a non-empty `need` is selected,
    carrying group, wine_type, and the sorted `need` list for the prompt/parse."""
    conn.row_factory = sqlite3.Row
    out: list[dict] = []
    for r in conn.execute(
        "SELECT sku,name,is_in_stock,variety,body,acidity,tannin,sweetness "
        "FROM products ORDER BY sku"
    ):
        if not _instock(r["is_in_stock"]):
            continue
        group, wine_type = resolve_group_type(r)
        if group not in DRINKABLE:
            continue
        ap = applies(group, wine_type)
        need = {f for f in ap if _empty(r[f])}
        if need:
            out.append({**dict(r), "group": group, "wine_type": wine_type,
                        "need": sorted(need)})
    return out


def _field_options(field: str, group: str) -> str:
    """The comma-joined allowlist for a field (variety is group-keyed; the gauge
    fields read their scale from FIELD_SPECS)."""
    if field == "variety":
        return ", ".join(variety_vocab_for(group))
    return ", ".join(FIELD_SPECS[field]["scale"])


def build_prompt(row: dict) -> str:
    """Build the constrained prompt for ONLY the fields in row['need'] (§4.0
    gating). variety options come from the group vocab; the gauge fields from
    FIELD_SPECS scales. Nothing is hardcoded — adding a field to FIELD_SPECS +
    applies() flows through here automatically."""
    group = row["group"]
    lines = [
        f"\"{f}\": <one of [{_field_options(f, group)}] or null>"
        for f in row["need"]
    ]
    body = "{" + ", ".join(lines) + "}"
    return (
        f"Product: {row['name']}\nCategory: {group}\n\n"
        f"Return STRICT JSON {body}.\n"
        "Use ONLY the listed values. If unsure, use null. Never invent a value."
    )


SYSTEM = ("You are a precise beverage attribute extractor. "
          "Output ONLY the requested JSON, values from the allowlist or null.")


def load_done_skus(path) -> set:
    """Read a JSONL sidecar and return the set of skus already present (ANY
    status, incl. api_error). Resume cost-safety (Rule 4/10): a re-run must not
    re-PAY for a sku already in the sidecar.

    A non-existent path -> empty set (fresh run). Blank / truncated / malformed
    lines (a crash mid-write leaves a partial last line) are skipped, not fatal —
    a corrupt tail must never abort the resume scan."""
    path = Path(path)
    if not path.exists():
        return set()
    done: set = set()
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:  # noqa: BLE001 — partial/garbage line -> skip, don't crash resume
                continue
            sku = rec.get("sku")
            if sku is not None:
                done.add(sku)
    return done


def filter_undone(rows: list[dict], done_skus: set) -> list[dict]:
    """Drop rows whose sku is already in done_skus (resume without re-paying)."""
    return [r for r in rows if r["sku"] not in done_skus]


def enrich_one(client, row: dict) -> dict:
    """ONE paid Haiku call: extract the row's NEEDED taste fields, parse the
    JSON-in-text, then VALIDATE each against its allowlist/scale. A value the LLM
    returns that is off-vocab/off-scale — or for a field NOT in row['need'] — is
    DROPPED to None (Rule 1/12 + spec §4.0/§4.1): the LLM is constrained but NOT
    trusted, and we never widen beyond the applicable+empty fields. None leaves
    the gap for the NULL-only merge; a coerced wrong value would ship bad data.
    Always emits all 5 FIELDS (None where N/A) so the sidecar schema is uniform.
    Never raises — API errors become status 'api_error' (all fields None) so one
    bad SKU can't abort a paid bulk run."""
    need = set(row["need"])
    try:
        resp = client.messages.create(
            model=MODEL, max_tokens=300, temperature=0,  # temp=0 for determinism
            system=[{"type": "text", "text": SYSTEM}],
            messages=[{"role": "user", "content": build_prompt(row)}])
    except Exception as e:  # noqa: BLE001 — any SDK/network error -> recorded, not raised
        out = {"sku": row["sku"], "group": row["group"],
               "status": f"api_error: {e}",
               "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0}
        out.update({f: None for f in FIELDS})
        return out
    text = "".join(getattr(b, "text", "") for b in resp.content)
    try:
        raw = json.loads(text[text.find("{"):text.rfind("}") + 1])
    except Exception:  # noqa: BLE001 — malformed/non-JSON -> empty dict (graceful all-None)
        raw = {}
    out = {"sku": row["sku"], "group": row["group"], "status": "ok"}
    for f in FIELDS:
        if f not in need:
            out[f] = None  # not applicable/needed -> never write it (no scope creep)
        elif f == "variety":
            out[f] = FIELD_SPECS["variety"]["validate"](row["group"], raw.get("variety"))
        else:
            out[f] = FIELD_SPECS[f]["validate"](raw.get(f))  # off-scale -> None
    u = resp.usage
    tin = u.input_tokens or 0
    tout = u.output_tokens or 0
    out["tokens_in"] = tin
    out["tokens_out"] = tout
    out["cost_usd"] = tin * COST_IN + tout * COST_OUT
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Phase B row selection + FREE dry-run")
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="NO API CALL — print prompts + selection only (free)",
    )
    p.add_argument("--ts", default="run", help="sidecar suffix (e.g. canary/full)")
    p.add_argument(
        "--skip-done",
        action="store_true",
        help="skip SKUs already in the sidecar (resume without re-paying)",
    )
    a = p.parse_args(argv)

    conn = sqlite3.connect(a.db)
    rows = select_rows(conn)
    print(f"Selected {len(rows)} rows (missing an applicable taste field).")

    if a.dry_run:
        # Apply --limit to the preview so `--limit N --dry-run` previews the same
        # window the paid run would take. (Resume filtering is paid-path only.)
        preview = rows[: a.limit] if a.limit else rows
        for r in preview[:5]:
            print(f"\n--- {r['sku']} {r['name']} [{r['group']}] ---")
            print(build_prompt(r))
        print("\n(dry-run — ZERO API calls made)")
        return 0

    # ----- PAID BRANCH (Task 4) — spends money. Rule 10: only after sign-off. ---
    # SOURCE OF TRUTH is the JSONL sidecar below, NOT enrichment_cache. We do NOT
    # write enrichment_cache: it has 6 NOT NULL columns (incl. prompt_hash /
    # evidence_hash) plus a cost_thb column, so a naive insert would crash
    # mid-paid-run after money is already spent. The separate NULL-only merge
    # script (Task 2) reads this sidecar to fill DB gaps; this script writes NO
    # products.db rows. Each sidecar record carries the validated (or None)
    # values only, so the downstream gap-fill never clobbers existing data.
    sidecar = REPO / f"data/phase_b_results-{a.ts}.jsonl"

    # ----- RESUME / ANTI-CLOBBER cost-safety (Rule 4/10) — BEFORE any SDK/spend -
    # The sidecar is the source of truth + the ONLY record of what we already
    # paid for. This guard runs before the SDK import/client so it can refuse
    # safely without needing an API key or making any call:
    #   --skip-done  -> read existing skus, drop them from `rows`, APPEND-mode
    #                   (prior results preserved, no re-pay).
    #   no flag, but a non-empty sidecar already exists -> REFUSE to run rather
    #                   than truncate it (truncate = destroy completed work AND
    #                   re-pay for everything). Operator must --skip-done or --ts.
    done_skus = load_done_skus(sidecar)
    if a.skip_done:
        before = len(rows)
        rows = filter_undone(rows, done_skus)
        print(f"Resume: {len(done_skus)} already in sidecar; "
              f"skipped {before - len(rows)}, {len(rows)} remaining to call.")
        open_mode = "a"  # APPEND — never truncate prior paid results
    else:
        if done_skus:
            print(
                f"ERROR: sidecar {sidecar} already has {len(done_skus)} result(s).\n"
                "Refusing to truncate it (that would DESTROY completed work and "
                "RE-PAY for every SKU).\n"
                "Use --skip-done to resume (append), or a fresh --ts for a new run.",
                file=sys.stderr,
            )
            return 1
        open_mode = "w"

    # Apply --limit AFTER resume-filtering so a capped resume processes the NEXT N
    # *undone* rows (not the first N selected, which on a resume may already be done
    # -> the run would stall / re-evaluate the same window). select_rows ORDER BY sku
    # makes "next N" deterministic across DB rewrites.
    if a.limit:
        rows = rows[: a.limit]

    if not rows:
        print("Nothing to do — all selected SKUs already in sidecar. No API calls.")
        return 0

    import os

    # Load ANTHROPIC_API_KEY from .env.local (mirrors phase_d1's loader). The key is
    # never in the shell env; .env.local lives at the repo root (symlinked into the
    # worktree). setdefault so a real env var still wins.
    env_path = REPO / ".env.local"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY missing (.env.local not found or no key)",
              file=sys.stderr)
        return 1

    import anthropic  # imported here so dry-run/tests never need the SDK installed

    client = anthropic.Anthropic()

    lock = threading.Lock()
    total_cost = 0.0
    total_in = total_out = 0
    n_calls = n_ok = n_api_error = 0
    n_field = {f: 0 for f in FIELDS}  # per-field "filled" tally (Rule 4 truthful count)

    with sidecar.open(open_mode) as fh, ThreadPoolExecutor(max_workers=6) as ex:
        futures = {ex.submit(enrich_one, client, r): r for r in rows}
        for fut in as_completed(futures):
            res = fut.result()
            with lock:
                fh.write(json.dumps(res) + "\n")
                fh.flush()
                n_calls += 1
                total_cost += res["cost_usd"]
                total_in += res["tokens_in"]
                total_out += res["tokens_out"]
                if res["status"] == "ok":
                    n_ok += 1
                elif str(res["status"]).startswith("api_error"):
                    n_api_error += 1
                for f in FIELDS:
                    if res.get(f) is not None:
                        n_field[f] += 1

    # Rule 4: per-SUCCESSFUL-row cost (NOT per-attempt — api_errors paid nothing
    # but must not deflate the cost-per-good-row the operator reasons about).
    per_ok = total_cost / max(n_ok, 1)
    print(f"Sidecar: {sidecar}")
    print(f"Calls: {n_calls}  ok: {n_ok}  api_error: {n_api_error}")
    print(f"Total cost: ${total_cost:.4f}  in: {total_in}  out: {total_out}")
    print("Filled: " + "  ".join(f"{f}={n_field[f]}" for f in FIELDS))
    print(f"Per-SUCCESSFUL-row cost: ${per_ok:.6f}")
    print(
        "NOTE: these are cache/sidecar counts, NOT user-facing 'shipped' counts. "
        "The shipped verification (Rule 1/4) happens at the merge+export step "
        "(Task 6): merge sidecar -> products.db -> refresh_live_export -> count.",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
