import { type FlavorProfile, type ProductRecord } from '@/lib/data';

export type RenderCheck = {
  label: string;
  status: 'pass' | 'warning';
  detail: string;
};

const inRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 5;

export function validateRenderedProduct(product: ProductRecord, profile: FlavorProfile): RenderCheck[] {
  return [
    {
      label: 'Radar metrics in 0-5 range',
      status: [profile.body, profile.acidity, profile.tannin, profile.sweetness, profile.intensity, profile.finish].every(inRange) ? 'pass' : 'warning',
      detail: 'Ensures charted flavor metrics will render without breaking the visual scale.'
    },
    {
      label: 'Renderable merchandising identity',
      status: product.name.trim() && product.sku.trim() ? 'pass' : 'warning',
      detail: 'Confirms the card title and product table row have required identity fields.'
    },
    {
      label: 'Currency + price present',
      status: product.currency.trim() && product.price > 0 ? 'pass' : 'warning',
      detail: 'Prevents broken pricing badges or empty export payloads.'
    }
  ];
}
