/**
 * stripBrandPrefix — remove a redundant leading brand name from a product's
 * full display name, so a UI that already shows the brand as its own label
 * (card subtitle, PDP eyebrow) doesn't repeat it inside the title too.
 *
 * Exact, case-sensitive prefix match only (no normalization) — see
 * docs/superpowers/specs/2026-09-05-catalog-brand-name-dedup-design.md for
 * the data audit behind this decision: ~90.5% of the catalog is a clean
 * prefix match; the remaining ~9.5% (case/punctuation mismatches, or names
 * that don't restate the brand at all, e.g. a parent house vs. a sub-label)
 * intentionally keep showing both fields untouched rather than risk a wrong
 * strip.
 *
 * Includes a word-boundary guard: a brand that is a literal string-prefix of
 * the name's first word but not a whole-word prefix (e.g. brand "Ace"
 * against name "Acevedo Winery Malbec") must NOT be stripped.
 */
export function stripBrandPrefix(name: string, brand: string | undefined): string {
  if (!brand || brand.trim() === '') return name;
  if (!name.startsWith(brand)) return name;

  const boundaryChar = name[brand.length];
  const isWordBoundary =
    boundaryChar === undefined || /[^\p{L}\p{N}]/u.test(boundaryChar);
  if (!isWordBoundary) return name;

  const remainder = name.slice(brand.length).replace(/^\s+/, '');
  return remainder === '' ? name : remainder;
}
