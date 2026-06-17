/**
 * TrustBar — a thin, calm reassurance strip.
 *
 * Sets shopper expectations without alarm: this is a browse-and-enquire
 * storefront (no online checkout yet). Exported for reuse near the top of the
 * home and shop pages (placed by Task 12).
 *
 * Server component (no interactivity). Quiet styling: secondary surface,
 * readable muted text on the 18px scale.
 */
export function TrustBar() {
  return (
    <div className="w-full border-b border-border bg-secondary">
      <p className="container py-2.5 text-center text-sm text-muted-foreground">
        Browse freely · Contact us to order · No online payment yet.
      </p>
    </div>
  );
}
