const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(diffMs: number): string {
  if (diffMs < MINUTE) {
    return "just now";
  }
  if (diffMs < HOUR) {
    const m = Math.floor(diffMs / MINUTE);
    return `${m}m ago`;
  }
  if (diffMs < DAY) {
    const h = Math.floor(diffMs / HOUR);
    return `${h}h ago`;
  }
  const d = Math.floor(diffMs / DAY);
  return `${d}d ago`;
}

function formatAbsolute(date: Date): string {
  return `${ABSOLUTE_FORMATTER.format(date)} UTC`;
}

export interface LastSyncedAtProps {
  at: Date | string | null | undefined;
  prefix?: string;
  now?: Date;
  className?: string;
}

/**
 * Render "<prefix> 3h ago" with an absolute UTC timestamp in the `title`
 * tooltip. Server-renderable — relative text is computed from `now` (or
 * `new Date()`), so the first paint matches the server render and the
 * `dateTime` attribute stays authoritative.
 */
export function LastSyncedAt({
  at,
  prefix = "Last synced",
  now,
  className,
}: LastSyncedAtProps) {
  if (!at) {
    return (
      <span className={className}>{`${prefix} — never`}</span>
    );
  }

  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) {
    return (
      <span className={className}>{`${prefix} — never`}</span>
    );
  }

  const reference = now ?? new Date();
  const diffMs = Math.max(0, reference.getTime() - date.getTime());

  return (
    <time
      dateTime={date.toISOString()}
      title={formatAbsolute(date)}
      className={className}
    >
      {`${prefix} ${formatRelative(diffMs)}`}
    </time>
  );
}
