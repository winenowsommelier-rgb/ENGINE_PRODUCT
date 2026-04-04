import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// ─── Auth ─────────────────────────────────────────────────────────────────────
// The same service account used for GSC/GA4 works here.
// REQUIRED: Enable "Google Sheets API" in Google Cloud Console for the wnlq0-seo project.
// REQUIRED: Share your Google Sheet with: seo-dashboard@wnlq0-seo.iam.gserviceaccount.com
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

// ─── Per-sheet cache ──────────────────────────────────────────────────────────
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const sheetCache = new Map<string, { data: SheetResponse; at: number }>();

interface SheetResponse {
  spreadsheetId: string;
  sheetName: string;
  range: string;
  headers: string[];
  rows: Record<string, string>[];
  count: number;
  fetchedAt: string;
}

// ─── GET /api/sheets ──────────────────────────────────────────────────────────
// Query params:
//   ?sheet=SPREADSHEET_ID   (or falls back to SHEETS_SPREADSHEET_ID env var)
//   &range=Sheet1!A:Z       (or SHEETS_RANGE, default "Sheet1!A:Z")
//   &name=MySheet           (display label, optional)
//   &refresh=true           (bypass cache)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spreadsheetId = searchParams.get('sheet') ?? process.env.SHEETS_SPREADSHEET_ID ?? '';
  const range = searchParams.get('range') ?? process.env.SHEETS_RANGE ?? 'Sheet1!A:Z';
  const sheetName = searchParams.get('name') ?? process.env.SHEETS_NAME ?? 'Sheet';
  const refresh = searchParams.get('refresh') === 'true';

  if (!spreadsheetId) {
    return NextResponse.json(
      {
        error:
          'No spreadsheet ID. Pass ?sheet=SPREADSHEET_ID or set SHEETS_SPREADSHEET_ID in .env.local. ' +
          'Also ensure the Google Sheets API is enabled and the sheet is shared with seo-dashboard@wnlq0-seo.iam.gserviceaccount.com',
      },
      { status: 400 }
    );
  }

  const cacheKey = `${spreadsheetId}:${range}`;
  const cached = sheetCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const auth = getAuth();
    const sheetsApi = google.sheets({ version: 'v4', auth });

    const res = await sheetsApi.spreadsheets.values.get({ spreadsheetId, range });
    const rawRows = res.data.values ?? [];

    if (rawRows.length === 0) {
      const empty: SheetResponse = {
        spreadsheetId,
        sheetName,
        range,
        headers: [],
        rows: [],
        count: 0,
        fetchedAt: new Date().toISOString(),
      };
      sheetCache.set(cacheKey, { data: empty, at: Date.now() });
      return NextResponse.json(empty);
    }

    // First row = headers
    const headers = (rawRows[0] as string[]).map(h => String(h ?? '').trim());
    const rows = (rawRows.slice(1) as string[][]).map(row => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = String(row[i] ?? '').trim();
      });
      return obj;
    });

    const result: SheetResponse = {
      spreadsheetId,
      sheetName,
      range,
      headers,
      rows,
      count: rows.length,
      fetchedAt: new Date().toISOString(),
    };

    sheetCache.set(cacheKey, { data: result, at: Date.now() });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
