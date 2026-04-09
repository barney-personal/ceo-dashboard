"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

type ModeReportSyncControl = {
  name: string;
  reportToken: string;
  section: string;
  modeUrl: string;
};

type SyncResponse = {
  outcome?: string;
  activeScopeDescription?: string;
  error?: string;
};

export function ModeReportSyncControls({
  reports,
  activeModeScopeDescription,
}: {
  reports: ModeReportSyncControl[];
  activeModeScopeDescription: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isBlockedByActiveRun = activeModeScopeDescription !== null;

  async function triggerReport(report: ModeReportSyncControl) {
    setPendingToken(report.reportToken);
    setMessage(null);

    try {
      const response = await fetch("/api/sync/mode/report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ reportToken: report.reportToken }),
      });

      const payload = (await response.json().catch(() => null)) as SyncResponse | null;

      if (!response.ok) {
        setMessage(payload?.error ?? `Failed to queue ${report.name}.`);
        return;
      }

      if (payload?.outcome === "already-running") {
        setMessage(
          payload.activeScopeDescription
            ? `Mode sync already active for ${payload.activeScopeDescription}.`
            : "Mode sync is already running."
        );
      } else {
        setMessage(`Queued ${report.name} for re-sync.`);
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : `Failed to queue ${report.name}.`
      );
    } finally {
      setPendingToken(null);
    }
  }

  return (
    <div className="space-y-4">
      {isBlockedByActiveRun && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
          Mode sync is currently active for {activeModeScopeDescription}. Wait
          for it to finish before queueing another report.
        </div>
      )}

      {message && (
        <div
          className="rounded-lg border border-border/50 bg-background/70 px-3 py-2 text-sm text-foreground/70"
          role="status"
        >
          {message}
        </div>
      )}

      <div className="divide-y divide-border/30">
        {reports.map((report) => {
          const isRowPending = pendingToken === report.reportToken;

          return (
            <div
              key={report.reportToken}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">
                    {report.name}
                  </p>
                  <a
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    href={report.modeUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  {report.section} · <span className="font-mono">{report.reportToken}</span>
                </p>
              </div>

              <Button
                disabled={isPending || isBlockedByActiveRun}
                onClick={() => void triggerReport(report)}
                size="sm"
                variant="outline"
              >
                {isRowPending ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Queueing…
                  </>
                ) : (
                  "Trigger"
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
