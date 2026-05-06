"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { BreadcrumbItem } from "@/lib/explore/types";

interface Props {
  items: BreadcrumbItem[];
  theme?: "dark" | "light";
}

export default function Breadcrumb({ items, theme = "dark" }: Props) {
  return (
    <nav aria-label="Map navigation breadcrumb" className="flex items-center gap-1 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.href} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className={theme === "light" ? "text-slate-400" : "text-white/30"} />}
            {isLast ? (
              <span className={theme === "light" ? "font-medium text-slate-900" : "font-medium text-white"}>{item.label}</span>
            ) : (
              <Link
                href={item.href}
                className={`inline-flex min-h-[44px] items-center rounded px-1 transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a1a] focus-visible:outline-none ${
                  theme === "light" ? "text-slate-600 hover:text-slate-900" : "text-white/60 hover:text-white"
                }`}
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
