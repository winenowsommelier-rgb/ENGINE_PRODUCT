import type { Metadata } from 'next';
import { ContactButtons } from '@/components/ContactButtons';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';

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
  title: 'Contact — WNLQ9',
  description:
    'Reach the WNLQ9 team on LINE, WhatsApp or Facebook — we’ll help you order.',
};

export default function ContactPage() {
  const links = buildContactLinks(getContactEnv());

  return (
    <section className="container max-w-xl py-16 sm:py-20">
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
