import { db } from "@/lib/db";
import { syncPhases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export class PhaseTracker {
  constructor(private syncLogId: number) {}

  async startPhase(phase: string, detail?: string): Promise<number> {
    const [row] = await db
      .insert(syncPhases)
      .values({
        syncLogId: this.syncLogId,
        phase,
        detail,
      })
      .returning({ id: syncPhases.id });
    return row.id;
  }

  async endPhase(
    phaseId: number,
    opts: {
      status?: "success" | "error" | "skipped" | "partial";
      itemsProcessed?: number;
      errorMessage?: string;
      detail?: string;
    } = {}
  ): Promise<void> {
    await db
      .update(syncPhases)
      .set({
        status: opts.status ?? "success",
        completedAt: new Date(),
        itemsProcessed: opts.itemsProcessed,
        errorMessage: opts.errorMessage,
        ...(opts.detail != null ? { detail: opts.detail } : {}),
      })
      .where(eq(syncPhases.id, phaseId));
  }
}

export function createPhaseTracker(syncLogId: number): PhaseTracker {
  return new PhaseTracker(syncLogId);
}
