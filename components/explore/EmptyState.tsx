"use client";

import Link from "next/link";
import { MapPin } from "lucide-react";
import type { CategoryScope } from "@/lib/explore/types";
import { getCategoryConfig } from "@/lib/explore/category-config";

interface Props {
  category: CategoryScope | null;
  locationName: string;
  suggestedHref?: string;
  suggestedName?: string;
}

export default function EmptyState({
  category,
  locationName,
  suggestedHref,
  suggestedName,
}: Props) {
  const label = category
    ? getCategoryConfig(category)?.label ?? category
    : "products";

  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <MapPin size={40} className="text-white/15 mb-4" />
      <p className="text-sm text-white/50">
        No {label} from {locationName}
      </p>
      {suggestedHref && suggestedName && (
        <Link
          href={suggestedHref}
          className="mt-3 text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: "#4A90D9" }}
        >
          Explore {suggestedName} for {label} &rarr;
        </Link>
      )}
    </div>
  );
}
