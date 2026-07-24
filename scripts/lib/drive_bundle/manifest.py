"""Manifest construction, content hashing, and hash-gating for the bundle.

The local .last_manifest.json is the SINGLE source of truth for change
detection (never the Drive copy — spec sec 6). live/ files and MANIFEST.json
always upload; catalog/slim/notebooklm + README gate on sha256. Absent prior
manifest (first run / deleted cache) => every file counts as changed (full
upload).
"""
from __future__ import annotations

import hashlib
import json
import os

ALWAYS_UPLOAD_PREFIXES = ('live/',)
ALWAYS_UPLOAD_EXACT = ('MANIFEST.json',)


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def _prior_hash(path: str, prior: dict | None) -> str | None:
    if not prior:
        return None
    for e in prior.get('files', []):
        if e.get('path') == path:
            return e.get('sha256')
    return None


def should_upload(path: str, new_hash: str, prior: dict | None) -> bool:
    """True if this file must be (re)uploaded this run."""
    if path in ALWAYS_UPLOAD_EXACT:
        return True
    if any(path.startswith(p) for p in ALWAYS_UPLOAD_PREFIXES):
        return True
    return _prior_hash(path, prior) != new_hash


def _prior_updated_at(path: str, prior: dict | None) -> str | None:
    if not prior:
        return None
    for e in prior.get('files', []):
        if e.get('path') == path:
            return e.get('updated_at')
    return None


def build_manifest(root: str, files: list[tuple[str, str, int]],
                   total_in_stock: int, total_all: int,
                   generated_at: str, prior: dict | None) -> dict:
    """Build the MANIFEST.json dict.

    files: list of (relative_path, tier, row_count). Each file must exist on
    disk under `root`. bytes + sha256 are read from disk (spec sec 11: manifest
    is enumerated from files actually on disk). updated_at carries forward from
    prior when the hash is unchanged, else = generated_at.
    """
    entries = []
    catalog_hashes = []
    for rel, tier, rows in sorted(files):
        abspath = os.path.join(root, rel)
        h = sha256_file(abspath)
        changed = should_upload(rel, h, prior)
        updated_at = generated_at if changed else (_prior_updated_at(rel, prior) or generated_at)
        entries.append({
            'path': rel, 'purpose': _purpose(rel), 'tier': tier,
            'rows': rows, 'bytes': os.path.getsize(abspath),
            'sha256': h, 'updated_at': updated_at,
        })
        if tier == 'catalog':
            catalog_hashes.append(h)

    catalog_version = hashlib.sha256(''.join(sorted(catalog_hashes)).encode()).hexdigest()
    return {
        'generated_at': generated_at,
        'catalog_version': catalog_version,
        'total_skus_in_stock': total_in_stock,
        'total_skus_all': total_all,
        'freshness': {'live': 'daily', 'catalog': 'on-change',
                      'slim': 'on-change', 'notebooklm': 'on-change'},
        'files': entries,
        'reserved_future': ['source_registry.csv'],
        'usage_notes': ('Read live/ for availability & price. Read catalog/ for '
                        'tasting notes & pairing. Never recommend a SKU absent '
                        'from live/inventory_live.csv.'),
    }


def _purpose(rel: str) -> str:
    name = os.path.basename(rel)
    if name == 'inventory_live.csv':
        return 'Current stock status per in-stock SKU'
    if name == 'pricing_promotions_live.csv':
        return 'Current price & promo per in-stock SKU'
    if name == 'products_all_archive.jsonl':
        return 'Thin reference record for ALL SKUs (in-stock or not)'
    if name.startswith('products_'):
        return 'Full product detail for a category'
    if name == 'product_index_compact.tsv':
        return 'Compact SKU index — search first'
    if name.startswith('system_prompt'):
        return 'AI persona / usage instructions'
    return name


def load_last_manifest(path: str) -> dict | None:
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None  # treat a corrupt cache as first-run


def save_last_manifest(path: str, manifest: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
