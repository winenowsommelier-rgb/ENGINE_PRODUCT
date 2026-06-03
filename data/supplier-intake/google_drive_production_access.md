# Google Drive Production Access

## Current Status

Checked on 2026-05-27.

- The app has a Google service account configured in `.env.local`.
- Existing app code uses that account for Google Sheets.
- A Drive API readonly access test against the supplier root folder failed because Google Drive API is not enabled in the Google Cloud project.

## Required Action

Enable Google Drive API for the configured Google Cloud project:

```text
https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=1030487865754
```

Then share the supplier root folder with the configured service account email shown in `.env.local`.

## Production Import Scope

Use readonly Drive access:

```text
https://www.googleapis.com/auth/drive.readonly
```

The import process should only read/list/download source files. It should not move, delete, or mutate Drive files.

