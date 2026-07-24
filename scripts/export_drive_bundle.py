#!/usr/bin/env python3
"""Drive Export v2 orchestrator. See docs/superpowers/specs/2026-07-23-drive-export-v2-design.md."""
from __future__ import annotations
import argparse, json, os, shutil, sys, time
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from scripts.lib.drive_bundle.instock import filter_in_stock
from scripts.lib.drive_bundle.live_csv import write_live_csvs
from scripts.lib.drive_bundle.archive import write_archive_jsonl
from scripts.lib.drive_bundle import manifest as M
from scripts.lib.drive_bundle.readme import render_readme
from scripts import export_ai_knowledge_base as kb
from scripts import export_ai_knowledge_base_slim as kbslim
from scripts import sync_ai_knowledge_base_to_drive as drive

SRC = os.path.join(ROOT, 'data', 'live_products_export.json')
WORK = os.path.join(ROOT, 'docs', 'drive-bundle')
LAST_MANIFEST = os.path.expanduser('~/.config/wnlq9/.last_manifest.json')
LOCKFILE = os.path.expanduser('~/.config/wnlq9/drive_bundle.lock')
STATIC_PROMPT_MD = os.path.join(ROOT, 'docs', 'ai-knowledge-base', 'system_prompt.md')
PARENT_FOLDER_ID = '1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK'
BKK = timezone(timedelta(hours=7))


def now_iso():
    return datetime.now(BKK).replace(microsecond=0).isoformat()


def acquire_lock():
    os.makedirs(os.path.dirname(LOCKFILE), exist_ok=True)
    try:
        fd = os.open(LOCKFILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode()); os.close(fd)
        return True
    except FileExistsError:
        print(f"ERROR: lock held ({LOCKFILE}); another run in progress.")
        return False


def release_lock():
    try:
        os.remove(LOCKFILE)
    except OSError:
        pass


def count_rows(rel_path, abspath):
    """Row count for a bundle file, by extension/name convention."""
    name = os.path.basename(rel_path)
    if name.endswith('.csv'):
        with open(abspath, 'r', encoding='utf-8') as f:
            n = sum(1 for _ in f)
        return max(n - 1, 0)
    if name.endswith('.jsonl'):
        with open(abspath, 'r', encoding='utf-8') as f:
            return sum(1 for _ in f)
    if name.startswith('products_') and name.endswith('.json'):
        with open(abspath, 'r', encoding='utf-8') as f:
            return len(json.load(f)['products'])
    if name.endswith('.tsv'):
        with open(abspath, 'r', encoding='utf-8') as f:
            n = sum(1 for _ in f)
        return max(n - 1, 0)
    return 0


def _tier_for(rel_path):
    parts = rel_path.split(os.sep)
    if len(parts) == 1:
        return 'root'
    return parts[0]


def build_bundle(all_items):
    """Local build: generate all bundle artifacts + MANIFEST + README.

    Returns (manifest, work_dir, instock, prior). No network. Reads nothing
    from Drive. `instock` and `prior` are returned so the caller can reuse the
    exact same snapshots for push verification and manifest persistence.
    """
    instock = filter_in_stock(all_items)

    # Rebuild WORK from scratch so stale artifacts never leak into the bundle.
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    live_dir = os.path.join(WORK, 'live')
    catalog_dir = os.path.join(WORK, 'catalog')
    slim_dir = os.path.join(WORK, 'slim')
    nlm_dir = os.path.join(WORK, 'notebooklm')
    for d in (WORK, live_dir, catalog_dir, slim_dir, nlm_dir):
        os.makedirs(d, exist_ok=True)

    # Generate content. Live + catalog/slim/notebooklm use IN-STOCK only.
    write_live_csvs(instock, live_dir)
    kb.generate(instock, catalog_dir)
    kbslim.generate_slim(instock, slim_dir)
    kbslim.generate_notebooklm(instock, nlm_dir)
    # Thin archive covers ALL items (in-stock + out-of-stock).
    write_archive_jsonl(all_items, catalog_dir)

    # Shared artifacts.
    compact_tsv = os.path.join(catalog_dir, 'product_index_compact.tsv')
    shutil.copy2(compact_tsv, os.path.join(slim_dir, 'product_index_compact.tsv'))
    shutil.copy2(compact_tsv, os.path.join(nlm_dir, 'product_index_compact.tsv'))
    shutil.copy2(STATIC_PROMPT_MD, os.path.join(slim_dir, 'system_prompt.md'))
    # Same content, .txt name for NotebookLM ingestion.
    shutil.copy2(STATIC_PROMPT_MD, os.path.join(nlm_dir, 'system_prompt.txt'))

    # README at WORK root (2-arg render_readme: no timestamp).
    with open(os.path.join(WORK, 'README.md'), 'w', encoding='utf-8') as f:
        f.write(render_readme(len(instock), len(all_items)))

    # Enumerate files from disk. Exclude MANIFEST.json (written after).
    files = []
    for dirpath, _dirnames, filenames in os.walk(WORK):
        for fn in filenames:
            abspath = os.path.join(dirpath, fn)
            rel = os.path.relpath(abspath, WORK)
            if rel == 'MANIFEST.json':
                continue
            tier = _tier_for(rel)
            files.append((rel, tier, count_rows(rel, abspath)))

    prior = M.load_last_manifest(LAST_MANIFEST)
    manifest = M.build_manifest(WORK, files, len(instock), len(all_items),
                                now_iso(), prior)
    with open(os.path.join(WORK, 'MANIFEST.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    return manifest, WORK, instock, prior


def row_count_sanity(instock, prior):
    """Loud WARN (do not abort) if in-stock count dropped >20% vs prior."""
    if not prior or 'total_skus_in_stock' not in prior:
        return
    prev = prior['total_skus_in_stock']
    if prev <= 0:
        return
    now = len(instock)
    drop = (prev - now) / prev
    if drop > 0.20:
        print("=" * 60)
        print(f"WARN: in-stock SKU count dropped {drop*100:.1f}% "
              f"({prev} -> {now}). Possible upstream data loss.")
        print("      Not aborting, but INSPECT before trusting this bundle.")
        print("=" * 60)


# Tier -> Drive subfolder name. 'root' maps to PARENT_FOLDER_ID (no subfolder).
SUBFOLDER_TIERS = ('live', 'catalog', 'slim', 'notebooklm')


def ensure_folders(service):
    """Create/find the 4 subfolders once. Returns {tier: folder_id} incl 'root'."""
    folder_ids = {'root': PARENT_FOLDER_ID}
    for name in SUBFOLDER_TIERS:
        folder_ids[name] = drive.get_or_create_subfolder(
            service, PARENT_FOLDER_ID, name)
    return folder_ids


def push_bundle(service, manifest, work_dir, prior, folder_ids):
    """Hash-gated upload of every bundle file to its tier folder.

    MANIFEST.json (not in manifest['files']) is added explicitly as tier 'root'
    and always uploads (ALWAYS_UPLOAD_EXACT). live/* also always upload. Static
    catalog/slim/notebooklm files upload only when their sha256 changed vs the
    local prior manifest. Returns {'uploaded': n, 'skipped': n}.
    """
    # (rel_path, tier) for every file, including MANIFEST.json.
    items = [(e['path'], e['tier']) for e in manifest['files']]
    items.append(('MANIFEST.json', 'root'))

    existing_cache = {}   # folder_id -> {filename: file_id}
    counts = {'uploaded': 0, 'skipped': 0}

    for rel, tier in items:
        folder_id = folder_ids[tier]
        abspath = os.path.join(work_dir, rel)
        new_hash = M.sha256_file(abspath)
        if not M.should_upload(rel, new_hash, prior):
            print(f"skip    {rel}")
            counts['skipped'] += 1
            continue
        if folder_id not in existing_cache:
            existing_cache[folder_id] = drive.list_drive_files(service, folder_id)
        existing = existing_cache[folder_id]
        rows = _rows_for(manifest, rel)
        nbytes = os.path.getsize(abspath)
        print(f"UPLOAD  {rel}  {rows} rows  {nbytes} bytes")
        drive.upload_file(service, abspath, folder_id, existing)
        counts['uploaded'] += 1

    return counts


def _rows_for(manifest, rel):
    for e in manifest['files']:
        if e['path'] == rel:
            return e.get('rows', 0)
    return 0   # MANIFEST.json itself has no row count


def verify_push(service, manifest, expected_in_stock):
    """Re-fetch MANIFEST.json from Drive and assert it matches (Rule 1/6).

    Up to 3 attempts with short linear backoff. Returns True on match.
    """
    root_files = drive.list_drive_files(service, PARENT_FOLDER_ID)
    mid = root_files.get('MANIFEST.json')
    if not mid:
        print("VERIFY: FAIL — MANIFEST.json not found in Drive root after push")
        return False

    expected_files = len(manifest['files'])
    for attempt in range(1, 4):
        try:
            raw = drive.download_file(service, mid)
            parsed = json.loads(raw)
            got_instock = parsed.get('total_skus_in_stock')
            got_files = len(parsed.get('files', []))
            if got_instock == expected_in_stock and got_files == expected_files:
                print(f"VERIFY: PASS (in-stock={got_instock}, files={got_files})")
                return True
            print(f"VERIFY: attempt {attempt} mismatch "
                  f"(in-stock {got_instock} vs {expected_in_stock}, "
                  f"files {got_files} vs {expected_files})")
        except Exception as exc:  # noqa: BLE001 — retryable network/parse errors
            print(f"VERIFY: attempt {attempt} error: {exc}")
        if attempt < 3:
            time.sleep(2 * attempt)

    print(f"VERIFY: FAIL — re-fetched MANIFEST did not match after 3 attempts "
          f"(expected in-stock={expected_in_stock}, files={expected_files})")
    return False


def prune_all(service, manifest, folder_ids, do_prune):
    """Trash Drive files no longer in the manifest, per tier. Returns stale names."""
    keep = {tier: set() for tier in folder_ids}
    for e in manifest['files']:
        keep[e['tier']].add(os.path.basename(e['path']))
    # Root always keeps MANIFEST.json + README.md.
    keep['root'].update({'MANIFEST.json', 'README.md'})

    all_stale = []
    for tier, folder_id in folder_ids.items():
        stale = drive.prune_folder(service, folder_id, keep[tier],
                                   label=tier, do_prune=do_prune)
        all_stale.extend(stale)
    return all_stale


def main():
    ap = argparse.ArgumentParser(description="Drive Export v2 orchestrator")
    ap.add_argument('--dry-run', action='store_true',
                    help="Build bundle locally + print summary; no Drive upload.")
    ap.add_argument('--prune', action='store_true',
                    help="Trash Drive files no longer in the manifest "
                         "(default is report-only STALE lines).")
    args = ap.parse_args()

    if not acquire_lock():
        sys.exit(1)
    try:
        with open(SRC, 'r', encoding='utf-8') as f:
            data = json.load(f)
        all_items = data if isinstance(data, list) else data.get('products', data.get('items', []))

        instock = filter_in_stock(all_items)
        prior = M.load_last_manifest(LAST_MANIFEST)
        row_count_sanity(instock, prior)

        manifest, work, instock, prior = build_bundle(all_items)

        # Summary.
        tiers = {}
        for e in manifest['files']:
            tiers[e['tier']] = tiers.get(e['tier'], 0) + 1
        print("-" * 60)
        print("Drive bundle built:", work)
        print(f"  total_skus_in_stock : {manifest['total_skus_in_stock']}")
        print(f"  total_skus_all      : {manifest['total_skus_all']}")
        print(f"  files               : {len(manifest['files'])}")
        for tier in sorted(tiers):
            print(f"    {tier:<12} : {tiers[tier]} files")
        print("-" * 60)

        if args.dry_run:
            print("DRY RUN — no Drive upload")
            return 0

        # --- Real Drive push (only reached when NOT --dry-run). ---
        service = drive.get_drive_service()
        folder_ids = ensure_folders(service)

        counts = push_bundle(service, manifest, work, prior, folder_ids)
        print("-" * 60)
        print(f"Pushed: {counts['uploaded']} uploaded, {counts['skipped']} skipped")

        ok = verify_push(service, manifest, len(instock))
        if not ok:
            # Do NOT save_last_manifest — next run must re-detect all changes.
            print("ABORT: re-fetch verification failed; NOT saving manifest.")
            return 1   # finally: release_lock() runs

        # Persist the manifest the moment the push is verified — BEFORE prune.
        # The cache reflects "what we successfully pushed and verified"; that is
        # true now, independent of prune. If prune_all raises, the lock still
        # releases (finally) and the cache is already saved, so the next run
        # won't wastefully re-upload all files.
        M.save_last_manifest(LAST_MANIFEST, manifest)

        stale = prune_all(service, manifest, folder_ids, do_prune=args.prune)

        print("=" * 60)
        print("Drive push complete + verified.")
        print(f"  uploaded : {counts['uploaded']}")
        print(f"  skipped  : {counts['skipped']}")
        print(f"  stale    : {len(stale)} "
              f"({'trashed' if args.prune else 'report-only'})")
        print(f"  in-stock : {len(instock)}")
        print(f"  files    : {len(manifest['files'])}")
        print(f"  Drive folder: "
              f"https://drive.google.com/drive/folders/{PARENT_FOLDER_ID}")
        print("=" * 60)
        return 0
    finally:
        release_lock()


if __name__ == '__main__':
    sys.exit(main() or 0)
