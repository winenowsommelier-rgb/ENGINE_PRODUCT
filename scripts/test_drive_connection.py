#!/usr/bin/env python3
"""
A simple diagnostic script to test the connection to Google Drive.

This script attempts to:
1. Load the Google Service Account credentials from .env.local.
2. Authenticate with the Google Drive API.
3. List the top-level folders inside the main supplier intake directory.

If this script succeeds, the core connection is working.
If it fails, the error message will point to the specific problem.
"""
import os
import json
import sys
from pathlib import Path

try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    print("ERROR: Missing required libraries. Run: pip install google-api-python-client google-auth")
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
SUPPLIER_DRIVE_ROOT_FOLDER_ID = '1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG'

def load_env() -> dict:
    env_path = REPO_ROOT / ".env.local"
    if not env_path.exists():
        print("❌ FAILURE: The .env.local file is missing.")
        sys.exit(1)
    
    env_vars = {}
    for line in env_path.read_text().splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            env_vars[k.strip()] = v.strip().strip("'").strip('"')
    return env_vars

def main():
    print("--- Running Google Drive Connection Test ---")
    
    # 1. Check for credentials
    env = load_env()
    sa_json_str = env.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_json_str:
        print("❌ FAILURE: GOOGLE_SERVICE_ACCOUNT_JSON is not set in your .env.local file.")
        sys.exit(1)
    print("✅ Credentials found in .env.local.")

    # 2. Attempt to authenticate and build service
    try:
        creds_info = json.loads(sa_json_str)
        creds = service_account.Credentials.from_service_account_info(
            creds_info, scopes=['https://www.googleapis.com/auth/drive.readonly']
        )
        service = build('drive', 'v3', credentials=creds)
        print("✅ Google API authentication successful.")
    except Exception as e:
        print(f"❌ FAILURE: Could not authenticate with Google. Error: {e}")
        sys.exit(1)

    # 3. Attempt to list folders
    try:
        query = f"'{SUPPLIER_DRIVE_ROOT_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        items = results.get('files', [])
        print(f"✅ Successfully connected to Drive folder ID '{SUPPLIER_DRIVE_ROOT_FOLDER_ID}'.")
        print(f"Found {len(items)} folders:")
        for item in items:
            print(f"  - {item['name']} ({item['id']})")
        print("\n🎉 SUCCESS! The connection to Google Drive is working correctly.")
    except HttpError as e:
        print(f"❌ FAILURE: An error occurred while accessing the Google Drive folder. Error: {e}")
        print("\nSuggestion: Double-check that the folder has been shared with the service account email.")

if __name__ == '__main__':
    main()