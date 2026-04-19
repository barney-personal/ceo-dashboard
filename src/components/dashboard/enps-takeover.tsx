"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Stage = "score" | "reason" | "thanks";

export function EnpsTakeover() {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("score");
  const [score, setScore] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // One-shot: ask the server on mount whether to display.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/enps/status")
      .then((r) => (r.ok ? r.json() : { show: false }))
      .then((data: { show?: boolean }) => {
        if (!cancelled && data.show) setOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Lock scroll and close on Escape (acts as dismiss = implicit skip).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = useCallback(
    async (finalReason: string | null) => {
      if (score === null || submitting) return;
      setSubmitting(true);
      try {
        const r = await fetch("/api/enps/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score, reason: finalReason }),
        });
        if (!r.ok) {
          setSubmitting(false);
          return;
        }
        setStage("thanks");
        setTimeout(() => setOpen(false), 1800);
      } catch {
        // Network error — allow retry.
        setSubmitting(false);
      }
    },
    [score, submitting]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="enps-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      {/* Warm backdrop with soft gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 20%, oklch(0.96 0.02 75 / 0.98), oklch(0.94 0.015 260 / 0.96))",
          backdropFilter: "blur(14px)",
        }}
        onClick={() => setOpen(false)}
      />

      <div
        className="relative z-10 flex w-full max-w-2xl flex-col gap-8 rounded-2xl bg-card px-8 py-10 shadow-2xl ring-1 ring-foreground/10 md:px-14 md:py-14"
      >
        <button
          type="button"
          aria-label="Dismiss for now"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {stage === "score" && (
          <ScoreStage
            score={score}
            onScore={(s) => {
              setScore(s);
              setStage("reason");
            }}
          />
        )}

        {stage === "reason" && score !== null && (
          <ReasonStage
            score={score}
            reason={reason}
            setReason={setReason}
            submitting={submitting}
            onBack={() => setStage("score")}
            onSkip={() => submit(null)}
            onSubmit={() => submit(reason)}
          />
        )}

        {stage === "thanks" && <ThanksStage />}

        {stage !== "thanks" && (
          <p className="text-center text-xs text-muted-foreground">
            Anonymous · Only aggregated results are shared
          </p>
        )}
      </div>
    </div>
  );
}

function ScoreStage({
  score,
  onScore,
}: {
  score: number | null;
  onScore: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="space-y-3 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Monthly pulse
        </p>
        <h2
          id="enps-title"
          className="font-display text-3xl italic leading-tight tracking-tight text-foreground md:text-4xl"
        >
          How happy are you at Cleo right now?
        </h2>
        <p className="text-sm text-muted-foreground">
          0 = not happy, 10 = couldn&apos;t be better
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="grid w-full grid-cols-11 gap-1.5">
          {Array.from({ length: 11 }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onScore(i)}
              className={cn(
                "group relative flex aspect-square items-center justify-center rounded-lg border text-sm font-medium transition-all duration-150",
                score === i
                  ? "border-primary bg-primary text-primary-foreground shadow-md"
                  : "border-border bg-background text-foreground hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-sm"
              )}
              style={{
                background:
                  score === i
                    ? undefined
                    : scoreTint(i),
              }}
              aria-label={`Score ${i}`}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="flex w-full justify-between text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          <span>Not happy</span>
          <span>Love it here</span>
        </div>
      </div>
    </div>
  );
}

function ReasonStage({
  score,
  reason,
  setReason,
  submitting,
  onBack,
  onSkip,
  onSubmit,
}: {
  score: number;
  reason: string;
  setReason: (s: string) => void;
  submitting: boolean;
  onBack: () => void;
  onSkip: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-3 text-center">
        <div className="inline-flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            You picked
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            {score}
          </span>
          <button
            type="button"
            onClick={onBack}
            className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground underline-offset-4 hover:underline"
          >
            Change
          </button>
        </div>
        <h2
          id="enps-title"
          className="font-display text-3xl italic leading-tight tracking-tight text-foreground md:text-4xl"
        >
          Why?
        </h2>
        <p className="text-sm text-muted-foreground">
          Optional — a sentence or two helps a lot
        </p>
      </div>

      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="What's going well, what isn't…"
        className="w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
      />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          disabled={submitting}
          className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          Submit without reason
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:translate-y-px disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function ThanksStage() {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-2xl">
        ✿
      </div>
      <h2
        id="enps-title"
        className="font-display text-3xl italic leading-tight tracking-tight text-foreground md:text-4xl"
      >
        Thank you
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Your answer helps us understand how the team is feeling. See you next
        month.
      </p>
    </div>
  );
}

// Subtle warm→cool tint across the scale for visual hierarchy.
function scoreTint(i: number): string {
  // 0-4 warm amber, 5-6 neutral, 7-10 cool indigo
  if (i <= 4) return `oklch(0.97 ${0.02 + i * 0.004} 70 / 0.6)`;
  if (i <= 6) return `oklch(0.97 0.01 85 / 0.4)`;
  return `oklch(0.95 ${0.015 + (i - 6) * 0.006} 260 / 0.5)`;
}
