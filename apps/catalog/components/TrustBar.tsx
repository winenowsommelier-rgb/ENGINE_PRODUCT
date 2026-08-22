/**
 * TrustBar — a thin, calm reassurance strip.
 *
 * Positions WNLQ9 as a full-service professional operation with Thailand's
 * largest wine & spirits catalog, not a delivery-speed claim. Exported for
 * reuse near the top of the home and shop pages (placed by Task 12).
 *
 * Server component (no interactivity). Quiet styling: secondary surface,
 * readable muted text on the 18px scale.
 */
export function TrustBar() {
  return (
    <div className="w-full border-b border-border bg-secondary">
      <p className="container py-2.5 text-center text-xs leading-relaxed text-muted-foreground sm:text-base">
        Thailand's largest wine & spirits catalog — full-service, expert-guided
      </p>
    </div>
  );
}
