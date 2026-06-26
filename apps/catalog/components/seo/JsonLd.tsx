// apps/catalog/components/seo/JsonLd.tsx
// Server-only component. Never import this from a 'use client' file.
// Renders structured data as a <script type="application/ld+json"> tag
// so crawlers see it without JavaScript execution.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        // Escape </script> sequences so inline JSON-LD cannot break out of
        // the script block. JSON.stringify alone does not do this.
        __html: JSON.stringify(data)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/\//g, '\\u002f'),
      }}
    />
  );
}
