import { db } from "@/lib/db";
import { userBriefings } from "@/lib/db/schema";
import { normalizeDatabaseError } from "@/lib/db/errors";
import { and, eq } from "drizzle-orm";
import * as Sentry from "@sentry/nextjs";
import type { Role } from "@/lib/auth/roles";
import { getBriefingContext } from "@/lib/data/briefing-context";
import { generateBriefing, BRIEFING_MODEL } from "@/lib/integrations/llm-briefing";

export interface DailyBriefing {
  text: string;
  generatedAt: Date;
  cached: boolean;
  briefingDate: string;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch today's briefing for this user, generating it on first access.
 *
 * Cached per `(email, briefing_date)` for the UTC day. Bumping `BRIEFING_MODEL`
 * forces regeneration via the model-mismatch check. Any unhandled failure
 * (DB or LLM) resolves to `null` rather than throwing — the caller renders
 * a graceful placeholder instead of breaking the overview page.
 */
export async function getOrGenerateBriefing({
  emails,
  role,
  userId,
}: {
  /**
   * All email addresses the Clerk user has — passed through to the context
   * gatherer for SSoT matching. The first entry is used as the cache key.
   */
  emails: string[];
  role: Role;
  userId?: string | null;
}): Promise<DailyBriefing | null> {
  if (emails.length === 0) return null;
  const cacheKeyEmail = emails[0].toLowerCase();
  const briefingDate = todayUtcDate();

  try {
    const existing = await db
      .select()
      .from(userBriefings)
      .where(
        and(
          eq(userBriefings.userEmail, cacheKeyEmail),
          eq(userBriefings.briefingDate, briefingDate),
        ),
      )
      .limit(1);

    if (existing.length > 0 && existing[0].model === BRIEFING_MODEL) {
      return {
        text: existing[0].briefingText,
        generatedAt: existing[0].generatedAt,
        cached: true,
        briefingDate,
      };
    }
  } catch (error) {
    const normalized = normalizeDatabaseError(
      "Load cached daily briefing",
      error,
    );
    Sentry.captureException(normalized, {
      tags: { integration: "llm-briefing" },
      extra: { step: "cache_read", email: cacheKeyEmail },
    });
    // Cache miss by design — fall through and generate fresh.
  }

  let context;
  try {
    context = await getBriefingContext({ emails, role, userId });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { integration: "llm-briefing" },
      extra: { step: "context_gather", email: cacheKeyEmail },
    });
    return null;
  }

  // If we couldn't identify the person at all, skip briefing rather than
  // hallucinating one against an empty profile.
  if (!context.person) return null;

  let result;
  try {
    result = await generateBriefing(context);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { integration: "llm-briefing" },
      extra: { step: "llm_generate", email: cacheKeyEmail },
    });
    return null;
  }

  const generatedAt = new Date();

  try {
    await db
      .insert(userBriefings)
      .values({
        userEmail: cacheKeyEmail,
        briefingDate,
        briefingText: result.text,
        contextJson: context,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        cacheCreationTokens: result.usage.cacheCreationTokens,
        generatedAt,
      })
      .onConflictDoUpdate({
        target: [userBriefings.userEmail, userBriefings.briefingDate],
        set: {
          briefingText: result.text,
          contextJson: context,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheCreationTokens: result.usage.cacheCreationTokens,
          generatedAt,
        },
      });
  } catch (error) {
    // The LLM call already succeeded — surface the text even if the write
    // fails so the user isn't punished by a transient DB error.
    const normalized = normalizeDatabaseError(
      "Persist daily briefing",
      error,
    );
    Sentry.captureException(normalized, {
      tags: { integration: "llm-briefing" },
      extra: { step: "cache_write", email: cacheKeyEmail },
    });
  }

  return {
    text: result.text,
    generatedAt,
    cached: false,
    briefingDate,
  };
}
