'use client';

import Script from 'next/script';

/**
 * Injects the GA4 gtag.js snippet into every page.
 *
 * Mount once in RootLayout alongside <Analytics /> and <SpeedInsights />.
 * The measurement ID comes from NEXT_PUBLIC_GA_ID — different value per
 * Vercel project (B2C vs B2B). When the env var is absent, this renders
 * nothing (safe for local dev and preview builds without GA).
 */
export function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  if (!gaId) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${gaId}', { send_page_view: true });
        `}
      </Script>
    </>
  );
}
