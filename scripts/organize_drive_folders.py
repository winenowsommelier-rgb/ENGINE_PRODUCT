#!/usr/bin/env python3
"""
A maintenance script to organize and standardize supplier intake folders in Google Drive.

This script traverses the supplier intake folder structure and renames supplier
and month folders to a consistent, sortable format.

Standardization Rules:
1. Supplier Folders: Removes suffixes like "(Update)" and trims whitespace.
   e.g., "  My Supplier (Update)  " -> "My Supplier"
2. Month Folders: Converts various date formats to a standard "YYYY-MM Month" format.
   e.g., "May 2026" -> "2026-05 May"

SAFETY:
- Runs in --dry-run mode by default. Use --execute to perform renames.
- This script requires WRITE permissions for Google Drive.
"""
import os
import json
import sys
import argparse
from pathlib import Path
from datetime import datetime

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
except ImportError:
    print("Missing required libraries. Run: pip install google-api-python-client google-auth")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent

# From docs/superpowers/plans/2026-05-26-supplier-intake-pricing.md
SUPPLIER_DRIVE_ROOT_FOLDER_ID = '1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG'
PRICING_BUCKET_IDS = [
    '1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY', # 1.RSP PRICE
    '132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf', # 2. NO RSP PRICE
    '1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz', # 3.Retail Supplier (Cash on store)
]

def load_supplier_definitions() -> list[dict]:
    """Loads supplier definitions from the JSON database."""
    suppliers_path = REPO_ROOT / "data" / "db" / "suppliers.json"
    if not suppliers_path.exists():
        print("WARNING: data/db/suppliers.json not found. Cannot map codes to names.", file=sys.stderr)
        return []
    with suppliers_path.open("r", encoding="utf-8") as f:
        return json.load(f)


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
    """Initializes the Drive API service with write permissions."""
    env = load_env()
    sa_json_str = env.get("GOOGLE_SERVICE_ACCOUNT_JSON") or os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    
    if not sa_json_str:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_JSON environment variable is missing.", file=sys.stderr)
        sys.exit(1)
        
    try:
        creds_info = json.loads(sa_json_str)
        # WARNING: This requests full drive access, not read-only.
        creds = service_account.Credentials.from_service_account_info(
            creds_info, 
            scopes=['https://www.googleapis.com/auth/drive']
        )
        return build('drive', 'v3', credentials=creds)
    except Exception as e:
        print(f"ERROR: Failed to initialize Google Drive service: {e}", file=sys.stderr)
        sys.exit(1)

def normalize_supplier_folder_name(name: str) -> str:
    """Removes common suffixes and trims whitespace."""
    return name.replace("(Update)", "").strip()

def normalize_month_folder_name(name: str) -> str | None:
    """Parses various month/year formats and returns 'YYYY-MM Month'."""
    now = datetime.now()
    formats_to_try = ["%B %Y", "%b %Y", "%Y %B", "%Y %b", "%m-%Y", "%Y-%m"]
    
    for fmt in formats_to_try:
        try:
            dt = datetime.strptime(name.strip(), fmt)
            return dt.strftime("%Y-%m %B")
        except ValueError:
            continue
    
    # Fallback for month name only (e.g., "May")
    for fmt in ["%B", "%b"]:
        try:
            dt = datetime.strptime(name.strip(), fmt)
            return dt.replace(year=now.year).strftime("%Y-%m %B")
        except ValueError:
            continue
            
    return None

def process_folders(service, root_folder_id: str, dry_run: bool):
    """Main processing loop to scan and rename folders."""
    print(f"Starting scan from root folder: {root_folder_id}")
    print("="*40)

    supplier_defs = load_supplier_definitions()
    supplier_map_by_name: dict[str, list[dict]] = {}
    for s in supplier_defs:
        key = s["name"].strip().lower()
        if key not in supplier_map_by_name:
            supplier_map_by_name[key] = []
        supplier_map_by_name[key].append(s)

    for bucket_id in PRICING_BUCKET_IDS:
        # Process Supplier Folders
        query = f"'{bucket_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        suppliers = service.files().list(q=query, fields="files(id, name)").execute().get('files', [])

        for supplier_folder in suppliers:
            original_name = supplier_folder['name']
            display_name_for_logs = original_name

            clean_folder_name = normalize_supplier_folder_name(original_name).lower()
            definitions = supplier_map_by_name.get(clean_folder_name)

            if definitions and len(definitions) == 1:
                definition = definitions[0]
                new_name = f"{definition['supplier_code']} - {definition['name']}"
                if original_name != new_name:
                    print(f"[RENAME SUPPLIER] '{original_name}' -> '{new_name}'")
                    if not dry_run:
                        service.files().update(fileId=supplier_folder['id'], body={'name': new_name}).execute()
                display_name_for_logs = new_name
            elif definitions and len(definitions) > 1:
                codes = [d.get('supplier_code', 'N/A') for d in definitions]
                print(f"  [AMBIGUITY] Skipping '{original_name}'. It matches multiple supplier codes: {codes}.")
                continue # Skip month processing for ambiguous folders
            else:
                # Fallback to old cleanup logic if no definition is found
                normalized_name = normalize_supplier_folder_name(original_name)
                if original_name != normalized_name:
                    print(f"  [RENAME CLEANUP] '{original_name}' -> '{normalized_name}' (No supplier code mapping found)")
                    if not dry_run:
                        service.files().update(fileId=supplier_folder['id'], body={'name': normalized_name}).execute()
                    display_name_for_logs = normalized_name

            # Process Month Folders within each supplier
            month_query = f"'{supplier_folder['id']}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            months = service.files().list(q=month_query, fields="files(id, name)").execute().get('files', [])

            for month in months:
                original_month = month['name']
                normalized_month = normalize_month_folder_name(original_month)

                if normalized_month and original_month != normalized_month:
                    print(f"  [RENAME MONTH] '{original_month}' -> '{normalized_month}' (in {display_name_for_logs})")
                    if not dry_run:
                        service.files().update(fileId=month['id'], body={'name': normalized_month}).execute()
                elif not normalized_month:
                    print(f"  [SKIP MONTH] Could not parse month folder name: '{original_month}' (in {display_name_for_logs})")

def main():
    parser = argparse.ArgumentParser(
        description="Organize Google Drive folders for supplier intake.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "--root-folder-id",
        default=SUPPLIER_DRIVE_ROOT_FOLDER_ID,
        help="The root Google Drive Folder ID for supplier intake."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform the rename operations. Default is a dry run."
    )
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        print("--- Running in DRY-RUN mode. No changes will be made. ---")
        print("--- Use --execute to perform renames. ---")
    else:
        print("--- Running in EXECUTE mode. Changes WILL be made to Google Drive. ---")
        if input("Are you sure you want to continue? (y/n): ").lower() != 'y':
            print("Aborted.")
            sys.exit(0)

    service = get_drive_service()
    process_folders(service, args.root_folder_id, dry_run)
    print("\nDone.")

if __name__ == '__main__':
    main()