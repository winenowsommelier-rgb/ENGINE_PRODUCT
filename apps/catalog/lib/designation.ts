/**
 * designation — derive a single most-specific product DESIGNATION (the "class":
 * Grand Cru, DOCG, IGT, XO, Reserva, …) from a product name.
 *
 * WHY a separate field: the raw `classification` field is product TYPE, not a
 * designation (CLAUDE.md ABSOLUTE RULE 12). The structured designation field did
 * not exist; this module + scripts/backfill_designation.py create it.
 *
 * PURE + fs-free: imported by the pure shop-query predicate (unit-tested without
 * Next) and usable client-side. MUST NOT import sku-taxonomy/category-groups
 * (they pull `fs`). Regex over name / persisted field only.
 *
 * PARITY: scripts/backfill_designation.py mirrors this table. tests/
 * test_designation_parity.py guards them against drift — update BOTH together.
 */
import type { PublicProduct } from './types';

/** Ordered MOST-SPECIFIC FIRST. First matching label wins. */
const DESIGNATION_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'Grand Cru',      re: /\bgrand\s+cru\b/i },
  { label: 'Premier Cru',    re: /\b(?:premier\s+cru|1er\s+cru)\b/i },
  { label: 'Cru Classé',     re: /\bcru\s+class[eé](?![a-z])/i },
  { label: 'DOCG',           re: /\bDOCG\b/ },
  { label: 'DOC',            re: /\bDOC\b/ },
  { label: 'IGT',            re: /\bIGT\b/ },
  { label: 'DOP/IGP',        re: /\b(?:DOP|IGP)\b/ },
  { label: 'AOC',            re: /\b(?:AOC|AOP)\b/ },
  { label: 'Single Malt',    re: /\bsingle\s+malt\b/i },
  { label: 'XO',             re: /\bXO\b/ },
  { label: 'VSOP',           re: /\bVSOP\b/ },
  { label: 'VS',             re: /\bVS\b/ },
  { label: 'Gran Reserva',   re: /\bgran\s+reserva\b/i },
  { label: 'Extra Brut',     re: /\bextra\s+brut\b/i },
  { label: 'Brut',           re: /\bbrut\b/i },
  { label: 'Reserva',        re: /\b(?:reserva|riserva)\b/i },
  { label: 'Reserve',        re: /\breserve\b/i },
  { label: 'Limited',        re: /\blimited(?:\s+edition)?\b/i },
  { label: 'Vintage',        re: /\bvintage\b/i },
];

/** Canonical ordered label list (most-specific first) for facet ordering + tests. */
export const DESIGNATIONS: readonly string[] = DESIGNATION_PATTERNS.map((d) => d.label);

/**
 * The single most-specific designation for a product, or undefined.
 * Prefers a persisted `designation` field; else parses `name`.
 */
export function designationForProduct(p: PublicProduct): string | undefined {
  const persisted = (p.designation ?? '').trim();
  if (persisted) return persisted;
  const name = p.name ?? '';
  for (const { label, re } of DESIGNATION_PATTERNS) {
    if (re.test(name)) return label;
  }
  return undefined;
}
