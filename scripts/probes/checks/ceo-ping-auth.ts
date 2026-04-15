import type { CheckContext, CheckHandler } from "../../probe";
import type { CheckResult } from "../report";

interface PingAuthResponse {
  db_ok: boolean;
  version: string | null;
  mode_sync_age_hours: number | null;
  deploying: boolean;
  ts: string;
}

export const run: CheckHandler = async (ctx: CheckContext): Promise<CheckResult> => {
  const checkName = "ceo-ping-auth";
  const start = performance.now();

  try {
    const res = await fetch(`${ctx.baseUrl}/api/probes/ping-auth`);
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      return {
        checkName,
        status: "red",
        latencyMs,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const body = (await res.json()) as PingAuthResponse;

    // Deploying is a known-degraded state, not a failure. Per the spec the
    // probe should treat it as degraded-ok — we report green so the alerter
    // doesn't fire during a 5-minute deploy window, but include the flag in
    // details so the dashboard can surface it distinctly.
    if (body.deploying) {
      return {
        checkName,
        status: "green",
        latencyMs,
        details: {
          ...(body as unknown as Record<string, unknown>),
          note: "service is mid-deploy — downstream checks skipped",
        },
      };
    }

    if (!body.db_ok) {
      return {
        checkName,
        status: "red",
        latencyMs,
        error: "db_ok is false — database unreachable",
        details: body as unknown as Record<string, unknown>,
      };
    }

    if (!body.version) {
      return {
        checkName,
        status: "red",
        latencyMs,
        error: "version is missing — deploy version not visible",
        details: body as unknown as Record<string, unknown>,
      };
    }

    if (body.mode_sync_age_hours === null || body.mode_sync_age_hours >= 26) {
      return {
        checkName,
        status: "red",
        latencyMs,
        error: `mode_sync_age_hours is ${body.mode_sync_age_hours ?? "null"} — Mode data is stale or unavailable`,
        details: body as unknown as Record<string, unknown>,
      };
    }

    return {
      checkName,
      status: "green",
      latencyMs,
      details: body as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      checkName,
      status: "red",
      latencyMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
