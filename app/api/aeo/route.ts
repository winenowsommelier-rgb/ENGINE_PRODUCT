import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Source',
};

const QUERIES = [
  "What are the best online wine shops in Thailand for delivery?",
  "Where can I buy imported wine online in Thailand?",
  "What wine delivery services are available in Bangkok?",
  "Recommend online liquor stores in Thailand with fast delivery",
  "Where to buy wine online in Thailand at good prices?",
  "What are good alcohol delivery apps in Thailand?",
  "Best places to order wine online delivered to Bangkok",
  "Which online wine shops deliver nationwide in Thailand?",
];

const OUR_BRANDS: Record<string, string[]> = {
  winenow: ["wine-now", "winenow"],
  liq9: ["liq9"],
};

const COMPETITORS = [
  "wishbeer",
  "wine connection",
  "spirit house",
  "time2drink",
  "valhalla",
  "wine plus",
  "the bottles",
  "bacchus",
  "tops",
  "villa market",
  "lotus",
  "shopee",
  "lazada",
  "grabmart",
  "lineman",
];

const SYSTEM_PROMPT =
  "You are a helpful assistant. Answer questions about wine and alcohol shopping in Thailand concisely. Give specific brand and website recommendations when you know them.";

const MODEL = "claude-haiku-4-5-20251001";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface QueryResult {
  query: string;
  mentioned: boolean;
  mentionedBrands: string[];
  snippet: string;
  fullResponse: string;
}

interface AEOResult {
  site: string;
  queriesRun: number;
  mentions: number;
  mentionRate: number;
  responses: QueryResult[];
  competitorMentions: Record<string, number>;
  topCompetitors: Array<{ brand: string; count: number }>;
  lastRun: string;
}

interface CacheEntry {
  data: AEOResult;
  timestamp: number;
}

// In-memory cache keyed by site
const cache: Record<string, CacheEntry> = {};

function detectBrands(text: string, brandTerms: string[]): boolean {
  const lower = text.toLowerCase();
  return brandTerms.some((term) => lower.includes(term.toLowerCase()));
}

function detectAllMentionedBrands(
  text: string,
  ourBrandTerms: string[]
): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  // Check our brands
  for (const term of ourBrandTerms) {
    if (lower.includes(term.toLowerCase())) {
      found.push(term);
    }
  }

  // Check competitors
  for (const competitor of COMPETITORS) {
    if (lower.includes(competitor.toLowerCase())) {
      found.push(competitor);
    }
  }

  return [...new Set(found)];
}

function countCompetitorMentions(
  responses: QueryResult[]
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const competitor of COMPETITORS) {
    counts[competitor] = 0;
  }

  for (const result of responses) {
    for (const brand of result.mentionedBrands) {
      const lower = brand.toLowerCase();
      if (COMPETITORS.includes(lower)) {
        counts[lower] = (counts[lower] ?? 0) + 1;
      }
    }
  }

  return counts;
}

async function runAEO(site: string): Promise<AEOResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const client = new Anthropic({ apiKey });
  const brandTerms = OUR_BRANDS[site] ?? [];

  const queryResults = await Promise.all(
    QUERIES.map(async (query): Promise<QueryResult> => {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: query }],
      });

      const fullResponse = message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("\n");

      const mentioned = detectBrands(fullResponse, brandTerms);
      const mentionedBrands = detectAllMentionedBrands(fullResponse, brandTerms);
      const snippet = fullResponse.slice(0, 200);

      return {
        query,
        mentioned,
        mentionedBrands,
        snippet,
        fullResponse,
      };
    })
  );

  const mentions = queryResults.filter((r) => r.mentioned).length;
  const mentionRate =
    queryResults.length > 0
      ? Math.round((mentions / queryResults.length) * 100)
      : 0;

  const competitorMentions = countCompetitorMentions(queryResults);

  const topCompetitors = Object.entries(competitorMentions)
    .map(([brand, count]) => ({ brand, count }))
    .sort((a, b) => b.count - a.count)
    .filter((entry) => entry.count > 0);

  return {
    site,
    queriesRun: queryResults.length,
    mentions,
    mentionRate,
    responses: queryResults,
    competitorMentions,
    topCompetitors,
    lastRun: new Date().toISOString(),
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const site = searchParams.get("site") ?? "winenow";
  const refresh = searchParams.get("refresh") === "true";

  if (!["winenow", "liq9"].includes(site)) {
    return NextResponse.json(
      {
        error:
          'Invalid site parameter. Must be "winenow" or "liq9".',
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not configured. Please set this environment variable to enable AEO analysis.",
      },
      { status: 503, headers: CORS_HEADERS }
    );
  }

  // Serve from cache if available and not expired, unless refresh is requested
  const cached = cache[site];
  if (!refresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
      cacheAge: Math.round((Date.now() - cached.timestamp) / 1000),
    }, { headers: CORS_HEADERS });
  }

  try {
    const result = await runAEO(site);

    cache[site] = {
      data: result,
      timestamp: Date.now(),
    };

    return NextResponse.json({ ...result, cached: false }, { headers: CORS_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `AEO analysis failed: ${message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
