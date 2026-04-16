import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    // Dynamic import so Turbopack doesn't pull @/lib/sync/runtime (and its
    // transitive process.pid / process.memoryUsage usage) into the Edge
    // bundle. The recovery sweep only runs in the Node runtime anyway.
    const { ensureSyncRecoverySweep } = await import("@/lib/sync/runtime");
    ensureSyncRecoverySweep();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
