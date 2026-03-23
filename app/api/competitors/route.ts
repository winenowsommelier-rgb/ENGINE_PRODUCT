import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ThreatLevel = 'high' | 'medium' | 'low';
type Tier = 1 | 2 | 3 | 4;
type SiteParam = 'winenow' | 'liq9';

interface CompetitorMeta {
  id: string;
  name: string;
  url: string;
  tier: Tier;
  focus: string;
}

interface CompetitorResult extends CompetitorMeta {
  threatLevel: ThreatLevel;
  contentGaps: string[];
  opportunities: string[];
}

interface ApiResponse {
  site: SiteParam;
  competitors: CompetitorResult[];
  tierSummary: {
    tier1: number;
    tier2: number;
    tier3: number;
    tier4: number;
  };
  keyInsights: string[];
  lastUpdated: string;
  note?: string;
}

interface ClaudeCompetitorAnalysis {
  id: string;
  contentGaps: string[];
  opportunities: string[];
}

interface ClaudeResponse {
  competitors: ClaudeCompetitorAnalysis[];
  keyInsights: string[];
}

// ---------------------------------------------------------------------------
// Competitor list (hardcoded)
// ---------------------------------------------------------------------------

const COMPETITORS: CompetitorMeta[] = [
  { id: 'wishbeer',       name: 'Wishbeer',         url: 'wishbeer.com',         tier: 1, focus: 'Craft beer + wine, broadest inventory, 10k+ SKUs' },
  { id: 'wineconnection', name: 'Wine Connection',  url: 'wineconnection.co.th', tier: 1, focus: 'Premium wine specialist, SE Asia chain, 300+ exclusive labels' },
  { id: 'spirithouse',    name: 'Spirit House',     url: 'spirithouse.com',      tier: 1, focus: 'Premium wine + whisky, same-day delivery' },
  { id: 'time2drink',     name: 'TIME2DRINK',       url: 'time2drink.co',        tier: 1, focus: 'Imported beer, spirits, wine, flat delivery fee' },
  { id: 'valhalla',       name: 'Valhalla',         url: 'valhalla.co.th',       tier: 1, focus: 'Craft beer + wine + liquor, under 3hr Bangkok delivery' },
  { id: 'wineplus',       name: 'Wine Plus',        url: 'wineplus.co.th',       tier: 1, focus: '300+ wines, free delivery on 6+ bottles' },
  { id: 'thebottles',     name: 'The Bottles BKK',  url: 'thebottlesbkk.com',   tier: 1, focus: 'Wine + spirits + beer megastore, free delivery over THB 2,999' },
  { id: 'bacchus',        name: 'Bacchus Online',   url: 'bacchusonline.net',    tier: 1, focus: 'Wine by varietal/region + sake + Japanese whisky' },
  { id: 'tops',           name: 'Tops Online',      url: 'tops.co.th',           tier: 2, focus: 'Supermarket chain, massive inventory, same-day delivery' },
  { id: 'villamarket',    name: 'Villa Market',     url: 'shop.villamarket.com', tier: 2, focus: 'Premium expat supermarket, strong imported wine' },
  { id: 'grabmart',       name: 'GrabMart',         url: 'grab.com/th',          tier: 3, focus: 'On-demand delivery aggregator, 50% market share' },
  { id: 'lineman',        name: 'LINE MAN',         url: 'linemanwongnai.com',   tier: 3, focus: 'Thailand super-app, food + grocery + alcohol delivery' },
  { id: 'shopee',         name: 'Shopee Thailand',  url: 'shopee.co.th',         tier: 4, focus: 'Top e-commerce marketplace, third-party alcohol sellers' },
  { id: 'lazada',         name: 'Lazada Thailand',  url: 'lazada.co.th',         tier: 4, focus: 'Major marketplace, third-party alcohol merchants' },
];

// ---------------------------------------------------------------------------
// Threat level mapping
// ---------------------------------------------------------------------------

function threatLevel(tier: Tier): ThreatLevel {
  if (tier === 1) return 'high';
  if (tier === 2) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Module-level cache (24-hour TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: ApiResponse;
  expiresAt: number;
}

const cache: Record<SiteParam, CacheEntry | null> = {
  winenow: null,
  liq9: null,
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Claude analysis
// ---------------------------------------------------------------------------

async function fetchClaudeAnalysis(site: SiteParam): Promise<ClaudeResponse | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const siteContext =
    site === 'winenow'
      ? 'Wine-Now (th.wine-now.com) — a Thai e-commerce site specialising in wine (red, white, rosé, sparkling, natural). Its primary audience is wine enthusiasts, expats, and gift-buyers in Thailand.'
      : 'LIQ9 (th.liq9.com) — a Thai e-commerce site specialising in liquor and spirits (whisky, rum, gin, vodka, tequila, sake, craft spirits). Its primary audience is spirits collectors, cocktail enthusiasts, and B2B buyers in Thailand.';

  const competitorList = COMPETITORS.map(
    (c) => `- id: ${c.id} | name: ${c.name} | url: ${c.url} | tier: ${c.tier} | focus: ${c.focus}`,
  ).join('\n');

  const prompt = `You are a senior SEO and digital-marketing strategist specialising in Thai e-commerce.

The client site is: ${siteContext}

Below is a list of competitors in the Thai wine/liquor online-retail market, identified by id, name, URL, competitive tier, and known focus:

${competitorList}

Your task: Return a JSON object (no markdown, no commentary, raw JSON only) with this exact shape:

{
  "competitors": [
    {
      "id": "<same id as above>",
      "contentGaps": ["<topic 1>", "<topic 2>", "<topic 3>", "<topic 4>", "<topic 5>"],
      "opportunities": ["<opportunity 1>", "<opportunity 2>", "<opportunity 3>"]
    }
    // one entry per competitor, all 14 competitors
  ],
  "keyInsights": [
    "<strategic insight 1>",
    "<strategic insight 2>",
    "<strategic insight 3>",
    "<strategic insight 4>",
    "<strategic insight 5>"
  ]
}

Rules:
- contentGaps: 3-5 content topics this competitor likely targets that our client site should also cover or outrank on. Be specific to Thai market and the client's product focus.
- opportunities: 2-3 concrete ways our client can differentiate from or exploit a weakness in this specific competitor. Be actionable.
- keyInsights: 3-5 high-level strategic insights about the overall competitive landscape relevant to the client site.
- All text must be in English.
- Return ONLY valid JSON. No markdown fences, no commentary before or after.`;

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return null;

  const raw = textBlock.text.trim();
  const parsed: ClaudeResponse = JSON.parse(raw);
  return parsed;
}

// ---------------------------------------------------------------------------
// Build response
// ---------------------------------------------------------------------------

async function buildResponse(site: SiteParam): Promise<ApiResponse> {
  const tierSummary = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 };
  for (const c of COMPETITORS) {
    (tierSummary as Record<string, number>)[`tier${c.tier}`]++;
  }

  // Base competitors with threat level, empty arrays as fallback
  const baseCompetitors: CompetitorResult[] = COMPETITORS.map((c) => ({
    ...c,
    threatLevel: threatLevel(c.tier),
    contentGaps: [],
    opportunities: [],
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      site,
      competitors: baseCompetitors,
      tierSummary,
      keyInsights: [],
      lastUpdated: new Date().toISOString(),
      note: 'ANTHROPIC_API_KEY is not set. Returning competitor list with threat levels only; contentGaps, opportunities, and keyInsights are unavailable.',
    };
  }

  let claudeData: ClaudeResponse | null = null;
  try {
    claudeData = await fetchClaudeAnalysis(site);
  } catch (err) {
    console.error('[competitors] Claude API error:', err);
  }

  if (!claudeData) {
    return {
      site,
      competitors: baseCompetitors,
      tierSummary,
      keyInsights: [],
      lastUpdated: new Date().toISOString(),
      note: 'Claude analysis failed. Returning competitor list with threat levels only.',
    };
  }

  // Merge Claude data into competitor list
  const claudeMap = new Map<string, ClaudeCompetitorAnalysis>(
    claudeData.competitors.map((c) => [c.id, c]),
  );

  const enrichedCompetitors: CompetitorResult[] = COMPETITORS.map((c) => {
    const analysis = claudeMap.get(c.id);
    return {
      ...c,
      threatLevel: threatLevel(c.tier),
      contentGaps: analysis?.contentGaps ?? [],
      opportunities: analysis?.opportunities ?? [],
    };
  });

  return {
    site,
    competitors: enrichedCompetitors,
    tierSummary,
    keyInsights: claudeData.keyInsights,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const siteParam = searchParams.get('site');

  const site: SiteParam =
    siteParam === 'liq9' ? 'liq9' : 'winenow'; // default to winenow

  // Check cache
  const cached = cache[site];
  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json(cached.data);
  }

  try {
    const data = await buildResponse(site);

    // Store in cache
    cache[site] = {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return NextResponse.json(data);
  } catch (err) {
    console.error('[competitors] Unhandled error:', err);
    return NextResponse.json(
      { error: 'Failed to build competitor intelligence data.' },
      { status: 500 },
    );
  }
}
