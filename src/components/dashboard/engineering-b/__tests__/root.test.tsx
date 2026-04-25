import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../manager-view", () => ({
  ManagerView: ({
    scope,
    managerEmail,
  }: {
    scope: string;
    managerEmail?: string | null;
  }) => (
    <div
      data-testid="manager-view-stub"
      data-scope={scope}
      data-manager-email={managerEmail ?? ""}
    >
      manager view stub
    </div>
  ),
}));

vi.mock("../engineer-view", () => ({
  EngineerView: ({
    viewerEmail,
    isCeoPreview,
  }: {
    viewerEmail?: string | null;
    isCeoPreview?: boolean;
  }) => (
    <div
      data-testid="engineer-view-stub"
      data-viewer-email={viewerEmail ?? ""}
      data-ceo-preview={isCeoPreview ? "true" : "false"}
    >
      engineer view stub
    </div>
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

  it("maps engineering_manager to manager persona (gated to directs scope)", () => {
    expect(resolvePersona("engineering_manager")).toBe("manager");
  });

  it("maps plain manager to engineer persona (only reachable via CEO role-preview)", () => {
    expect(resolvePersona("manager")).toBe("engineer");
  });

  it("maps everyone to engineer persona (only reachable via CEO role-preview)", () => {
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

  it("returns directs for engineering_manager — they only see their own reports", () => {
    expect(resolveManagerScope("engineering_manager")).toBe("directs");
  });

  it("returns directs for any lower role (only reachable via CEO role-preview)", () => {
    expect(resolveManagerScope("manager")).toBe("directs");
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

  it("renders the manager view with directs scope for engineering_manager", () => {
    render(
      <EngineeringBRoot
        effectiveRole="engineering_manager"
        managerEmail="em@meetcleo.com"
      />,
    );
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-persona")).toBe("manager");
    expect(root.getAttribute("data-scope")).toBe("directs");
    const view = screen.getByTestId("manager-view-stub");
    expect(view.getAttribute("data-scope")).toBe("directs");
    // The viewer's own email is what scopes the directs cohort.
    expect(view.getAttribute("data-manager-email")).toBe("em@meetcleo.com");
  });

  it("threads impersonatedEmail to EngineerView and disables the CEO preview banner", () => {
    render(
      <EngineeringBRoot
        effectiveRole="everyone"
        isCeoPreview
        impersonatedEmail="arti@meetcleo.com"
      />,
    );
    const root = screen.getByTestId("engineering-b-root");
    // data-impersonated marker is set so the page tree can style/inspect.
    expect(root.getAttribute("data-impersonated")).toBe("true");
    // CEO-preview banner is suppressed under impersonation — the engineer
    // view is the truthful rendering for the impersonated user, not a demo.
    expect(root.getAttribute("data-ceo-preview")).toBeNull();

    const view = screen.getByTestId("engineer-view-stub");
    expect(view.getAttribute("data-viewer-email")).toBe("arti@meetcleo.com");
    expect(view.getAttribute("data-ceo-preview")).toBe("false");
  });

  it("keeps the CEO preview banner when no impersonation is active and CEO is previewing", () => {
    render(<EngineeringBRoot effectiveRole="everyone" isCeoPreview />);
    const root = screen.getByTestId("engineering-b-root");
    expect(root.getAttribute("data-impersonated")).toBeNull();
    expect(root.getAttribute("data-ceo-preview")).toBe("true");

    const view = screen.getByTestId("engineer-view-stub");
    expect(view.getAttribute("data-viewer-email")).toBe("");
    expect(view.getAttribute("data-ceo-preview")).toBe("true");
  });

  it("falls back impersonatedEmail to managerEmail when manager persona has no explicit managerEmail", () => {
    render(
      <EngineeringBRoot
        effectiveRole="manager"
        impersonatedEmail="lead@meetcleo.com"
      />,
    );
    // manager role → engineer persona in current resolvePersona, so we still
    // hit the engineer view here. The manager-persona fallback is exercised by
    // the leadership case below.
    const view = screen.getByTestId("engineer-view-stub");
    expect(view.getAttribute("data-viewer-email")).toBe(
      "lead@meetcleo.com",
    );
  });

  it("threads impersonatedEmail to ManagerView when CEO impersonates a leadership user", () => {
    render(
      <EngineeringBRoot
        effectiveRole="leadership"
        impersonatedEmail="lead@meetcleo.com"
      />,
    );
    const view = screen.getByTestId("manager-view-stub");
    expect(view.getAttribute("data-scope")).toBe("org");
    // Even on org scope ManagerView gets the impersonated email — harmless,
    // and consistent if scope ever changes.
    expect(view.getAttribute("data-manager-email")).toBe(
      "lead@meetcleo.com",
    );
  });

  it("impersonatedEmail wins over managerEmail when CEO impersonates an engineering_manager", () => {
    // The CEO is logged in (managerEmail = ceo@meetcleo.com) and impersonates
    // an engineering manager. The directs-scope cohort must be the eng
    // manager's reports, not the CEO's.
    render(
      <EngineeringBRoot
        effectiveRole="engineering_manager"
        managerEmail="ceo@meetcleo.com"
        impersonatedEmail="em@meetcleo.com"
      />,
    );
    const view = screen.getByTestId("manager-view-stub");
    expect(view.getAttribute("data-scope")).toBe("directs");
    expect(view.getAttribute("data-manager-email")).toBe("em@meetcleo.com");
  });
});
