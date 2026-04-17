// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

import { decideAlert, runAlerter } from "../alerter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-14T12:00:00Z");
const CHECK = "ceo-ping-auth";

function run(status: string, offsetMs = 0, details?: Record<string, unknown>) {
  return {
    status,
    ts: new Date(NOW.getTime() - offsetMs),
    detailsJson: details ?? null,
  };
}

function incident(overrides: {
  id?: number;
  openedAt?: Date;
  escalationLevel?: number;
  lastAlertedAt?: Date | null;
} = {}) {
  const openedAt = overrides.openedAt ?? new Date(NOW.getTime() - 10 * 60_000);
  return {
    id: overrides.id ?? 1,
    openedAt,
    escalationLevel: overrides.escalationLevel ?? 0,
    lastAlertedAt: overrides.lastAlertedAt !== undefined
      ? overrides.lastAlertedAt
      : openedAt,
  };
}

// ---------------------------------------------------------------------------
// decideAlert — pure function tests
// ---------------------------------------------------------------------------

describe("decideAlert", () => {
  it("green run with no open incident returns none", () => {
    const result = decideAlert(CHECK, [run("green")], null, NOW);
    expect(result.action).toBe("none");
  });

  it("first red with no open incident fires open_incident", () => {
    const result = decideAlert(
      CHECK,
      [run("red", 0, { reason: "connection refused" })],
      null,
      NOW
    );
    expect(result.action).toBe("open_incident");
    expect(result).toMatchObject({
      message: expect.stringMatching(/🚨.*failed/),
    });
    expect(result).toMatchObject({ message: expect.stringContaining(CHECK) });
  });

  it("first timeout with no open incident fires open_incident", () => {
    const result = decideAlert(CHECK, [run("timeout")], null, NOW);
    expect(result.action).toBe("open_incident");
    expect(result).toMatchObject({ message: expect.stringMatching(/🚨/) });
  });

  it("3 consecutive reds with level-0 incident escalates", () => {
    const runs = [
      run("red", 0),
      run("red", 5 * 60_000),
      run("red", 10 * 60_000),
    ];
    const inc = incident({ escalationLevel: 0 });
    const result = decideAlert(CHECK, runs, inc, NOW);
    expect(result.action).toBe("escalate");
    expect(result).toMatchObject({
      incidentId: inc.id,
      level: 1,
      message: expect.stringMatching(/⚠️.*still failing/),
    });
  });

  it("green run with open incident triggers recovery", () => {
    const inc = incident({
      openedAt: new Date(NOW.getTime() - 20 * 60_000),
      escalationLevel: 1,
    });
    const result = decideAlert(
      CHECK,
      [run("green"), run("red", 5 * 60_000)],
      inc,
      NOW
    );
    expect(result.action).toBe("recover");
    expect(result).toMatchObject({
      incidentId: inc.id,
      message: expect.stringMatching(/✅.*recovered/),
    });
  });

  it("flap (red–green–red) does not escalate", () => {
    // Only 1 consecutive red at the top; green breaks the streak
    const runs = [
      run("red", 0),
      run("green", 5 * 60_000),
      run("red", 10 * 60_000),
    ];
    // Incident opened for the latest red, lastAlertedAt = 5 min ago
    const inc = incident({ lastAlertedAt: new Date(NOW.getTime() - 5 * 60_000) });
    const result = decideAlert(CHECK, runs, inc, NOW);
    expect(result.action).toBe("none");
  });

  it("reminder is suppressed when reminder interval has not elapsed", () => {
    const runs = [run("red", 0), run("red", 5 * 60_000), run("red", 10 * 60_000), run("red", 15 * 60_000)];
    const inc = incident({
      escalationLevel: 1,
      lastAlertedAt: new Date(NOW.getTime() - 30 * 60_000), // 30 min ago
    });
    const result = decideAlert(CHECK, runs, inc, NOW);
    expect(result.action).toBe("none");
  });

  it("reminder fires when reminder interval has elapsed", () => {
    const runs = [run("red", 0), run("red", 5 * 60_000), run("red", 10 * 60_000), run("red", 15 * 60_000)];
    const inc = incident({
      escalationLevel: 1,
      lastAlertedAt: new Date(NOW.getTime() - 90 * 60_000), // 90 min ago
    });
    const result = decideAlert(CHECK, runs, inc, NOW);
    expect(result.action).toBe("remind");
    expect(result).toMatchObject({
      incidentId: inc.id,
      message: expect.stringContaining("still failing"),
    });
  });

  it("escalation with already-level-1 incident does not re-escalate (reminder path)", () => {
    const runs = [run("red", 0), run("red", 5 * 60_000), run("red", 10 * 60_000)];
    const inc = incident({
      escalationLevel: 1, // already escalated
      lastAlertedAt: new Date(NOW.getTime() - 90 * 60_000),
    });
    const result = decideAlert(CHECK, runs, inc, NOW);
    // Should send a reminder, not escalate again
    expect(result.action).toBe("remind");
  });

  it("empty runs list returns none", () => {
    const result = decideAlert(CHECK, [], null, NOW);
    expect(result.action).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// runAlerter — wired tests (mock repo + telegram)
// ---------------------------------------------------------------------------

vi.mock("../repo", () => ({
  lastRunsForCheck: vi.fn(),
  openIncidentForCheck: vi.fn(),
  openIncident: vi.fn(),
  closeIncident: vi.fn(),
  escalateIncident: vi.fn(),
  setLastAlertedAt: vi.fn(),
}));

vi.mock("../telegram", () => ({
  sendTelegram: vi.fn(),
}));

import * as repo from "../repo";
import * as tg from "../telegram";

describe("runAlerter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    (tg.sendTelegram as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, messageId: 1 });
  });

  it("does nothing on green run with no open incident", async () => {
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "green", ts: NOW, detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await runAlerter(CHECK);

    expect(repo.openIncident).not.toHaveBeenCalled();
    expect(tg.sendTelegram).not.toHaveBeenCalled();
  });

  it("opens incident and sends Telegram on first red", async () => {
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "red", ts: NOW, detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repo.openIncident as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });

    await runAlerter(CHECK);

    expect(repo.openIncident).toHaveBeenCalledWith(CHECK, 0);
    expect(tg.sendTelegram).toHaveBeenCalledOnce();
    expect((tg.sendTelegram as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("🚨");
  });

  it("does not send Telegram when openIncident returns null (concurrency conflict)", async () => {
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "red", ts: NOW, detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repo.openIncident as ReturnType<typeof vi.fn>).mockResolvedValue(null); // conflict

    await runAlerter(CHECK);

    expect(tg.sendTelegram).not.toHaveBeenCalled();
  });

  it("closes incident and sends recovery Telegram on green", async () => {
    const inc = incident({ id: 5 });
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "green", ts: NOW, detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(inc);
    (repo.closeIncident as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await runAlerter(CHECK);

    expect(repo.closeIncident).toHaveBeenCalledWith(5);
    expect(tg.sendTelegram).toHaveBeenCalledOnce();
    expect((tg.sendTelegram as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("✅");
  });

  it("escalates and sends escalation Telegram on 3 consecutive reds", async () => {
    const inc = incident({ id: 7, escalationLevel: 0 });
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "red", ts: NOW, detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 5 * 60_000), detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 10 * 60_000), detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(inc);
    (repo.escalateIncident as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await runAlerter(CHECK);

    expect(repo.escalateIncident).toHaveBeenCalledWith(7, 1, expect.any(Date));
    expect(tg.sendTelegram).toHaveBeenCalledOnce();
    expect((tg.sendTelegram as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain("⚠️");
  });

  it("suppresses duplicate escalation when escalateIncident returns false", async () => {
    const inc = incident({ id: 7, escalationLevel: 0 });
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "red", ts: NOW, detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 5 * 60_000), detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 10 * 60_000), detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(inc);
    (repo.escalateIncident as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await runAlerter(CHECK);

    expect(repo.escalateIncident).toHaveBeenCalled();
    expect(tg.sendTelegram).not.toHaveBeenCalled();
  });

  it("suppresses duplicate recovery when closeIncident returns false", async () => {
    const inc = incident({ id: 5 });
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "green", ts: NOW, detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(inc);
    (repo.closeIncident as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await runAlerter(CHECK);

    expect(repo.closeIncident).toHaveBeenCalledWith(5);
    expect(tg.sendTelegram).not.toHaveBeenCalled();
  });

  it("suppresses duplicate reminder when setLastAlertedAt returns false", async () => {
    const inc = incident({
      id: 9,
      escalationLevel: 1,
      lastAlertedAt: new Date(NOW.getTime() - 90 * 60_000),
    });
    (repo.lastRunsForCheck as ReturnType<typeof vi.fn>).mockResolvedValue([
      { status: "red", ts: NOW, detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 5 * 60_000), detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 10 * 60_000), detailsJson: null },
      { status: "red", ts: new Date(NOW.getTime() - 15 * 60_000), detailsJson: null },
    ]);
    (repo.openIncidentForCheck as ReturnType<typeof vi.fn>).mockResolvedValue(inc);
    (repo.setLastAlertedAt as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await runAlerter(CHECK);

    expect(repo.setLastAlertedAt).toHaveBeenCalled();
    expect(tg.sendTelegram).not.toHaveBeenCalled();
  });
});
