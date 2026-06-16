import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';

// --- Configuration ---

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON!;
const CRON_SECRET = process.env.CRON_SECRET!;

const SITE_MAP: Record<string, string> = {
  winenow: 'https://th.wine-now.com/',
  liq9: 'https://th.liq9.com/',
};

const GA4_PROPERTY_MAP: Record<string, string> = {
  winenow: '377750759',
  liq9: '377924618',
};

const DAYS_TO_FETCH = 30; // Fetch data for the last 30 days on each run.

// Supabase client is created inside handlers to avoid build-time env errors
function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// --- Google API Authentication ---

function getGoogleAuth() {
  const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ],
  });
}

// --- Helper Functions ---

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function subtractDays(date: Date, days: number): Date {
  const newDate = new Date(date);
  newDate.setDate(date.getDate() - days);
  return newDate;
}

async function logSyncStart(runId: string, site: string) {
  const { error } = await getSupabase().from('sync_log').insert({
    run_id: runId,
    site: site,
    status: 'running',
  });
  if (error) console.error(`Error logging sync start for ${site}:`, error);
}

async function logSyncEnd(
  runId: string,
  status: string,
  rowsWritten: number,
  errorMsg: string | null = null,
  startedAtMs: number | null = null,
) {
  // duration computed in JS — the Supabase JS client has no .raw() for SQL
  // expressions inside .update(), so we can't subtract started_at server-side.
  const completedAt = new Date();
  const { error } = await getSupabase()
    .from('sync_log')
    .update({
      completed_at: completedAt.toISOString(),
      status: status,
      rows_written: rowsWritten,
      error_msg: errorMsg,
      duration_ms: startedAtMs != null ? completedAt.getTime() - startedAtMs : null,
    })
    .eq('run_id', runId);
  if (error) console.error(`Error logging sync end for ${runId}:`, error);
}

/**
 * Upserts records into a Supabase table.
 * @param tableName The name of the table.
 * @param records An array of objects to upsert.
 * @param onConflict A comma-separated string of column names for conflict resolution.
 * @returns The number of rows written.
 */
async function upsertRecords(tableName: string, records: any[], onConflict: string): Promise<number> {
  if (records.length === 0) return 0;

  const { error } = await getSupabase().from(tableName).upsert(records, { onConflict });

  if (error) {
    console.error(`Error upserting into ${tableName}:`, error);
    throw error;
  }
  return records.length;
}

// --- Google API Fetchers ---

async function fetchGSCData(
  auth: any,
  siteUrl: string,
  startDate: string,
  endDate: string,
  site: string,
) {
  const gscService = google.searchconsole({ version: 'v1', auth });
  const syncedAt = new Date().toISOString();

  // GSC Daily Aggregate
  const dailyResponse = await gscService.searchanalytics.query({
    siteUrl: siteUrl,
    requestBody: {
      startDate: startDate,
      endDate: endDate,
      dimensions: ['date'],
    },
  });
  const gscDailyRecords =
    dailyResponse.data.rows?.map((row: any) => ({
      site: site,
      date: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      avg_ctr: row.ctr,
      avg_position: row.position,
      synced_at: syncedAt,
    })) || [];

  // GSC Top Keywords (for endDate)
  const keywordsResponse = await gscService.searchanalytics.query({
    siteUrl: siteUrl,
    requestBody: {
      startDate: endDate,
      endDate: endDate,
      dimensions: ['query'],
      rowLimit: 100,
    },
  });
  const gscKeywordsRecords =
    keywordsResponse.data.rows?.map((row: any) => ({
      site: site,
      snapshot_date: endDate,
      keyword: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      synced_at: syncedAt,
    })) || [];

  // GSC Top Pages (for endDate)
  const pagesResponse = await gscService.searchanalytics.query({
    siteUrl: siteUrl,
    requestBody: {
      startDate: endDate,
      endDate: endDate,
      dimensions: ['page'],
      rowLimit: 50,
    },
  });
  const gscPagesRecords =
    pagesResponse.data.rows?.map((row: any) => ({
      site: site,
      snapshot_date: endDate,
      page: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
      synced_at: syncedAt,
    })) || [];

  return { gscDailyRecords, gscKeywordsRecords, gscPagesRecords };
}

async function fetchGA4Data(
  auth: any,
  propertyId: string,
  startDate: string,
  endDate: string,
  site: string,
) {
  const ga4Service = google.analyticsdata({ version: 'v1beta', auth });
  const syncedAt = new Date().toISOString();

  // GA4 Daily Aggregate
  const dailyReport = await ga4Service.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'ecommercePurchases' },
        { name: 'purchaseRevenue' },
      ],
    },
  });
  const ga4DailyRecords =
    dailyReport.data.rows?.map((row: any) => ({
      site: site,
      date: row.dimensionValues[0].value,
      sessions: parseInt(row.metricValues[0].value),
      users: parseInt(row.metricValues[1].value),
      new_users: parseInt(row.metricValues[2].value),
      page_views: parseInt(row.metricValues[3].value),
      bounce_rate: parseFloat(row.metricValues[4].value) * 100, // Convert to percentage
      avg_session_duration: parseInt(row.metricValues[5].value),
      purchases: parseInt(row.metricValues[6].value),
      revenue: parseFloat(row.metricValues[7].value),
      synced_at: syncedAt,
    })) || [];

  // GA4 Daily by Channel
  const channelReport = await ga4Service.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'source' }, { name: 'medium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'conversions' },
        { name: 'purchaseRevenue' },
      ],
    },
  });
  const ga4BySourceRecords =
    channelReport.data.rows?.map((row: any) => ({
      site: site,
      date: row.dimensionValues[0].value,
      channel: row.dimensionValues[1].value,
      source: row.dimensionValues[2].value,
      medium: row.dimensionValues[3].value,
      sessions: parseInt(row.metricValues[0].value),
      users: parseInt(row.metricValues[1].value),
      conversions: parseInt(row.metricValues[2].value),
      revenue: parseFloat(row.metricValues[3].value),
      synced_at: syncedAt,
    })) || [];

  // GA4 Ecommerce Daily
  const ecommerceReport = await ga4Service.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: startDate, endDate: endDate }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'ecommercePurchases' },
        { name: 'purchaseRevenue' },
        { name: 'addToCarts' },
        { name: 'checkouts' },
        { name: 'itemsAddedToCart' }, // Using this to calculate cart_to_purchase_pct
        { name: 'averagePurchaseRevenue' },
      ],
    },
  });
  const ga4EcommerceRecords =
    ecommerceReport.data.rows?.map((row: any) => ({
      site: site,
      date: row.dimensionValues[0].value,
      purchases: parseInt(row.metricValues[0].value),
      revenue: parseFloat(row.metricValues[1].value),
      add_to_carts: parseInt(row.metricValues[2].value),
      checkouts: parseInt(row.metricValues[3].value),
      cart_to_purchase_pct:
        parseInt(row.metricValues[2].value) > 0
          ? (parseInt(row.metricValues[0].value) / parseInt(row.metricValues[2].value)) * 100
          : 0,
      avg_order_value: parseFloat(row.metricValues[5].value),
      synced_at: syncedAt,
    })) || [];

  return { ga4DailyRecords, ga4BySourceRecords, ga4EcommerceRecords };
}

async function calculateContentSignals(site: string, endDate: string) {
  const today = new Date(endDate);
  const sevenDaysAgo = formatDate(subtractDays(today, 7));
  const thirtyDaysAgo = formatDate(subtractDays(today, 30));
  const lastRebuilt = new Date().toISOString();

  // Fetch GSC pages data for the last 30 days for this site
  const { data: gscPagesData, error: gscPagesError } = await getSupabase()
    .from('gsc_pages')
    .select('page, snapshot_date, position, ctr, impressions, clicks')
    .eq('site', site)
    .gte('snapshot_date', thirtyDaysAgo)
    .lte('snapshot_date', endDate);

  if (gscPagesError) {
    console.error(`Error fetching gsc_pages for content signals for ${site}:`, gscPagesError);
    throw gscPagesError;
  }

  const pageDataMap: { [page: string]: any[] } = {};
  for (const row of gscPagesData) {
    if (!pageDataMap[row.page]) {
      pageDataMap[row.page] = [];
    }
    pageDataMap[row.page].push(row);
  }

  const contentSignalsRecords = [];
  for (const page in pageDataMap) {
    const pageHistory = pageDataMap[page];

    const positions7d = pageHistory
      .filter((d) => d.snapshot_date >= sevenDaysAgo)
      .map((d) => d.position);
    const positions30d = pageHistory.map((d) => d.position);
    const ctrs7d = pageHistory
      .filter((d) => d.snapshot_date >= sevenDaysAgo)
      .map((d) => d.ctr);
    const ctrs30d = pageHistory.map((d) => d.ctr);
    const impressions30d = pageHistory.reduce((sum, d) => sum + d.impressions, 0);
    const clicks30d = pageHistory.reduce((sum, d) => sum + d.clicks, 0);

    const avgPosition7d = positions7d.length
      ? positions7d.reduce((sum, p) => sum + p, 0) / positions7d.length
      : null;
    const avgPosition30d = positions30d.length
      ? positions30d.reduce((sum, p) => sum + p, 0) / positions30d.length
      : null;
    const avgCtr7d = ctrs7d.length ? ctrs7d.reduce((sum, c) => sum + c, 0) / ctrs7d.length : null;
    const avgCtr30d = ctrs30d.length ? ctrs30d.reduce((sum, c) => sum + c, 0) / ctrs30d.length : null;

    const positionDelta =
      avgPosition7d !== null && avgPosition30d !== null
        ? avgPosition7d - avgPosition30d
        : null;

    let opportunityScore = 0;
    if (impressions30d > 500 && avgPosition7d !== null && avgPosition7d >= 5 && avgPosition7d <= 20 && avgCtr7d !== null && avgCtr7d < 2) {
      opportunityScore = 100; // High potential
    } else if (impressions30d > 100 && avgPosition7d !== null && avgPosition7d >= 10 && avgPosition7d <= 30) {
      opportunityScore = 50; // Medium potential
    }

    let decayScore = 0;
    if (positionDelta !== null && positionDelta > 2 && impressions30d > 200) {
      decayScore = 100; // Significant decay
    } else if (positionDelta !== null && positionDelta > 0.5 && impressions30d > 50) {
      decayScore = 50; // Moderate decay
    }

    contentSignalsRecords.push({
      site: site,
      page: page,
      avg_position_7d: avgPosition7d,
      avg_position_30d: avgPosition30d,
      position_delta: positionDelta,
      avg_ctr_7d: avgCtr7d,
      avg_ctr_30d: avgCtr30d,
      impressions_30d: impressions30d,
      clicks_30d: clicks30d,
      decay_score: decayScore,
      opportunity_score: opportunityScore,
      last_rebuilt: lastRebuilt,
    });
  }

  return contentSignalsRecords;
}

// --- Main Sync Handler ---

export async function POST(req: NextRequest) {
  // 1. Auth Check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetSite = searchParams.get('site'); // 'winenow', 'liq9', or null for both
  const refresh = searchParams.get('refresh') === 'true'; // Force refresh

  const sitesToSync = targetSite ? [targetSite] : Object.keys(SITE_MAP);
  const googleAuth = getGoogleAuth();

  const syncSummary: { [site: string]: any } = {};

  for (const site of sitesToSync) {
    const runId = uuidv4();
    const startedAtMs = Date.now();
    let totalRowsWritten = 0;
    const errorMessages: string[] = [];
    let syncStatus = 'ok';

    syncSummary[site] = { status: 'started', rows: 0, errors: [] };
    console.log(`[${site}] Starting sync with run_id: ${runId}`);

    try {
      await logSyncStart(runId, site);

      const today = new Date();
      const yesterday = formatDate(subtractDays(today, 1));
      const thirtyDaysAgo = formatDate(subtractDays(today, DAYS_TO_FETCH));

      // Check if already synced today
      if (!refresh) {
        const { data: lastSync, error: syncLogError } = await getSupabase()
          .from('sync_log')
          .select('status')
          .eq('site', site)
          .gte('started_at', formatDate(today)) // Check for today's runs
          .eq('status', 'ok')
          .limit(1);

        if (syncLogError) console.error(`Error checking last sync for ${site}:`, syncLogError);

        if (lastSync && lastSync.length > 0) {
          console.log(`[${site}] Already successfully synced today. Skipping.`);
          syncSummary[site] = { status: 'skipped', message: 'Already synced today' };
          await logSyncEnd(runId, 'skipped', 0, 'Already synced today', startedAtMs);
          continue;
        }
      }

      // 1. Pull GSC Data
      try {
        const { gscDailyRecords, gscKeywordsRecords, gscPagesRecords } = await fetchGSCData(
          googleAuth,
          SITE_MAP[site],
          thirtyDaysAgo,
          yesterday,
          site,
        );
        totalRowsWritten += await upsertRecords('gsc_daily', gscDailyRecords, 'site,date');
        totalRowsWritten += await upsertRecords('gsc_keywords', gscKeywordsRecords, 'site,snapshot_date,keyword');
        totalRowsWritten += await upsertRecords('gsc_pages', gscPagesRecords, 'site,snapshot_date,page');
        console.log(`[${site}] GSC data synced. Daily: ${gscDailyRecords.length}, Keywords: ${gscKeywordsRecords.length}, Pages: ${gscPagesRecords.length}`);
      } catch (e: any) {
        console.error(`[${site}] GSC Sync Error:`, e);
        errorMessages.push(`GSC Error: ${e.message}`);
        syncStatus = 'partial';
      }

      // 2. Pull GA4 Data
      try {
        const { ga4DailyRecords, ga4BySourceRecords, ga4EcommerceRecords } = await fetchGA4Data(
          googleAuth,
          GA4_PROPERTY_MAP[site],
          thirtyDaysAgo,
          yesterday,
          site,
        );
        totalRowsWritten += await upsertRecords('ga4_daily', ga4DailyRecords, 'site,date');
        totalRowsWritten += await upsertRecords('ga4_by_source', ga4BySourceRecords, 'site,date,channel');
        totalRowsWritten += await upsertRecords('ga4_ecommerce', ga4EcommerceRecords, 'site,date');
        console.log(`[${site}] GA4 data synced. Daily: ${ga4DailyRecords.length}, BySource: ${ga4BySourceRecords.length}, Ecommerce: ${ga4EcommerceRecords.length}`);
      } catch (e: any) {
        console.error(`[${site}] GA4 Sync Error:`, e);
        errorMessages.push(`GA4 Error: ${e.message}`);
        syncStatus = 'partial';
      }

      // 3. Rebuild Content Signals
      try {
        const contentSignalsRecords = await calculateContentSignals(site, yesterday);
        totalRowsWritten += await upsertRecords('content_signals', contentSignalsRecords, 'site,page');
        console.log(`[${site}] Content signals rebuilt: ${contentSignalsRecords.length} records.`);
      } catch (e: any) {
        console.error(`[${site}] Content Signals Error:`, e);
        errorMessages.push(`Content Signals Error: ${e.message}`);
        syncStatus = 'partial';
      }

      // 4. Upsert Data Snapshots (Placeholder for now)
      try {
        // In a real scenario, you'd aggregate data into a JSON payload here
        // For now, a simple placeholder
        const snapshotPayload = {
          message: `Snapshot for ${site} on ${yesterday}`,
          // ... actual aggregated data would go here
        };
        const snapshotRecord = {
          site: site,
          snapshot_date: yesterday,
          payload: snapshotPayload,
          synced_at: new Date().toISOString(),
        };
        totalRowsWritten += await upsertRecords('data_snapshots', [snapshotRecord], 'site,snapshot_date');
        console.log(`[${site}] Data snapshot created.`);
      } catch (e: any) {
        console.error(`[${site}] Data Snapshots Error:`, e);
        errorMessages.push(`Data Snapshots Error: ${e.message}`);
        syncStatus = 'partial';
      }

      syncSummary[site] = { status: syncStatus, rows: totalRowsWritten, errors: errorMessages };
      await logSyncEnd(runId, syncStatus, totalRowsWritten, errorMessages.join('; '), startedAtMs);
      console.log(`[${site}] Sync finished with status: ${syncStatus}. Total rows: ${totalRowsWritten}`);
    } catch (e: any) {
      console.error(`[${site}] CRITICAL Sync Error:`, e);
      errorMessages.push(`CRITICAL Error: ${e.message}`);
      syncSummary[site] = { status: 'error', rows: totalRowsWritten, errors: errorMessages };
      await logSyncEnd(runId, 'error', totalRowsWritten, errorMessages.join('; '));
    }
  }

  return NextResponse.json({ message: 'Sync process completed', summary: syncSummary });
}
