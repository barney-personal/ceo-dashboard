import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EngineeringBRoot,
  resolvePersona,
} from "@/components/dashboard/engineering-b/root";

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

describe("EngineeringBRoot", () => {
  it("renders the manager persona copy for CEO", () => {
    render(<EngineeringBRoot effectiveRole="ceo" />);
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-persona")).toBe("manager");
    expect(screen.getByText(/Manager view/i)).toBeInTheDocument();
    expect(screen.queryByText(/Engineer view/i)).not.toBeInTheDocument();
  });

  it("renders the engineer persona copy for non-leadership", () => {
    render(<EngineeringBRoot effectiveRole="everyone" />);
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-persona")).toBe("engineer");
    expect(screen.getByText(/Engineer view/i)).toBeInTheDocument();
    expect(screen.queryByText(/Manager view/i)).not.toBeInTheDocument();
  });

  it("advertises the B-side surface framing regardless of persona", () => {
    render(<EngineeringBRoot effectiveRole="leadership" />);
    expect(screen.getByText(/B-side surface/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Single root\. No tabs\. No impact model\./i),
    ).toBeInTheDocument();
  });
});
