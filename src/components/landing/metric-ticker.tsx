"use client";

import { useState, useEffect } from "react";

const PHRASES = [
  "5 dashboards, one view",
  "Synced every 2 hours",
  "Mode, Slack, Excel — unified",
  "LTV, CPA, OKRs, P&L, headcount",
  "AI-parsed, zero manual entry",
];

export function MetricTicker() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % PHRASES.length);
        setVisible(true);
      }, 400);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 h-8">
      <div className="h-1.5 w-1.5 rounded-full bg-positive animate-[pulse_2s_ease-in-out_infinite]" />
      <div
        className="transition-all duration-400"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(4px)",
        }}
      >
        <span className="text-[12px] tracking-wide text-muted-foreground/60">
          {PHRASES[index]}
        </span>
      </div>
    </div>
  );
}
