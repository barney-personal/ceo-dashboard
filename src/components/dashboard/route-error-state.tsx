"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RouteErrorStateProps {
  title: string;
  description: string;
  onRetry: () => void;
  retryLabel?: string;
  digest?: string;
  className?: string;
  fullScreen?: boolean;
}

export function RouteErrorState({
  title,
  description,
  onRetry,
  retryLabel = "Try again",
  digest,
  className,
  fullScreen = false,
}: RouteErrorStateProps) {
  return (
    <div
      className={cn(
        "bg-background px-6 py-10",
        fullScreen && "flex min-h-screen items-center justify-center py-16",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-3xl rounded-[2rem] border border-border/60 bg-card p-8 shadow-warm sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/20 bg-warning/10 text-warning">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Route error
              </p>
              <h1 className="font-display text-3xl italic tracking-tight text-foreground sm:text-4xl">
                {title}
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {description}
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={onRetry}
            className="h-10 shrink-0 rounded-full px-5 shadow-warm transition-shadow hover:shadow-warm-lg"
          >
            <RotateCcw className="h-4 w-4" />
            {retryLabel}
          </Button>
        </div>

        {digest ? (
          <div className="mt-6 rounded-2xl border border-border/50 bg-background/80 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Reference
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {digest}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
