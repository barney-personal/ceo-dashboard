import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  currentUser: vi.fn(),
  clerkClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import {
  EngineeringViewMutationError,
  getEngineeringViewResolution,
  isEngineeringViewB,
  setEngineeringViewB,
} from "@/lib/auth/engineering-view.server";

const mockCurrentUser = vi.mocked(currentUser);
const mockClerkClient = vi.mocked(clerkClient);
const mockCookies = vi.mocked(cookies);

type ClerkUserLike = Awaited<ReturnType<typeof currentUser>>;

function asCurrentUser(
  publicMetadata: Record<string, unknown>,
  id = "user_fake",
  email: string | null = null,
): ClerkUserLike {
  return {
    id,
    publicMetadata,
    primaryEmailAddress: email ? { emailAddress: email } : null,
    emailAddresses: email ? [{ emailAddress: email }] : [],
  } as unknown as ClerkUserLike;
}

function withCookies(values: Record<string, string | undefined>) {
  const get = (name: string) =>
    values[name] ? { name, value: values[name] as string } : undefined;
  mockCookies.mockResolvedValue({ get } as unknown as Awaited<
    ReturnType<typeof cookies>
  >);
}

/**
 * Wire up clerkClient mocks. Both `getUserList` (used to find the CEO's
 * org-wide flag) and `getUser` (used for impersonation lookups) need to be
 * mockable. Defaults:
 *   - getUserList → empty list (so the org flag resolves to false)
 *   - getUser → the supplied impersonation profile (per-test wiring)
 */
function withClerkMocks({
  ceoUsersWithFlagOn = [] as Array<"on" | "off">,
  impersonatedProfile,
}: {
  ceoUsersWithFlagOn?: Array<"on" | "off">;
  impersonatedProfile?: {
    role: "everyone" | "manager" | "engineering_manager" | "leadership" | "ceo";
    email: string;
    firstName?: string;
    lastName?: string;
  };
} = {}) {
  const ceoUsers = ceoUsersWithFlagOn.map((state, i) => ({
    publicMetadata: {
      role: "ceo",
      ...(state === "on" ? { engineeringViewB: true } : {}),
    },
    id: `user_ceo_${i}`,
  }));
  const getUserList = vi.fn().mockResolvedValue({ data: ceoUsers });
  const getUser = vi.fn().mockResolvedValue(
    impersonatedProfile
      ? {
          publicMetadata: { role: impersonatedProfile.role },
          primaryEmailAddress: { emailAddress: impersonatedProfile.email },
          emailAddresses: [{ emailAddress: impersonatedProfile.email }],
          firstName: impersonatedProfile.firstName ?? "Test",
          lastName: impersonatedProfile.lastName ?? "User",
          imageUrl: null,
        }
      : null,
  );
  mockClerkClient.mockResolvedValue({
    users: { getUserList, getUser, updateUser: vi.fn() },
  } as unknown as Awaited<ReturnType<typeof clerkClient>>);
  return { getUserList, getUser };
}

describe("getEngineeringViewResolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    withCookies({});
    withClerkMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a-side anon default when unauthenticated", async () => {
    mockCurrentUser.mockResolvedValue(null);
    const result = await getEngineeringViewResolution();
    expect(result).toEqual({
      surface: "a-side",
      actualCeo: false,
      toggleOn: false,
      effectiveRole: "everyone",
      impersonatedEmail: null,
      viewerEmail: null,
    });
  });

  // -------- CEO viewer (writer of the global flag) --------

  it("returns a-side for CEO with toggle absent (default OFF)", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(false);
  });

  it("returns b-side for CEO with toggle ON", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser(
        { role: "ceo", engineeringViewB: true },
        "user_ceo",
        "ceo@meetcleo.com",
      ),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(true);
    expect(result.viewerEmail).toBe("ceo@meetcleo.com");
  });

  it("returns a-side for CEO with toggle OFF explicitly", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: false }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(false);
  });

  // -------- Non-CEO viewer; reads CEO's org-wide flag --------

  it("returns b-side for engineering_manager when the CEO's global flag is ON", async () => {
    withClerkMocks({ ceoUsersWithFlagOn: ["on"] });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser(
        { role: "engineering_manager" },
        "user_em",
        "em@meetcleo.com",
      ),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(false);
    expect(result.toggleOn).toBe(true);
    expect(result.effectiveRole).toBe("engineering_manager");
    expect(result.viewerEmail).toBe("em@meetcleo.com");
  });

  it("returns b-side for leadership when the CEO's global flag is ON", async () => {
    withClerkMocks({ ceoUsersWithFlagOn: ["on"] });
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "leadership" }));
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(false);
  });

  it("returns a-side for engineering_manager when the CEO's global flag is OFF", async () => {
    withClerkMocks({ ceoUsersWithFlagOn: ["off"] });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "engineering_manager" }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(false);
  });

  it("returns a-side for everyone even when the CEO's global flag is ON (below gate)", async () => {
    withClerkMocks({ ceoUsersWithFlagOn: ["on"] });
    mockCurrentUser.mockResolvedValue(asCurrentUser({}));
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(true); // flag IS on, viewer just below gate
    expect(result.effectiveRole).toBe("everyone");
  });

  it("ignores forged engineeringViewB on a non-CEO viewer's own metadata", async () => {
    // Even if a leadership user has hand-set engineeringViewB=true, the
    // resolver MUST read the CEO's flag (not the viewer's), so this is
    // a-side when no CEO user has the flag set.
    withClerkMocks({ ceoUsersWithFlagOn: [] });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "leadership", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(false);
  });

  it("plain manager auto-promotion is below the gate even with global flag on", async () => {
    // `manager` role is data-derived, not Clerk-set. We simulate a user the
    // upstream has resolved to manager — they still cannot reach B-side.
    withClerkMocks({ ceoUsersWithFlagOn: ["on"] });
    mockCurrentUser.mockResolvedValue(asCurrentUser({}));
    // NB: getUserRole returns "everyone" for any unrecognised role string.
    // The actual `manager` tier never appears on Clerk metadata, but we
    // assert that even at the in-resolver effectiveRole "everyone" the
    // viewer stays on a-side.
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
  });

  // -------- Role preview (CEO only) --------

  it("CEO role-previewing as engineering_manager with toggle ON stays on b-side (manager persona)", async () => {
    withCookies({ "role-preview": "engineering_manager" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("engineering_manager");
  });

  it("CEO role-previewing as leadership with toggle ON stays on b-side", async () => {
    withCookies({ "role-preview": "leadership" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("leadership");
  });

  it("CEO role-previewing as plain manager falls to a-side (below gate)", async () => {
    withCookies({ "role-preview": "manager" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.effectiveRole).toBe("manager");
  });

  it("CEO role-previewing as everyone falls to a-side (below gate)", async () => {
    withCookies({ "role-preview": "everyone" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.effectiveRole).toBe("everyone");
  });

  it("returns b-side when CEO has an unknown/invalid role-preview cookie and toggle ON", async () => {
    withCookies({ "role-preview": "garbage" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("ceo");
  });

  // -------- Impersonation (CEO only) --------

  it("CEO impersonating an engineering manager with toggle ON keeps b-side", async () => {
    withCookies({
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_em",
          name: "Eng Mgr",
          role: "engineering_manager",
        }),
      ),
    });
    withClerkMocks({
      ceoUsersWithFlagOn: ["on"],
      impersonatedProfile: {
        role: "engineering_manager",
        email: "em@meetcleo.com",
      },
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("engineering_manager");
    expect(result.impersonatedEmail).toBe("em@meetcleo.com");
  });

  it("CEO impersonating an engineer (everyone role) falls to a-side (below gate)", async () => {
    withCookies({
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_arti",
          name: "Arti",
          role: "everyone",
        }),
      ),
    });
    withClerkMocks({
      ceoUsersWithFlagOn: ["on"],
      impersonatedProfile: { role: "everyone", email: "arti@meetcleo.com" },
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.effectiveRole).toBe("everyone");
    expect(result.impersonatedEmail).toBe("arti@meetcleo.com");
  });

  it("impersonation takes precedence over a stale role-preview cookie", async () => {
    withCookies({
      "role-preview": "manager",
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_em",
          name: "Eng Mgr",
          role: "engineering_manager",
        }),
      ),
    });
    withClerkMocks({
      ceoUsersWithFlagOn: ["on"],
      impersonatedProfile: {
        role: "engineering_manager",
        email: "em@meetcleo.com",
      },
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.effectiveRole).toBe("engineering_manager");
    expect(result.impersonatedEmail).toBe("em@meetcleo.com");
  });

  // -------- Sundry --------

  it("treats engineeringViewB as false when value is a truthy non-boolean", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: "yes" }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(false);
  });

  it("isEngineeringViewB is a thin wrapper returning surface === b-side", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    await expect(isEngineeringViewB()).resolves.toBe(true);

    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    await expect(isEngineeringViewB()).resolves.toBe(false);
  });
});

describe("setEngineeringViewB", () => {
  const updateUser = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    updateUser.mockReset();
    mockClerkClient.mockResolvedValue({
      users: { updateUser },
    } as unknown as Awaited<ReturnType<typeof clerkClient>>);
    withCookies({});
  });

  it("rejects unauthenticated callers with 401", async () => {
    mockCurrentUser.mockResolvedValue(null);
    await expect(setEngineeringViewB(true)).rejects.toMatchObject({
      name: "EngineeringViewMutationError",
      status: 401,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects non-CEO callers with 403, even if their metadata claims engineeringViewB", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser(
        { role: "leadership", engineeringViewB: true },
        "user_leader",
      ),
    );
    await expect(setEngineeringViewB(true)).rejects.toBeInstanceOf(
      EngineeringViewMutationError,
    );
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects engineering_manager callers with 403", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "engineering_manager" }, "user_em"),
    );
    await expect(setEngineeringViewB(true)).rejects.toMatchObject({
      status: 403,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects unroled callers with 403", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({}, "user_anon"));
    await expect(setEngineeringViewB(true)).rejects.toMatchObject({
      status: 403,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates Clerk publicMetadata for a real CEO caller and preserves role", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", foo: "bar" }, "user_ceo"),
    );
    updateUser.mockResolvedValue({ id: "user_ceo" });

    await setEngineeringViewB(true);

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith("user_ceo", {
      publicMetadata: { role: "ceo", foo: "bar", engineeringViewB: true },
    });
  });

  it("persists false without clobbering other metadata", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser(
        { role: "ceo", engineeringViewB: true, other: 1 },
        "user_ceo",
      ),
    );
    updateUser.mockResolvedValue({ id: "user_ceo" });

    await setEngineeringViewB(false);

    expect(updateUser).toHaveBeenCalledWith("user_ceo", {
      publicMetadata: {
        role: "ceo",
        engineeringViewB: false,
        other: 1,
      },
    });
  });
});
