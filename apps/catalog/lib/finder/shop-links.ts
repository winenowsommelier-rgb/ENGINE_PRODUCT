/**
 * shop-links — PURE builders for the finder result's "discovery map".
 *
 * Turns a finder result (the shopper's Answers + the category's typical origin)
 * into clickable links that hit the catalog's REAL /shop filters:
 *   - breadcrumbLinks: category → country → typical region (a drill-down trail)
 *   - signatureChips:  body / tannin / acidity / grape "signature" pills
 *   - styleShopUrl:    the broad "see all N like this" link (taste, no geography)
 *
 * INVARIANTS (why this file is careful):
 *   - Every link uses the EXACT /shop filter param names from lib/shop-query:
 *       group, class, country, region, subregion, grape, body, acidity, tannin, price
 *   - body/acidity/tannin chip values come from primaryValue() in lib/finder/scales
 *     (the FILTER scale, e.g. 'bold'→'Full', 'firm'→'High') — NEVER the raw answer
 *     token, which /shop would not match.
 *   - `class` is matched by /shop against the canonical sub-type (typeForProduct),
 *     so the class values here are the canonical types ("Red Wine", "Whisky", …).
 *   - appellation has 0% data → it is NEVER linked.
 *
 * No React / Next imports — pure functions, exhaustively unit-testable.
 */
import type { PublicProduct } from '@/lib/types';
import type { Answers, FinderCategory } from '@/lib/finder/answers';
import { primaryValue } from '@/lib/finder/scales';

/** A clickable discovery-map link. */
export interface ShopLink {
  label: string;
  href: string;
}

/** The geo filter field a value resolves to, plus its canonical-cased value. */
export interface OriginField {
  field: 'region' | 'subregion' | 'country';
  value: string;
}

/**
 * FinderCategory → the /shop {group, class} pair that scopes the catalog to that
 * category. `class` is the canonical sub-type that /shop matches via typeForProduct.
 *
 * Group names are the 10-group model from CATEGORY_GROUPS:
 *   Wine, Whisky, Spirits, Sake & Asian, …
 *
 * Notes on choices:
 *   - sparkling → {Wine, 'Sparkling & Champagne'}: sparkling SKUs live in the Wine
 *     group with canonical type "Sparkling & Champagne" (the value /shop's class
 *     filter matches; "Sparkling Wine" matches 0 products → was a dead link).
 *   - whisky/spirits/sake → no class (undefined): the group alone is the right scope
 *     (whisky has many sub-types; "spirits"/"sake" are group-level concepts).
 */
const CATEGORY_SCOPE: Record<FinderCategory, { group: string; classValue?: string }> = {
  red:       { group: 'Wine',        classValue: 'Red Wine' },
  white:     { group: 'Wine',        classValue: 'White Wine' },
  sparkling: { group: 'Wine',        classValue: 'Sparkling & Champagne' },
  whisky:    { group: 'Whisky' },
  gin:       { group: 'Spirits',     classValue: 'Gin' },
  spirits:   { group: 'Spirits' },
  sake:      { group: 'Sake & Asian' },
};

/** Human label for the category breadcrumb root. */
const CATEGORY_LABEL: Record<FinderCategory, string> = {
  red: 'Red Wine',
  white: 'White Wine',
  sparkling: 'Sparkling',
  whisky: 'Whisky',
  gin: 'Gin',
  spirits: 'Spirits',
  sake: 'Sake',
};

/** Build a /shop URL from a flat param map (URL-encodes every value). */
export function buildShopUrl(params: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `/shop?${qs}` : '/shop';
}

/** Lower-cased, trimmed form for case-insensitive comparison. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Resolve a geo string to the /shop filter field it belongs to.
 *
 * Exact (case-insensitive) match against any product's region, else subregion,
 * else country — in that precedence order (region is the broadest typical drill
 * target). Returns the CANONICAL-cased value found in the catalog so the emitted
 * filter value matches /shop's exact-ci comparison, or null if the value appears
 * in none of the three fields.
 */
export function resolveOriginField(
  value: string,
  catalog: PublicProduct[],
): OriginField | null {
  const target = norm(value);
  if (!target) return null;

  const fields: OriginField['field'][] = ['region', 'subregion', 'country'];
  for (const field of fields) {
    for (const p of catalog) {
      const candidate = p[field];
      if (candidate && norm(candidate) === target) {
        return { field, value: candidate };
      }
    }
  }
  return null;
}

/** Scope passed to breadcrumbLinks: category root + optional geo drill levels. */
export interface BreadcrumbScope {
  category: FinderCategory;
  country?: string;
  typicalRegion?: string;
}

/**
 * Ordered breadcrumb trail for the result's discovery map:
 *   [category → group+class] → [country → country=] → [typicalRegion → resolved geo field]
 *
 * Each level is dropped if it does not resolve (unknown country, region not in the
 * catalog, etc.). appellation is NEVER emitted.
 */
export function breadcrumbLinks(
  scope: BreadcrumbScope,
  catalog: PublicProduct[],
): ShopLink[] {
  const links: ShopLink[] = [];
  const cfg = CATEGORY_SCOPE[scope.category];

  // Level 1 — category (group + canonical class)
  if (cfg) {
    const params: Record<string, string> = { group: cfg.group };
    if (cfg.classValue) params.class = cfg.classValue;
    links.push({ label: CATEGORY_LABEL[scope.category], href: buildShopUrl(params) });
  }

  // Level 2 — country (only if a country was provided; exact-ci filter)
  if (scope.country && scope.country.trim()) {
    links.push({
      label: scope.country,
      href: buildShopUrl({ country: scope.country }),
    });
  }

  // Level 3 — typical region, resolved to its real geo field (region/subregion/country)
  if (scope.typicalRegion && scope.typicalRegion.trim()) {
    const origin = resolveOriginField(scope.typicalRegion, catalog);
    if (origin) {
      links.push({
        label: origin.value,
        href: buildShopUrl({ [origin.field]: origin.value }),
      });
    }
  }

  return links;
}

/**
 * "Signature" chips from the shopper's answers — the taste fingerprint of the
 * result, each a clickable /shop filter.
 *
 * body (from axis1), tannin, acidity are ALWAYS converted to the FILTER scale via
 * primaryValue() (never the raw token); grape is a substring token. A chip is
 * emitted only when its answer is present AND resolves to a real filter value.
 */
export function signatureChips(answers: Answers): ShopLink[] {
  const chips: ShopLink[] = [];

  if (answers.axis1) {
    const body = primaryValue('body', answers.axis1);
    if (body) chips.push({ label: body, href: buildShopUrl({ body }) });
  }
  if (answers.tannin) {
    const tannin = primaryValue('tannin', answers.tannin);
    if (tannin) chips.push({ label: tannin, href: buildShopUrl({ tannin }) });
  }
  if (answers.acidity) {
    const acidity = primaryValue('acidity', answers.acidity);
    if (acidity) chips.push({ label: acidity, href: buildShopUrl({ acidity }) });
  }
  if (answers.grape && answers.grape.trim()) {
    chips.push({ label: answers.grape, href: buildShopUrl({ grape: answers.grape }) });
  }

  return chips;
}

/**
 * The broad "see all N like this" URL: category scope (group + class) plus the
 * taste signature (body / tannin / acidity via primaryValue, + grape) — but NO
 * geography (no country/region/subregion), so it surfaces every match in style.
 */
export function styleShopUrl(answers: Answers): string {
  const params: Record<string, string> = {};

  const cfg = CATEGORY_SCOPE[answers.category];
  if (cfg) {
    params.group = cfg.group;
    if (cfg.classValue) params.class = cfg.classValue;
  }

  if (answers.axis1) {
    const body = primaryValue('body', answers.axis1);
    if (body) params.body = body;
  }
  if (answers.tannin) {
    const tannin = primaryValue('tannin', answers.tannin);
    if (tannin) params.tannin = tannin;
  }
  if (answers.acidity) {
    const acidity = primaryValue('acidity', answers.acidity);
    if (acidity) params.acidity = acidity;
  }
  if (answers.grape && answers.grape.trim()) {
    params.grape = answers.grape;
  }

  return buildShopUrl(params);
}
