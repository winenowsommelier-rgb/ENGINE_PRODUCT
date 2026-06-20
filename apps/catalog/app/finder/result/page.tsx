import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TrustBar } from '@/components/TrustBar';
import { StyleResult } from '@/components/finder/StyleResult';
import { getAllProducts } from '@/lib/catalog-data';
import { decodeAnswers, encodeAnswers } from '@/lib/finder/answers';
import { scoreProducts } from '@/lib/finder/scoring';
import { resolveProfile } from '@/lib/finder/style-profiles';
import { cn } from '@/lib/utils';

/**
 * Finder result — the pay-off page.
 *
 * Server component: decode the answers from the URL, run the pure scoring engine
 * over the full catalog, resolve the style archetype, and hand plain data to the
 * presentational <StyleResult>. URL state is authoritative, so this page is
 * shareable and refresh-safe.
 *
 * Empty pool (rare — nothing in this budget/stock/category) renders an honest
 * "no matches, widen your budget" message instead of an empty grid (spec §5).
 */

type SearchParams = Record<string, string | string[] | undefined>;

function toSearchParams(sp: SearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === 'string' && val !== '') out.set(k, val);
  }
  return out;
}

const linkBtn =
  'inline-flex min-h-[44px] items-center rounded-md border border-border bg-background px-6 text-base font-medium text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function FinderResultPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = toSearchParams(searchParams);
  const answers = decodeAnswers(sp);

  // Guard: no valid category → start over.
  if (!answers.category) redirect('/finder');

  const allProducts = getAllProducts();
  const { products, degraded } = scoreProducts(answers, allProducts);
  const profile = resolveProfile(answers);
  const query = encodeAnswers(answers);

  return (
    <>
      <TrustBar />
      <main className="container flex flex-col gap-10 py-8">
        {products.length === 0 ? (
          <section className="flex max-w-2xl flex-col gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              No matches in this budget
            </h1>
            <p className="text-lg text-muted-foreground">
              We couldn&rsquo;t find anything in stock that fits these answers.
              Try widening your budget or adjusting a preference.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link href={`/finder/2?${query}`} className={linkBtn}>
                Refine answers
              </Link>
              <Link href="/finder" className={linkBtn}>
                Start over
              </Link>
            </div>
          </section>
        ) : (
          <>
            <StyleResult
              profile={profile}
              products={products}
              degraded={degraded}
              answers={answers}
              allProducts={allProducts}
            />

            <div className="flex flex-wrap gap-3 border-t border-border pt-6">
              <Link href={`/finder/1?${query}`} className={linkBtn}>
                Refine answers
              </Link>
              <Link
                href="/finder"
                className={cn(linkBtn, 'border-transparent text-muted-foreground hover:text-foreground')}
              >
                Start over
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}
