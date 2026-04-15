import { describe, expect, it } from "vitest";
import {
  formatUptime,
  formatLatency,
  formatRelativeTime,
  statusColor,
  heartbeatBadge,
  type SerializedTimelineRun,
  serializeSummary,
  serializeTimelineRun,
  groupTimelineByHour,
} from "../format";

// ---------------------------------------------------------------------------
// formatUptime
// ---------------------------------------------------------------------------

describe("formatUptime", () => {
  it("renders percentage with % suffix", () => {
    expect(formatUptime(99)).toBe("99%");
  });

  it("returns '—' for null", () => {
    expect(formatUptime(null)).toBe("—");
  });

  it("renders 0% for zero", () => {
    expect(formatUptime(0)).toBe("0%");
  });

  it("renders 100% for full uptime", () => {
    expect(formatUptime(100)).toBe("100%");
  });
});

// ---------------------------------------------------------------------------
// formatLatency
// ---------------------------------------------------------------------------

describe("formatLatency", () => {
  it("renders ms suffix for integer", () => {
    expect(formatLatency(120)).toBe("120ms");
  });

  it("rounds decimal to nearest integer", () => {
    expect(formatLatency(105.5)).toBe("106ms");
  });

  it("returns '—' for null", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  const now = new Date("2026-04-14T10:00:00Z");

  it("shows seconds for very recent", () => {
    const ts = "2026-04-14T09:59:30Z";
    expect(formatRelativeTime(ts, now)).toBe("30s ago");
  });

  it("shows minutes for > 60 seconds", () => {
    const ts = "2026-04-14T09:55:00Z";
    expect(formatRelativeTime(ts, now)).toBe("5m ago");
  });

  it("shows hours for > 60 minutes", () => {
    const ts = "2026-04-14T07:00:00Z";
    expect(formatRelativeTime(ts, now)).toBe("3h ago");
  });

  it("shows days for > 24 hours", () => {
    const ts = "2026-04-12T10:00:00Z";
    expect(formatRelativeTime(ts, now)).toBe("2d ago");
  });

  it("returns '—' for null", () => {
    expect(formatRelativeTime(null, now)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// statusColor
// ---------------------------------------------------------------------------

describe("statusColor", () => {
  it("returns green class for green status", () => {
    expect(statusColor("green")).toBe("text-positive");
  });

  it("returns red class for red status", () => {
    expect(statusColor("red")).toBe("text-destructive");
  });

  it("returns yellow class for timeout", () => {
    expect(statusColor("timeout")).toBe("text-warning");
  });

  it("returns muted class for null", () => {
    expect(statusColor(null)).toBe("text-muted-foreground");
  });

  it("returns muted class for unknown status", () => {
    expect(statusColor("unknown")).toBe("text-muted-foreground");
  });
});

// ---------------------------------------------------------------------------
// heartbeatBadge
// ---------------------------------------------------------------------------

describe("heartbeatBadge", () => {
  it("returns fresh badge when heartbeat is fresh", () => {
    const badge = heartbeatBadge(true);
    expect(badge.label).toBe("Fresh");
    expect(badge.className).toContain("positive");
  });

  it("returns stale badge when heartbeat is not fresh", () => {
    const badge = heartbeatBadge(false);
    expect(badge.label).toBe("Stale");
    expect(badge.className).toContain("warning");
  });
});

// ---------------------------------------------------------------------------
// serializeSummary
// ---------------------------------------------------------------------------

describe("serializeSummary", () => {
  it("converts Date fields to ISO strings", () => {
    const input = {
      checkName: "ceo-ping-auth",
      latestStatus: "green" as const,
      latestRunTs: new Date("2026-04-14T10:00:00Z"),
      heartbeatFresh: true,
      heartbeatLastSeen: new Date("2026-04-14T09:58:00Z"),
      heartbeatVersion: "1.0.0",
      openIncident: null,
      uptimePercent7d: 100,
      latencyP50: 120,
      latencyP95: 200,
      recentRedEvents: [],
    };

    const result = serializeSummary(input);

    expect(result.latestRunTs).toBe("2026-04-14T10:00:00.000Z");
    expect(result.heartbeatLastSeen).toBe("2026-04-14T09:58:00.000Z");
    expect(result.checkName).toBe("ceo-ping-auth");
  });

  it("preserves null dates as null", () => {
    const input = {
      checkName: "ceo-ping-auth",
      latestStatus: null,
      latestRunTs: null,
      heartbeatFresh: false,
      heartbeatLastSeen: null,
      heartbeatVersion: null,
      openIncident: null,
      uptimePercent7d: null,
      latencyP50: null,
      latencyP95: null,
      recentRedEvents: [],
    };

    const result = serializeSummary(input);

    expect(result.latestRunTs).toBeNull();
    expect(result.heartbeatLastSeen).toBeNull();
  });

  it("serializes open incident dates", () => {
    const input = {
      checkName: "ceo-ping-auth",
      latestStatus: "red" as const,
      latestRunTs: new Date("2026-04-14T10:00:00Z"),
      heartbeatFresh: true,
      heartbeatLastSeen: new Date("2026-04-14T10:00:00Z"),
      heartbeatVersion: "1.0.0",
      openIncident: {
        id: 42,
        escalationLevel: 2,
        openedAt: new Date("2026-04-14T09:00:00Z"),
      },
      uptimePercent7d: 80,
      latencyP50: 100,
      latencyP95: 200,
      recentRedEvents: [
        { ts: new Date("2026-04-14T09:30:00Z"), latencyMs: 500, details: { error: "timeout" } },
      ],
    };

    const result = serializeSummary(input);

    expect(result.openIncident!.openedAt).toBe("2026-04-14T09:00:00.000Z");
    expect(result.recentRedEvents[0].ts).toBe("2026-04-14T09:30:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// serializeTimelineRun
// ---------------------------------------------------------------------------

describe("serializeTimelineRun", () => {
  it("converts ts to ISO string and preserves other fields", () => {
    const input = {
      id: 1,
      probeId: "gh-actions",
      checkName: "ceo-ping-auth",
      status: "green",
      latencyMs: 120,
      detailsJson: null,
      runId: null,
      target: "prod",
      ts: new Date("2026-04-14T10:00:00Z"),
    };

    const result = serializeTimelineRun(input);

    expect(result.ts).toBe("2026-04-14T10:00:00.000Z");
    expect(result.checkName).toBe("ceo-ping-auth");
    expect(result.status).toBe("green");
  });
});

// ---------------------------------------------------------------------------
// groupTimelineByHour
// ---------------------------------------------------------------------------

describe("groupTimelineByHour", () => {
  it("groups runs by hour bucket", () => {
    const runs: SerializedTimelineRun[] = [
      { id: 1, probeId: "gh", checkName: "a", status: "green", latencyMs: 100, detailsJson: null, runId: null, target: "prod", ts: "2026-04-14T10:15:00.000Z" },
      { id: 2, probeId: "gh", checkName: "a", status: "red", latencyMs: 200, detailsJson: null, runId: null, target: "prod", ts: "2026-04-14T10:45:00.000Z" },
      { id: 3, probeId: "gh", checkName: "a", status: "green", latencyMs: 100, detailsJson: null, runId: null, target: "prod", ts: "2026-04-14T09:30:00.000Z" },
    ];

    const groups = groupTimelineByHour(runs);

    expect(groups).toHaveLength(2);
    expect(groups[0].hour).toBe("2026-04-14T10:00:00.000Z");
    expect(groups[0].runs).toHaveLength(2);
    expect(groups[1].hour).toBe("2026-04-14T09:00:00.000Z");
    expect(groups[1].runs).toHaveLength(1);
  });

  it("returns empty array for no runs", () => {
    expect(groupTimelineByHour([])).toEqual([]);
  });
});
