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
): ClerkUserLike {
  return {
    id,
    publicMetadata,
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
 * Wire up clerkClient.users.getUser to return a profile that
 * `getImpersonation` and `getCurrentUserRole` will resolve from. Used by the
 * impersonation tests, which need a live Clerk lookup of the impersonated
 * user's role + primary email. Each call returns the supplied profile.
 */
function withImpersonatedClerkUser(profile: {
  role: "everyone" | "manager" | "engineering_manager" | "leadership" | "ceo";
  email: string;
  firstName?: string;
  lastName?: string;
}) {
  const getUser = vi.fn().mockResolvedValue({
    publicMetadata: { role: profile.role },
    primaryEmailAddress: { emailAddress: profile.email },
    emailAddresses: [{ emailAddress: profile.email }],
    firstName: profile.firstName ?? "Test",
    lastName: profile.lastName ?? "User",
    imageUrl: null,
  });
  mockClerkClient.mockResolvedValue({
    users: { getUser },
  } as unknown as Awaited<ReturnType<typeof clerkClient>>);
  return getUser;
}

describe("getEngineeringViewResolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    withCookies({});
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
    });
  });

  it("returns a-side for CEO with toggle absent (default OFF)", async () => {
    mockCurrentUser.mockResolvedValue(asCurrentUser({ role: "ceo" }));
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(false);
    expect(result.effectiveRole).toBe("ceo");
    expect(result.impersonatedEmail).toBeNull();
  });

  it("returns b-side for CEO with toggle ON and no preview", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(true);
    expect(result.effectiveRole).toBe("ceo");
    expect(result.impersonatedEmail).toBeNull();
  });

  it("returns a-side for CEO with toggle OFF explicitly", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: false }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.toggleOn).toBe(false);
  });

  it("returns a-side for non-CEO even when forged engineeringViewB=true in metadata", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "leadership", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(false);
    expect(result.toggleOn).toBe(false);
  });

  it("returns a-side for engineering_manager with forged engineeringViewB", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({
        role: "engineering_manager",
        engineeringViewB: true,
      }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(false);
  });

  it("returns a-side for user with no role and forged engineeringViewB", async () => {
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(false);
  });

  it("keeps b-side when CEO role-previews as everyone with toggle ON (engineer persona downstream)", async () => {
    withCookies({ "role-preview": "everyone" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(true);
    expect(result.effectiveRole).toBe("everyone");
    expect(result.impersonatedEmail).toBeNull();
  });

  it("keeps b-side when CEO role-previews as manager with toggle ON (engineer persona downstream)", async () => {
    withCookies({ "role-preview": "manager" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("manager");
  });

  it("keeps b-side when CEO role-previews as leadership with toggle ON (manager persona downstream)", async () => {
    withCookies({ "role-preview": "leadership" });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("leadership");
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

  it("keeps b-side when CEO impersonates an engineer with toggle ON, surfacing the impersonated email", async () => {
    withCookies({
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_arti",
          name: "Arti Mathanda",
          role: "everyone",
        }),
      ),
    });
    withImpersonatedClerkUser({
      role: "everyone",
      email: "arti@meetcleo.com",
      firstName: "Arti",
      lastName: "Mathanda",
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.actualCeo).toBe(true);
    expect(result.toggleOn).toBe(true);
    // The impersonated user's role drives the persona resolution downstream.
    expect(result.effectiveRole).toBe("everyone");
    // And the engineer view picks up the impersonated user's identity.
    expect(result.impersonatedEmail).toBe("arti@meetcleo.com");
  });

  it("keeps b-side when CEO impersonates a leadership user (manager persona downstream)", async () => {
    withCookies({
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_lead",
          name: "Lead",
          role: "leadership",
        }),
      ),
    });
    withImpersonatedClerkUser({
      role: "leadership",
      email: "lead@meetcleo.com",
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("b-side");
    expect(result.effectiveRole).toBe("leadership");
    expect(result.impersonatedEmail).toBe("lead@meetcleo.com");
  });

  it("impersonation takes precedence over a stale role-preview cookie", async () => {
    withCookies({
      "role-preview": "manager",
      impersonate: encodeURIComponent(
        JSON.stringify({
          userId: "user_arti",
          name: "Arti",
          role: "everyone",
        }),
      ),
    });
    withImpersonatedClerkUser({
      role: "everyone",
      email: "arti@meetcleo.com",
    });
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ role: "ceo", engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.effectiveRole).toBe("everyone");
    expect(result.impersonatedEmail).toBe("arti@meetcleo.com");
  });

  it("ignores engineeringViewB when the actual user is not CEO (manager auto-promotion scenario)", async () => {
    // Simulating a user who would auto-promote to manager via getCurrentUserRole;
    // actual Clerk role is everyone, but engineeringViewB true was hand-set.
    mockCurrentUser.mockResolvedValue(
      asCurrentUser({ engineeringViewB: true }),
    );
    const result = await getEngineeringViewResolution();
    expect(result.surface).toBe("a-side");
    expect(result.actualCeo).toBe(false);
    expect(result.toggleOn).toBe(false);
  });

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
