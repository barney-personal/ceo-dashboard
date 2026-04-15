export type ProbeStatus = "green" | "red" | "timeout";

export interface ProbeRunPayload {
  probeId: string;
  checkName: string;
  status: ProbeStatus;
  latencyMs: number;
  details?: Record<string, unknown>;
  runId?: string;
  target?: "prod" | "staging";
}

export interface ProbeHeartbeatPayload {
  probeId: string;
  version?: string;
}
