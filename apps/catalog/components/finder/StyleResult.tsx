import { ProductCard } from '@/components/ProductCard';
import type { PublicProduct } from '@/lib/types';
import type { StyleProfile } from '@/lib/finder/style-profiles';

/**
 * StyleResult — the finder pay-off, "style-profile first".
 *
 * Presentational only (server-rendered): the archetype card on top — name,
 * tagline, expert note, defining attributes, food & occasion guidance — then the
 * matched product grid below. When `degraded`, the grid header is the honest
 * "Closest matches in your budget" instead of "Your matches" (spec §5).
 *
 * The empty-pool case (no products at all) is handled by the page, not here;
 * this component assumes it has at least one product to show under the grid.
 */
interface StyleResultProps {
  profile: StyleProfile | null;
  products: PublicProduct[];
  degraded: boolean;
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

export function StyleResult({ profile, products, degraded }: StyleResultProps) {
  const attrs = profile?.definingAttributes;
  const grapes = attrs?.typicalGrapes?.join(', ');
  const regions = attrs?.typicalRegions?.join(', ');

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

      <section aria-label="Matched products" className="flex flex-col gap-5">
        <h2 className="text-xl font-medium text-foreground sm:text-2xl">
          {degraded ? 'Closest matches in your budget' : 'Your matches'}
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.sku} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
