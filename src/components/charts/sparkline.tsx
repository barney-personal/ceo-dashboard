import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Data points, oldest first. */
  values: number[];
  /** Fixed width/height — small, for inline use in cards. */
  width?: number;
  height?: number;
  /** Stroke color. Falls back to currentColor so parent text tints it. */
  color?: string;
  /** Show a dot on the latest point. Default true. */
  showLatest?: boolean;
  className?: string;
  /** Invert so higher values render lower — for "lower is better" metrics. */
  invert?: boolean;
}

/**
 * Small inline sparkline. Renders a polyline of the provided values scaled to
 * fit [0..width] × [0..height]. Hides itself if there are fewer than 2 points
 * or if all points are identical (sparkline of a flat line conveys nothing).
 */
export function Sparkline({
  values,
  width = 72,
  height = 20,
  color,
  showLatest = true,
  className,
  invert = false,
}: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) {
    // Draw a flat baseline so the card doesn't feel empty.
    const midY = height / 2;
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn("shrink-0", className)}
        style={color ? { color } : undefined}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={midY}
          x2={width}
          y2={midY}
          stroke="currentColor"
          strokeWidth={1.25}
          strokeOpacity={0.4}
        />
      </svg>
    );
  }

  const stepX = width / (values.length - 1);
  // Leave a half-pixel of padding on top/bottom so the latest dot doesn't clip.
  const padY = 1.5;
  const usable = height - padY * 2;
  const scaled = values.map((v, i) => {
    const normalized = (v - min) / range;
    const y = invert ? padY + normalized * usable : padY + (1 - normalized) * usable;
    return { x: i * stepX, y };
  });
  const path = scaled.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = scaled[scaled.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
      style={color ? { color } : undefined}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLatest && (
        <circle cx={last.x} cy={last.y} r={1.75} fill="currentColor" />
      )}
    </svg>
  );
}
