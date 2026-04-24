"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface EngineeringViewToggleProps {
  initialToggleOn: boolean;
}

/**
 * CEO-only two-state toggle between the legacy A-side engineering section and
 * the simplified B-side surface. Rendered only when the server layout has
 * already confirmed the viewer is the real CEO, so this component does not
 * re-check authorization — the API handler enforces it server-side.
 */
export function EngineeringViewToggle({
  initialToggleOn,
}: EngineeringViewToggleProps) {
  const router = useRouter();
  const [on, setOn] = useState(initialToggleOn);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const update = (next: boolean) => {
    if (next === on || pending) return;
    setError(null);
    setOn(next);
    startTransition(async () => {
      try {
        const res = await fetch("/api/engineering-view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engineeringViewB: next }),
        });
        if (!res.ok) {
          setOn(!next);
          const payload = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(payload.error ?? "Failed to update view");
          return;
        }
        router.refresh();
      } catch {
        setOn(!next);
        setError("Network error");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        role="radiogroup"
        aria-label="Engineering view"
        className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5 text-xs"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!on}
          disabled={pending}
          onClick={() => update(false)}
          className={cn(
            "rounded-sm px-2.5 py-1 font-medium transition-colors",
            !on
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          A-side
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={on}
          disabled={pending}
          onClick={() => update(true)}
          className={cn(
            "rounded-sm px-2.5 py-1 font-medium transition-colors",
            on
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          B-side (beta)
        </button>
      </div>
      {error && (
        <p className="text-[10px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
