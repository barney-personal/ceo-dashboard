"use client";

import { cn } from "@/lib/utils";
import { ExternalLink, BarChart3 } from "lucide-react";

interface ModeEmbedProps {
  /** Full Mode URL — report or specific viz URL */
  url: string;
  /** Display title */
  title: string;
  /** Optional subtitle / context */
  subtitle?: string;
  className?: string;
}

/**
 * Links out to a Mode report or chart visualization.
 *
 * Mode sets X-Frame-Options: sameorigin on all pages, so iframe embedding
 * is not possible from third-party domains. Instead we show a styled card
 * with the chart title and a direct link to open in Mode.
 *
 * The dashboard shows actual metric values from synced data above these
 * cards — the link-out provides access to the full interactive Mode chart.
 */
export function ModeEmbed({ url, title, subtitle, className }: ModeEmbedProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex items-center gap-4 rounded-xl border border-border/60 bg-card px-5 py-4 shadow-warm transition-all duration-200 hover:border-primary/30 hover:shadow-warm-lg",
        className
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 text-primary transition-colors group-hover:bg-primary/10">
        <BarChart3 className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">
          {subtitle ?? "Open in Mode"}
        </p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </a>
  );
}
