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

  it("renders a summary row and amber phase detail for enriched Mode and Slack phases", () => {
    render(
      <SyncRunLog
        avgDurations={{ mode: 60_000 }}
        runs={[
          {
            id: 3,
            source: "mode",
            status: "success",
            trigger: "cron",
            attempt: 1,
            startedAt: "2026-04-08T09:00:00.000Z",
            completedAt: "2026-04-08T09:04:00.000Z",
            heartbeatAt: "2026-04-08T09:04:00.000Z",
            leaseExpiresAt: "2026-04-08T09:05:00.000Z",
            recordsSynced: 9,
            skipReason: null,
            errorMessage: null,
            phases: [
              {
                id: 301,
                phase: "sync_report:Alpha Report",
                status: "partial",
                startedAt: "2026-04-08T09:00:30.000Z",
                completedAt: "2026-04-08T09:02:00.000Z",
                detail: "Stored 9 rows — 2 queries succeeded, 1 failed, 1 warning",
                itemsProcessed: 9,
                errorMessage: null,
              },
              {
                id: 302,
                phase: "sync_channel:C123",
                status: "success",
                startedAt: "2026-04-08T09:02:00.000Z",
                completedAt: "2026-04-08T09:03:00.000Z",
                detail: "#growth-okrs — 4 parsed, 2 skipped, 7 KRs stored",
                itemsProcessed: 7,
                errorMessage: null,
              },
              {
                id: 303,
                phase: "legacy_phase",
                status: "skipped",
                startedAt: "2026-04-08T09:03:00.000Z",
                completedAt: "2026-04-08T09:03:30.000Z",
                detail: "Legacy detail string",
                itemsProcessed: 0,
                errorMessage: null,
              },
            ],
          },
        ]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /mode/i })[1]);

    expect(screen.getByTestId("phase-summary")).toHaveTextContent("Phases");
    expect(screen.getByTestId("phase-summary")).toHaveTextContent("Warnings");
    expect(screen.getByTestId("phase-summary")).toHaveTextContent("1");
    expect(screen.getByTestId("phase-summary")).toHaveTextContent("Skipped");
    expect(screen.getByTestId("phase-summary")).toHaveTextContent("16");
    expect(screen.getByText("Queries: 2 ok / 1 failed")).toBeInTheDocument();
    expect(screen.getByText("Messages: 4 parsed / 2 skipped")).toBeInTheDocument();
    expect(screen.getByText("Legacy detail string")).toBeInTheDocument();
    expect(screen.getByTestId("phase-row-301")).toHaveAttribute("data-phase-status", "partial");
  });
});
