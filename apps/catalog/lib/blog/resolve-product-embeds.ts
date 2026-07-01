// apps/catalog/lib/blog/resolve-product-embeds.ts
import type { PublicProduct } from '@/lib/types';

export function resolveProductEmbeds(
  html: string,
  allProducts: PublicProduct[],
): Map<string, PublicProduct> {
  const productBySku = new Map(allProducts.map((p) => [p.sku.toUpperCase(), p]));
  const result = new Map<string, PublicProduct>();

  // Regex created inside function — a module-level /gi regex maintains lastIndex state
  // on the object and would produce "skips every other match" bugs if called outside
  // an exhausted loop (e.g. after refactoring or early return).
  const re = /<!--\s*product:\s*([A-Z0-9]+)\s*-->/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const sku = match[1].toUpperCase();
    const product = productBySku.get(sku);
    if (product) result.set(sku, product);
  }

  return result;
}
