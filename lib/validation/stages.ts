// lib/validation/stages.ts
// Five pure stage functions — no I/O, no side effects.

import type { Product, StageResult, TaxonomyProposal, RuleSet } from './types';

// ── helpers ──────────────────────────────────────────────────────────────────

function isEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

function textFrom(product: Product): string {
  return [
    product.description_en_text ?? '',
    product.short_description_en ?? '',
  ].join(' ').toLowerCase();
}

// ── Stage 1: SKU Classification ───────────────────────────────────────────────

export function stage1Sku(product: Product, rules: RuleSet): StageResult {
  const patch: StageResult['patch'] = {};
  const sku = (product.sku ?? '').toUpperCase();

  // Sorted longest-prefix-first in the JSON file
  const match = rules.skuPrefixes.find(r => sku.startsWith(r.prefix));
  if (match) {
    if (isEmpty(product.classification)) patch.classification = match.classification;
    if (isEmpty(product.segment))        patch.segment        = match.segment;
  }

  return { patch, proposals: [] };
}

// ── Stage 2: Name Extraction ──────────────────────────────────────────────────

export function stage2Name(product: Product, rules: RuleSet, priorPatch: StageResult['patch']): StageResult {
  const patch: StageResult['patch'] = {};
  const name = (product.name ?? '').trim();
  const segment = priorPatch.segment || product.segment || '';

  // Vintage year
  if (isEmpty(product.vintage)) {
    const m = name.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    if (m) patch.vintage = m[1];
  }

  // Alcohol %
  if (isEmpty(product.alcohol)) {
    const m = name.match(/\b(\d{1,2}\.?\d?)\s*(%|vol|abv)/i);
    if (m) patch.alcohol = m[1];
  }

  // Grape variety (wine only — check aliases too)
  if (segment === 'wine' && isEmpty(product.grape_variety)) {
    const nameLower = name.toLowerCase();
    for (const variety of rules.grapeVarieties) {
      const terms = [variety.name, ...variety.aliases].map(s => s.toLowerCase());
      if (terms.some(t => nameLower.includes(t))) {
        patch.grape_variety = variety.name;
        break;
      }
    }
  }

  // Brand: knowledge base first, then positional
  if (isEmpty(product.brand)) {
    const nameLower = name.toLowerCase();
    const knownBrand = rules.brands.find(b => nameLower.startsWith(b.toLowerCase()));
    if (knownBrand) {
      patch.brand = knownBrand;
    } else {
      // Extract text before first separator: year token, ' - ', or ','
      const sepMatch = name.match(/^(.+?)(?:\s+(?:19|20)\d{2}\b|\s+-\s+|,)/);
      if (sepMatch) {
        const candidate = sepMatch[1].trim();
        if (candidate.length > 1 && candidate.length < 50) patch.brand = candidate;
      }
    }
  }

  return { patch, proposals: [] };
}

// ── Stage 3: Description Keyword Scan ────────────────────────────────────────

export function stage3Description(product: Product, rules: RuleSet): StageResult {
  const patch: StageResult['patch'] = {};
  const text = textFrom(product);

  if (!text.trim()) return { patch, proposals: [] };

  // Wine profile (body / acidity / tannin)
  const profileFields = ['wine_body', 'wine_acidity', 'wine_tannin'] as const;
  for (const field of profileFields) {
    if (isEmpty(product[field])) {
      const tiers = rules.bodyKeywords[field];
      for (const [tier, keywords] of Object.entries(tiers)) {
        if (keywords.some(kw => text.includes(kw))) {
          patch[field] = tier;
          break;
        }
      }
    }
  }

  // Flavor tags
  if (isEmpty(product.flavor_tags)) {
    const matched: string[] = [];
    for (const [category, keywords] of Object.entries(rules.flavorKeywords)) {
      if ((keywords as string[]).some(kw => text.includes(kw))) {
        matched.push(category);
      }
    }
    if (matched.length) patch.flavor_tags = JSON.stringify(matched);
  }

  // Food matching
  if (isEmpty(product.food_matching)) {
    const matched: string[] = [];
    for (const [label, keywords] of Object.entries(rules.foodKeywords)) {
      if ((keywords as string[]).some(kw => text.includes(kw))) {
        matched.push(label);
      }
    }
    if (matched.length) patch.food_matching = matched.join('|');
  }

  return { patch, proposals: [] };
}

// ── Stage 4: Geography, Appellation & Classification Tier ─────────────────────

export function stage4Geography(product: Product, rules: RuleSet, priorPatch: StageResult['patch']): StageResult {
  const patch: StageResult['patch'] = {};
  const proposals: TaxonomyProposal[] = [];

  let country = product.country || priorPatch.country;
  const nameAndDesc = `${product.name ?? ''} ${product.description_en_text ?? ''}`;
  const text = nameAndDesc.toLowerCase();
  const sku = (product.sku ?? '').toUpperCase();

  // Country detection (resolve early so region/appellation/tier lookups can use it)
  if (!country) {
    const knownCountries = Object.keys(rules.regions);
    for (const c of knownCountries) {
      if (text.includes(c.toLowerCase())) {
        country = c;
        patch.country = c;
        break;
      }
    }
  }

  // ── Parse Magento pipe-separated region field: "Region | Sub-region" ──────────
  // Magento stores curated data like "Bordeaux | Saint-Émilion" in the region field.
  // Extract both parts so nothing is discarded.
  let pipeRegionCandidate: string | null = null;
  let pipeSubregionCandidate: string | null = null;
  if (product.region && String(product.region).includes('|')) {
    const parts = String(product.region).split('|').map(s => s.trim()).filter(Boolean);
    // Last segment that contains a space or is longer likely the sub-region/appellation
    // First clean segment is the region
    const cleaned = parts.filter(p => p.length > 1);
    // Handle "Burgundy|Burgundy | Côte de Nuits" → deduplicate then take first/last
    const unique = [...new Set(cleaned.map(p => p.toLowerCase()))];
    if (unique.length >= 2) {
      pipeRegionCandidate = cleaned[0];
      pipeSubregionCandidate = cleaned[cleaned.length - 1];
    } else if (unique.length === 1) {
      pipeRegionCandidate = cleaned[0];
    }
  }

  // ── Region + Sub-region extraction ────────────────────────────────────────────
  // Search text AND the pipe-parsed region candidate for a taxonomy match.
  const regionSearchText = [text, pipeRegionCandidate?.toLowerCase() ?? '', pipeSubregionCandidate?.toLowerCase() ?? ''].join(' ');

  if (country && rules.regions[country]) {
    const countryRegions = rules.regions[country];
    for (const [regionName, regionData] of Object.entries(countryRegions)) {
      const regionTerms = [regionName, ...(regionData.aliases ?? [])].map(s => s.toLowerCase());
      const regionMatched = regionTerms.some(t => regionSearchText.includes(t));

      if (regionMatched) {
        // Always write canonical taxonomy value (normalises non-standard Magento import data)
        patch.region = regionName;

        // Sub-region: check text first, then the pipe-extracted candidate
        const subSearchText = [text, pipeSubregionCandidate?.toLowerCase() ?? ''].join(' ');
        for (const sub of regionData.sub_regions) {
          if (subSearchText.includes(sub.toLowerCase())) {
            patch.subregion = sub;
            break;
          }
        }

        // If no taxonomy subregion matched but we have a pipe candidate, write it directly
        // (Magento's curated data is trustworthy) and flag as a proposal for taxonomy review
        if (!patch.subregion && pipeSubregionCandidate) {
          const subLower = pipeSubregionCandidate.toLowerCase();
          const allKnownSubs = regionData.sub_regions.map(s => s.toLowerCase());
          if (!allKnownSubs.includes(subLower)) {
            patch.subregion = pipeSubregionCandidate;
            proposals.push({
              type:           'sub_region',
              proposed_value: pipeSubregionCandidate,
              parent_path:    `${country} > ${regionName}`,
              source_sku:     sku,
            });
          }
        }
        break;
      }
    }
  }

  // ── Fallback: if no taxonomy region matched, write pipe-parsed values directly ──
  // Covers regions not yet in our taxonomy (e.g. Abruzzo, Priorat, Alsace sub-regions).
  // Magento's curated pipe data is trustworthy — write it and flag for taxonomy review.
  if (!patch.region && pipeRegionCandidate) {
    patch.region = pipeRegionCandidate;
    proposals.push({
      type:           'region',
      proposed_value: pipeRegionCandidate,
      parent_path:    country ?? '',
      source_sku:     sku,
    });
    if (pipeSubregionCandidate) {
      patch.subregion = pipeSubregionCandidate;
      proposals.push({
        type:           'sub_region',
        proposed_value: pipeSubregionCandidate,
        parent_path:    `${country ?? ''} > ${pipeRegionCandidate}`,
        source_sku:     sku,
      });
    }
  }

  // Appellation — always write canonical value when matched
  if (country && rules.appellations[country]) {
    for (const app of rules.appellations[country]) {
      if (text.includes(app.toLowerCase())) {
        patch.appellation = app;
        break;
      }
    }
  }

  // Classification tier (country-aware) — always write canonical value when matched
  if (country) {
    const countryTiers = rules.classificationTiers[country];
    if (countryTiers) {
      const effectiveRegion = patch.region || product.region;
      const tiersToCheck: string[] = [
        ...(effectiveRegion && countryTiers[effectiveRegion] ? countryTiers[effectiveRegion] : []),
        ...(countryTiers['_any'] ?? []),
      ];
      for (const tier of tiersToCheck) {
        if (text.includes(tier.toLowerCase())) {
          patch.wine_classification = tier;
          break;
        }
      }
    }
  }

  // ── Proposal generation: detect unknown values via text patterns ─────────────

  // Unknown appellation: regex scan for AOC/AOP/DOC/DOCG/DOCa/DO/GI/AVA/QbA markers
  if (isEmpty(product.appellation) && !patch.appellation) {
    const appellationRe = /\b([\w\s'\u00C0-\u024F-]{2,40}?)\s+(AOC|AOP|DOC|DOCG|DOCa|DO|GI|AVA|QbA|PDO)\b/gi;
    const knownApps = new Set(
      Object.values(rules.appellations).flat().map(s => s.toLowerCase())
    );
    let m: RegExpExecArray | null;
    while ((m = appellationRe.exec(nameAndDesc)) !== null) {
      const candidate = `${m[1].trim()} ${m[2]}`.trim();
      if (candidate.length > 2 && !knownApps.has(candidate.toLowerCase())) {
        proposals.push({
          type:           'appellation',
          proposed_value: candidate,
          parent_path:    (patch.country || product.country) ?? '',
          source_sku:     sku,
        });
        break; // one appellation proposal per product per run
      }
    }
  }

  return { patch, proposals };
}

// ── Stage 5: Confidence Scoring & Status Assignment ───────────────────────────

const EXPECTED_FIELDS: Record<string, string[]> = {
  wine:        ['classification', 'grape_variety', 'country', 'region', 'wine_body', 'wine_acidity', 'wine_tannin'],
  spirits:     ['classification', 'country'],
  beer:        ['classification', 'country'],
  accessories: ['classification'],
  other:       ['classification'],
};

export function stage5Score(
  product: Product,
  allPatches: StageResult['patch'],
  proposals: TaxonomyProposal[],
): StageResult {
  const segment = (allPatches.segment || product.segment || '').toLowerCase();
  const expected = EXPECTED_FIELDS[segment] ?? EXPECTED_FIELDS['other'];

  // Count fields that will be non-null after this run (existing OR newly extracted)
  let filled = 0;
  for (const field of expected) {
    const val = allPatches[field as keyof typeof allPatches] ?? product[field];
    if (!isEmpty(val)) filled++;
  }

  let score = expected.length > 0 ? filled / expected.length : 0;

  // Bonus for appellation/wine_classification
  const hasAppellation = !isEmpty(allPatches.appellation ?? product.appellation);
  const hasClassTier   = !isEmpty(allPatches.wine_classification ?? product.wine_classification);
  if (hasAppellation || hasClassTier) score = Math.min(1.0, score + 0.1);

  const patch: StageResult['patch'] = {
    overall_confidence:  parseFloat(score.toFixed(3)),
    // taxonomy_confidence mirrors overall_confidence — deliberate (no separate formula defined yet)
    taxonomy_confidence: parseFloat(score.toFixed(3)),
  };

  // Determine new status (never downgrade validated; never downgrade needs_attention to raw)
  const current = product.validation_status as string | null;
  if (current !== 'validated') {
    if (score >= 0.75) {
      patch.validation_status = 'validated';
    } else if (score >= 0.40) {
      patch.validation_status = 'needs_review'; // includes upgrade of needs_attention
    } else {
      // score < 0.40 — set raw for null/raw products; never downgrade needs_attention or needs_review
      if (current === null || current === undefined || current === 'raw') {
        patch.validation_status = 'raw';
      }
    }
  }

  // If any unknown taxonomy values were detected, force needs_review regardless of score
  // Guard on `current` so validated products are never touched by this path
  if (proposals.length > 0 && current !== 'validated') {
    patch.validation_status = 'needs_review';
  }

  return { patch, proposals: [] };
}
