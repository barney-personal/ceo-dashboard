/**
 * Shared chart plumbing for impact analytics: sizing, tooltip, palette.
 *
 * Each chart is a client component that uses a ResizeObserver-backed
 * container width, shared palette from CSS custom properties, and a
 * single tooltip singleton mounted at the page root.
 */

"use client";

import { useEffect, useState } from "react";
import { getContentBoxWidth } from "@/components/charts/chart-utils";
import type { Discipline } from "@/lib/data/engineering-impact";

/** Hook: responsive container width, updates on resize + mount. */
export function useContainerWidth(
  ref: React.RefObject<HTMLDivElement | null>,
  fallback = 640,
): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const measure = () => {
      setWidth(Math.max(360, Math.floor(getContentBoxWidth(node))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Tooltip singleton — attached to document.body on first use. */
let tooltipEl: HTMLDivElement | null = null;
let tooltipTitle: HTMLDivElement | null = null;
let tooltipSubtitle: HTMLDivElement | null = null;
let tooltipMeta: HTMLDivElement | null = null;

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  if (typeof document === "undefined") {
    throw new Error("tooltip requires DOM");
  }
  const el = document.createElement("div");
  el.setAttribute("role", "tooltip");
  el.style.cssText = `
    position: fixed;
    pointer-events: none;
    background: var(--foreground);
    color: var(--background);
    font-family: var(--font-sans);
    font-size: 12px;
    line-height: 1.4;
    padding: 8px 10px;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 120ms;
    z-index: 60;
    max-width: 280px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  `;
  // Pre-build child nodes so we only ever set textContent (no innerHTML).
  const title = document.createElement("div");
  title.style.fontWeight = "600";
  const subtitle = document.createElement("div");
  const meta = document.createElement("div");
  meta.style.cssText =
    "font-family:var(--font-mono);font-size:11px;opacity:0.75;margin-top:4px;";
  el.appendChild(title);
  el.appendChild(subtitle);
  el.appendChild(meta);
  document.body.appendChild(el);
  tooltipEl = el;
  tooltipTitle = title;
  tooltipSubtitle = subtitle;
  tooltipMeta = meta;
  return el;
}

export interface TooltipRow {
  title?: string;
  subtitle?: string;
  meta?: string;
}

export function showTooltip(
  event: { clientX: number; clientY: number },
  row: TooltipRow,
): void {
  ensureTooltip();
  // All user-derived strings set via textContent — no HTML parsing.
  if (tooltipTitle) {
    tooltipTitle.textContent = row.title ?? "";
    tooltipTitle.style.display = row.title ? "" : "none";
  }
  if (tooltipSubtitle) {
    tooltipSubtitle.textContent = row.subtitle ?? "";
    tooltipSubtitle.style.display = row.subtitle ? "" : "none";
  }
  if (tooltipMeta) {
    tooltipMeta.textContent = row.meta ?? "";
    tooltipMeta.style.display = row.meta ? "" : "none";
  }
  if (tooltipEl) tooltipEl.style.opacity = "1";
  moveTooltip(event);
}

export function moveTooltip(event: {
  clientX: number;
  clientY: number;
}): void {
  const el = ensureTooltip();
  const pad = 14;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + w > window.innerWidth - 8) x = event.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = event.clientY - h - pad;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

export function hideTooltip(): void {
  if (tooltipEl) tooltipEl.style.opacity = "0";
}

// ─── Palette — OKLCH, aligned with globals.css tokens ────────────────

export const DISC_COLOR: Record<Discipline, string> = {
  BE: "oklch(0.52 0.16 155)", // positive green
  FE: "oklch(0.55 0.18 25)", // warm red
  EM: "oklch(0.55 0.15 280)", // purple
  QA: "oklch(0.68 0.15 70)", // gold
  ML: "oklch(0.42 0.17 265)", // primary indigo
  Ops: "oklch(0.55 0.08 70)", // muted warm
  Other: "oklch(0.55 0.005 75)", // muted
};

export const PILLAR_PALETTE = [
  "oklch(0.42 0.17 265)", // indigo
  "oklch(0.55 0.18 25)", // red
  "oklch(0.52 0.16 155)", // green
  "oklch(0.68 0.15 70)", // gold
  "oklch(0.55 0.15 280)", // purple
  "oklch(0.5 0.15 200)", // teal
  "oklch(0.55 0.15 330)", // pink
  "oklch(0.45 0.12 100)", // olive
  "oklch(0.6 0.12 40)", // terracotta
  "oklch(0.5 0.1 240)", // slate blue
] as const;

export const SEVERITY_COLOR = {
  severe: "oklch(0.55 0.18 25)",
  moderate: "oklch(0.68 0.15 70)",
  ok: "oklch(0.55 0.008 75)",
  uncomparable: "oklch(0.7 0.004 75)",
} as const;
