"""Rule-1 verify-shipped: for the EXACT (sku, field) values written this run
(from the sidecar), assert each is non-empty in live_products_export.json.
Gross DB column totals are NOT verification (they read the DB and can rise from
unrelated rows). This reads the USER-FACING export. Exits nonzero if any miss."""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path

FIELDS = ("variety", "body", "acidity", "tannin", "sweetness")

def verify(export_path, sidecar_path):
    export = {p["sku"]: p for p in json.loads(Path(export_path).read_text())}
    missing = []
    for line in Path(sidecar_path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        rec = json.loads(line)
        sku = rec.get("sku")
        for f in FIELDS:
            v = rec.get(f)
            if not v:                      # sidecar didn't write this field for this sku
                continue
            row = export.get(sku)
            shipped = row and str(row.get(f) or "").strip()
            if not shipped:
                missing.append((sku, f))
    return missing

def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--sidecar", required=True)
    a = ap.parse_args(argv)
    missing = verify(a.export, a.sidecar)
    if missing:
        print(f"RULE-1 FAIL: {len(missing)} (sku,field) written to cache but NOT in export:", file=sys.stderr)
        for sku, f in missing[:50]:
            print(f"  {sku} {f}", file=sys.stderr)
        return 1
    print("RULE-1 OK: every field written this run is populated in live_products_export.json")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
