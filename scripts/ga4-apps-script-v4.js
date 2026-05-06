/**
 * ============================================================
 * WNLQ9 GA4 — Production Script v4
 * Wine-Now (th.wine-now.com) & LIQ9 (th.liq9.com)
 * ============================================================
 *
 * v4 CHANGES vs v3:
 *   - FIXED: Wine-Now property ID corrected to 377750759 (primary property
 *     with full e-commerce). v3 used 386954192 (secondary, basic events only).
 *   - FIXED: backfillAll() now shares a single startMs across both sites so
 *     the 5-min timeout budget is global, not per-site. This was the root cause
 *     of LIQ9 always timing out — it got a fresh 5-min clock after Wine-Now
 *     already used 2.5 min of the 6-min Apps Script limit.
 *   - NEW: backfillSite_() accepts an optional sharedStartMs parameter.
 *   - NEW: scheduleContinuation_() creates a one-off time trigger so LIQ9
 *     backfill automatically resumes 5 minutes after Wine-Now completes.
 *   - NEW: SAFE_REMAINING_MS constant (90 seconds) — if less than this remains
 *     after Wine-Now, LIQ9 is scheduled instead of run inline.
 *   - All other logic unchanged from v3.
 *
 * TABS PER SPREADSHEET:
 *   Daily Metrics      — date-level sessions, users, pageviews (from 2024-01-01)
 *   Daily by Source    — date × channel attribution
 *   Monthly Summary    — auto-built monthly rollup
 *   Top Pages          — rolling 30d, top 500 pages
 *   Traffic Sources    — rolling 30d, all channels
 *   Landing Pages      — rolling 30d, top 500 landing pages
 *   Ecommerce Daily    — purchases, revenue, add-to-carts
 *   Product Performance— rolling 90d, top products
 *
 * FUNCTIONS TO KNOW:
 *   dailyRefreshAll()     → set daily trigger to this (6 AM ICT)
 *   backfillAll()         → run ONCE after setup to pull all history
 *   backfillWineNow()     → backfill Wine-Now only
 *   backfillLIQ9()        → backfill LIQ9 only (also used as continuation target)
 *   rebuildMonthly()      → rebuild Monthly Summary from Daily Metrics (recovery)
 *   createDailyTrigger()  → set up auto-trigger (run once)
 *
 * SETUP:
 *   1. Paste this script into BOTH GA4 spreadsheets' Apps Script editor
 *   2. Run backfillAll() once to seed historical data
 *   3. Run createDailyTrigger() once to start daily automation
 * ============================================================
 */

// ============================================================
// CONFIGURATION
// ============================================================
const GA_CONFIG = {
  wineNow: {
    propertyId:    '377750759',   // ✅ v4 fix: primary property (full e-commerce)
    spreadsheetId: '1jJm5FVGOdbCgPcrb02sUwghl3me0np4J1b5kOCKOGDA'
  },
  liq9: {
    propertyId:    '377924618',
    spreadsheetId: '19EzmTkLnrxSMauYLHNXze45c-vxT7w2uWucqtT2mVDo'
  }
};

const HISTORICAL_START     = '2024-01-01';
const ROLLING_DAYS         = 30;
const PRODUCT_ROLLING_DAYS = 90;
const TZ                   = 'Asia/Bangkok';
const MAX_EXEC_MS          = 300000;  // 5 min — bail before 6-min Apps Script hard limit
const SAFE_REMAINING_MS    = 90000;   // 1.5 min — minimum headroom needed to start LIQ9 safely

// ============================================================
// MAIN ENTRY POINTS
// ============================================================

/** Daily auto-refresh — set your trigger to this function */
function dailyRefreshAll() {
  log_('=== Daily GA4 Refresh: ' + new Date().toISOString() + ' ===');
  dailyRefreshSite_(GA_CONFIG.wineNow, 'Wine-Now');
  dailyRefreshSite_(GA_CONFIG.liq9,    'LIQ9');
  log_('=== Daily GA4 Refresh Complete ===');
}

/**
 * Run ONCE on first setup to backfill all history from 2024-01-01.
 *
 * v4: Uses a shared startMs across both sites so the 5-min timeout
 * budget is global. If Wine-Now consumes most of the budget,
 * LIQ9 is automatically scheduled to run 5 minutes later instead of
 * being killed mid-backfill by the 6-min Apps Script wall.
 */
function backfillAll() {
  const startMs = Date.now();
  backfillSite_(GA_CONFIG.wineNow, 'Wine-Now', startMs);

  const elapsed   = Date.now() - startMs;
  const remaining = MAX_EXEC_MS - elapsed;

  if (remaining < SAFE_REMAINING_MS) {
    log_('⏱ Only ' + Math.round(remaining / 1000) + 's remaining after Wine-Now — scheduling LIQ9 in 5 min');
    scheduleContinuation_('backfillLIQ9', 5);
    return;
  }

  backfillSite_(GA_CONFIG.liq9, 'LIQ9', startMs);
}

/** Backfill Wine-Now only */
function backfillWineNow() { backfillSite_(GA_CONFIG.wineNow, 'Wine-Now'); }

/**
 * Backfill LIQ9 only.
 * Also used as the auto-scheduled continuation target when backfillAll()
 * runs out of time after Wine-Now.
 */
function backfillLIQ9() { backfillSite_(GA_CONFIG.liq9, 'LIQ9'); }

/** Manually rebuild Monthly Summary from existing Daily Metrics data */
function rebuildMonthly() {
  buildMonthlySummary_(openSheet_(GA_CONFIG.wineNow.spreadsheetId), 'Wine-Now');
  buildMonthlySummary_(openSheet_(GA_CONFIG.liq9.spreadsheetId),    'LIQ9');
  log_('Monthly Summary rebuilt for both sites');
}

// ============================================================
// BACKFILL — pull full history from HISTORICAL_START
// ============================================================

/**
 * @param {object} config      - GA_CONFIG.wineNow or GA_CONFIG.liq9
 * @param {string} siteName    - display name for logs
 * @param {number} sharedStartMs - optional: pass the calling function's
 *   Date.now() so the timeout budget is shared across multiple sites.
 *   Omit when calling a single site (backfillWineNow / backfillLIQ9).
 */
function backfillSite_(config, siteName, sharedStartMs) {
  const startMs = sharedStartMs || Date.now();
  log_('=== Backfill started: ' + siteName + ' ===');
  const ss      = openSheet_(config.spreadsheetId);
  const endDate = yesterday_();

  backfillDailyMetrics_  (ss, config.propertyId, HISTORICAL_START, endDate, siteName, startMs);
  if (timedOut_(startMs)) { log_('⚠️ Time limit hit after Daily Metrics — skipping remaining tabs for ' + siteName); return; }

  backfillDailyBySource_ (ss, config.propertyId, HISTORICAL_START, endDate, siteName, startMs);
  if (timedOut_(startMs)) { log_('⚠️ Time limit hit after Daily by Source for ' + siteName); return; }

  backfillEcommerceDaily_(ss, config.propertyId, HISTORICAL_START, endDate, siteName, startMs);

  buildMonthlySummary_(ss, siteName);
  refreshRollingTabs_  (ss, config.propertyId, siteName);
  log_('=== Backfill complete: ' + siteName + ' ===');
}

// ============================================================
// DAILY REFRESH — appends only new days, then refreshes rolling tabs
// ============================================================
function dailyRefreshSite_(config, siteName) {
  const startMs = Date.now();
  log_('--- Daily refresh: ' + siteName + ' ---');
  const ss = openSheet_(config.spreadsheetId);

  const dailySheet = ss.getSheetByName('Daily Metrics');
  let lastDate = HISTORICAL_START;
  if (dailySheet && dailySheet.getLastRow() > 1) {
    const lastRow  = dailySheet.getLastRow();
    const readFrom = Math.max(2, lastRow - 99);
    const readCount = lastRow - readFrom + 1;
    const dates = dailySheet.getRange(readFrom, 1, readCount, 1).getValues();
    dates.forEach(row => {
      if (row[0]) {
        const d = toIsoDate_(row[0]);
        if (d > lastDate) lastDate = d;
      }
    });
  }

  const startStr = offsetDate_(lastDate, 1);
  const endStr   = yesterday_();

  if (startStr <= endStr) {
    log_('Appending: ' + startStr + ' → ' + endStr);
    backfillDailyMetrics_  (ss, config.propertyId, startStr, endStr, siteName, startMs);
    backfillDailyBySource_ (ss, config.propertyId, startStr, endStr, siteName, startMs);
    backfillEcommerceDaily_(ss, config.propertyId, startStr, endStr, siteName, startMs);
    buildMonthlySummary_(ss, siteName);
  } else {
    log_('Daily Metrics already up to date (' + lastDate + ')');
  }

  refreshRollingTabs_(ss, config.propertyId, siteName);
  log_('✅ ' + siteName + ' daily refresh complete (' + Math.round((Date.now() - startMs) / 1000) + 's)');
}

// ============================================================
// APPEND TABS — Daily Metrics, Daily by Source, Ecommerce Daily
// ============================================================
function backfillDailyMetrics_(ss, propertyId, startDate, endDate, siteName, startMs) {
  const sheet = getOrCreateSheet_(ss, 'Daily Metrics');
  const existingDates = getExistingDates_(sheet, 0);
  log_('Daily Metrics: ' + existingDates.size + ' existing dates');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Sessions', 'Total Users', 'New Users', 'Pageviews',
                     'Bounce Rate %', 'Avg Session Duration (s)', 'Conversions',
                     'Ecommerce Purchases', 'Purchase Revenue', 'Updated']);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const chunks = getMonthChunks_(startDate, endDate);
  log_('Daily Metrics: ' + chunks.length + ' chunks to process');

  for (const chunk of chunks) {
    if (timedOut_(startMs)) { log_('⚠️ Timed out mid-backfill (Daily Metrics)'); break; }

    const result = callGA4_(propertyId, {
      dateRanges: [{ startDate: chunk.start, endDate: chunk.end }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
        { name: 'conversions' },
        { name: 'ecommercePurchases' },
        { name: 'purchaseRevenue' }
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      limit: 10000
    });

    if (result && result.rows) {
      const newRows = [];
      result.rows.forEach(row => {
        const dateStr = ga4DateToIso_(row.dimensionValues[0].value);
        if (existingDates.has(dateStr)) return;

        const v = row.metricValues.map(m => parseFloat(m.value) || 0);
        newRows.push([
          dateStr,
          v[0],
          v[1],
          v[2],
          v[3],
          Math.round(v[4] * 10000) / 100,
          Math.round(v[5] * 10) / 10,
          Math.round(v[6]),
          Math.round(v[7]),
          Math.round(v[8] * 100) / 100,
          new Date()
        ]);
        existingDates.add(dateStr);
      });
      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        log_('  ' + chunk.start + '→' + chunk.end + ': +' + newRows.length + ' rows');
      }
    }
    Utilities.sleep(300);
  }

  sortSheetByDate_(sheet);
  formatSheet_(sheet);
}

function backfillDailyBySource_(ss, propertyId, startDate, endDate, siteName, startMs) {
  const sheet = getOrCreateSheet_(ss, 'Daily by Source');
  const existingKeys = getExistingCompositeKeys_(sheet, [0, 1]);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Channel', 'Source', 'Medium',
                     'Sessions', 'Users', 'Conversions', 'Revenue', 'Updated']);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const chunks = getMonthChunks_(startDate, endDate);

  for (const chunk of chunks) {
    if (timedOut_(startMs)) { log_('⚠️ Timed out (Daily by Source)'); break; }

    const result = callGA4_(propertyId, {
      dateRanges: [{ startDate: chunk.start, endDate: chunk.end }],
      dimensions: [
        { name: 'date' },
        { name: 'sessionDefaultChannelGroup' },
        { name: 'sessionSource' },
        { name: 'sessionMedium' }
      ],
      metrics: [
        { name: 'sessions' }, { name: 'totalUsers' },
        { name: 'conversions' }, { name: 'totalRevenue' }
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      limit: 10000
    });

    if (result && result.rows) {
      const newRows = [];
      result.rows.forEach(row => {
        const dateStr = ga4DateToIso_(row.dimensionValues[0].value);
        const channel = row.dimensionValues[1].value;
        const key     = dateStr + '|' + channel;
        if (existingKeys.has(key)) return;

        const source = row.dimensionValues[2].value;
        const medium = row.dimensionValues[3].value;
        const v      = row.metricValues.map(m => parseFloat(m.value) || 0);
        newRows.push([dateStr, channel, source, medium,
                      v[0], v[1], Math.round(v[2]), Math.round(v[3] * 100) / 100, new Date()]);
        existingKeys.add(key);
      });
      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        log_('  Daily by Source ' + chunk.start + '→' + chunk.end + ': +' + newRows.length + ' rows');
      }
    }
    Utilities.sleep(300);
  }

  sortSheetByDate_(sheet);
  formatSheet_(sheet);
}

function backfillEcommerceDaily_(ss, propertyId, startDate, endDate, siteName, startMs) {
  const sheet = getOrCreateSheet_(ss, 'Ecommerce Daily');
  const existingDates = getExistingDates_(sheet, 0);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Purchases', 'Purchase Revenue (THB)',
                     'Add to Carts', 'Checkouts', 'Cart→Purchase %', 'Avg Order Value', 'Updated']);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const chunks = getMonthChunks_(startDate, endDate);

  for (const chunk of chunks) {
    if (timedOut_(startMs)) { log_('⚠️ Timed out (Ecommerce Daily)'); break; }

    const result = callGA4_(propertyId, {
      dateRanges: [{ startDate: chunk.start, endDate: chunk.end }],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' },
        { name: 'addToCarts' },         { name: 'checkouts' }
      ],
      orderBys: [{ dimension: { dimensionName: 'date' }, desc: false }],
      limit: 10000
    });

    if (result && result.rows) {
      const newRows = [];
      result.rows.forEach(row => {
        const dateStr  = ga4DateToIso_(row.dimensionValues[0].value);
        if (existingDates.has(dateStr)) return;

        const purchases = parseFloat(row.metricValues[0].value) || 0;
        const revenue   = Math.round((parseFloat(row.metricValues[1].value) || 0) * 100) / 100;
        const carts     = parseFloat(row.metricValues[2].value) || 0;
        const checkouts = parseFloat(row.metricValues[3].value) || 0;
        const cartRate  = carts > 0 ? Math.round(purchases / carts * 10000) / 100 : 0;
        const aov       = purchases > 0 ? Math.round(revenue / purchases * 100) / 100 : 0;

        newRows.push([dateStr, purchases, revenue, carts, checkouts,
                      cartRate + '%', aov, new Date()]);
        existingDates.add(dateStr);
      });
      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
        log_('  Ecommerce ' + chunk.start + '→' + chunk.end + ': +' + newRows.length + ' rows');
      }
    }
    Utilities.sleep(300);
  }

  sortSheetByDate_(sheet);
  formatSheet_(sheet);
}

// ============================================================
// MONTHLY SUMMARY
// ============================================================
function buildMonthlySummary_(ss, siteName) {
  const dailySheet = ss.getSheetByName('Daily Metrics');
  if (!dailySheet || dailySheet.getLastRow() < 2) {
    log_('buildMonthlySummary: Daily Metrics empty, skipping');
    return;
  }

  const sheet = getOrCreateSheet_(ss, 'Monthly Summary');
  sheet.clear();
  sheet.appendRow(['Month', 'Sessions', 'Total Users', 'New Users', 'Pageviews',
                   'Avg Bounce Rate %', 'Conversions', 'Purchases', 'Revenue (THB)', 'Updated']);
  sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  sheet.setFrozenRows(1);

  const numRows = dailySheet.getLastRow() - 1;
  const data    = dailySheet.getRange(2, 1, numRows, 10).getValues();
  const monthly = {};

  data.forEach(row => {
    const dateStr = toIsoDate_(row[0]);
    if (!dateStr || dateStr.length < 7) return;

    const month = dateStr.substring(0, 7);
    if (!monthly[month]) {
      monthly[month] = { sessions: 0, users: 0, newUsers: 0, pageviews: 0,
                         bounceSum: 0, days: 0, conversions: 0, purchases: 0, revenue: 0 };
    }
    const m = monthly[month];
    m.sessions    += Number(row[1]) || 0;
    m.users       += Number(row[2]) || 0;
    m.newUsers    += Number(row[3]) || 0;
    m.pageviews   += Number(row[4]) || 0;
    m.bounceSum   += Number(row[5]) || 0;
    m.days++;
    m.conversions += Number(row[7]) || 0;
    m.purchases   += Number(row[8]) || 0;
    m.revenue     += Number(row[9]) || 0;
  });

  const months = Object.keys(monthly).sort();
  if (months.length === 0) {
    log_('buildMonthlySummary: No valid date rows found for ' + (siteName || ''));
    return;
  }

  const rows = months.map(month => {
    const m = monthly[month];
    return [
      month, m.sessions, m.users, m.newUsers, m.pageviews,
      Math.round(m.bounceSum / m.days * 100) / 100 + '%',
      m.conversions, m.purchases,
      Math.round(m.revenue * 100) / 100,
      new Date()
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  formatSheet_(sheet);
  log_('Monthly Summary: ' + months.length + ' months built');
}

// ============================================================
// ROLLING TABS
// ============================================================
function refreshRollingTabs_(ss, propertyId, siteName) {
  const endDate = yesterday_();
  const start30 = offsetDate_(endDate, -ROLLING_DAYS);
  const start90 = offsetDate_(endDate, -PRODUCT_ROLLING_DAYS);

  refreshTopPages_      (ss, propertyId, start30, endDate);
  refreshTrafficSources_(ss, propertyId, start30, endDate);
  refreshLandingPages_  (ss, propertyId, start30, endDate);
  refreshProducts_      (ss, propertyId, start90, endDate);
}

function refreshTopPages_(ss, propertyId, dateFrom, dateTo) {
  const sheet  = getOrCreateSheet_(ss, 'Top Pages');
  const result = callGA4_(propertyId, {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
    metrics: [
      { name: 'screenPageViews' }, { name: 'totalUsers' }, { name: 'bounceRate' },
      { name: 'averageSessionDuration' }, { name: 'conversions' }, { name: 'purchaseRevenue' }
    ],
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 500
  });
  sheet.clear();
  sheet.appendRow(['Page Path', 'Title', 'Pageviews', 'Users', 'Bounce Rate',
                   'Avg Duration (s)', 'Conversions', 'Revenue', 'Updated']);
  writeGA4Rows_(sheet, result);
  formatSheet_(sheet);
}

function refreshTrafficSources_(ss, propertyId, dateFrom, dateTo) {
  const sheet  = getOrCreateSheet_(ss, 'Traffic Sources');
  const result = callGA4_(propertyId, {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [
      { name: 'sessionDefaultChannelGroup' },
      { name: 'sessionSource' },
      { name: 'sessionMedium' }
    ],
    metrics: [
      { name: 'sessions' }, { name: 'totalUsers' }, { name: 'bounceRate' },
      { name: 'conversions' }, { name: 'ecommercePurchases' }, { name: 'totalRevenue' }
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 200
  });
  sheet.clear();
  sheet.appendRow(['Channel', 'Source', 'Medium', 'Sessions', 'Users',
                   'Bounce Rate', 'Conversions', 'Purchases', 'Revenue', 'Updated']);
  writeGA4Rows_(sheet, result);
  formatSheet_(sheet);
}

function refreshLandingPages_(ss, propertyId, dateFrom, dateTo) {
  const sheet  = getOrCreateSheet_(ss, 'Landing Pages');
  const result = callGA4_(propertyId, {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [{ name: 'landingPagePlusQueryString' }],
    metrics: [
      { name: 'sessions' }, { name: 'totalUsers' }, { name: 'bounceRate' },
      { name: 'conversions' }, { name: 'ecommercePurchases' }, { name: 'purchaseRevenue' }
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 500
  });
  sheet.clear();
  sheet.appendRow(['Landing Page', 'Sessions', 'Users', 'Bounce Rate',
                   'Conversions', 'Purchases', 'Revenue', 'Updated']);
  writeGA4Rows_(sheet, result);
  formatSheet_(sheet);
}

function refreshProducts_(ss, propertyId, dateFrom, dateTo) {
  const sheet  = getOrCreateSheet_(ss, 'Product Performance');
  const result = callGA4_(propertyId, {
    dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
    dimensions: [{ name: 'itemName' }, { name: 'itemCategory' }],
    metrics: [
      { name: 'itemsViewed' }, { name: 'itemsAddedToCart' },
      { name: 'itemsPurchased' }, { name: 'itemRevenue' }
    ],
    orderBys: [{ metric: { metricName: 'itemRevenue' }, desc: true }],
    limit: 500
  });
  sheet.clear();
  sheet.appendRow(['Product Name', 'Category', 'Views', 'Add to Cart',
                   'Purchased', 'Revenue', 'Updated']);
  writeGA4Rows_(sheet, result);
  formatSheet_(sheet);
}

// ============================================================
// GA4 API CALLER — with retry + exponential backoff
// ============================================================
function callGA4_(propertyId, request, attempt) {
  attempt = attempt || 1;
  const url = 'https://analyticsdata.googleapis.com/v1beta/properties/'
              + propertyId + ':runReport';
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(request),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  if (code === 200) return JSON.parse(resp.getContentText());

  if ([429, 500, 503].indexOf(code) > -1 && attempt <= 3) {
    const wait = Math.pow(2, attempt) * 1000;
    log_('GA4 retry ' + attempt + '/3 after ' + wait + 'ms (HTTP ' + code + ')');
    Utilities.sleep(wait);
    return callGA4_(propertyId, request, attempt + 1);
  }

  log_('GA4 API error (HTTP ' + code + '): ' + resp.getContentText().substring(0, 300));
  return null;
}

// ============================================================
// HELPERS
// ============================================================

function openSheet_(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}

function ga4DateToIso_(raw) {
  return raw.substring(0, 4) + '-' + raw.substring(4, 6) + '-' + raw.substring(6, 8);
}

function toIsoDate_(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, TZ, 'yyyy-MM-dd');
  return String(val).substring(0, 10);
}

function yesterday_() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function offsetDate_(isoDate, days) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().substring(0, 10);
}

function timedOut_(startMs) {
  return (Date.now() - startMs) >= MAX_EXEC_MS;
}

/**
 * Schedule a one-off trigger to run a named function after a delay.
 * Removes any existing one-off triggers for the same function first
 * to prevent duplicates if backfillAll() is re-run.
 *
 * @param {string} handlerFn     - function name to trigger (e.g. 'backfillLIQ9')
 * @param {number} delayMinutes  - minutes from now (default 5)
 */
function scheduleContinuation_(handlerFn, delayMinutes) {
  delayMinutes = delayMinutes || 5;

  // Remove existing one-off (clock) triggers for this handler to avoid duplication
  ScriptApp.getProjectTriggers()
    .filter(function(t) {
      return t.getHandlerFunction() === handlerFn
          && t.getTriggerSource() === ScriptApp.TriggerSource.CLOCK
          && t.getEventType() === ScriptApp.EventType.CLOCK;
    })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  const runAt = new Date(Date.now() + delayMinutes * 60 * 1000);
  ScriptApp.newTrigger(handlerFn)
    .timeBased()
    .at(runAt)
    .create();

  log_('✅ Scheduled ' + handlerFn + ' to run at ' + Utilities.formatDate(runAt, TZ, 'HH:mm:ss') + ' ICT (in ' + delayMinutes + ' min)');
}

function writeGA4Rows_(sheet, result) {
  if (!result || !result.rows || result.rows.length === 0) return;
  const rows = result.rows.map(function(row) {
    const dims = row.dimensionValues ? row.dimensionValues.map(function(d) { return d.value; }) : [];
    const vals = row.metricValues.map(function(v) {
      const n = parseFloat(v.value);
      return isNaN(n) ? v.value : Math.round(n * 100) / 100;
    });
    return dims.concat(vals).concat([new Date()]);
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function getExistingDates_(sheet, dateColIndex) {
  const dates = new Set();
  if (sheet.getLastRow() < 2) return dates;
  const data = sheet.getRange(2, dateColIndex + 1, sheet.getLastRow() - 1, 1).getValues();
  data.forEach(function(row) {
    if (row[0]) dates.add(toIsoDate_(row[0]));
  });
  return dates;
}

function getExistingCompositeKeys_(sheet, colIndexes) {
  const keys = new Set();
  if (sheet.getLastRow() < 2) return keys;
  const maxCol = Math.max.apply(null, colIndexes) + 1;
  const data   = sheet.getRange(2, 1, sheet.getLastRow() - 1, maxCol).getValues();
  data.forEach(function(row) {
    const key = colIndexes.map(function(i) {
      const val = row[i];
      return val instanceof Date ? toIsoDate_(val) : String(val);
    }).join('|');
    keys.add(key);
  });
  return keys;
}

function getMonthChunks_(startDate, endDate) {
  const chunks  = [];
  let current   = new Date(startDate + 'T12:00:00Z');
  const end     = new Date(endDate   + 'T12:00:00Z');

  while (current <= end) {
    const chunkEnd = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0));
    const actual   = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      start: current.toISOString().substring(0, 10),
      end:   actual.toISOString().substring(0, 10)
    });
    current = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  }
  return chunks;
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}

function sortSheetByDate_(sheet) {
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort(1);
  }
}

function formatSheet_(sheet) {
  if (sheet.getLastRow() < 1) return;
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight('bold');
  sheet.setFrozenRows(1);
  try { sheet.autoResizeColumns(1, Math.min(sheet.getLastColumn(), 10)); } catch(e) {}
}

function log_(msg) {
  Logger.log('[' + Utilities.formatDate(new Date(), TZ, 'HH:mm:ss') + '] ' + msg);
}

// ============================================================
// TRIGGER SETUP — idempotent: safe to run multiple times
// ============================================================
function createDailyTrigger() {
  const FN = 'dailyRefreshAll';
  const existing = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === FN;
  });
  if (existing.length > 0) {
    log_('Trigger already exists for ' + FN + ' — no action needed');
    return;
  }
  ScriptApp.newTrigger(FN)
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .inTimezone(TZ)
    .create();
  log_('✅ Daily trigger set: ' + FN + ' at 6 AM ICT');
}
