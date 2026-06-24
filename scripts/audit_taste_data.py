"""Read-only taste-data quality audit. NO DB writes (opens DB mode=ro).

Stages: (1) census + category resolve, (2) free deterministic triage,
(3) optional paid Haiku judge over suspects + a stratified control with
per-cell Wilson-LB escalation. Outputs a markdown report + per-SKU findings
JSON. Rule-10: the paid stage is gated behind --judge and prints a cost
estimate; the default run is FREE.
See docs/superpowers/specs/2026-06-24-taste-data-quality-audit-design.md
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
from scripts import audit_taste_lib as L          # noqa: E402
from data.lib.taxonomy import sku_taxonomy         # noqa: E402

TASTE_COLS = ("smokiness", "sweetness", "body", "variety")
DEFAULT_DB = REPO / "data" / "db" / "products.db"
AUDIT_DIR = REPO / "data" / "audits"
REPORT_PATH = REPO / "docs" / "superpowers" / "audits" / "2026-06-24-taste-audit-report.md"
JUDGE_CACHE = AUDIT_DIR / "taste_audit_judge_cache.jsonl"
MODEL = "claude-haiku-4-5-20251001"
CONTROL_PER_TYPE = 10
ESCALATE_LB = 0.15

JUDGE_SYSTEM = """You audit a single beverage taste attribute. Reply ONLY with JSON:
{"verdict":"confirm_correct"|"wrong_value"|"not_applicable_null_it","value":<corrected value or null>,"reason":"<short>"}

Domain rules (apply strictly):
- Sparkling dosage ladder: Brut Nature(0-3) < Extra Brut < Brut < Extra Dry(12-17 g/L) < Sec/Dry < Demi-Sec < Doux. "Extra Dry" is SWEETER than Brut -> Off-Dry, NOT Dry.
- "Dry" as a STYLE NAME is not palate: London/Plymouth Dry Gin, Riesling Trocken, sake Karakuchi(=dry). Judge palate, not the label word. Vermouth Dry vs Rosso IS a real palate distinction.
- Peat is by-distillery: Talisker/Ledaig/Caol Ila/Kilchoman/Lagavulin/Laphroaig/Ardbeg/Bowmore = smoky even with no "peat" in the name. But "Smoky/Smokehead/Ole Smoky" may be a BRAND -> verify actually peated.
- German Pradikat: Kabinett/Spatlese default off-dry/sweet UNLESS "Trocken/Feinherb" present (then dry).
- variety = base material / class per category: wine->grape; whisky->Single Malt/Blended/Bourbon/Rye; sake->Junmai/Ginjo grade; gin->botanical. NEVER judge a whisky/sake variety against a grape rubric.
- not_applicable_null_it: use when the attribute should not exist for this product (e.g. grape variety on glassware)."""


# --- Stage 1: census + read-only DB ----------------------------------------

def open_ro(db_path) -> sqlite3.Connection:
    """Open the DB strictly read-only so the audit can never mutate it."""
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _triage_cell(r, col):
    """Run the applicable deterministic rules for one (row, column); first hit wins.

    CRITICAL: smokiness is NOT in any universal_scales.applies() set (the matrix
    has no smokiness axis), so it must NEVER be routed through triage_inapplicable
    — doing so would flag all ~1,970 smokiness rows as 'inapplicable' and the
    peated-false-negative / brand-false-positive rules would never run.
    """
    name, g, t, v = r.get("name", ""), r["group"], r["type"], r[col]
    if col == "smokiness":
        return L.triage_smokiness(r["sku"], name, v, g, t)
    f = L.triage_inapplicable(r["sku"], name, col, v, g, t)
    if f:
        return f
    if col == "sweetness":
        return L.triage_sweetness(r["sku"], name, v, g, t)
    if col == "body":
        return (L.triage_nonbeverage(r["sku"], name, "body", v, g, t)
                or L.triage_body_case(r["sku"], name, v, g, t))
    if col == "variety":
        return L.triage_nonbeverage(r["sku"], name, "variety", v, g, t)
    return None


def run_census(db_path) -> dict:
    conn = open_ro(db_path)
    rows = [dict(r) for r in conn.execute(
        f"SELECT sku, name, {', '.join(TASTE_COLS)} FROM products")]
    conn.close()

    populated = {c: 0 for c in TASTE_COLS}
    suspects, clean = [], []
    for r in rows:
        cat = sku_taxonomy.resolve({"sku": r["sku"], "name": r.get("name", "")})
        r["group"], r["type"] = cat["group"], cat["type"]
        for col in TASTE_COLS:
            if not L.is_populated(r[col]):
                continue
            populated[col] += 1
            f = _triage_cell(r, col)
            if f:
                # Enrich the finding so suspect dicts carry the SAME keys as
                # clean dicts (group/type/name). Without this the live judge
                # (and canary) KeyError on build_judge_prompt -> first paid row
                # crashes and the Rule-10 gate never runs.
                f.update({"group": r["group"], "type": r["type"],
                          "name": r.get("name", "")})
                suspects.append(f)
            else:
                clean.append({"sku": r["sku"], "column": col,
                              "current_value": r[col], "group": r["group"],
                              "type": r["type"], "name": r.get("name", ""),
                              "rule": None})
    return {"populated": populated, "suspects": suspects, "clean": clean,
            "total_rows": len(rows)}


# --- Stage 3: judge prompt + cache -----------------------------------------

def build_judge_prompt(row: dict) -> str:
    return (f"group={row['group']} type={row['type']}\n"
            f"product name: {row.get('name','')}\n"
            f"attribute: {row['column']}\n"
            f"current value: {row['current_value']}\n"
            f"Is the current value correct for THIS product? Apply the domain rules.")


def cache_key(row: dict) -> str:
    return f"{row['sku']}|{row['column']}"


def cache_get(path, key):
    p = Path(path)
    if not p.exists():
        return None
    for line in p.read_text().splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("key") == key:
            return rec.get("value")
    return None


def cache_put(path, key, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a") as fh:
        fh.write(json.dumps({"key": key, "value": value}) + "\n")


def parse_env_line(line: str):
    """Parse a KEY=VALUE .env line, stripping surrounding quotes. Returns (k,v) or None.

    The .env.local value is quoted (ANTHROPIC_API_KEY="sk-..."); the quotes MUST be
    stripped or the SDK sends them as part of the key -> 401 invalid x-api-key.
    Mirrors enrich_phase_b.py's loader exactly.
    """
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        return None
    k, v = line.split("=", 1)
    return k.strip(), v.strip().strip('"').strip("'")


def _load_env_local():
    """Mirror enrich_phase_b: load ANTHROPIC_API_KEY from .env.local if unset."""
    import os
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    envp = REPO / ".env.local"
    if envp.exists():
        for line in envp.read_text().splitlines():
            kv = parse_env_line(line)
            if kv and kv[0] == "ANTHROPIC_API_KEY":
                os.environ["ANTHROPIC_API_KEY"] = kv[1]


def _call_haiku(prompt: str) -> dict:
    import anthropic                       # lazy: tests/free run never import it
    _load_env_local()
    client = anthropic.Anthropic()
    resp = client.messages.create(
        model=MODEL, max_tokens=200, temperature=0,
        system=JUDGE_SYSTEM, messages=[{"role": "user", "content": prompt}])
    text = resp.content[0].text
    return json.loads(text[text.find("{"):text.rfind("}") + 1])


def _judge_one(row):
    key = cache_key(row)
    cached = cache_get(JUDGE_CACHE, key)
    if cached is not None:
        return cached
    verdict = _call_haiku(build_judge_prompt(row))
    cache_put(JUDGE_CACHE, key, verdict)
    return verdict


def _judge_rows(rows):
    out = []
    for row in rows:
        v = _judge_one(row)
        out.append({**{k: row.get(k) for k in
                       ("sku", "column", "current_value", "rule",
                        "expected_value", "group", "type", "name")}, **v})
    return out


def _cell_key(v):
    """A cell = (column, current_value, group, type) per spec §6."""
    return (v["column"], v["current_value"], v.get("group"), v.get("type"))


def _escalate_dirty_cells(control_verdicts, census, min_n=20, lb=ESCALATE_LB):
    """Per-CELL Wilson-LB escalation (spec §6). For each control cell with
    n>=min_n whose wrong-rate lower bound > lb, judge ALL remaining clean rows
    in that cell. Cells with n<min_n are reported but NOT gated."""
    cells = {}
    for v in control_verdicts:
        cells.setdefault(_cell_key(v), []).append(v)
    escalated, cell_report = [], []
    for key, vs in cells.items():
        n = len(vs)
        wrong = sum(1 for v in vs if v["verdict"] in
                    ("wrong_value", "not_applicable_null_it"))
        lower = L.wilson_lower_bound(wrong, n)
        gated = n >= min_n
        cell_report.append({"cell": list(key), "n": n, "wrong": wrong,
                            "wilson_lb": round(lower, 3), "gated": gated,
                            "escalated": gated and lower > lb})
        if gated and lower > lb:
            col, val, grp, typ = key
            already = {v["sku"] for v in vs}
            extra = [r for r in census["clean"]
                     if r["column"] == col and r["current_value"] == val
                     and r.get("group") == grp and r.get("type") == typ
                     and r["sku"] not in already]
            escalated.extend(_judge_rows(extra))
    return escalated, cell_report


def run_judge(census: dict, canary: int = 0) -> dict:
    suspects = census["suspects"]
    control = L.stratified_control(census["clean"], key="type",
                                   per_type=CONTROL_PER_TYPE, seed=42)
    if canary:
        targets = (suspects + control)[:canary]
        verdicts = _judge_rows(targets)
        escalated, cell_report = [], []
    else:
        suspect_verdicts = _judge_rows(suspects)
        control_verdicts = _judge_rows(control)
        escalated, cell_report = _escalate_dirty_cells(control_verdicts, census)
        verdicts = suspect_verdicts + control_verdicts + escalated

    checked = [v for v in verdicts if v.get("rule") in
               ("sparkling_extra_dry_inversion", "nonbeverage_taste_leak")]
    agreed = sum(1 for v in checked
                 if v["verdict"] in ("wrong_value", "not_applicable_null_it"))
    calibration = {"checked": len(checked), "agreed": agreed,
                   "miscalibrated": bool(checked) and agreed < len(checked) * 0.8}

    if canary:
        n_full = len(suspects) + len(control)
        est = n_full * (60 * 1e-6 * 1.0 + 30 * 1e-6 * 5.0)  # Haiku ~$1/M in, $5/M out
        print(f"[CANARY] judged {len(targets)} rows; full set = {n_full} rows "
              f"(pre-escalation); est ${est:.3f}. Calibration: {calibration}. "
              f"Re-run WITHOUT --canary and WITH sign-off to judge the full set.")
    return {"verdicts": verdicts, "calibration": calibration,
            "cell_report": cell_report, "escalated": len(escalated),
            "control_size": len(control), "suspect_size": len(suspects)}


# --- Outputs ---------------------------------------------------------------

def _per_column_judged(judged):
    """Aggregate judge verdicts into a per-column measured error rate (spec §10,
    Rule 4). Returns {col: {judged, wrong, error_rate, error_lb, suggest}}."""
    out = {}
    for v in (judged or {}).get("verdicts", []):
        col = v["column"]
        d = out.setdefault(col, {"judged": 0, "wrong": 0})
        d["judged"] += 1
        if v.get("verdict") in ("wrong_value", "not_applicable_null_it"):
            d["wrong"] += 1
    for col, d in out.items():
        n, w = d["judged"], d["wrong"]
        d["error_rate"] = round(w / n, 3) if n else 0.0
        d["error_lb"] = round(L.wilson_lower_bound(w, n), 3)
        d["suggest"] = ("trust" if d["error_lb"] < 0.02
                        else "correct" if d["error_lb"] < 0.30 else "re-enrich")
    return out


def build_outputs(census: dict, judged):
    """Return (report_markdown, findings_dict). judged=None for the free run.

    When `judged` is present this emits the spec §10 per-column section: the
    judge-MEASURED error rate (point + Wilson lower bound) and an advisory
    trust/correct/re-enrich leaning. The decision WORD is confirmed by a human
    in Task 8, but the measured rate is computed here, not by hand.
    """
    by_col = {}
    for f in census["suspects"]:
        by_col.setdefault(f["column"], []).append(f)
    pcj = _per_column_judged(judged)
    lines = ["# Taste-Data Quality Audit — Report", "",
             f"Total rows: {census['total_rows']}",
             f"Judge: {'yes' if judged else 'no (free deterministic run)'}", ""]
    if judged:
        cal = judged.get("calibration", {})
        lines += [f"Judge calibration: checked={cal.get('checked')} "
                  f"agreed={cal.get('agreed')} "
                  f"miscalibrated={cal.get('miscalibrated')}",
                  f"Escalated cells -> extra rows judged: {judged.get('escalated', 0)}",
                  ""]
        if cal.get("miscalibrated"):
            lines += ["> JUDGE MISCALIBRATED — verdicts NOT trustworthy; "
                      "fix the judge prompt before acting on this report.", ""]
    for col in TASTE_COLS:
        sus = by_col.get(col, [])
        lines += [f"## {col}",
                  f"- populated: {census['populated'][col]}",
                  f"- deterministic suspects: {len(sus)}"]
        rules = {}
        for f in sus:
            rules[f["rule"]] = rules.get(f["rule"], 0) + 1
        for rule, n in sorted(rules.items(), key=lambda kv: -kv[1]):
            lines.append(f"    - {rule}: {n}")
        if col in pcj:
            d = pcj[col]
            lines += [f"- judged: {d['judged']} | wrong: {d['wrong']} | "
                      f"measured error rate: {d['error_rate']} "
                      f"(Wilson LB {d['error_lb']})",
                      f"- ADVISORY leaning: **{d['suggest']}** "
                      f"(human confirms in Task 8)"]
        lines.append("")
    findings = {"meta": {"total_rows": census["total_rows"],
                         "populated": census["populated"],
                         "judged": bool(judged)},
                "per_column": pcj,
                "suspects": census["suspects"],
                "judge": judged or {}}
    return "\n".join(lines), findings


def write_outputs(report: str, findings: dict):
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report)
    (AUDIT_DIR / "taste_audit_findings.json").write_text(json.dumps(findings, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--judge", action="store_true",
                    help="run the PAID Haiku judge (Rule-10 gated)")
    ap.add_argument("--canary", type=int, default=0,
                    help="judge only N rows, print a cost estimate, then stop")
    args = ap.parse_args()

    census = run_census(args.db)
    judged = None
    if args.judge or args.canary:
        judged = run_judge(census, canary=args.canary)
    report, findings = build_outputs(census, judged)
    write_outputs(report, findings)
    print(report)
    print(f"\nWrote {REPORT_PATH}\nWrote {AUDIT_DIR/'taste_audit_findings.json'}")


if __name__ == "__main__":
    main()
