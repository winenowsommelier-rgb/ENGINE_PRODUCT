import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS middleware — allows browser-based clients (Claude artifacts, external
 * dashboards) to call our API endpoints directly via fetch().
 *
 * Only applies to /api/* routes. Page routes are unaffected.
 */
export function middleware(req: NextRequest) {
  // Only handle API routes
  if (!req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(req),
    });
  }

  // Add CORS headers to actual response
  const res = NextResponse.next();
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    res.headers.set(key, value);
  }
  return res;
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Source',
    'Access-Control-Max-Age': '86400',
  };
}

export const config = {
  matcher: '/api/:path*',
};
