#!/usr/bin/env python3
"""Export human-review candidates from the validity audit to a CSV.

Read-only. Produces one row per flagged product so the data team can triage
(keep / fix / ignore) in a spreadsheet. Two flag types, distinguished by the
`issue` column:

  spirit_wine_attr  — a Whisky/Spirits product carrying wine-only attributes
                      (grape_variety / wine_body / wine_acidity / wine_tannin).
                      Mostly genuine garbage (e.g. tequila with a 'wine_body'),
                      but grape-based spirits (Cognac, some vodka) legitimately
                      have a grape — so it is a REVIEW list, not an auto-wipe.

  country_vs_name   — stored `country` disagrees with the country implied by the
                      product NAME (high-confidence name-inference only). KNOWN
                      false-positive source: cask/finish mentions ("Sherry Wood",
                      "Burgundy Cask") make a Scotch look Spanish/French. The
                      `name_signal` column shows what the inference matched so a
                      human can dismiss cask noise quickly.

Usage:  .venv/bin/python scripts/export_data_review_candidates.py [--db PATH] [--out PATH]
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from data.lib.taxonomy.sku_taxonomy import resolve as _resolve_cat  # noqa: E402
from data.lib.name_inference.rules import infer_from_name as _infer  # noqa: E402

DEFAULT_DB = REPO_ROOT / "data" / "db" / "products.db"
DEFAULT_OUT = REPO_ROOT / "data" / "data_review_candidates.csv"

WINE_ONLY = ["grape_variety", "wine_color", "wine_body", "wine_acidity", "wine_tannin"]


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() == "")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute("SELECT * FROM products")]
    conn.close()

    def group(r):
        g = r.get("category_group")
        return g or _resolve_cat(r).get("group")

    out_rows = []

    # 1) spirit_wine_attr
    for r in rows:
        g = group(r)
        if g not in ("Whisky", "Spirits"):
            continue
        present = {a: r.get(a) for a in WINE_ONLY if not _blank(r.get(a))}
        if not present:
            continue
        out_rows.append({
            "issue": "spirit_wine_attr",
            "sku": r.get("sku"),
            "name": r.get("name"),
            "category_group": g,
            "stored_country": r.get("country"),
            "offending_attrs": "; ".join(f"{k}={v}" for k, v in present.items()),
            "name_signal": "",
            "inferred_country": "",
            "confidence": "",
            "suggested_action": "null wine attrs unless grape-based spirit (Cognac/Ciroc)",
        })

    # 2) country_vs_name (high-confidence inference only)
    for r in rows:
        name = r.get("name") or ""
        cls = r.get("classification") or ""
        inf = _infer(name, cls)
        if inf.get("suppressed") or inf.get("confidence", 0) < 0.8:
            continue
        ic = (inf.get("country") or "").strip()
        rc = (r.get("country") or "").strip()
        if not ic or not rc or ic.lower() == rc.lower():
            continue
        # The matched rule text is the "signal" — lets a human spot cask/finish noise.
        sig = "; ".join(sorted({m["rule"] for m in inf.get("matched_rules", [])}))
        out_rows.append({
            "issue": "country_vs_name",
            "sku": r.get("sku"),
            "name": name,
            "category_group": group(r),
            "stored_country": rc,
            "offending_attrs": "",
            "name_signal": sig,
            "inferred_country": ic,
            "confidence": f"{inf.get('confidence', 0):.2f}",
            "suggested_action": "verify — may be cask/finish false positive",
        })

    fields = ["issue", "sku", "name", "category_group", "stored_country",
              "offending_attrs", "name_signal", "inferred_country",
              "confidence", "suggested_action"]
    with args.out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)

    n_attr = sum(1 for r in out_rows if r["issue"] == "spirit_wine_attr")
    n_ctry = sum(1 for r in out_rows if r["issue"] == "country_vs_name")
    print(f"Wrote {len(out_rows)} candidates → {args.out}")
    print(f"  spirit_wine_attr: {n_attr}")
    print(f"  country_vs_name:  {n_ctry}  (review — includes cask/finish false positives)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
