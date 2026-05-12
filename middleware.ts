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

    // Enforce token check in production, or in dev ONLY if the environment variable is actively set
    if (!isDev || expectedToken) {
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