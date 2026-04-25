import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../manager-view", () => ({
  ManagerView: ({ scope }: { scope: string }) => (
    <div data-testid="manager-view-stub" data-scope={scope}>
      manager view stub
    </div>
  ),
}));

vi.mock("../engineer-view", () => ({
  EngineerView: () => (
    <div data-testid="engineer-view-stub">engineer view stub</div>
  ),
}));

import {
  EngineeringBRoot,
  resolveManagerScope,
  resolvePersona,
} from "../root";

describe("resolvePersona", () => {
  it("maps ceo to manager persona", () => {
    expect(resolvePersona("ceo")).toBe("manager");
  });

  it("maps leadership to manager persona", () => {
    expect(resolvePersona("leadership")).toBe("manager");
  });

  it("maps manager role to engineer persona (non-CEO plain managers never reach B-side in first pass)", () => {
    expect(resolvePersona("manager")).toBe("engineer");
  });

  it("maps engineering_manager to engineer persona", () => {
    expect(resolvePersona("engineering_manager")).toBe("engineer");
  });

  it("maps everyone to engineer persona", () => {
    expect(resolvePersona("everyone")).toBe("engineer");
  });
});

describe("resolveManagerScope", () => {
  it("returns org for ceo", () => {
    expect(resolveManagerScope("ceo")).toBe("org");
  });

  it("returns org for leadership", () => {
    expect(resolveManagerScope("leadership")).toBe("org");
  });

  it("returns directs for any lower role (unreachable in first pass)", () => {
    expect(resolveManagerScope("manager")).toBe("directs");
    expect(resolveManagerScope("engineering_manager")).toBe("directs");
    expect(resolveManagerScope("everyone")).toBe("directs");
  });
});

describe("EngineeringBRoot", () => {
  it("renders the manager view with org scope for CEO", () => {
    render(<EngineeringBRoot effectiveRole="ceo" />);
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-persona")).toBe("manager");
    expect(root.getAttribute("data-scope")).toBe("org");
    const view = screen.getByTestId("manager-view-stub");
    expect(view.getAttribute("data-scope")).toBe("org");
  });

  it("renders the manager view with org scope for leadership", () => {
    render(<EngineeringBRoot effectiveRole="leadership" />);
    const view = screen.getByTestId("manager-view-stub");
    expect(view.getAttribute("data-scope")).toBe("org");
  });

  it("renders the engineer view for engineer persona roles", () => {
    render(<EngineeringBRoot effectiveRole="everyone" />);
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-persona")).toBe("engineer");
    expect(screen.getByTestId("engineer-view-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("manager-view-stub")).not.toBeInTheDocument();
  });

  it("does not leak manager content to engineering_manager persona", () => {
    render(<EngineeringBRoot effectiveRole="engineering_manager" />);
    expect(screen.queryByTestId("manager-view-stub")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineer-view-stub")).toBeInTheDocument();
  });
});
