"use client";

import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";

const STORAGE_KEY = "explore-onboarding-seen";

export default function OnboardingHint() {
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
      className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-white/[0.08] backdrop-blur-sm border border-white/[0.1] px-4 py-2 animate-fade-in-up"
    >
      <MousePointerClick size={16} className="text-white/60 shrink-0" />
      <span className="text-sm text-white/70 whitespace-nowrap">
        Tap a country to start exploring
      </span>
    </div>
  );
}
