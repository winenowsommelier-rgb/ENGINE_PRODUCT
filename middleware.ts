import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith('/api/');

  if (isApiRoute) {
    // Intercept OPTIONS preflight requests immediately
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Source',
        },
      });
    }

    const expectedToken = process.env.PIM_API_TOKEN;
    const isDev = process.env.NODE_ENV === 'development';

    // Same-origin browser requests (from the local dashboard UI) are always allowed —
    // they have no way to include a server-side token. Only gate external API consumers.
    const origin = request.headers.get('origin') ?? '';
    const referer = request.headers.get('referer') ?? '';
    const host = request.headers.get('host') ?? '';
    const isSameOrigin =
      origin.includes(host) ||
      referer.includes(host) ||
      (!origin && !referer); // server-side Next.js fetch (RSC / API → API)

    // Enforce token check only for cross-origin requests (external API consumers),
    // or in production when there is no same-origin signal.
    if (!isDev && !isSameOrigin) {
      const authHeader = request.headers.get('authorization');

      if (!expectedToken) {
        return NextResponse.json(
          { error: 'Server configuration error: PIM_API_TOKEN is missing.' },
          {
            status: 500,
            headers: { 'Access-Control-Allow-Origin': '*' }
          }
        );
      }

      if (authHeader !== `Bearer ${expectedToken}`) {
        return NextResponse.json(
          { error: 'Unauthorized. Please provide a valid Bearer token.' },
          {
            status: 401,
            headers: { 'Access-Control-Allow-Origin': '*' }
          }
        );
      }
    } else if (!isDev && isSameOrigin) {
      // Production same-origin: still allow, no token needed from internal UI
    } else if (isDev && expectedToken && !isSameOrigin) {
      // Dev + token set + cross-origin: enforce token for external callers
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${expectedToken}`) {
        return NextResponse.json(
          { error: 'Unauthorized. Please provide a valid Bearer token.' },
          {
            status: 401,
            headers: { 'Access-Control-Allow-Origin': '*' }
          }
        );
      }
    }
  }

  // Proceed with the request and attach CORS headers to the response
  const response = NextResponse.next();
  
  if (isApiRoute) {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Source');
  }

  return response;
}

export const config = {
  matcher: '/api/:path*',
};