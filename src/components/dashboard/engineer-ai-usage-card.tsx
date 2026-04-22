"use client";

import { LineChart } from "@/components/charts/line-chart";
import { PeerDistributionStrip } from "@/components/charts/peer-distribution-strip";
import type { EngineerAiUsage } from "@/lib/data/engineer-profile";

function formatCurrency(value: number): string {
  if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatMonth(iso: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function EngineerAiUsageCard({ usage }: { usage: EngineerAiUsage }) {
  const peerDelta = usage.peerMedianCost
    ? ((usage.latestMonthCost - usage.peerMedianCost) / usage.peerMedianCost) *
      100
    : null;

  const costSeries = usage.costSeries.length > 1 ? usage.costSeries : null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/60 bg-card p-5 shadow-warm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              {formatMonth(usage.latestMonthStart)} spend
            </p>
            <p className="mt-1 font-display text-3xl italic text-foreground">
              {formatCurrency(usage.latestMonthCost)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTokens(usage.latestMonthTokens)} tokens across{" "}
              {usage.nDays} active day{usage.nDays === 1 ? "" : "s"}
            </p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs text-muted-foreground">
            <div>
              <p className="text-muted-foreground/60 uppercase tracking-[0.1em]">
                Peer median
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {formatCurrency(usage.peerMedianCost)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground/60 uppercase tracking-[0.1em]">
                Peer avg
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {formatCurrency(usage.peerAvgCost)}
              </p>
            </div>
            {peerDelta != null && (
              <div>
                <p className="text-muted-foreground/60 uppercase tracking-[0.1em]">
                  vs median
                </p>
                <p
                  className={`mt-0.5 font-medium ${peerDelta > 20 ? "text-amber-700" : peerDelta < -20 ? "text-positive" : "text-foreground"}`}
                >
                  {peerDelta > 0 ? "+" : ""}
                  {peerDelta.toFixed(0)}%
                </p>
              </div>
            )}
          </div>
        </div>

        {usage.byCategory.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {usage.byCategory.map((cat) => (
              <div
                key={cat.category}
                className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-[11px]"
              >
                <span className="font-medium capitalize text-foreground">
                  {cat.category}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatCurrency(cat.cost)}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="tabular-nums text-muted-foreground/70">
                  {formatTokens(cat.tokens)} tokens
                </span>
              </div>
            ))}
          </div>
        )}

        {usage.peerSpend.length > 1 && (
          <div className="mt-6 border-t border-border/40 pt-4">
            <PeerDistributionStrip
              peers={usage.peerSpend}
              userValue={usage.latestMonthCost}
              label="Peer spend distribution"
            />
          </div>
        )}
      </div>

      {costSeries && (
        <LineChart
          title="Monthly AI spend"
          subtitle="Claude + Cursor costs per month"
          yFormatType="currency"
          series={[
            {
              label: "Spend",
              color: "#7c3aed",
              data: costSeries,
            },
          ]}
        />
      )}
    </div>
  );
}
