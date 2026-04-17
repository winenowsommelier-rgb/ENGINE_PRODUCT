import { NextResponse } from 'next/server';
import { google } from 'googleapis';

// ─── Auth helper ──────────────────────────────────────────────────────────────
function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw === 'PASTE_YOUR_SERVICE_ACCOUNT_JSON_HERE') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured in .env.local');
  }
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── GA4 runReport helper ─────────────────────────────────────────────────────
async function runReport(
  propertyId: string,
  authClient: Awaited<ReturnType<typeof google.auth.GoogleAuth.prototype.getClient>>,
  body: object
) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${(authClient as { getAccessToken: () => Promise<{ token: string }> }).getAccessToken().then(t => t.token)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  return res.json();
}

const GA4_PROPERTY_MAP: Record<string, string> = {
  winenow: '377750759',   // Primary GA4 property — has full Enhanced E-commerce events
  liq9:    '377924618',
  // winenow_secondary: '386954192', // secondary property — basic events only, no e-commerce
};

// ─── GET /api/ga4 ─────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteParam = searchParams.get('site');

  const propertyId = (siteParam && GA4_PROPERTY_MAP[siteParam])
    ?? process.env.GA4_PROPERTY_ID;

  if (!propertyId || propertyId === 'YOUR_PROPERTY_ID') {
    return NextResponse.json(
      { error: 'GA4_PROPERTY_ID is not configured in .env.local' },
      { status: 500 }
    );
  }

  const days = parseInt(searchParams.get('days') ?? '90', 10);
  const startDate = daysAgo(days);

  try {
    const auth = getAuth();
    const token = await auth.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const base = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

    // Fire all reports in parallel
    const [overviewRes, sourcesRes, topPagesRes, dailyRes, conversionsRes] = await Promise.all([
      // Overall totals
      fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate: 'today' }],
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
            { name: 'screenPageViews' },
          ],
        }),
      }).then(r => r.json()),

      // Traffic by channel
      fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        }),
      }).then(r => r.json()),

      // Top pages
      fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'screenPageViews' },
            { name: 'sessions' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
          limit: 10,
        }),
      }).then(r => r.json()),

      // Daily trend
      fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 90,
        }),
      }).then(r => r.json()),

      // Conversion & engagement events — tracks both e-commerce events
      // (purchase, add_to_cart, begin_checkout, view_item) and fallback
      // engagement signals (form_submit, view_search_results, click, scroll)
      // for sites that haven't yet configured full e-commerce tracking.
      fetch(base, {
        method: 'POST', headers,
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate: 'today' }],
          dimensions: [{ name: 'eventName' }],
          metrics: [
            { name: 'eventCount' },
            { name: 'eventCountPerUser' },
          ],
          dimensionFilter: {
            filter: {
              fieldName: 'eventName',
              inListFilter: {
                values: [
                  // E-commerce (GA4 Enhanced Ecommerce)
                  'purchase', 'add_to_cart', 'begin_checkout', 'view_item',
                  'remove_from_cart', 'view_cart', 'add_payment_info', 'add_shipping_info',
                  // Lead / contact
                  'generate_lead', 'form_submit', 'form_start', 'contact',
                  // Engagement signals
                  'view_search_results', 'search', 'click', 'scroll',
                  // Custom Magento events (common)
                  'wishlist_add', 'checkout', 'order_complete',
                ]
              }
            }
          },
          orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
          limit: 20,
        }),
      }).then(r => r.json()),
    ]);

    // Parse overview
    const overviewRow = overviewRes?.rows?.[0];
    const totalSessions = parseInt(overviewRow?.metricValues?.[0]?.value ?? '0', 10);
    const totals = {
      sessions: totalSessions,
      users: parseInt(overviewRow?.metricValues?.[1]?.value ?? '0', 10),
      bounceRate: parseFloat(
        (parseFloat(overviewRow?.metricValues?.[2]?.value ?? '0') * 100).toFixed(1)
      ),
      avgSessionDuration: parseInt(
        parseFloat(overviewRow?.metricValues?.[3]?.value ?? '0').toFixed(0),
        10
      ),
      pageViews: parseInt(overviewRow?.metricValues?.[4]?.value ?? '0', 10),
    };

    // Parse sources
    const safeTotal = totalSessions || 1;
    const sources = (sourcesRes?.rows ?? []).map((r: { dimensionValues: Array<{value: string}>; metricValues: Array<{value: string}> }) => ({
      channel: r.dimensionValues?.[0]?.value ?? 'Unknown',
      sessions: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      share: parseFloat(
        ((parseInt(r.metricValues?.[0]?.value ?? '0', 10) / safeTotal) * 100).toFixed(1)
      ),
    }));

    // Parse top pages
    const topPages = (topPagesRes?.rows ?? []).map((r: { dimensionValues: Array<{value: string}>; metricValues: Array<{value: string}> }) => ({
      page: r.dimensionValues?.[0]?.value ?? '/',
      pageViews: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      sessions: parseInt(r.metricValues?.[1]?.value ?? '0', 10),
      bounceRate: parseFloat(
        (parseFloat(r.metricValues?.[2]?.value ?? '0') * 100).toFixed(1)
      ),
      avgDuration: parseInt(parseFloat(r.metricValues?.[3]?.value ?? '0').toFixed(0), 10),
    }));

    // Parse daily trend
    const daily = (dailyRes?.rows ?? []).map((r: { dimensionValues: Array<{value: string}>; metricValues: Array<{value: string}> }) => {
      const raw = r.dimensionValues?.[0]?.value ?? '';
      return {
        date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
        sessions: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
        users: parseInt(r.metricValues?.[1]?.value ?? '0', 10),
      };
    });

    // Parse conversion events
    const conversions = (conversionsRes?.rows ?? []).map((r: { dimensionValues: Array<{value: string}>; metricValues: Array<{value: string}> }) => ({
      event: r.dimensionValues?.[0]?.value ?? 'unknown',
      count: parseInt(r.metricValues?.[0]?.value ?? '0', 10),
      perUser: parseFloat(parseFloat(r.metricValues?.[1]?.value ?? '0').toFixed(2)),
    }));

    // Flag whether GA4 Enhanced E-commerce is configured on this property.
    // If none of the core purchase events fire, Magento GTM needs to be set up.
    const ecommerceEvents = ['purchase', 'add_to_cart', 'begin_checkout', 'view_item', 'view_cart'];
    const ecommerceConfigured = conversions.some((c: { event: string }) => ecommerceEvents.includes(c.event));

    return NextResponse.json({
      propertyId,
      period: { startDate, endDate: 'today', days },
      totals,
      sources,
      topPages,
      daily,
      conversions,
      ecommerceConfigured,
      // Action required message when e-commerce is not set up
      ecommerceNote: ecommerceConfigured
        ? null
        : 'GA4 Enhanced E-commerce events (purchase, add_to_cart, begin_checkout) are not firing. Configure Google Tag Manager with Magento purchase events to track revenue and conversion rate.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
