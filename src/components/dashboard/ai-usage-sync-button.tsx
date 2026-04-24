"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type SyncResponse = {
  outcome?: string;
  activeScopeDescription?: string;
  error?: string;
};

/**
 * CEO-only "Sync now" trigger for the AI Model Usage Dashboard Mode report.
 * Posts to the scoped sync endpoint and refreshes the route so the page
 * re-renders with the fresh data once the background drain finishes.
 */
export function AiUsageSyncButton({ reportToken }: { reportToken: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function trigger() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/sync/mode/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reportToken }),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as SyncResponse | null;

      if (!response.ok) {
        setMessage(payload?.error ?? "Sync request failed.");
        return;
      }

      if (payload?.outcome === "already-running") {
        setMessage(
          payload.activeScopeDescription
            ? `Mode sync already running for ${payload.activeScopeDescription}.`
            : "Mode sync is already running.",
        );
      } else {
        setMessage("Sync queued — refresh in ~30s.");
      }
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync request failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || isPending}
        onClick={() => void trigger()}
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`}
        />
        {pending ? "Queueing…" : "Sync now"}
      </Button>
      {message && (
        <p className="text-[11px] text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
