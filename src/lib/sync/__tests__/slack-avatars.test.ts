import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { selectMock, updateMock, getUserAvatarUrlMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  getUserAvatarUrlMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));

vi.mock("@/lib/integrations/slack", () => ({
  getUserAvatarUrl: getUserAvatarUrlMock,
}));

interface MockRow {
  slackUserId: string;
  slackImageUrl: string | null;
}

function mockSelect(rows: MockRow[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValueOnce({ from });
}

function mockUpdate(): {
  setSpy: ReturnType<typeof vi.fn>;
  whereSpy: ReturnType<typeof vi.fn>;
} {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  updateMock.mockReturnValueOnce({ set });
  return { setSpy: set, whereSpy: where };
}

describe("syncSlackAvatars", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
    updateMock.mockReset();
    getUserAvatarUrlMock.mockReset();
  });

  it("does NOT advance fetched_at on fetch failures (transient outages must not block retries)", async () => {
    mockSelect([{ slackUserId: "U1", slackImageUrl: null }]);
    getUserAvatarUrlMock.mockResolvedValueOnce(null);

    const { syncSlackAvatars } = await import("../slack-avatars");
    const result = await syncSlackAvatars();

    expect(result).toEqual({ total: 1, fetched: 0, unchanged: 0, failed: 1 });
    // The critical invariant: no DB write on failure. If we ever stamped
    // fetched_at here, a Slack outage would lock the row out for 30 days.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("stamps fetched_at without writing the URL when unchanged", async () => {
    mockSelect([
      { slackUserId: "U2", slackImageUrl: "https://slack/img/u2.png" },
    ]);
    getUserAvatarUrlMock.mockResolvedValueOnce("https://slack/img/u2.png");
    const { setSpy } = mockUpdate();

    const { syncSlackAvatars } = await import("../slack-avatars");
    const result = await syncSlackAvatars();

    expect(result.unchanged).toBe(1);
    expect(result.fetched).toBe(0);
    const writtenSet = setSpy.mock.calls[0][0];
    expect(writtenSet).not.toHaveProperty("slackImageUrl");
    expect(writtenSet).toHaveProperty("slackImageFetchedAt");
  });

  it("writes the new URL + fetched_at when the avatar has changed", async () => {
    mockSelect([{ slackUserId: "U3", slackImageUrl: "https://old.png" }]);
    getUserAvatarUrlMock.mockResolvedValueOnce("https://new.png");
    const { setSpy } = mockUpdate();

    const { syncSlackAvatars } = await import("../slack-avatars");
    const result = await syncSlackAvatars();

    expect(result.fetched).toBe(1);
    const writtenSet = setSpy.mock.calls[0][0];
    expect(writtenSet.slackImageUrl).toBe("https://new.png");
    expect(writtenSet).toHaveProperty("slackImageFetchedAt");
  });

  it("processes multiple rows and tallies each path independently", async () => {
    mockSelect([
      { slackUserId: "U1", slackImageUrl: null },
      { slackUserId: "U2", slackImageUrl: "https://same.png" },
      { slackUserId: "U3", slackImageUrl: "https://old.png" },
      { slackUserId: "U4", slackImageUrl: null },
    ]);
    getUserAvatarUrlMock
      .mockResolvedValueOnce("https://new1.png") // U1 → fetched
      .mockResolvedValueOnce("https://same.png") // U2 → unchanged
      .mockResolvedValueOnce("https://new3.png") // U3 → fetched
      .mockResolvedValueOnce(null); // U4 → failed
    // 3 updates expected (one per non-failure row)
    mockUpdate();
    mockUpdate();
    mockUpdate();

    const { syncSlackAvatars } = await import("../slack-avatars");
    const result = await syncSlackAvatars();

    expect(result).toEqual({
      total: 4,
      fetched: 2,
      unchanged: 1,
      failed: 1,
    });
    expect(updateMock).toHaveBeenCalledTimes(3);
  });
});
