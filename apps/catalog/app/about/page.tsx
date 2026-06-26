import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactButtons } from '@/components/ContactButtons';
import { buildContactLinks } from '@/lib/contact';
import { getContactEnv } from '@/lib/contact-env';

/**
 * About — a calm, static Maison page introducing WNLQ9 (server component, SSG).
 *
 * Short, warm copy: a considered selection of wine, whisky and spirits, browsed
 * at the shopper's own pace, ordered by reaching out (no online payment yet —
 * the contact-to-order model). Generous whitespace, 18px base type.
 *
 * Contact links are computed SERVER-SIDE (getContactEnv → buildContactLinks)
 * and the resulting strings handed to the client <ContactButtons>; any channel
 * whose handle isn't configured is simply omitted, never broken.
 */

export const metadata: Metadata = {
  title: 'About WNLQ9 — Curated Wine & Spirits, Bangkok',
  description: 'WNLQ9 is a curated selection of wine, whisky and spirits in Bangkok, Thailand. Browse and order via LINE or WhatsApp.',
  alternates: { canonical: 'https://wnlq9-catalog.vercel.app/about' },
  openGraph: {
    title: 'About WNLQ9 — Curated Wine & Spirits, Bangkok',
    locale: 'en_TH',
    siteName: 'WNLQ9',
  },
};

export default function AboutPage() {
  const links = buildContactLinks(getContactEnv());

  return (
    <section className="container max-w-2xl py-16 sm:py-20">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
        About WNLQ9
      </h1>

      <div className="mt-8 flex flex-col gap-6 text-lg leading-relaxed text-muted-foreground">
        <p>
          WNLQ9 is a considered selection of wine, whisky and spirits — chosen
          with care, presented simply. We&apos;d rather offer a thoughtful
          collection than an endless one, so every bottle here has earned its
          place.
        </p>
        <p>
          Browse at your own pace. When something speaks to you, reach out and
          our team will help you order. We don&apos;t take payment online yet —
          it&apos;s a contact-to-order model, which means a real person on the
          other end to answer questions, confirm availability and arrange the
          details.
        </p>
        <p>
          Whether you know exactly what you&apos;re after or would welcome a
          recommendation, we&apos;re glad to help.
        </p>
      </div>

      <div className="mt-10">
        <Link
          href="/shop"
          className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Browse the collection
        </Link>
      </div>

      <div className="mt-14 border-t border-border pt-10">
        <h2 className="text-lg font-medium text-foreground">
          Have a question? Talk to us.
        </h2>
        <div className="mt-4">
          <ContactButtons links={links} variant="inline" />
        </div>
      </div>
    </section>
  );
}
