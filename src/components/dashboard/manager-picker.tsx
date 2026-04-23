"use client";

import { useRouter } from "next/navigation";

interface ManagerOption {
  email: string;
  name: string;
  directReports: number;
  jobTitle: string | null;
}

export function ManagerPicker({
  current,
  managers,
  basePath = "/dashboard/managers",
}: {
  current: string;
  managers: ManagerOption[];
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <select
      value={current}
      onChange={(e) =>
        router.push(`${basePath}?manager=${encodeURIComponent(e.target.value)}`)
      }
      className="h-8 min-w-[280px] max-w-[420px] rounded-md border border-border/60 bg-background px-2.5 text-xs text-foreground focus:border-primary/60 focus:outline-none"
    >
      {managers.map((m) => (
        <option key={m.email} value={m.email}>
          {m.name} · {m.directReports} report{m.directReports === 1 ? "" : "s"}
          {m.jobTitle ? ` · ${m.jobTitle}` : ""}
        </option>
      ))}
    </select>
  );
}
