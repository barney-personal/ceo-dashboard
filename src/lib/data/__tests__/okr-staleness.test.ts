import { describe, it, expect } from "vitest";
import {
  STALE_DAYS,
  daysSince,
  formatUpdatedAgo,
  formatAbsoluteDate,
  staleToneClasses,
} from "../okr-staleness";

const FIXED_NOW = new Date("2026-04-22T12:00:00Z").getTime();

describe("daysSince", () => {
  it("returns 0 for a timestamp in the same day window (<24h earlier)", () => {
    const iso = new Date(FIXED_NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(daysSince(iso, FIXED_NOW)).toBe(0);
  });

  it("floors fractional days (23h59m is still 0)", () => {
    const iso = new Date(FIXED_NOW - (86_400_000 - 60_000)).toISOString();
    expect(daysSince(iso, FIXED_NOW)).toBe(0);
  });

  it("returns 1 for exactly 24h ago", () => {
    const iso = new Date(FIXED_NOW - 86_400_000).toISOString();
    expect(daysSince(iso, FIXED_NOW)).toBe(1);
  });

  it("returns 16 for sixteen full days ago", () => {
    const iso = new Date(FIXED_NOW - 16 * 86_400_000).toISOString();
    expect(daysSince(iso, FIXED_NOW)).toBe(16);
  });

  it("clamps future-dated timestamps to 0 (no negative days)", () => {
    const iso = new Date(FIXED_NOW + 5 * 86_400_000).toISOString();
    expect(daysSince(iso, FIXED_NOW)).toBe(0);
  });
});

describe("formatUpdatedAgo", () => {
  it("returns 'today' for 0 days", () => {
    expect(formatUpdatedAgo(0)).toBe("today");
  });

  it("returns 'yesterday' for 1 day", () => {
    expect(formatUpdatedAgo(1)).toBe("yesterday");
  });

  it("returns 'Nd ago' for N>=2", () => {
    expect(formatUpdatedAgo(2)).toBe("2d ago");
    expect(formatUpdatedAgo(29)).toBe("29d ago");
  });
});

describe("formatAbsoluteDate", () => {
  it("renders month and day (no year)", () => {
    const output = formatAbsoluteDate("2026-04-20T15:00:00Z");
    // Locale-dependent exact text; assert it contains the month abbrev and day
    expect(output).toMatch(/Apr/);
    expect(output).toMatch(/20/);
  });
});

describe("staleToneClasses", () => {
  it("returns muted tone for fresh updates (<= STALE_DAYS)", () => {
    expect(staleToneClasses(0)).toBe("text-muted-foreground/70");
    expect(staleToneClasses(STALE_DAYS)).toBe("text-muted-foreground/70");
  });

  it("returns warning tone just past STALE_DAYS", () => {
    expect(staleToneClasses(STALE_DAYS + 1)).toBe("text-warning");
    expect(staleToneClasses(30)).toBe("text-warning");
  });

  it("returns negative tone past 30 days", () => {
    expect(staleToneClasses(31)).toBe("text-negative");
    expect(staleToneClasses(120)).toBe("text-negative");
  });
});
