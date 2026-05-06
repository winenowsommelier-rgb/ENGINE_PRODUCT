"""
Clean up region/subregion data:
  1. Remove "Right Bank" from Bordeaux subregions (not a real AOC) and reassign 3 products.
  2. Reassign products with region=Highland, subregion=Speyside  -> region=Speyside, subregion=blank.
  3. Clear subregion on products where subregion equals region (redundant placeholder).
  4. Delete the corresponding placeholder entries from data/taxonomy/subregions.json.

Backups are written to data/db/backups/ and data/taxonomy/ before mutation.
A changelog entry is appended to data/db/product-changelog.json for every product touched.
"""

import json
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_PATH = ROOT / "data" / "db" / "products.json"
CHANGELOG_PATH = ROOT / "data" / "db" / "product-changelog.json"
SUBREGIONS_PATH = ROOT / "data" / "taxonomy" / "subregions.json"
BACKUPS_DIR = ROOT / "data" / "db" / "backups"
TAXONOMY_BACKUPS_DIR = ROOT / "data" / "taxonomy" / "backups"

TAG = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
SOURCE = "fix_subregion_taxonomy"


def backup(src: Path, dst_dir: Path, suffix: str) -> Path:
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{src.stem}_{TAG}_{suffix}{src.suffix}"
    shutil.copy2(src, dst)
    return dst


def load_json(path: Path):
    with open(path) as f:
        return json.load(f)


def save_json(path: Path, data) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main() -> None:
    products = load_json(PRODUCTS_PATH)
    changelog = load_json(CHANGELOG_PATH)
    subregions_doc = load_json(SUBREGIONS_PATH)
    subregions = subregions_doc["data"]

    backup(PRODUCTS_PATH, BACKUPS_DIR, "pre_subregion_cleanup")
    backup(SUBREGIONS_PATH, TAXONOMY_BACKUPS_DIR, "pre_subregion_cleanup")

    # ---- Step 1: Right Bank reassignments ----
    right_bank_fixes = {
        # SKU -> (new_subregion, reason)
        "WRW1985AH": ("Saint-Émilion",
                      "name contains Saint-Emilion; Right Bank is not an AOC"),
        "WRW5154DW": ("Castillon Côtes de Bordeaux",
                      "name says Castillon Cotes de Bordeaux; Right Bank is not an AOC"),
        "WBS0278WN": ("",
                      "multi-AOC mixed pack; Right Bank is not an AOC"),
    }

    # ---- Step 2: Highland/Speyside reassignment ----
    # Products with region=Highland, subregion=Speyside -> region=Speyside, subregion=cleared
    # ---- Step 3: redundant region==subregion -> clear subregion ----

    new_changelog_entries = []
    counts = {"right_bank": 0, "highland_speyside": 0, "redundant": 0}

    for p in products:
        sku = p.get("sku")
        rg = (p.get("region") or "").strip()
        sr = (p.get("subregion") or "").strip()

        # Right Bank explicit overrides
        if sku in right_bank_fixes and sr.lower() == "right bank":
            new_sr, reason = right_bank_fixes[sku]
            old_sr = p.get("subregion")
            p["subregion"] = new_sr if new_sr else None
            new_changelog_entries.append({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "source": SOURCE,
                "sku": sku,
                "field": "subregion",
                "old_value": old_sr,
                "new_value": new_sr if new_sr else None,
                "note": reason,
            })
            counts["right_bank"] += 1
            continue

        # Highland with subregion Speyside -> change region to Speyside, clear subregion
        if rg.lower() == "highland" and sr.lower() == "speyside":
            old_rg = p.get("region")
            old_sr = p.get("subregion")
            p["region"] = "Speyside"
            p["subregion"] = None
            new_changelog_entries.append({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "source": SOURCE,
                "sku": sku,
                "field": "region",
                "old_value": old_rg,
                "new_value": "Speyside",
                "note": "Speyside is its own region, not a Highland subregion",
            })
            new_changelog_entries.append({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "source": SOURCE,
                "sku": sku,
                "field": "subregion",
                "old_value": old_sr,
                "new_value": None,
                "note": "cleared after region promotion to Speyside",
            })
            counts["highland_speyside"] += 1
            continue

        # Redundant: subregion equals region -> clear subregion
        if rg and sr and rg.lower() == sr.lower():
            old_sr = p.get("subregion")
            p["subregion"] = None
            new_changelog_entries.append({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "source": SOURCE,
                "sku": sku,
                "field": "subregion",
                "old_value": old_sr,
                "new_value": None,
                "note": f"redundant subregion equal to region {rg!r}",
            })
            counts["redundant"] += 1

    # ---- Step 4: prune taxonomy ----
    # Build region name lookup
    regions_doc = load_json(ROOT / "data" / "taxonomy" / "regions.json")
    region_by_id = {r["id"]: r["name"] for r in regions_doc["data"]}

    drop_ids = set()
    for s in subregions:
        rg = region_by_id.get(s["region_id"], "")
        nm = s["name"]
        # drop "Right Bank" under Bordeaux
        if nm.lower() == "right bank" and rg.lower() == "bordeaux":
            drop_ids.add(s["id"])
        # drop "Speyside" sub under Highland (duplicate of Speyside region)
        if nm.lower() == "speyside" and rg.lower() == "highland":
            drop_ids.add(s["id"])
        # drop redundant subregion == region
        if nm.lower() == rg.lower():
            drop_ids.add(s["id"])

    pruned = [s for s in subregions if s["id"] not in drop_ids]
    print(f"Subregion taxonomy: dropping {len(drop_ids)} entries -> {len(pruned)} remaining")
    subregions_doc["data"] = pruned
    save_json(SUBREGIONS_PATH, subregions_doc)

    # ---- Step 5: write products + changelog ----
    save_json(PRODUCTS_PATH, products)
    changelog.extend(new_changelog_entries)
    save_json(CHANGELOG_PATH, changelog)

    print("Product mutations:")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print(f"Changelog entries appended: {len(new_changelog_entries)}")
    print(f"Backups tagged: {TAG}")


if __name__ == "__main__":
    main()
