import { Suspense } from 'react';
import { ContactButtons } from '@/components/ContactButtons';
import { Filters } from '@/components/Filters';

/**
 * TEMPORARY scratch route for Task 9 visual review — /preview-task9.
 *
 * Renders ContactButtons (inline + stacked) with hard-coded sample links, and
 * Filters wrapped in <Suspense> (required because Filters uses useSearchParams).
 * NOT linked from navigation; safe to delete after review.
 */
export const dynamic = 'force-static';

const sampleLinks = {
  line: 'https://line.me/R/ti/p/@x',
  whatsapp: 'https://wa.me/66812345678',
  facebook: 'https://m.me/x',
};

export default function PreviewTask9Page() {
  return (
    <main className="container flex flex-col gap-12 py-10">
      <section>
        <h1 className="mb-6 text-2xl font-semibold">Task 9 — preview</h1>
        <h2 className="mb-3 text-lg font-medium">ContactButtons — inline</h2>
        <ContactButtons links={sampleLinks} variant="inline" />
        <h2 className="mb-3 mt-8 text-lg font-medium">ContactButtons — stacked</h2>
        <div className="max-w-xs">
          <ContactButtons links={sampleLinks} variant="stacked" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Filters</h2>
        <Suspense fallback={null}>
          <Filters countries={['France', 'Italy', 'Japan']} />
        </Suspense>
      </section>
    </main>
  );
}
