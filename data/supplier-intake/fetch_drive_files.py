#!/usr/bin/env python3
"""
Fetch supplier source files from the structured Google Drive folders.
Implements step 1 of the Supplier Intake Contract:
Drive source file -> preserved evidence
"""
import os
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
except ImportError:
    print("Missing required libraries. Run: pip install google-api-python-client google-auth")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVIDENCE_DIR = REPO_ROOT / "data" / "supplier-intake" / "evidence"

# From docs/superpowers/plans/2026-05-26-supplier-intake-pricing.md
SUPPLIER_DRIVE_ROOT_FOLDER_ID = '1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG'
PRICING_BUCKETS = {
    # bucket_id: {name, structure}
    '1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY': {'name': '1.RSP PRICE', 'structure': 'rsp_price'},
    '132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf': {'name': '2. NO RSP PRICE', 'structure': 'no_rsp_price'},
    '1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz': {'name': '3.Retail Supplier (Cash on store)', 'structure': 'retail_cash_store'},
}


def load_env() -> dict:
    env_path = REPO_ROOT / ".env.local"
    env_vars = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env_vars[k.strip()] = v.strip().strip("'").strip('"')
    return env_vars

def get_drive_service():
    env = load_env()
    sa_json_str = env.get("GOOGLE_SERVICE_ACCOUNT_JSON") or os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    
    if not sa_json_str:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing.")
        sys.exit(1)
        
    try:
        creds_info = json.loads(sa_json_str)
        creds = service_account.Credentials.from_service_account_info(
            creds_info, 
            scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        return build('drive', 'v3', credentials=creds)
    except Exception as e:
        print(f"ERROR: Failed to initialize Google Drive service: {e}")
        sys.exit(1)

def _download_file(service, file_item: dict, supplier_name: str, pricing_structure: str):
    """Downloads a single file and its metadata."""
    file_id = file_item['id']
    file_name = file_item['name']
    mime_type = file_item['mimeType']

    # Sanitize supplier name for use in filename
    sanitized_supplier = supplier_name.replace(' ', '_').lower()
    
    # Prepend supplier and timestamp to avoid name collisions
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    local_filename = f"{timestamp}_{sanitized_supplier}_{file_name}"
    file_path = EVIDENCE_DIR / local_filename

    if mime_type == 'application/vnd.google-apps.folder':
        return # Skip folders

    if mime_type == 'application/vnd.google-apps.spreadsheet':
        request = service.files().export_media(fileId=file_id, mimeType='text/csv')
        file_path = file_path.with_suffix('.csv')
    else:
        request = service.files().get_media(fileId=file_id)

    if file_path.exists():
        print(f"    [Skip] {file_name} (Already exists as {file_path.name})")
        return

    print(f"    [Download] {file_name} ({file_id})")
    try:
        with open(file_path, 'wb') as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
        
        # Save metadata for the audit requirements
        meta_path = file_path.with_suffix(f"{file_path.suffix}.meta.json")
        meta_path.write_text(json.dumps({
            "source_file_id": file_id,
            "source_file_name": file_name,
            "supplier_name": supplier_name,
            "pricing_structure": pricing_structure,
            "intake_batch_id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        }, indent=2))
    except Exception as e:
        print(f"      [Error] Failed to download {file_name}: {e}")
        if file_path.exists():
            file_path.unlink() # Clean up partial download


def sync_from_drive(scan_latest_month_only: bool, supplier_filter: list[str] | None):
    """
    Traverses the structured Google Drive folders, finds new supplier files,
    and downloads them as evidence.
    """
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    service = get_drive_service()
    print(f"Starting sync from Google Drive root: {SUPPLIER_DRIVE_ROOT_FOLDER_ID}")
    print(f"Saving evidence to: {EVIDENCE_DIR.relative_to(REPO_ROOT)}")
    print("-" * 50)

    for bucket_id, bucket_info in PRICING_BUCKETS.items():
        print(f"\nScanning Pricing Bucket: {bucket_info['name']}...")
        # 1. List supplier folders in the bucket
        query = f"'{bucket_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        suppliers = service.files().list(q=query, fields="files(id, name)").execute().get('files', [])

        for supplier_folder in suppliers:
            supplier_name = supplier_folder['name'].replace("(Update)", "").strip()
            if supplier_filter and not any(f.lower() in supplier_name.lower() for f in supplier_filter):
                continue

            print(f"  -> Supplier: {supplier_name}")

            # 2. List month folders for the supplier
            month_query = f"'{supplier_folder['id']}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            months = service.files().list(q=month_query, fields="files(id, name)", orderBy="name desc").execute().get('files', [])
            
            if not months:
                print("    (No month folders found)")
                continue

            folders_to_scan = months
            if scan_latest_month_only:
                folders_to_scan = [months[0]] # Already sorted by name desc
                print(f"    (Scanning latest month only: {folders_to_scan[0]['name']})")

            for month_folder in folders_to_scan:
                if not scan_latest_month_only:
                    print(f"    -> Month: {month_folder['name']}")

                # 3. List and download files from the month folder
                file_query = f"'{month_folder['id']}' in parents and trashed = false"
                files = service.files().list(q=file_query, fields="files(id, name, mimeType)").execute().get('files', [])

                if not files:
                    print("      (No files found in this month folder)")
                    continue

                for file_item in files:
                    _download_file(service, file_item, supplier_name, bucket_info['structure'])

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Sync new supplier files from the structured Google Drive folders.")
    parser.add_argument(
        "--scan-latest-month-only",
        action="store_true",
        help="Only scan the most recent month folder for each supplier."
    )
    parser.add_argument(
        "--supplier",
        action="append",
        help="Filter to run only for specific supplier(s) by name. Can be used multiple times."
    )
    args = parser.parse_args()
    
    sync_from_drive(args.scan_latest_month_only, args.supplier)
    print("\nSync complete.")