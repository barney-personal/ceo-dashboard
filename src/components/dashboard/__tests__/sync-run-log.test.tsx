import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SyncRunLog } from "@/components/dashboard/sync-run-log";

describe("SyncRunLog", () => {
  it("shows abandoned state for expired running leases", () => {
    render(
      <SyncRunLog
        avgDurations={{ mode: 60_000 }}
        runs={[
          {
            id: 1,
            source: "mode",
            status: "running",
            trigger: "cron",
            attempt: 1,
            startedAt: "2026-04-08T11:00:00.000Z",
            completedAt: null,
            heartbeatAt: "2026-04-08T11:02:00.000Z",
            leaseExpiresAt: "2026-04-08T11:03:00.000Z",
            recordsSynced: 0,
            skipReason: null,
            errorMessage: null,
            phases: [],
          },
        ]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /mode/i })[1]);

    expect(screen.getByText("State: abandoned")).toBeInTheDocument();
  });

  it("shows queued state metadata for queued runs", () => {
    render(
      <SyncRunLog
        avgDurations={{ mode: 60_000 }}
        runs={[
          {
            id: 2,
            source: "mode",
            status: "queued",
            trigger: "manual",
            attempt: 1,
            startedAt: "2026-04-08T12:00:00.000Z",
            completedAt: null,
            heartbeatAt: null,
            leaseExpiresAt: null,
            recordsSynced: 0,
            skipReason: null,
            errorMessage: null,
            phases: [],
          },
        ]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /mode/i })[1]);

    expect(screen.getByText("State: queued")).toBeInTheDocument();
    expect(screen.getByText("Trigger: manual")).toBeInTheDocument();
  });
});
