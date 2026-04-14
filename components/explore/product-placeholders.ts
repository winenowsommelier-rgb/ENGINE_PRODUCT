import type { ExploreProduct } from "@/lib/explore/types";

const wine = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 100"><path d="M15 5h10v20l5 10v50c0 5.5-4.5 10-10 10s-10-4.5-10-10V35l5-10V5z" fill="rgba(114,47,55,0.3)" stroke="rgba(114,47,55,0.6)" stroke-width="1"/></svg>'
)}`;

const spirits = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 100"><rect x="12" y="5" width="16" height="10" rx="2" fill="rgba(181,101,29,0.3)" stroke="rgba(181,101,29,0.6)" stroke-width="1"/><rect x="10" y="15" width="20" height="70" rx="3" fill="rgba(181,101,29,0.3)" stroke="rgba(181,101,29,0.6)" stroke-width="1"/></svg>'
)}`;

const beer = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 100"><rect x="10" y="10" width="20" height="75" rx="3" fill="rgba(218,165,32,0.3)" stroke="rgba(218,165,32,0.6)" stroke-width="1"/></svg>'
)}`;

const sake = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 100"><rect x="14" y="5" width="12" height="8" rx="1" fill="rgba(95,133,117,0.3)" stroke="rgba(95,133,117,0.6)" stroke-width="1"/><rect x="10" y="13" width="20" height="72" rx="2" fill="rgba(95,133,117,0.3)" stroke="rgba(95,133,117,0.6)" stroke-width="1"/></svg>'
)}`;

export function getPlaceholderSvg(p: ExploreProduct): string {
  const cl = (p.classification || "").toLowerCase();
  if (cl.includes("wine") || cl.includes("champagne")) return wine;
  if (
    cl.includes("whisky") ||
    cl.includes("gin") ||
    cl.includes("rum") ||
    cl.includes("tequila") ||
    cl.includes("vodka") ||
    cl.includes("brandy") ||
    cl.includes("liqueur") ||
    cl.includes("cognac")
  )
    return spirits;
  if (cl.includes("beer")) return beer;
  if (cl.includes("sake") || cl.includes("shochu")) return sake;
  return spirits;
}
