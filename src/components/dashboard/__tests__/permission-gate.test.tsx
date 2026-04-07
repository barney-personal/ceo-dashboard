import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PermissionGate } from "../permission-gate";

describe("PermissionGate", () => {
  it("renders children when user has exact required role", () => {
    render(
      <PermissionGate role="ceo" requiredRole="ceo">
        <p>Secret content</p>
      </PermissionGate>
    );
    expect(screen.getByText("Secret content")).toBeInTheDocument();
  });

  it("renders children when user has higher role than required", () => {
    render(
      <PermissionGate role="ceo" requiredRole="everyone">
        <p>Visible content</p>
      </PermissionGate>
    );
    expect(screen.getByText("Visible content")).toBeInTheDocument();
  });

  it("renders nothing when user lacks access", () => {
    const { container } = render(
      <PermissionGate role="everyone" requiredRole="ceo">
        <p>Hidden content</p>
      </PermissionGate>
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    expect(container.innerHTML).toBe("");
  });

  it("renders fallback when user lacks access and fallback is provided", () => {
    render(
      <PermissionGate
        role="everyone"
        requiredRole="ceo"
        fallback={<p>Access denied</p>}
      >
        <p>Hidden content</p>
      </PermissionGate>
    );
    expect(screen.queryByText("Hidden content")).not.toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("leadership can see leadership-level content", () => {
    render(
      <PermissionGate role="leadership" requiredRole="leadership">
        <p>Leadership only</p>
      </PermissionGate>
    );
    expect(screen.getByText("Leadership only")).toBeInTheDocument();
  });

  it("leadership cannot see ceo-level content", () => {
    const { container } = render(
      <PermissionGate role="leadership" requiredRole="ceo">
        <p>CEO only</p>
      </PermissionGate>
    );
    expect(screen.queryByText("CEO only")).not.toBeInTheDocument();
    expect(container.innerHTML).toBe("");
  });
});
