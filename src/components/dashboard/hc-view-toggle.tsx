"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

export type HcView = "current" | "planned";

const OPTIONS: ReadonlyArray<{ value: HcView; label: string }> = [
  { value: "current", label: "Current" },
  { value: "planned", label: "Planned" },
];

export function HcViewToggle({ current }: { current: HcView }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSelect = (value: HcView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "current") {
      params.delete("view");
    } else {
      params.set("view", value);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?");
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleSelect(opt.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            current === opt.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
