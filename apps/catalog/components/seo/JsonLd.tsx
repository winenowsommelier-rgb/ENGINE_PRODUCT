// apps/catalog/components/seo/JsonLd.tsx
// Server-only component. Never import this from a 'use client' file.
// Renders structured data as a <script type="application/ld+json"> tag
// so crawlers see it without JavaScript execution.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
