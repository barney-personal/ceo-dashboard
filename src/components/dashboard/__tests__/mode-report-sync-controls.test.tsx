import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModeReportSyncControls } from "@/components/dashboard/mode-report-sync-controls";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh,
  }),
}));

describe("ModeReportSyncControls", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("posts the requested report token and refreshes after queueing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: "queued" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ModeReportSyncControls
        activeModeScopeDescription={null}
        reports={[
          {
            name: "Alpha Report",
            reportToken: "report-alpha",
            section: "product",
            modeUrl: "https://example.com/report-alpha",
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/sync/mode/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportToken: "report-alpha" }),
      });
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect(
      screen.getByText("Queued Alpha Report for re-sync.")
    ).toBeInTheDocument();
  });

  it("disables triggers while another Mode sync is already active", () => {
    render(
      <ModeReportSyncControls
        activeModeScopeDescription="all Mode reports"
        reports={[
          {
            name: "Alpha Report",
            reportToken: "report-alpha",
            section: "product",
            modeUrl: "https://example.com/report-alpha",
          },
        ]}
      />
    );

    expect(screen.getByRole("button", { name: "Trigger" })).toBeDisabled();
    expect(
      screen.getByText(/Mode sync is currently active for all Mode reports/i)
    ).toBeInTheDocument();
  });
});
