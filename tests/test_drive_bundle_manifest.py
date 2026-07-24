import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.lib.drive_bundle.manifest import (
    sha256_file, build_manifest, load_last_manifest, should_upload,
)


def test_sha256_changes_with_content(tmp_path):
    p = tmp_path / 'f.txt'
    p.write_text('a')
    h1 = sha256_file(str(p))
    p.write_text('b')
    h2 = sha256_file(str(p))
    assert h1 != h2 and len(h1) == 64


def test_first_run_uploads_everything():
    assert should_upload('catalog/products_whisky.json', 'newhash', prior=None) is True


def test_unchanged_hash_skips_static_tier():
    prior = {'files': [{'path': 'catalog/x.json', 'sha256': 'abc'}]}
    assert should_upload('catalog/x.json', 'abc', prior=prior) is False
    assert should_upload('catalog/x.json', 'def', prior=prior) is True


def test_live_and_manifest_always_upload():
    prior = {'files': [{'path': 'live/inventory_live.csv', 'sha256': 'abc'}]}
    assert should_upload('live/inventory_live.csv', 'abc', prior=prior) is True
    assert should_upload('MANIFEST.json', 'abc', prior=prior) is True


def test_readme_is_hash_gated_not_always():
    prior = {'files': [{'path': 'README.md', 'sha256': 'abc'}]}
    assert should_upload('README.md', 'abc', prior=prior) is False
    assert should_upload('README.md', 'zzz', prior=prior) is True


def test_build_manifest_enumerates_disk(tmp_path):
    (tmp_path / 'live').mkdir()
    f = tmp_path / 'live' / 'inventory_live.csv'
    f.write_text('sku\nA\n')
    manifest = build_manifest(
        root=str(tmp_path),
        files=[('live/inventory_live.csv', 'live', 1)],
        total_in_stock=6206, total_all=11934, generated_at='2026-07-24T03:00:00+07:00',
        prior=None,
    )
    entry = manifest['files'][0]
    assert entry['path'] == 'live/inventory_live.csv'
    assert entry['rows'] == 1
    assert entry['tier'] == 'live'
    assert len(entry['sha256']) == 64
    assert entry['bytes'] == f.stat().st_size
    assert manifest['total_skus_in_stock'] == 6206
    assert 'source_registry.csv' in manifest['reserved_future']
