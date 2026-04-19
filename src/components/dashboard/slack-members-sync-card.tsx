"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Clock, Upload, FileQuestion } from "lucide-react";
import type { SlackSyncStatus } from "@/lib/data/slack-members-sync-status";

interface Props {
  status: SlackSyncStatus;
}

const FRESHNESS_META = {
  fresh: {
    icon: CheckCircle2,
    iconClass: "text-emerald-600",
    label: "Up to date",
    message: "Latest export is recent — no action needed.",
    barClass: "bg-emerald-500/70",
  },
  due: {
    icon: Clock,
    iconClass: "text-amber-600",
    label: "Due for refresh",
    message: "Export a fresh CSV from Slack when you have a moment.",
    barClass: "bg-amber-500/70",
  },
  stale: {
    icon: AlertTriangle,
    iconClass: "text-rose-600",
    label: "Overdue",
    message: "Export a new CSV from Slack to keep engagement data accurate.",
    barClass: "bg-rose-500/70",
  },
  none: {
    icon: FileQuestion,
    iconClass: "text-muted-foreground",
    label: "No snapshot yet",
    message: "Upload your first Slack Member Analytics CSV to get started.",
    barClass: "bg-muted-foreground/40",
  },
} as const;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function SlackMembersSyncCard({ status }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [, startTransition] = useTransition();

  const meta = FRESHNESS_META[status.freshness];
  const Icon = meta.icon;

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/sync/slack-members", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ kind: "error", message: data.error ?? "Upload failed" });
        return;
      }
      const recon = data.reconcile as Record<string, number>;
      const matched = (recon.auto_username ?? 0) + (recon.auto_name ?? 0) + (recon.manual ?? 0);
      const parts: string[] = [];
      if (data.rowsInserted > 0) parts.push(`${data.rowsInserted} new`);
      if (data.rowsUpdated > 0) parts.push(`${data.rowsUpdated} updated`);
      if (parts.length === 0) parts.push("no changes");
      setFeedback({
        kind: "success",
        message: `${parts.join(", ")} (window ${data.windowStart.slice(0, 10)} → ${data.windowEnd.slice(0, 10)}). ${matched} matched to SSoT, ${recon.unmatched ?? 0} unmatched, ${recon.external ?? 0} external.`,
      });
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-warm">
      <div className="flex items-start justify-between gap-4 border-b border-border/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.iconClass}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Slack Member Analytics
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {meta.message}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${meta.iconClass} ${meta.barClass}/10`}>
          {meta.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-4">
        <Stat
          label="Window end"
          value={fmtDate(status.windowEnd)}
          hint={
            status.daysSinceWindowEnd !== null
              ? `${status.daysSinceWindowEnd}d ago`
              : undefined
          }
        />
        <Stat label="Window start" value={fmtDate(status.windowStart)} />
        <Stat
          label="Members"
          value={status.memberCount > 0 ? status.memberCount.toLocaleString() : "—"}
        />
        <Stat label="Last imported" value={fmtDate(status.importedAt)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border/50 px-5 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/85 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {isUploading ? "Uploading…" : "Upload CSV"}
        </button>
        <a
          href="https://cleo-team.slack.com/admin/stats#members"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          Open Slack Admin → Analytics
        </a>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer transition-colors hover:text-foreground">
            How to export
          </summary>
          <ol className="mt-2 max-w-md list-decimal space-y-1 pl-5 text-[11px]">
            <li>Slack Admin → Analytics → Members tab</li>
            <li>Pick a time window (we use the 1-year range for the widest signal)</li>
            <li>Click <code className="rounded bg-muted px-1">Export CSV</code> — Slack DMs you the file from Slackbot</li>
            <li>Download from Slackbot to your laptop, drop it here</li>
          </ol>
        </details>
        {feedback && (
          <span
            className={`text-[11px] ${feedback.kind === "success" ? "text-emerald-700" : "text-rose-700"}`}
          >
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
