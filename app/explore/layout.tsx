import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Explore Wine & Spirits by Region",
  description:
    "Discover wines, spirits, beer and sake from around the world. Browse by region on our interactive map.",
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0a0a1a]">
      {children}
    </div>
  );
}
