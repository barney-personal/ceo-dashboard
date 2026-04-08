import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RouteErrorState } from "../route-error-state";

describe("RouteErrorState", () => {
  it("renders the error copy and digest", () => {
    render(
      <RouteErrorState
        title="The dashboard hit a snag"
        description="Retry the route to fetch fresh data."
        digest="abc123"
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "The dashboard hit a snag" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Retry the route to fetch fresh data."),
    ).toBeInTheDocument();
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is pressed", () => {
    const onRetry = vi.fn();

    render(
      <RouteErrorState
        title="Something broke"
        description="Please try again."
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
