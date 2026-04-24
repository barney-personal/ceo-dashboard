import { Sparkles } from "lucide-react";
import { getOrGenerateBriefing } from "@/lib/data/briefing";
import type { Role } from "@/lib/auth/roles";

interface DailyBriefingProps {
  /**
   * All email addresses the Clerk user has. First entry is used as the
   * per-day cache key; every entry is checked against the Headcount SSoT.
   */
  emails: string[];
  role: Role;
  userId: string | null;
}

/**
 * Render a string with minimal markdown support — just **bold**.
 * Keeps the LLM output warm without pulling in react-markdown.
 */
function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function formatFreshness(generatedAt: Date): string {
  const now = Date.now();
  const diffMs = now - generatedAt.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return generatedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export async function DailyBriefing({ emails, role, userId }: DailyBriefingProps) {
  if (emails.length === 0) return null;

  const briefing = await getOrGenerateBriefing({ emails, role, userId });
  if (!briefing) return null;

  // Split on blank lines so multi-paragraph briefings render as separate <p>.
  const paragraphs = briefing.text.split(/\n{2,}/).filter((p) => p.trim());

  return (
    <section className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/[0.04] via-card to-card p-6 shadow-warm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <h2 className="font-serif text-lg font-semibold text-foreground">
            Your briefing
          </h2>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Updated {formatFreshness(briefing.generatedAt)}
        </span>
      </div>
      <div className="space-y-3 font-serif text-[15px] leading-relaxed text-foreground/90">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{renderInlineMarkdown(paragraph)}</p>
        ))}
      </div>
    </section>
  );
}

export function DailyBriefingSkeleton() {
  return (
    <section className="rounded-xl border border-border/60 bg-gradient-to-br from-primary/[0.04] via-card to-card p-6 shadow-warm">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <h2 className="font-serif text-lg font-semibold text-foreground">
          Your briefing
        </h2>
      </div>
      <div className="space-y-2.5">
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted/60" />
        <div className="h-4 w-full animate-pulse rounded bg-muted/60" />
        <div className="h-4 w-10/12 animate-pulse rounded bg-muted/60" />
        <div className="h-4 w-9/12 animate-pulse rounded bg-muted/60" />
      </div>
    </section>
  );
}
