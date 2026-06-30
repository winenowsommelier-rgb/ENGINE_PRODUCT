import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';

// Public paths that bypass the auth gate.
// IMPORTANT: _next/data IS gated (RSC data routes that serve product JSON).
// _next/static, _next/image, favicon are exempt (needed to load the login page itself).
const PUBLIC_PREFIXES = [
  '/login',
  '/api/login',
  '/_next/static',
  '/_next/image',
  '/favicon.ico',
  '/icons/',
];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // Verify cookie
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (await verifyToken(token)) {
    const res = NextResponse.next();
    res.headers.set('Cache-Control', 'no-store');
    return res;
  }

  // Redirect to login — no-store so edge never caches the auth gate
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  const res = NextResponse.redirect(loginUrl);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  // Run on all paths EXCEPT static files explicitly excluded in middleware logic.
  // Note: _next/data/:path* is intentionally INCLUDED here (not in the matcher excludes)
  // so that unauthenticated RSC data fetches get redirected to /login.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icons/).*)',
  ],
};
