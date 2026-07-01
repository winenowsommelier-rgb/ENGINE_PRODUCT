// Hashnode sanitizes content.html before delivery — we trust this output.
// Product embed comments (<!-- product: SKU -->) are replaced with InlineProductCard nodes.
import type React from 'react';
import type { PublicProduct } from '@/lib/types';
import { InlineProductCard } from './InlineProductCard';

export function PostBody({
  html,
  productMap,
}: {
  html: string;
  productMap?: Map<string, PublicProduct>;
}) {
  if (!productMap || productMap.size === 0) {
    return <div className="prose prose-neutral max-w-none" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Split on embed comments and interleave InlineProductCard React nodes.
  // This avoids ReactDOMServer.renderToStaticMarkup (string injection bypasses reconciliation).
  // Regex created inside function scope — avoids lastIndex state bugs with module-level /gi regex.
  const parts: (string | React.ReactNode)[] = [];
  let lastIndex = 0;
  let i = 0;
  const re = /<!--\s*product:\s*([A-Z0-9]+)\s*-->/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const sku = match[1].toUpperCase();
    const product = productMap.get(sku);
    if (match.index > lastIndex) {
      parts.push(html.slice(lastIndex, match.index));
    }
    if (product) {
      parts.push(<InlineProductCard key={`embed-${sku}-${i++}`} product={product} />);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) parts.push(html.slice(lastIndex));

  return (
    <div className="prose prose-neutral max-w-none">
      {parts.map((part, idx) =>
        typeof part === 'string' ? (
          <span key={idx} dangerouslySetInnerHTML={{ __html: part }} />
        ) : (
          part
        ),
      )}
    </div>
  );
}
