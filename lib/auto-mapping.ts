import { grapeDNA, regionModifiers, styleDNA, type FlavorProfile, type ProductRecord } from '@/lib/data';

const clamp = (value: number) => Math.max(0, Math.min(5, Number(value.toFixed(1))));

export function buildFlavorProfile(product: ProductRecord): FlavorProfile {
  const grape = grapeDNA.find((entry) => entry.grape === product.grape);
  const style = styleDNA.find((entry) => entry.style === product.style);
  const region = regionModifiers.find((entry) => entry.region === product.region);

  const body = clamp((grape?.body ?? 2.5) * 0.45 + (style?.body ?? 2.5) * 0.45 + (region?.bodyMod ?? 0));
  const acidity = clamp((grape?.acidity ?? 2.5) * 0.5 + (style?.acidity ?? 2.5) * 0.35 + (region?.acidityMod ?? 0));
  const tannin = clamp((grape?.tannin ?? 1.5) * 0.6 + (style?.tannin ?? 1.5) * 0.35 + (region?.tanninMod ?? 0));
  const sweetness = clamp((style?.sweetness ?? 0.5) + (product.category === 'Spirits' ? 0.2 : 0));
  const intensity = clamp((style?.intensity ?? 3) * 0.5 + (grape?.fruitProfile ?? 2.5) * 0.2 + (region?.intensityMod ?? 0));
  const oak = clamp(product.oak);

  return {
    body,
    acidity,
    tannin,
    sweetness,
    alcohol: clamp(product.category === 'Spirits' ? 4.8 : 3.6),
    intensity,
    finish: clamp(intensity * 0.85 + oak * 0.2),
    texture: clamp(body * 0.6 + oak * 0.3),
    oak,
    fruit: clamp((grape?.fruitProfile ?? 2.5) + (product.category === 'Wine' ? 0.4 : -0.2)),
    floral: clamp(acidity * 0.35 + (product.style.includes('Aromatic') ? 1.4 : 0.6)),
    herbal: clamp(acidity * 0.2 + (product.region.includes('Marlborough') ? 1.7 : 0.7)),
    spice: clamp(oak * 0.6 + intensity * 0.25),
    earth: clamp(product.style.includes('Earthy') ? 3.6 : 1.4),
    mineral: clamp(acidity * 0.3 + (product.region.includes('Valley') ? 0.6 : 1.1))
  };
}

export function calculateConfidence(product: ProductRecord): number {
  const matchedSources = [
    grapeDNA.some((entry) => entry.grape === product.grape),
    styleDNA.some((entry) => entry.style === product.style),
    regionModifiers.some((entry) => entry.region === product.region)
  ].filter(Boolean).length;

  return clamp((matchedSources / 3) * 4.2 + (product.status === 'Ready' ? 0.8 : 0.2));
}
