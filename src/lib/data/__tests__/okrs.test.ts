import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  okrUpdates: { postedAt: "postedAt" },
  squads: { isActive: "isActive" },
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
}));

import {
  getSlackMessageUrl,
  groupLatestOkrRows,
  type OkrUpdateRow,
} from "../okrs";

describe("groupLatestOkrRows", () => {
  it("keeps only the latest Slack message per squad and groups by pillar", () => {
    const grouped = groupLatestOkrRows([
      {
        pillar: "Growth",
        squadName: "Growth Conversion",
        objectiveName: "Grow",
        krName: "KR 1",
        status: "on_track",
        actual: "10",
        target: "20",
        userName: "Alice",
        postedAt: new Date("2026-04-08T10:00:00Z"),
        channelId: "C123",
        slackTs: "200.0002",
      },
      {
        pillar: "Growth",
        squadName: "Growth Conversion",
        objectiveName: "Grow",
        krName: "KR 2",
        status: "behind",
        actual: "1",
        target: "5",
        userName: "Alice",
        postedAt: new Date("2026-04-08T10:00:00Z"),
        channelId: "C123",
        slackTs: "200.0002",
      },
      {
        pillar: "Growth",
        squadName: "Growth Conversion",
        objectiveName: "Grow",
        krName: "Old KR",
        status: "on_track",
        actual: "9",
        target: "9",
        userName: "Alice",
        postedAt: new Date("2026-04-01T10:00:00Z"),
        channelId: "C123",
        slackTs: "199.0001",
      },
      {
        pillar: null,
        squadName: "Unknown Squad",
        objectiveName: "Stabilise",
        krName: "KR 3",
        status: "at_risk",
        actual: null,
        target: null,
        userName: "Bob",
        postedAt: new Date("2026-04-07T10:00:00Z"),
        channelId: "C999",
        slackTs: "150.0001",
      },
    ] satisfies OkrUpdateRow[]);

    expect(grouped.get("Growth")?.map((okr) => okr.krName)).toEqual([
      "KR 1",
      "KR 2",
    ]);
    expect(grouped.get("Other")?.map((okr) => okr.krName)).toEqual(["KR 3"]);
  });
});

describe("getSlackMessageUrl", () => {
  it("builds a Slack permalink from a channel id and message timestamp", () => {
    expect(getSlackMessageUrl("C123456", "1712512345.6789")).toBe(
      "https://cleo-team.slack.com/archives/C123456/p17125123456789",
    );
  });
});
