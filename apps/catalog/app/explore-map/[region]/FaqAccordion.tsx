// apps/catalog/app/explore-map/[region]/FaqAccordion.tsx
import type { QAItem } from '@/lib/seo/faq-builder';

export function FaqAccordion({ items }: { items: QAItem[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-10 border-t border-border pt-8">
      <h2 className="text-lg font-semibold text-foreground mb-4">Frequently Asked Questions</h2>
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <details key={item.question} className="group rounded-lg border border-border">
            <summary className="flex cursor-pointer items-center justify-between p-4 text-base font-medium text-foreground">
              {item.question}
            </summary>
            <p className="px-4 pb-4 text-base leading-relaxed text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
