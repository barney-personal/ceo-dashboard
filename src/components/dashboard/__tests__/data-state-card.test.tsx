import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataStateCard } from "../data-state-card";

const NOW = new Date("2026-04-17T12:00:00Z");

describe("DataStateCard", () => {
  it("renders the empty variant with onboarding copy and no last-synced stamp", () => {
    render(
      <DataStateCard
        variant="empty"
        title="OKR updates from Slack"
        lastSyncedAt={null}
        now={NOW}
      />,
    );

    const card = screen.getByTestId("data-state-card");
    expect(card).toHaveAttribute("data-variant", "empty");
    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(
      screen.getByText("OKR updates from Slack"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
  });

  it("renders the stale variant with a relative last-synced stamp", () => {
    const lastSynced = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);

    render(
      <DataStateCard
        variant="stale"
        title="Unit economics data from Mode Analytics"
        lastSyncedAt={lastSynced}
        now={NOW}
      />,
    );

    const card = screen.getByTestId("data-state-card");
    expect(card).toHaveAttribute("data-variant", "stale");
    expect(screen.getByText("Data may be stale")).toBeInTheDocument();
    expect(screen.getByText("Last synced 3h ago")).toBeInTheDocument();
  });

  it("renders the unavailable variant with DB-down copy and optional last-synced", () => {
    const lastSynced = new Date(NOW.getTime() - 90 * 60 * 1000);

    render(
      <DataStateCard
        variant="unavailable"
        title="Dashboard database"
        lastSyncedAt={lastSynced}
        now={NOW}
      />,
    );

    const card = screen.getByTestId("data-state-card");
    expect(card).toHaveAttribute("data-variant", "unavailable");
    expect(
      screen.getByText("Data temporarily unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Last synced 1h ago")).toBeInTheDocument();
  });

  it("respects a custom description override", () => {
    render(
      <DataStateCard
        variant="empty"
        title="Management accounts from Slack"
        description="Drop a new xlsx into #fyi-management_accounts to onboard."
      />,
    );

    expect(
      screen.getByText("Drop a new xlsx into #fyi-management_accounts to onboard."),
    ).toBeInTheDocument();
  });
});
