#!/usr/bin/env python3
"""
Full pipeline: regenerate all knowledge base files from live_products_export.json,
then upload/overwrite every file across three Google Drive folders:
  - ai-knowledge-base          (full detail JSON)
  - ai-knowledge-base-slim     (slim JSON for Claude/ChatGPT projects)
  - ai-knowledge-base-notebooklm (plain text for NotebookLM)

Usage:
    python3 scripts/sync_ai_knowledge_base_to_drive.py
    python3 scripts/sync_ai_knowledge_base_to_drive.py --dry-run

Requirements:
    pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client

Credentials:
    Place your OAuth2 credentials JSON at ~/.config/wnlq9/gdrive_credentials.json
    On first run you will be prompted to authorise in a browser.
    Token cached at ~/.config/wnlq9/gdrive_token.json for future runs.
"""

import os
import sys
import json
import subprocess

ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KB_DIR      = os.path.join(ROOT, 'docs', 'ai-knowledge-base')
SLIM_DIR    = os.path.join(ROOT, 'docs', 'ai-knowledge-base-slim')
NLM_DIR     = os.path.join(ROOT, 'docs', 'ai-knowledge-base-notebooklm')

EXPORT_SCR      = os.path.join(ROOT, 'scripts', 'export_ai_knowledge_base.py')
EXPORT_SLIM_SCR = os.path.join(ROOT, 'scripts', 'export_ai_knowledge_base_slim.py')

# Parent Drive folder — subfolders are created automatically if missing
PARENT_FOLDER_ID = '1jI0O-5sYTekqpOQBET7I_rw4XTIeaKdK'

CREDS_PATH = os.path.expanduser('~/.config/wnlq9/gdrive_credentials.json')
TOKEN_PATH = os.path.expanduser('~/.config/wnlq9/gdrive_token.json')

SCOPES = ['https://www.googleapis.com/auth/drive']

MIME_MAP = {
    '.md':   'text/plain',
    '.json': 'application/json',
    '.tsv':  'text/tab-separated-values',
    '.txt':  'text/plain',
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


def get_or_create_subfolder(service, parent_id, name, dry_run=False):
    """Return the Drive folder ID for `name` inside `parent_id`, creating it if needed."""
    resp = service.files().list(
        q=f"'{parent_id}' in parents and name='{name}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields='files(id, name)',
    ).execute()
    files = resp.get('files', [])
    if files:
        return files[0]['id']
    if dry_run:
        print(f"  [DRY RUN] Would CREATE subfolder: {name}")
        return None
    metadata = {
        'name': name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [parent_id],
    }
    folder = service.files().create(body=metadata, fields='id').execute()
    print(f"  Created Drive subfolder: {name}")
    return folder['id']


def sync_folder(service, local_dir, drive_folder_id, label, dry_run=False):
    """Upload all files from local_dir to drive_folder_id."""
    existing = list_drive_files(service, drive_folder_id)
    print(f"  {label}: {len(existing)} existing files in Drive\n")

    files = sorted(f for f in os.listdir(local_dir)
                   if os.path.splitext(f)[1] in MIME_MAP)
    for filename in files:
        local_path = os.path.join(local_dir, filename)
        upload_file(service, local_path, drive_folder_id, existing, dry_run=dry_run)
    print(f"\n  → {len(files)} files synced ({label})")
    return len(files)


def main():
    dry_run = '--dry-run' in sys.argv

    # Step 1: regenerate full knowledge base
    print("=" * 60)
    print("Step 1: Regenerating full knowledge base")
    print("=" * 60)
    subprocess.run([sys.executable, EXPORT_SCR], check=True)
    print()

    # Step 2: regenerate slim + NotebookLM versions
    print("=" * 60)
    print("Step 2: Regenerating slim + NotebookLM versions")
    print("=" * 60)
    subprocess.run([sys.executable, EXPORT_SLIM_SCR], check=True)
    print()

    # Step 3: sync all three folders to Drive
    print("=" * 60)
    print("Step 3: Syncing to Google Drive")
    if dry_run:
        print("  (DRY RUN — no files will be written)")
    print("=" * 60)

    service = get_drive_service()

    # Full KB — goes directly in the parent folder
    print(f"\n[ai-knowledge-base — full detail]")
    existing_root = list_drive_files(service, PARENT_FOLDER_ID)
    # Only upload files (not subfolders) to root
    root_files = sorted(f for f in os.listdir(KB_DIR)
                        if os.path.splitext(f)[1] in MIME_MAP)
    for filename in root_files:
        upload_file(service, os.path.join(KB_DIR, filename),
                    PARENT_FOLDER_ID, existing_root, dry_run=dry_run)
    print(f"\n  → {len(root_files)} files synced (full detail)")

    # Slim — subfolder
    print(f"\n[ai-knowledge-base-slim — Claude/ChatGPT]")
    slim_id = get_or_create_subfolder(service, PARENT_FOLDER_ID, 'ai-knowledge-base-slim', dry_run)
    if slim_id:
        sync_folder(service, SLIM_DIR, slim_id, 'slim', dry_run)

    # NotebookLM — subfolder
    print(f"\n[ai-knowledge-base-notebooklm — NotebookLM]")
    nlm_id = get_or_create_subfolder(service, PARENT_FOLDER_ID, 'ai-knowledge-base-notebooklm', dry_run)
    if nlm_id:
        sync_folder(service, NLM_DIR, nlm_id, 'notebooklm', dry_run)

    print("\n" + "=" * 60)
    print("All done. Drive folder:")
    print(f"  https://drive.google.com/drive/folders/{PARENT_FOLDER_ID}")


if __name__ == '__main__':
    main()
