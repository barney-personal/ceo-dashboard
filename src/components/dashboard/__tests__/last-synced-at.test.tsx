import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LastSyncedAt } from "../last-synced-at";

const NOW = new Date("2026-04-17T12:00:00Z");

describe("LastSyncedAt", () => {
  it("renders 'never' when `at` is null", () => {
    render(<LastSyncedAt at={null} now={NOW} />);
    expect(screen.getByText("Last synced — never")).toBeInTheDocument();
  });

  it("formats minutes correctly and attaches a UTC tooltip", () => {
    const at = new Date(NOW.getTime() - 5 * 60 * 1000);
    render(<LastSyncedAt at={at} now={NOW} />);

    const element = screen.getByText("Last synced 5m ago");
    expect(element.tagName).toBe("TIME");
    expect(element).toHaveAttribute("dateTime", at.toISOString());
    expect(element.getAttribute("title")).toContain("UTC");
  });

  it("formats hours and days", () => {
    const atHours = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
    const { rerender } = render(<LastSyncedAt at={atHours} now={NOW} />);
    expect(screen.getByText("Last synced 3h ago")).toBeInTheDocument();

    const atDays = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    rerender(<LastSyncedAt at={atDays} now={NOW} />);
    expect(screen.getByText("Last synced 2d ago")).toBeInTheDocument();
  });

  it("renders 'just now' for sub-minute timestamps", () => {
    const at = new Date(NOW.getTime() - 30 * 1000);
    render(<LastSyncedAt at={at} now={NOW} />);
    expect(screen.getByText("Last synced just now")).toBeInTheDocument();
  });

  it("falls back to 'never' for invalid date strings", () => {
    render(<LastSyncedAt at="not-a-date" now={NOW} />);
    expect(screen.getByText("Last synced — never")).toBeInTheDocument();
  });

  it("supports a custom prefix", () => {
    const at = new Date(NOW.getTime() - 45 * 60 * 1000);
    render(<LastSyncedAt at={at} prefix="Updated" now={NOW} />);
    expect(screen.getByText("Updated 45m ago")).toBeInTheDocument();
  });
});
