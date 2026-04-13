import { Metadata } from "next";
import { readFileSync } from "fs";
import { join } from "path";
import ExploreClient from "./ExploreClient";

function getCountryCount(): number {
  try {
    const raw = readFileSync(
      join(process.cwd(), "data/taxonomy/explore-taxonomy.json"),
      "utf-8",
    );
    const data = JSON.parse(raw);
    return data?.countries?.length ?? 50;
  } catch {
    return 50;
  }
}

export function generateMetadata(): Metadata {
  const countryCount = getCountryCount();

  const title = "Explore Wine & Spirits by Region — Wine-Now";
  const description = `Discover wines, spirits, beer and sake from ${countryCount} countries. Browse by region on our interactive world map.`;

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

export default function ExplorePage() {
  return <ExploreClient slug={[]} />;
}
