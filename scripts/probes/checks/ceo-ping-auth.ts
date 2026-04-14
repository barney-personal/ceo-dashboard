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

    if (body.deploying) {
      return {
        checkName,
        status: "red",
        latencyMs,
        error: "deploying: service is mid-deploy",
        details: body as unknown as Record<string, unknown>,
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
