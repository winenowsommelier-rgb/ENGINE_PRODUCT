#!/usr/bin/env python3
"""
Full pipeline: regenerate knowledge base files from live_products_export.json,
then upload/overwrite every file in the Google Drive ai-knowledge-base folder.

Usage:
    python3 scripts/sync_ai_knowledge_base_to_drive.py

Requirements:
    pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client

Credentials:
    Place your OAuth2 credentials JSON at ~/.config/wnlq9/gdrive_credentials.json
    (download from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client)
    On first run you will be prompted to authorise in a browser.
    The token is cached at ~/.config/wnlq9/gdrive_token.json for future runs.
"""

import os
import sys
import json
import subprocess

ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_DIR     = os.path.join(ROOT, 'docs', 'ai-knowledge-base')
EXPORT_SCR = os.path.join(ROOT, 'scripts', 'export_ai_knowledge_base.py')
FOLDER_ID  = '1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK'

CREDS_PATH = os.path.expanduser('~/.config/wnlq9/gdrive_credentials.json')
TOKEN_PATH = os.path.expanduser('~/.config/wnlq9/gdrive_token.json')

SCOPES = ['https://www.googleapis.com/auth/drive']

MIME_MAP = {
    '.md':   'text/plain',
    '.json': 'application/json',
    '.tsv':  'text/tab-separated-values',
}


def get_drive_service():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_PATH):
                print(f"ERROR: credentials file not found at {CREDS_PATH}")
                print("Download OAuth2 credentials from Google Cloud Console and save there.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        os.makedirs(os.path.dirname(TOKEN_PATH), exist_ok=True)
        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())

    return build('drive', 'v3', credentials=creds)


def list_drive_files(service, folder_id):
    """Return dict of {filename: file_id} for all files in folder."""
    existing = {}
    page_token = None
    while True:
        resp = service.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields='nextPageToken, files(id, name)',
            pageToken=page_token,
        ).execute()
        for f in resp.get('files', []):
            existing[f['name']] = f['id']
        page_token = resp.get('nextPageToken')
        if not page_token:
            break
    return existing


def upload_file(service, local_path, folder_id, existing, dry_run=False):
    from googleapiclient.http import MediaFileUpload

    filename  = os.path.basename(local_path)
    ext       = os.path.splitext(filename)[1].lower()
    mime_type = MIME_MAP.get(ext, 'text/plain')
    size_kb   = os.path.getsize(local_path) // 1024

    if filename in existing:
        action = 'UPDATE'
        file_id = existing[filename]
    else:
        action = 'CREATE'
        file_id = None

    if dry_run:
        print(f"  [DRY RUN] {action:6s}  {filename:55s}  {size_kb:>5}KB")
        return

    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=True)

    if action == 'UPDATE':
        service.files().update(
            fileId=file_id,
            media_body=media,
        ).execute()
    else:
        metadata = {'name': filename, 'parents': [folder_id]}
        service.files().create(
            body=metadata,
            media_body=media,
            fields='id',
        ).execute()

    print(f"  {action:6s}  {filename:55s}  {size_kb:>5}KB  OK")


def main():
    dry_run = '--dry-run' in sys.argv

    # Step 1: regenerate local files
    print("=" * 60)
    print("Step 1: Regenerating knowledge base files from live export")
    print("=" * 60)
    result = subprocess.run([sys.executable, EXPORT_SCR], check=True)
    print()

    # Step 2: upload to Drive
    print("=" * 60)
    print("Step 2: Syncing to Google Drive")
    if dry_run:
        print("  (DRY RUN — no files will be written)")
    print("=" * 60)

    service  = get_drive_service()
    existing = list_drive_files(service, FOLDER_ID)
    print(f"  Found {len(existing)} existing files in Drive folder\n")

    files = sorted(f for f in os.listdir(KB_DIR)
                   if os.path.splitext(f)[1] in MIME_MAP)

    for filename in files:
        local_path = os.path.join(KB_DIR, filename)
        upload_file(service, local_path, FOLDER_ID, existing, dry_run=dry_run)

    print(f"\nDone. {len(files)} files synced to:")
    print(f"  https://drive.google.com/drive/folders/{FOLDER_ID}")


if __name__ == '__main__':
    main()
