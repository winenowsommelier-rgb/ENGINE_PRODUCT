import Link from 'next/link';
import { TrustBar } from '@/components/TrustBar';
import { cn } from '@/lib/utils';
import type { FinderCategory } from '@/lib/finder/answers';
import { NOVICE_MOMENTS, suggestCategory } from '@/lib/finder/suggest-category';

/**
 * Product Finder — intro + Step 1 (category).
 *
 * Server component. Step 1 sets ONLY `category`; selecting a card links to
 * `/finder/2?cat=<category>` (step "1" inside [step] is the first config step,
 * occasion — so the category grid hands off to step 2 with the budget/taste
 * flow… wait: per spec the [step] route is 1-based over the config steps, where
 * step "1" = occasion. Step 1 here = category selection, which is NOT in the
 * config list, so we navigate to `/finder/1?cat=...`).
 *
 * Routing note (judgment call): the spec says "Selecting one navigates to
 * /finder/2?cat=<category>" in one line and "step '1' = first config step =
 * occasion" in another. Those conflict. The [step] page is 1-based over the
 * CONFIG steps (occasion = "1"), so the first question after category must be
 * `/finder/1`. We follow the [step] contract (occasion = step 1) and link the
 * category cards to `/finder/1?cat=<category>` so no config step is skipped.
 */

const CATEGORIES: Array<{
  id: FinderCategory;
  label: string;
  icon: string;
  blurb: string;
}> = [
  { id: 'red', label: 'Red Wine', icon: '🍷', blurb: 'From bright & elegant to bold & structured' },
  { id: 'white', label: 'White Wine', icon: '🥂', blurb: 'Crisp and zesty through rich and textured' },
  { id: 'sparkling', label: 'Sparkling & Champagne', icon: '🍾', blurb: 'Festive fizz to fine traditional method' },
  { id: 'whisky', label: 'Whisky', icon: '🥃', blurb: 'Scotch, Japanese, bourbon, Irish & world' },
  { id: 'gin', label: 'Gin', icon: '🍸', blurb: 'Classic London Dry to contemporary botanical' },
  { id: 'spirits', label: 'Other Spirits', icon: '✨', blurb: 'Vodka, rum, tequila, brandy & more' },
  { id: 'sake', label: 'Sake & Asian', icon: '🍶', blurb: 'Crisp and dry through fragrant and fruity' },
];

export default function FinderIntroPage() {
  return (
    <>
      <TrustBar />

      <main className="container flex flex-col gap-8 py-8">
        <header className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Find your bottle
          </h1>
          <p className="text-lg text-muted-foreground">
            Answer a few quick questions and we&rsquo;ll match you to a style —
            then show the bottles in our cellar that fit it. No jargon, no wrong
            answers.
          </p>
        </header>

        <section aria-label="Choose a category" className="flex flex-col gap-4">
          <h2 className="text-xl font-medium text-foreground">
            What are you in the mood for?
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/finder/1?cat=${cat.id}`}
                className={cn(
                  'flex min-h-[88px] flex-col justify-center gap-1 rounded-lg border border-border bg-background px-5 py-4 transition-all',
                  'hover:-translate-y-0.5 hover:border-primary hover:shadow-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <span className="text-lg font-medium text-foreground">
                  <span aria-hidden="true" className="mr-2">
                    {cat.icon}
                  </span>
                  {cat.label}
                </span>
                <span className="text-sm text-muted-foreground">
                  {cat.blurb}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Cross-category novice entry (Task 11). For the first-timer who doesn't
            know which category they want: pick a plain MOMENT and we route into a
            sensible category journey via suggestCategory (pure helper). A native
            <details> disclosure keeps it tiny — no extra client JS, no cart. */}
        <section aria-label="Not sure what you want">
          <details className="group rounded-lg border border-border bg-muted/20 p-5">
            <summary
              className={cn(
                'flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2',
                'text-lg font-medium text-foreground marker:content-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span>Not sure what you want? Help me choose</span>
              <span
                aria-hidden="true"
                className="text-muted-foreground transition-transform group-open:rotate-180"
              >
                ⌄
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Tell us the moment — we&rsquo;ll point you at a good place to
                start.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {NOVICE_MOMENTS.map((moment) => {
                  const cat = suggestCategory(moment.token);
                  // Defensive: only render a moment that resolves to a real
                  // category (it always should — the test asserts it).
                  if (!cat) return null;
                  return (
                    <Link
                      key={moment.token}
                      href={`/finder/1?cat=${cat}`}
                      className={cn(
                        'flex min-h-[72px] items-center gap-3 rounded-lg border border-border bg-background px-5 py-4 transition-all',
                        'hover:-translate-y-0.5 hover:border-primary hover:shadow-sm',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      )}
                    >
                      <span aria-hidden="true" className="text-2xl">
                        {moment.icon}
                      </span>
                      <span className="text-base font-medium text-foreground">
                        {moment.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </details>
        </section>
      </main>
    </>
  );
}
