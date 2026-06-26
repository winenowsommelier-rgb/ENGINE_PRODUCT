import type { Metadata } from 'next';
import { ContactButtons } from '@/components/ContactButtons';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildLocalBusiness } from '@/lib/seo/jsonld';

/**
 * Contact — a clean, static Maison contact page (server component, SSG).
 *
 * We only surface the messaging channels we actually have (LINE / WhatsApp /
 * Facebook Messenger). We deliberately DON'T invent phone numbers or addresses.
 *
 * Links are computed SERVER-SIDE (getContactEnv → buildContactLinks); the
 * stacked <ContactButtons> reads well in this single narrow column. Any channel
 * whose handle isn't configured is omitted gracefully — never a broken link.
 */

export const metadata: Metadata = {
  title: 'Order Wine & Spirits — Contact WNLQ9, Bangkok',
  description: 'Reach the WNLQ9 team on LINE, WhatsApp or Facebook to order wine, whisky and spirits in Bangkok, Thailand.',
  alternates: { canonical: 'https://wnlq9-catalog.vercel.app/contact' },
  openGraph: {
    title: 'Contact WNLQ9 — Wine & Spirits, Bangkok',
    locale: 'en_TH',
    siteName: 'WNLQ9',
  },
};

export default function ContactPage() {
  const links = buildContactLinks(getContactEnv());

  return (
    <section className="container max-w-xl py-16 sm:py-20">
      <JsonLd data={buildLocalBusiness()} />
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        Contact us
      </h1>

      <p className="mt-8 text-lg leading-relaxed text-muted-foreground">
        Reach us on LINE, WhatsApp, or Facebook — we&apos;ll help you order,
        check availability, or point you toward the right bottle.
      </p>

      <div className="mt-10">
        <ContactButtons links={links} variant="stacked" />
      </div>
    </section>
  );
}
