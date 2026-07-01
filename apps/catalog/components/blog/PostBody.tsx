// Hashnode sanitizes content.html before delivery — we trust this output.
// Phase 2 (Task 13): split on <!-- product: SKU --> comments and render InlineProductCard nodes.

export function PostBody({ html }: { html: string }) {
  return (
    <div
      className="prose prose-neutral max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
