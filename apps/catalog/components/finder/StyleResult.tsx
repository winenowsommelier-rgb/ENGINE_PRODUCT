import Link from 'next/link';
import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';
import type { StyleProfile } from '@/lib/finder/style-profiles';
import type { Answers } from '@/lib/finder/answers';
import {
  breadcrumbLinks,
  signatureChips,
  styleShopParams,
  styleShopUrl,
} from '@/lib/finder/shop-links';
import { matchesFilters } from '@/lib/shop-query';
import type { ContactLinks } from '@/lib/contact';
import type { MatchBandLabel } from '@/lib/finder/match-band';

/**
 * StyleResult — the finder pay-off, "style-profile first".
 *
 * Presentational only (server-rendered): the archetype card on top — name,
 * tagline, expert note, defining attributes, food & occasion guidance — then a
 * navigable "discovery map" (geo breadcrumb, signature chips, "see all in your
 * style" link) and the matched product grid below. When `degraded`, the grid
 * header is the honest "Closest matches in your budget" instead of "Your
 * matches" (spec §5).
 *
 * The empty-pool case (no products at all) is handled by the page, not here;
 * this component assumes it has at least one product to show under the grid.
 */
interface StyleResultProps {
  profile: StyleProfile | null;
  products: PublicProduct[];
  degraded: boolean;
  /** Decoded finder answers — drives the discovery-map links. */
  answers: Answers;
  /** Full catalog — used to resolve breadcrumb geo levels to real /shop filters. */
  allProducts: PublicProduct[];
  /**
   * Per-bottle contact deep-links keyed by sku (built server-side via
   * buildContactLinks). Threaded into each ProductCard so the Quick-look modal
   * exposes the Buy/Enquire path (LINE / WhatsApp / Messenger). There is NO cart
   * in this catalog — conversion is via these contact deep-links.
   */
  contactLinksBySku?: Record<string, ContactLinks>;
  /**
   * Honest per-bottle match band keyed by sku (spec §11.9). A banded label
   * ("Great / Strong / Good match") shown on each card — never a fabricated %.
   */
  bandBySku?: Record<string, MatchBandLabel>;
}

/** A labelled attribute row, only rendered when the value is present. */
function Attr({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col">
      <dt className="text-sm uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function StyleResult({
  profile,
  products,
  degraded,
  answers,
  allProducts,
  contactLinksBySku,
  bandBySku,
}: StyleResultProps) {
  const attrs = profile?.definingAttributes;
  const grapes = attrs?.typicalGrapes?.join(', ');
  const regions = attrs?.typicalRegions?.join(', ');

  // ── Discovery-map links (all hit the real /shop filters) ──
  // No `country` field on the profile, so the breadcrumb starts at the category
  // and (when resolvable) drills to the style's typical region.
  const breadcrumb = breadcrumbLinks(
    {
      category: answers.category,
      typicalRegion: attrs?.typicalRegions?.[0],
    },
    allProducts,
  );
  const chips = signatureChips(answers);
  const shopAllHref = styleShopUrl(answers);
  // Count with the SHOP's own predicate over the SAME params the link carries, so
  // "See all N" == the /shop grid the link lands on (not the curated result grid,
  // which is budget/geo-narrowed and would over- or under-state the destination).
  const shopAllParams = styleShopParams(answers);
  const shopAllCount = allProducts.filter((p) =>
    matchesFilters(p, shopAllParams),
  ).length;

  return (
    <div className="flex flex-col gap-10">
      {profile ? (
        <section
          aria-label="Your style profile"
          className="flex flex-col gap-5 rounded-xl border border-border bg-muted/20 p-6 sm:p-8"
        >
          <header className="flex flex-col gap-1">
            <p className="text-sm uppercase tracking-wide text-muted-foreground">
              Your style
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {profile.name}
            </h1>
            <p className="text-lg text-muted-foreground">{profile.tagline}</p>
          </header>

          <p className="max-w-2xl text-base leading-relaxed text-foreground">
            {profile.expertNote}
          </p>

          {attrs &&
          (attrs.body ||
            attrs.acidity ||
            attrs.tannin ||
            grapes ||
            regions) ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Attr label="Body" value={attrs.body} />
              <Attr label="Acidity" value={attrs.acidity} />
              <Attr label="Tannin" value={attrs.tannin} />
              <Attr label="Typical grapes" value={grapes} />
              <Attr label="Typical regions" value={regions} />
            </dl>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
                Pairs with
              </h2>
              <p className="text-base text-foreground">
                {profile.foodGuidance}
              </p>
            </div>
            {profile.occasionFit.length > 0 ? (
              <div className="flex flex-col gap-1">
                <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
                  Great for
                </h2>
                <div className="flex flex-wrap gap-2">
                  {profile.occasionFit.map((o) => (
                    <span
                      key={o}
                      className="inline-flex items-center rounded-full border border-border bg-background px-3 py-1 text-sm capitalize text-foreground"
                    >
                      {o}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Discovery map — navigable links into the real /shop catalog */}
      {breadcrumb.length > 0 || chips.length > 0 ? (
        <section
          aria-label="Explore your style"
          className="flex flex-col gap-6 rounded-xl border border-border bg-muted/10 p-6 sm:p-8"
        >
          {breadcrumb.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
                Classically found in
              </h2>
              <nav
                aria-label="Origin breadcrumb"
                className="flex flex-wrap items-center gap-x-1 gap-y-2"
              >
                {breadcrumb.map((link, i) => (
                  <span key={link.href} className="flex items-center gap-1">
                    {i > 0 ? (
                      <span aria-hidden="true" className="px-1 text-muted-foreground">
                        ›
                      </span>
                    ) : null}
                    <Link
                      href={link.href}
                      className="inline-flex min-h-[44px] items-center rounded-md px-1 text-base text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {link.label}
                    </Link>
                  </span>
                ))}
              </nav>
            </div>
          ) : null}

          {chips.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm uppercase tracking-wide text-muted-foreground">
                Browse by your style
              </h2>
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <Link
                    key={chip.href}
                    href={chip.href}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-background px-4 text-sm text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {chip.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <Link
              href={shopAllHref}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-background px-6 text-base font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {shopAllCount > 0
                ? `See all ${shopAllCount} in your style ↗`
                : 'See all in your style ↗'}
            </Link>
          </div>
        </section>
      ) : null}

      <section aria-label="Matched products" className="flex flex-col gap-5">
        <h2 className="text-xl font-medium text-foreground sm:text-2xl">
          {degraded ? 'Closest matches in your budget' : 'Your matches'}
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
          {products.map((product) => {
            const band = bandBySku?.[product.sku];
            return (
              <div key={product.sku} className="flex flex-col gap-2">
                {band ? (
                  <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {band}
                  </span>
                ) : null}
                <ProductCard
                  product={product}
                  contactLinks={contactLinksBySku?.[product.sku]}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
