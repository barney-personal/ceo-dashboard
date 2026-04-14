"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface PeriodOption {
  readonly label: string;
  readonly value: number;
}

export function PeriodPicker({
  periods,
  current,
}: {
  periods: readonly PeriodOption[];
  current: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSelect = (value: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", String(value));
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-0.5">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => handleSelect(period.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            current === period.value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
