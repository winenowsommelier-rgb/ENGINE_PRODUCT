/**
 * TrustBar — a thin, calm reassurance strip.
 *
 * Positions WNLQ9 as a professional wine & spirits specialist serving
 * Thailand HoReCa businesses. Exported for reuse near the top of the home
 * and shop pages (placed by Task 12).
 *
 * Server component (no interactivity). Quiet styling: secondary surface,
 * readable muted text on the 18px scale.
 */
export function TrustBar() {
  return (
    <div className="w-full border-b border-border bg-secondary">
      <p className="container py-2.5 text-center text-xs leading-relaxed text-muted-foreground sm:text-base">
        Wine & spirits specialists, serving Thailand HoReCa
      </p>
    </div>
  );
}
