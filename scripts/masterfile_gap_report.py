#!/usr/bin/env python3
"""Read-only masterfile-intake GAP REPORT (sign-off artifact).

Spends NO money, writes NOTHING to the database. Opens products.db READ-ONLY
and tells the user exactly what the later (gated) write steps WOULD do:
  - SKU reconciliation (matched / mf-only / db-only / duplicate artifacts)
  - per-field fill candidates, conflicts (DB kept), agreements
  - item_type buckets (cosmetic vs real disagreement -> taxonomy overrides)
  - score preview (incoming critic points, bare-vs-HTML mismatches, NEW after dedupe)
  - designation gap (DB empty designation that name-regex would fill)
  - item_type values NOT in the designation-eligible set (silent-drop guard)

Outputs two files: <out>.json (machine) and <out>.md (human, the artifact).
"""
from __future__ import annotations
import argparse, json, sqlite3, sys, unicodedata
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "data" / "lib" / "taxonomy"))

from scripts.masterfile_lib import (  # noqa: E402
    load_masterfile, is_empty_cell, normalize_variety, parse_points,
    extract_designation, _DESIG_TYPES,
)
import sku_taxonomy  # noqa: E402

DEFAULT_DB = "data/db/products.db"
DEFAULT_OUT = "data/masterfile_gap_report.json"
DEFAULT_CSV = ("/Users/admin/Desktop/OPERATE FOLDER/WNLQ9 Master file/"
               "Masterfile Data WNLQ9 - MReport Masterfile.csv")

# masterfile col -> DB col. variety is special (grape_variety || grape_class),
# designation is special (name regex). Handled explicitly below.
FIELD_MAP = [
    ("country", "country"),
    ("region", "region"),
    ("sub_region", "subregion"),
    ("wine_body", "body"),
    ("wine_acidity", "acidity"),
    ("wine_tanin", "tannin"),
    ("food_matching", "food_matching"),
    ("short_description", "desc_en_short"),
    ("description", "full_description"),
]

# Bare wine_score_1..4 map positionally to these critics (per spec).
BARE_SLOTS = {
    "wine_score_1": "Wine Enthusiast",
    "wine_score_2": "Wine Advocate",
    "wine_score_3": "Wine Spectator",
    "wine_score_4": "James Suckling",
}
HTML_SLOTS = {
    "wine_score_wineenthusiast": "Wine Enthusiast",
    "wine_score_wineadvocate": "Wine Advocate",
    "wine_score_winespectator": "Wine Spectator",
    "wine_score_jamessuckling": "James Suckling",
}


def _norm_type(s: str | None) -> str:
    """Lowercase, strip spaces/slashes/accents — to decide 'same-ish' type."""
    s = (s or "").strip().lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    for ch in (" ", "/", "&", "-", ".", ",", "'"):
        s = s.replace(ch, "")
    return s


def bare_points(v) -> int | None:
    """Bare wine_score_N cells are plain integers (e.g. '90', '92.0').

    parse_points() is built for the HTML critic columns and requires a
    'points'/critic-name cue after the number, so it returns None on a bare
    integer. The bare slots ARE the score, so parse them directly, validated
    to the 50-100 critic range (reject vintage/junk noise).
    """
    v = (v or "").strip()
    if not v:
        return None
    try:
        n = int(float(v))
    except ValueError:
        return None
    return n if 50 <= n <= 100 else None


def mf_variety(row: dict) -> str | None:
    """grape_variety preferred, fall back to grape_class; normalized."""
    for col in ("grape_variety", "grape_class"):
        v = row.get(col)
        if not is_empty_cell(v):
            return normalize_variety(v)
    return None


def build_report(db_path: str, csv_path: str) -> dict:
    rows, dups = load_masterfile(csv_path)
    mf_distinct = len(rows) + len(dups)  # deduped rows + removed dup artifacts
    mf_by_sku = {(r.get("sku") or "").strip(): r for r in rows}

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    db_rows = {r["sku"]: r for r in con.execute("SELECT * FROM products")}

    # ---- SKU reconciliation -------------------------------------------------
    mf_skus = set(mf_by_sku)
    db_skus = set(db_rows)
    matched = mf_skus & db_skus
    mf_only = mf_skus - db_skus
    db_only = db_skus - mf_skus
    mf_only_in_stock = sum(
        1 for s in mf_only if (mf_by_sku[s].get("is_in_stock") or "").strip() in ("1", "1.0")
    )
    recon = {
        "mf_distinct": mf_distinct,
        "matched": len(matched),
        "mf_only_unique": len(mf_only),
        "mf_only_in_stock": mf_only_in_stock,
        "mf_only_oos": len(mf_only) - mf_only_in_stock,
        "db_only": len(db_only),
        "dup_artifacts": len(dups),
        "dup_skus_sample": sorted(set(dups))[:10],
        "db_only_sample": sorted(db_only)[:10],
        "mf_only_sample": sorted(mf_only)[:10],
    }

    # ---- field fill / conflict / agree (matched only) -----------------------
    field_fill, field_conflicts, field_agree = {}, {}, {}
    conflict_samples = defaultdict(list)

    def tally(db_col, get_mf, key):
        fill = conflict = agree = 0
        for sku in matched:
            db_val = db_rows[sku][db_col]
            mf_val = get_mf(mf_by_sku[sku])
            db_empty = is_empty_cell(db_val if isinstance(db_val, str) else (db_val or ""))
            mf_empty = mf_val is None or is_empty_cell(mf_val)
            if mf_empty:
                continue
            if db_empty:
                fill += 1
            elif str(db_val).strip() == str(mf_val).strip():
                agree += 1
            else:
                conflict += 1
                if len(conflict_samples[key]) < 8:
                    conflict_samples[key].append(
                        {"sku": sku, "db": str(db_val)[:60], "mf": str(mf_val)[:60]}
                    )
        field_fill[key] = fill
        field_conflicts[key] = conflict
        field_agree[key] = agree

    for mf_col, db_col in FIELD_MAP:
        tally(db_col, lambda r, c=mf_col: (None if is_empty_cell(r.get(c)) else r.get(c).strip()), db_col)
    # variety (grape_variety||grape_class, normalized)
    tally("variety", mf_variety, "variety")
    # designation (name regex, type-gated by masterfile item_type)
    tally(
        "designation",
        lambda r: extract_designation(r.get("name"), (r.get("item_type") or "").strip()),
        "designation",
    )

    # ---- item_type buckets --------------------------------------------------
    bucket_a = 0  # cosmetic (same-ish)
    bucket_b = Counter()  # (resolver, mf) real disagreements
    no_mf_item_type = 0
    for sku in matched:
        mf_it = (mf_by_sku[sku].get("item_type") or "").strip()
        if not mf_it:
            no_mf_item_type += 1
            continue
        res = sku_taxonomy.type_for(sku) or ""
        if _norm_type(res) == _norm_type(mf_it):
            bucket_a += 1
        else:
            bucket_b[(res, mf_it)] += 1
    bucket_b_top = [
        {"resolver": r, "masterfile": m, "count": n}
        for (r, m), n in bucket_b.most_common(25)
    ]
    item_type_buckets = {
        "bucket_a_cosmetic": bucket_a,
        "bucket_b_real_disagreement": sum(bucket_b.values()),
        "bucket_b_distinct_pairs": len(bucket_b),
        "matched_without_mf_item_type": no_mf_item_type,
        "bucket_b_override_candidates": bucket_b_top,
    }

    # ---- item_type values NOT designation-eligible (silent-drop guard) -------
    elig_norm = {_norm_type(t) for t in _DESIG_TYPES}
    not_eligible = Counter()
    for sku in matched:
        mf_it = (mf_by_sku[sku].get("item_type") or "").strip()
        if mf_it and _norm_type(mf_it) not in elig_norm:
            not_eligible[mf_it] += 1
    item_type_not_eligible = {
        "distinct_types": len(not_eligible),
        "total_rows": sum(not_eligible.values()),
        "types": [{"item_type": t, "count": n} for t, n in not_eligible.most_common()],
    }

    # ---- score preview ------------------------------------------------------
    score_cols = ["wine_score_range"] + list(BARE_SLOTS) + list(HTML_SLOTS)
    incoming_rows = 0
    bare_html_mismatch = []
    incoming_pairs = set()  # (sku, critic, vintage)
    for sku, r in mf_by_sku.items():
        has_any = any(not is_empty_cell(r.get(c)) for c in score_cols)
        if has_any:
            incoming_rows += 1
        vintage = (r.get("vintage") or "").strip()
        # Build per-critic point from bare slot and HTML slot, detect mismatch.
        bare_pts = {}
        for col, critic in BARE_SLOTS.items():
            p = bare_points(r.get(col))
            if p is not None:
                bare_pts[critic] = p
                incoming_pairs.add((sku, critic, vintage))
        for col, critic in HTML_SLOTS.items():
            p = parse_points(r.get(col))
            if p is not None:
                incoming_pairs.add((sku, critic, vintage))
                if critic in bare_pts and bare_pts[critic] != p:
                    if len(bare_html_mismatch) < 15:
                        bare_html_mismatch.append(
                            {"sku": sku, "critic": critic,
                             "bare": bare_pts[critic], "html": p}
                        )
    # count ALL mismatches (not just sampled) for an accurate number
    mismatch_total = 0
    for sku, r in mf_by_sku.items():
        for bcol, critic in BARE_SLOTS.items():
            bp = bare_points(r.get(bcol))
            hcol = next((h for h, c in HTML_SLOTS.items() if c == critic), None)
            hp = parse_points(r.get(hcol)) if hcol else None
            if bp is not None and hp is not None and bp != hp:
                mismatch_total += 1

    existing = con.execute("SELECT sku, critic, vintage FROM critic_scores").fetchall()
    existing_pairs = {
        (e["sku"], (e["critic"] or "").strip(), (e["vintage"] or "").strip()
         if e["vintage"] is not None else "")
        for e in existing
    }
    new_pairs = {p for p in incoming_pairs if p not in existing_pairs}
    score_preview = {
        "mf_incoming_rows_with_any_score": incoming_rows,
        "incoming_distinct_sku_critic_vintage": len(incoming_pairs),
        "bare_vs_html_mismatch_count": mismatch_total,
        "bare_vs_html_mismatch_sample": bare_html_mismatch,
        "existing_critic_scores": len(existing),
        "new_after_dedupe": len(new_pairs),
        "new_sample": sorted(list(new_pairs))[:10],
    }

    # ---- designation gap (DB empty, name-regex would fill) ------------------
    gap = 0
    gap_samples = []
    for sku in matched:
        if not is_empty_cell(db_rows[sku]["designation"] or ""):
            continue
        mf = mf_by_sku[sku]
        it = (mf.get("item_type") or "").strip() or (sku_taxonomy.type_for(sku) or "")
        name = mf.get("name") or db_rows[sku]["name"]
        d = extract_designation(name, it)
        if d:
            gap += 1
            if len(gap_samples) < 10:
                gap_samples.append({"sku": sku, "name": (name or "")[:70],
                                    "item_type": it, "designation": d})
    designation_gap = {
        "db_empty_fillable_by_name_regex": gap,
        "samples": gap_samples,
    }

    con.close()
    return {
        "sku_reconciliation": recon,
        "field_fill": field_fill,
        "field_conflicts": field_conflicts,
        "field_agree": field_agree,
        "field_conflict_samples": dict(conflict_samples),
        "item_type_buckets": item_type_buckets,
        "item_type_not_designation_eligible": item_type_not_eligible,
        "score_preview": score_preview,
        "designation_gap": designation_gap,
    }


def render_md(rep: dict, db_path: str, csv_path: str) -> str:
    r = rep["sku_reconciliation"]
    L = []
    L.append("# Masterfile Intake — Gap Report (read-only sign-off artifact)")
    L.append("")
    L.append("> This report spent **no money** and wrote **nothing** to the database. "
             "It describes what the later (gated) write steps WOULD do. "
             "On every conflict the **DB value is KEPT** (DB is source of truth).")
    L.append("")
    L.append(f"- DB (read-only): `{db_path}`")
    L.append(f"- Masterfile CSV: `{csv_path}`")
    L.append("")

    L.append("## 1. SKU Reconciliation")
    L.append("")
    L.append("| Metric | Count |")
    L.append("|---|---|")
    L.append(f"| Masterfile distinct SKUs | {r['mf_distinct']} |")
    L.append(f"| Matched (in both) | {r['matched']} |")
    L.append(f"| Masterfile-only (would be NEW products) | {r['mf_only_unique']} |")
    L.append(f"| &nbsp;&nbsp;↳ in stock | {r['mf_only_in_stock']} |")
    L.append(f"| &nbsp;&nbsp;↳ out of stock | {r['mf_only_oos']} |")
    L.append(f"| DB-only (not in masterfile) | {r['db_only']} |")
    L.append(f"| Duplicate-SKU artifacts removed | {r['dup_artifacts']} |")
    L.append("")
    L.append(f"_Invariant_: matched({r['matched']}) + mf_only({r['mf_only_unique']}) "
             f"+ dup_artifacts({r['dup_artifacts']}) = {r['matched']+r['mf_only_unique']+r['dup_artifacts']} "
             f"== mf_distinct({r['mf_distinct']})")
    L.append("")
    L.append(f"Duplicate SKUs: `{', '.join(r['dup_skus_sample']) or '—'}`")
    L.append(f"DB-only sample: `{', '.join(r['db_only_sample']) or '—'}`")
    L.append(f"Masterfile-only sample: `{', '.join(r['mf_only_sample']) or '—'}`")
    L.append("")

    L.append("## 2. Per-Field Fill / Conflict / Agree (matched SKUs)")
    L.append("")
    L.append("**Fill** = DB empty, masterfile has a value (would be written). "
             "**Conflict** = both present and differ (**DB KEPT, masterfile ignored**). "
             "**Agree** = identical.")
    L.append("")
    L.append("| DB field | Fill candidates | Conflicts (DB kept) | Agree |")
    L.append("|---|---|---|---|")
    for k in rep["field_fill"]:
        L.append(f"| {k} | {rep['field_fill'][k]} | {rep['field_conflicts'][k]} | {rep['field_agree'][k]} |")
    L.append("")
    for k, samples in rep["field_conflict_samples"].items():
        if not samples:
            continue
        L.append(f"<details><summary>Conflict samples — {k} (DB kept)</summary>")
        L.append("")
        L.append("| SKU | DB (kept) | Masterfile (ignored) |")
        L.append("|---|---|---|")
        for s in samples:
            L.append(f"| {s['sku']} | {s['db']} | {s['mf']} |")
        L.append("")
        L.append("</details>")
        L.append("")

    b = rep["item_type_buckets"]
    L.append("## 3. item_type Buckets (teach the taxonomy)")
    L.append("")
    L.append(f"- **Bucket A — cosmetic** (same type, different spelling): {b['bucket_a_cosmetic']}")
    L.append(f"- **Bucket B — real disagreements** (override candidates): "
             f"{b['bucket_b_real_disagreement']} rows across {b['bucket_b_distinct_pairs']} distinct pairs")
    L.append(f"- Matched rows with no masterfile item_type: {b['matched_without_mf_item_type']}")
    L.append("")
    if b["bucket_b_override_candidates"]:
        L.append("| Resolver (`type_for`) | Masterfile item_type | Count |")
        L.append("|---|---|---|")
        for c in b["bucket_b_override_candidates"]:
            L.append(f"| {c['resolver'] or '∅'} | {c['masterfile'] or '∅'} | {c['count']} |")
        L.append("")

    ne = rep["item_type_not_designation_eligible"]
    L.append("## 4. item_type NOT in designation-eligible set (silent-drop guard)")
    L.append("")
    L.append("These masterfile item_type labels are not in the designation-eligible "
             "type set, so any designation in those names is silently dropped. "
             "Review labels that LOOK eligible (e.g. a wine spelled differently).")
    L.append("")
    L.append(f"- Distinct types: {ne['distinct_types']} · Total matched rows: {ne['total_rows']}")
    L.append("")
    if ne["types"]:
        L.append("| Masterfile item_type | Count |")
        L.append("|---|---|")
        for t in ne["types"]:
            L.append(f"| {t['item_type'] or '∅'} | {t['count']} |")
        L.append("")

    sp = rep["score_preview"]
    L.append("## 5. Score Preview")
    L.append("")
    L.append("| Metric | Count |")
    L.append("|---|---|")
    L.append(f"| Masterfile rows with any wine_score | {sp['mf_incoming_rows_with_any_score']} |")
    L.append(f"| Incoming distinct (sku, critic, vintage) | {sp['incoming_distinct_sku_critic_vintage']} |")
    L.append(f"| Bare-value vs HTML-parsed MISMATCH (same critic slot) | {sp['bare_vs_html_mismatch_count']} |")
    L.append(f"| Existing critic_scores rows | {sp['existing_critic_scores']} |")
    L.append(f"| **NEW after dedupe on (sku, critic, vintage)** | {sp['new_after_dedupe']} |")
    L.append("")
    if sp["bare_vs_html_mismatch_sample"]:
        L.append("<details><summary>Bare-vs-HTML mismatch samples</summary>")
        L.append("")
        L.append("| SKU | Critic | Bare value | HTML-parsed |")
        L.append("|---|---|---|---|")
        for s in sp["bare_vs_html_mismatch_sample"]:
            L.append(f"| {s['sku']} | {s['critic']} | {s['bare']} | {s['html']} |")
        L.append("")
        L.append("</details>")
        L.append("")

    dg = rep["designation_gap"]
    L.append("## 6. Designation Gap")
    L.append("")
    L.append(f"DB rows with empty `designation` that `extract_designation(name, item_type)` "
             f"would fill: **{dg['db_empty_fillable_by_name_regex']}**")
    L.append("")
    if dg["samples"]:
        L.append("| SKU | Name | item_type | Designation |")
        L.append("|---|---|---|---|")
        for s in dg["samples"]:
            L.append(f"| {s['sku']} | {s['name']} | {s['item_type']} | {s['designation']} |")
        L.append("")

    L.append("---")
    L.append("_Generated read-only. Next steps are separate, gated, and require sign-off._")
    L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Read-only masterfile gap report")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--csv", default=DEFAULT_CSV)
    args = ap.parse_args()

    rep = build_report(args.db, args.csv)
    out_json = Path(args.out)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(rep, indent=2, ensure_ascii=False))
    out_md = out_json.with_suffix(".md")
    out_md.write_text(render_md(rep, args.db, args.csv))
    print(f"wrote {out_json}")
    print(f"wrote {out_md}")


if __name__ == "__main__":
    main()
