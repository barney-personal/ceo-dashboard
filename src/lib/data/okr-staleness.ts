export const STALE_DAYS = 10;

export function daysSince(iso: string, now: number = Date.now()): number {
  const ms = now - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function formatUpdatedAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function staleToneClasses(days: number): string {
  if (days > 30) return "text-negative";
  if (days > STALE_DAYS) return "text-warning";
  return "text-muted-foreground/70";
}
