"use client";

import { useEffect, useState } from "react";
import { MousePointerClick, Search } from "lucide-react";

const STORAGE_KEY = "explore-onboarding-seen";

interface Props {
  theme?: "dark" | "light";
}

export default function OnboardingHint({ theme = "dark" }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    setVisible(true);

    const timer = setTimeout(() => dismiss(), 5000);

    const handleClick = () => dismiss();
    window.addEventListener("click", handleClick, { once: true });

    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick);
    };
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // storage unavailable
    }
  }

  if (!visible) return null;

  return (
    <div
      className={`absolute bottom-20 left-1/2 z-20 w-[min(92vw,520px)] -translate-x-1/2 rounded-2xl px-4 py-3 backdrop-blur-sm animate-fade-in-up ${
        theme === "light" ? "border border-slate-200 bg-white/95 shadow-lg" : "border border-white/[0.1] bg-white/[0.08]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-full p-2 ${theme === "light" ? "bg-slate-100" : "bg-white/10"}`}>
          <MousePointerClick size={16} className={theme === "light" ? "shrink-0 text-slate-700" : "shrink-0 text-white/70"} />
        </div>
        <div className="min-w-0">
          <p className={theme === "light" ? "text-sm font-medium text-slate-900" : "text-sm font-medium text-white/85"}>How to explore the map</p>
          <p className={theme === "light" ? "mt-1 text-xs leading-relaxed text-slate-600" : "mt-1 text-xs leading-relaxed text-white/60"}>
            Start with a country, open a region, then explore products for that location.
            You can also use search to jump straight to a place.
          </p>
          <div className={theme === "light" ? "mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400" : "mt-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/35"}>
            <span>Country</span>
            <span>&rarr;</span>
            <span>Region</span>
            <span>&rarr;</span>
            <span>Products</span>
            <span className={theme === "light" ? "ml-2 inline-flex items-center gap-1 normal-case tracking-normal text-slate-500" : "ml-2 inline-flex items-center gap-1 normal-case tracking-normal text-white/45"}>
              <Search size={12} />
              Search available
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
