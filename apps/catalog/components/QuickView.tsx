'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { StorefrontImage } from '@/components/StorefrontImage';
import { ContactButtons } from '@/components/ContactButtons';
import { formatPrice } from '@/lib/price-tiers';
import { stripToText } from '@/lib/sanitize-html';
import { isInStock } from '@/lib/utils';
import type { PublicProduct } from '@/lib/types';
import type { ContactLinks } from '@/lib/contact';

/**
 * QuickView — a Maison-clean modal preview of a product, opened from a card's
 * "Quick look" button WITHOUT navigating away from the grid.
 *
 * Built on the shadcn Dialog (Radix): focus-trap, ESC-to-close, scroll-lock,
 * and ARIA roles are handled by the primitive. We supply DialogTitle /
 * DialogDescription so the dialog is properly labelled for screen readers.
 *
 * Shows: image, name, brand/region subtitle, price, a few key attributes
 * (country/region/grape/vintage — nulls skipped), short description, stock
 * status, and a "View full details" link to the product page.
 *
 * Per-product contact buttons (LINE / WhatsApp / Messenger) render when
 * `contactLinks` is supplied. The link STRINGS are computed by a SERVER parent
 * (getContactEnv -> buildContactLinks) and passed down; QuickView is a client
 * component and never reads process.env. When `contactLinks` is absent the
 * contact row is simply omitted (graceful) — the shop/product pages wire it in
 * (Tasks 10/11).
 */

interface QuickViewProps {
  product: PublicProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Ready-made contact deep-links for THIS product (built server-side). When
   * omitted, no contact buttons are shown.
   */
  contactLinks?: ContactLinks;
}

/** Key attributes to surface, in display order. Nulls are skipped at render. */
function attributeRows(p: PublicProduct): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string | undefined | number }> = [
    { label: 'Country', value: p.country },
    { label: 'Region', value: p.region },
    { label: 'Grape', value: p.grape_variety },
    { label: 'Vintage', value: p.vintage },
    { label: 'Size', value: p.bottle_size },
  ];
  return rows
    .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== '')
    .map((r) => ({ label: r.label, value: String(r.value) }));
}

export function QuickView({
  product,
  open,
  onOpenChange,
  contactLinks,
}: QuickViewProps) {
  const subtitle = product.brand || product.region;
  const attributes = attributeRows(product);
  const inStock = isInStock(product.is_in_stock);
  // desc_en_short is plain prose today (0/5,786 contain tags), but strip any tags
  // to text so the modal can never show raw <p>/<strong> markup, and render it as a
  // normal React child (escaped → no XSS) inside the Radix <p> DialogDescription.
  const shortDesc = stripToText(product.desc_en_short);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-y-auto p-0 sm:max-h-[90vh]">
        <div className="grid gap-6 p-6 sm:grid-cols-2 sm:gap-8">
          {/* Image */}
          <StorefrontImage
            src={product.image_url}
            alt={product.name}
            sizes="(max-width: 640px) 90vw, 40vw"
            className="rounded-md border border-border"
          />

          {/* Details */}
          <div className="flex flex-col">
            {subtitle ? (
              <p className="mb-1 text-sm uppercase tracking-wide text-muted-foreground">
                {subtitle}
              </p>
            ) : null}

            <DialogTitle className="text-2xl font-semibold leading-snug text-foreground">
              {product.name}
            </DialogTitle>

            <p className="mt-3 text-2xl font-semibold text-primary">
              {formatPrice(product.price)}
            </p>

            {!inStock ? (
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                Out of stock
              </p>
            ) : null}

            {attributes.length > 0 ? (
              <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
                {attributes.map((a) => (
                  <div key={a.label} className="contents">
                    <dt className="text-muted-foreground">{a.label}</dt>
                    <dd className="text-foreground">{a.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {shortDesc ? (
              <DialogDescription className="mt-5 text-base leading-relaxed text-foreground">
                {shortDesc}
              </DialogDescription>
            ) : (
              // Radix logs a warning without a Description; keep an sr-only one.
              <DialogDescription className="sr-only">
                {`${product.name} — quick preview`}
              </DialogDescription>
            )}

            {contactLinks ? (
              <div className="mt-6">
                <p className="mb-2 text-sm text-muted-foreground">
                  Questions? Talk to us:
                </p>
                <ContactButtons links={contactLinks} variant="inline" size="sm" />
              </div>
            ) : null}

            <Link
              href={`/product/${product.sku}`}
              className="mt-6 inline-flex h-11 w-fit items-center gap-1.5 text-base font-medium text-primary underline-offset-4 hover:underline"
            >
              View full details
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
