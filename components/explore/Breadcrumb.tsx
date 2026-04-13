"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BreadcrumbItem } from "@/lib/explore/types";

interface Props {
  items: BreadcrumbItem[];
}

export default function Breadcrumb({ items }: Props) {
  return (
    <nav aria-label="Map navigation breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-white/30" />}
            {isLast ? (
              <span className="text-white font-medium">{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className="inline-flex items-center min-h-[44px] px-1 text-white/60 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none rounded"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
