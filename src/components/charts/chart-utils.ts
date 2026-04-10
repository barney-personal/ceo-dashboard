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
