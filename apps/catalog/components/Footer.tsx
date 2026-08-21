import Link from 'next/link';
import { CATEGORY_GROUPS } from '@/lib/category-groups';
import { getContactEnv } from '@/lib/contact-env';
import { buildContactLinks } from '@/lib/contact';

/**
 * Global site footer — Maison minimal style.
 *
 * - WNLQ9 wordmark + short tagline.
 * - Shop column: one link per shopper-facing category group, linking to
 *   /shop?group=<Group>. Sourced from CATEGORY_GROUPS so it stays in sync with
 *   the catalog's grouping logic (single source of truth).
 * - Info column: About / Contact.
 * - Contact channels: LINE is a real deep-link (lib/contact.ts). WhatsApp is
 *   temporarily disabled site-wide (may return later). Facebook is
 *   intentionally hidden for now; any channel with no handle configured
 *   omits gracefully.
 *
 * Server component — no interactivity. Links are >=44px tall tap targets.
 */

const INFO_LINKS = [
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/blog', label: 'Journal' },
  { href: '/catalogs', label: 'Catalogs' },
  { href: 'https://b2b.wnlq9.shop', label: 'WNLQ9 B2B', external: true },
] as const;

export function Footer() {
  const links = buildContactLinks(getContactEnv());
  // WhatsApp is temporarily disabled site-wide — omitted here rather than
  // deleted from ContactLinks/lib/contact.ts, so re-enabling is a one-line add back.
  const CONTACT_CHANNELS = [
    { label: 'LINE', aria: 'Contact us on LINE', href: links.line },
  ].filter((c) => c.href !== '');

  return (
    <footer className="mt-24 border-t border-border bg-background">
      <div className="container py-12">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          {/* Brand + tagline */}
          <div className="md:col-span-2">
            <Link
              href="/"
              className="inline-flex h-11 items-center text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary"
              aria-label="WNLQ9 home"
            >
              WNLQ9
            </Link>
            <p className="mt-3 max-w-sm text-base text-muted-foreground">
              A considered selection of wine, whisky and spirits. Browse the
              collection, then reach out — we&apos;ll help you order.
            </p>
          </div>

          {/* Shop column — 2-col grid so 10 categories stay short, not a tall stack */}
          <nav aria-label="Shop categories">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Shop
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-6">
              {CATEGORY_GROUPS.map((group) => (
                <li key={group}>
                  <Link
                    href={`/shop?group=${encodeURIComponent(group)}`}
                    className="flex min-h-11 items-center text-base text-muted-foreground transition-colors hover:text-primary"
                  >
                    {group}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Info column */}
          <nav aria-label="Information">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              Info
            </h2>
            <ul className="mt-4 flex flex-col">
              {INFO_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    {...('external' in link && link.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    className="flex min-h-11 items-center text-base text-muted-foreground transition-colors hover:text-primary"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom row: contact channels + copyright */}
        <div className="mt-12 flex flex-col gap-6 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap items-center gap-6">
            {CONTACT_CHANNELS.map((channel) => (
              <li key={channel.label}>
                <a
                  href={channel.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={channel.aria}
                  className="flex min-h-11 items-center text-base text-muted-foreground transition-colors hover:text-primary"
                >
                  {channel.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} WNLQ9
          </p>
        </div>
      </div>
    </footer>
  );
}
