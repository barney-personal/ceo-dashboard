/**
 * Returns the content-box width of an element (clientWidth minus horizontal padding).
 *
 * All chart components render an SVG with `className="w-full"` inside a container
 * that has horizontal padding (e.g. `px-4`). The CSS `width: 100%` sizes the SVG
 * to the content box, but `clientWidth` includes padding. Using `clientWidth`
 * directly as the SVG coordinate-space width causes the right side of the chart
 * to be clipped by the padding amount.
 */
export function getContentBoxWidth(container: HTMLElement): number {
  const style = getComputedStyle(container);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  return container.clientWidth - paddingLeft - paddingRight;
}

/**
 * Domain-stretched heatmap color: Red (low) → Yellow (mid) → Green (high).
 * Normalises `rate` into [min, max] so the full spectrum maps to the data range,
 * making small differences clearly visible.
 */
export function domainColor(rate: number, min: number, max: number): string {
  const range = max - min || 1;
  const t = Math.max(0, Math.min(1, (rate - min) / range));
  const hue = t * 142;
  const saturation = 50 + t * 10;
  const lightness = 85 - t * 30;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/** Text color with sufficient contrast against a `domainColor` background. */
export function domainTextColor(rate: number, min: number, max: number): string {
  const range = max - min || 1;
  const t = Math.max(0, Math.min(1, (rate - min) / range));
  const lightness = 85 - t * 30;
  return lightness < 62 ? "rgba(255,255,255,0.95)" : "rgba(20,20,50,0.85)";
}
