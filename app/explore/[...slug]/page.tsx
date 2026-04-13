import { Metadata } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import ExploreClient from "../ExploreClient";

// ---------------------------------------------------------------------------
// Types for the taxonomy JSON
// ---------------------------------------------------------------------------

interface TaxonomyCounts {
  wine: number;
  spirits: number;
  beer: number;
  sake: number;
  total: number;
}

interface TaxonomyCountry {
  name: string;
  slug: string;
  counts: TaxonomyCounts;
}

interface TaxonomyRegion {
  name: string;
  slug: string;
  parentSlug: string;
  counts: TaxonomyCounts;
}

interface TaxonomySubregion {
  name: string;
  slug: string;
  parentSlug: string;
  grandparentSlug: string;
  counts: TaxonomyCounts;
}

interface TaxonomyData {
  _meta: { counts: { countries: number } };
  countries: TaxonomyCountry[];
  regions: TaxonomyRegion[];
  subregions: TaxonomySubregion[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = new Set(["wine", "spirits", "beer", "sake"]);

const CATEGORY_LABELS: Record<string, string> = {
  wine: "Wine",
  spirits: "Spirits",
  beer: "Beer",
  sake: "Sake",
};

const CATEGORY_PLURAL: Record<string, string> = {
  wine: "wines",
  spirits: "spirits",
  beer: "beers",
  sake: "sake",
};

/** Demonym map for common countries — falls back to "{Name}" for unlisted. */
const DEMONYMS: Record<string, string> = {
  argentina: "Argentine",
  australia: "Australian",
  austria: "Austrian",
  chile: "Chilean",
  china: "Chinese",
  france: "French",
  germany: "German",
  greece: "Greek",
  hungary: "Hungarian",
  israel: "Israeli",
  italy: "Italian",
  japan: "Japanese",
  mexico: "Mexican",
  "new-zealand": "New Zealand",
  portugal: "Portuguese",
  "south-africa": "South African",
  spain: "Spanish",
  switzerland: "Swiss",
  thailand: "Thai",
  uk: "British",
  usa: "American",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _taxonomy: TaxonomyData | null = null;

function loadTaxonomy(): TaxonomyData {
  if (_taxonomy) return _taxonomy;
  const raw = readFileSync(
    join(process.cwd(), "data/taxonomy/explore-taxonomy.json"),
    "utf-8",
  );
  _taxonomy = JSON.parse(raw) as TaxonomyData;
  return _taxonomy;
}

type DrillLevel =
  | { level: "category"; category: string }
  | { level: "country"; category: string | null; countrySlug: string }
  | { level: "region"; category: string | null; countrySlug: string; regionSlug: string };

function parseSlugForMeta(slug: string[]): DrillLevel | null {
  if (slug.length === 0) return null;

  const first = slug[0].toLowerCase();
  const hasCategory = CATEGORIES.has(first);
  const category = hasCategory ? first : null;
  const rest = hasCategory ? slug.slice(1) : slug;

  if (rest.length === 0 && category) {
    return { level: "category", category };
  }
  if (rest.length === 1) {
    return { level: "country", category, countrySlug: rest[0] };
  }
  if (rest.length === 2) {
    return { level: "region", category, countrySlug: rest[0], regionSlug: rest[1] };
  }
  // Deeper levels (subregion, appellation) — treat as region-level for now
  if (rest.length >= 2) {
    return { level: "region", category, countrySlug: rest[0], regionSlug: rest[rest.length - 1] };
  }
  return null;
}

function countForCategory(
  counts: TaxonomyCounts,
  category: string | null,
): number {
  if (!category) return counts.total;
  return counts[category as keyof TaxonomyCounts] ?? counts.total;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function demonym(slug: string, name: string): string {
  return DEMONYMS[slug] ?? name;
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const taxonomy = loadTaxonomy();
  const parsed = parseSlugForMeta(slug);

  // Fallback
  let title = "Explore Wine & Spirits by Region — Wine-Now";
  let description =
    "Discover wines, spirits, beer and sake from around the world. Browse by region on our interactive map.";

  if (parsed?.level === "category") {
    const cat = parsed.category;
    const label = CATEGORY_LABELS[cat] ?? cat;
    const plural = CATEGORY_PLURAL[cat] ?? cat;
    const totalCount = taxonomy.countries.reduce(
      (sum, c) => sum + countForCategory(c.counts, cat),
      0,
    );
    const countriesWithCategory = taxonomy.countries.filter(
      (c) => countForCategory(c.counts, cat) > 0,
    ).length;

    title = `Explore ${label} Regions of the World — Wine-Now`;
    description = `Browse ${formatCount(totalCount)} ${plural} from ${countriesWithCategory} countries. Discover ${plural} by region, grape variety, and style.`;
  } else if (parsed?.level === "country") {
    const country = taxonomy.countries.find(
      (c) => c.slug === parsed.countrySlug,
    );
    if (country) {
      const count = countForCategory(country.counts, parsed.category);
      const adj = demonym(country.slug, country.name);
      const catPlural = parsed.category
        ? CATEGORY_PLURAL[parsed.category] ?? parsed.category
        : "products";

      // Find top regions for this country
      const topRegions = taxonomy.regions
        .filter((r) => r.parentSlug === country.slug && r.counts.total > 0)
        .sort((a, b) => b.counts.total - a.counts.total)
        .slice(0, 3)
        .map((r) => r.name);

      title = `${adj} ${parsed.category ? CATEGORY_LABELS[parsed.category] + "s" : "Wines & Spirits"} — Explore ${formatCount(count)} Products — Wine-Now`;
      const regionSuffix =
        topRegions.length > 0
          ? ` from ${topRegions.join(", ")} and more. Browse by region.`
          : ". Browse by region.";
      description = `Discover ${formatCount(count)} ${adj} ${catPlural}${regionSuffix}`;
    }
  } else if (parsed?.level === "region") {
    // Try regions first, then subregions
    const region =
      taxonomy.regions.find(
        (r) =>
          r.slug === parsed.regionSlug &&
          r.parentSlug === parsed.countrySlug,
      ) ??
      taxonomy.subregions.find(
        (sr) =>
          sr.slug === parsed.regionSlug &&
          (sr.grandparentSlug === parsed.countrySlug ||
            sr.parentSlug === parsed.countrySlug),
      );

    const country = taxonomy.countries.find(
      (c) => c.slug === parsed.countrySlug,
    );

    if (region && country) {
      const count = countForCategory(region.counts, parsed.category);
      const catPlural = parsed.category
        ? CATEGORY_PLURAL[parsed.category] ?? parsed.category
        : "products";

      title = `${region.name} ${parsed.category ? CATEGORY_LABELS[parsed.category] + "s" : "Wines & Spirits"} — ${formatCount(count)} Products — Wine-Now`;
      description = `Explore ${formatCount(count)} ${catPlural} from ${region.name}, ${country.name}.`;
    }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function ExploreSlugPage({ params }: Props) {
  const { slug } = await params;
  return <ExploreClient slug={slug} />;
}
