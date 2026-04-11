"use client";

import { useState, useMemo } from "react";
import { ChevronLeft } from "lucide-react";
import { BarChart, type BarChartData } from "@/components/charts/bar-chart";

export interface DrilldownPerson {
  name: string;
  jobTitle: string;
  function: string;
}

interface DepartmentDrilldownProps {
  deptData: BarChartData[];
  employees: DrilldownPerson[];
  total: number;
  modeUrl?: string;
}

export function DepartmentDrilldown({
  deptData,
  employees,
  total,
  modeUrl,
}: DepartmentDrilldownProps) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  const jobTitleData = useMemo(() => {
    if (!selectedDept) return [];
    const deptEmployees = employees.filter(
      (e) => e.function === selectedDept
    );
    // Group by normalised key but display the most common original casing
    const counts = new Map<string, { display: string; count: number }>();
    for (const e of deptEmployees) {
      const raw = (e.jobTitle || "Untitled").trim();
      const key = raw.toLowerCase();
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { display: raw, count: 1 });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ display, count }) => ({ label: display, value: count, color: "#3b3bba" }));
  }, [selectedDept, employees]);

  const deptCount = selectedDept
    ? employees.filter((e) => e.function === selectedDept).length
    : 0;

  if (selectedDept) {
    return (
      <BarChart
        data={jobTitleData}
        title={selectedDept}
        subtitle={`${deptCount} employees`}
        modeUrl={modeUrl}
        leftMargin={220}
        headerLeft={
          <button
            onClick={() => setSelectedDept(null)}
            className="flex items-center gap-0.5 rounded-md border border-border/50 px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <ChevronLeft className="h-3 w-3" />
            Back
          </button>
        }
      />
    );
  }

  return (
    <BarChart
      data={deptData}
      title="Headcount by Department"
      subtitle={`${total} total`}
      modeUrl={modeUrl}
      onBarClick={(item) => setSelectedDept(item.label)}
    />
  );
}
