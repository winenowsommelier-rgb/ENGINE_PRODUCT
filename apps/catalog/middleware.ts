// apps/catalog/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// GROUP_SLUG values — kept inline to avoid importing from lib/ in edge runtime
const GROUP_SLUGS: Record<string, string> = {
  'wine': 'Wine',
  'whisky': 'Whisky',
  'spirits': 'Spirits',
  'sake--asian': 'Sake & Asian',
  'liqueur': 'Liqueur',
  'beer--rtd': 'Beer & RTD',
  'non-alcoholic': 'Non-Alcoholic',
  'cigars': 'Cigars',
  'events': 'Events',
  'accessories': 'Accessories',
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // /shop/[group] → /shop?group=X for browser users
  // Bots see the static page with JSON-LD; browsers get the interactive shop.
  const match = pathname.match(/^\/shop\/([^/]+)$/);
  if (match) {
    const slug = match[1];
    const groupName = GROUP_SLUGS[slug];
    if (groupName) {
      const ua = request.headers.get('user-agent') ?? '';
      const isBot = /bot|crawler|spider|facebookexternalhit|Twitterbot|LinkedInBot/i.test(ua);
      if (!isBot) {
        const url = request.nextUrl.clone();
        url.pathname = '/shop';
        url.searchParams.set('group', groupName);
        return NextResponse.redirect(url, { status: 302 });
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/shop/:group*'],
};
