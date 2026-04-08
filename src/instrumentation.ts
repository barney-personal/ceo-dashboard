import * as Sentry from "@sentry/nextjs";
import { ensureSyncRecoverySweep } from "@/lib/sync/runtime";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    ensureSyncRecoverySweep();
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
