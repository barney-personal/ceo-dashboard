import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const client = new Anthropic();

export interface ParsedKr {
  objective: string;
  name: string;
  rag: "green" | "amber" | "red" | "not_started";
  metric: string | null;
}

export interface ParsedOkrUpdate {
  squadName: string;
  tldr: string;
  krs: ParsedKr[];
}

/**
 * Build squad context for the LLM prompt from the database.
 * This way adding a squad is just a DB insert — no code changes.
 */
export async function buildSquadContext(): Promise<string> {
  const allSquads = await db
    .select()
    .from(squads)
    .where(eq(squads.isActive, true));

  // Group by pillar
  const byPillar = new Map<string, typeof allSquads>();
  for (const s of allSquads) {
    const existing = byPillar.get(s.pillar) ?? [];
    existing.push(s);
    byPillar.set(s.pillar, existing);
  }

  const pillarLines = [...byPillar.entries()]
    .map(
      ([pillar, sqs]) =>
        `${pillar}: ${sqs.map((s) => s.name).join(", ")}`
    )
    .join("\n");

  const authorLines = allSquads
    .filter((s) => s.pmName)
    .map((s) => `- ${s.pmName} → ${s.name} (${s.pillar})`)
    .join("\n");

  return `Known squads per pillar:\n${pillarLines}\n\nKnown author → squad mapping:\n${authorLines}`;
}

export function buildSystemPromptFromContext(squadContext: string): string {
  return `You extract structured OKR data from weekly squad update messages posted by product managers in Slack.

IMPORTANT: Only extract ACTUAL OKR Key Results — these are formal objectives with measurable targets and RAG status indicators. Do NOT extract:
- Experiments (live, upcoming, or shipped)
- "Last week" / "This week" / "Working on" items
- Shipped features or initiatives
- Discovery work or general status updates
- Delivery milestones (unless they ARE a formal KR)

A real KR looks like: "KR1: Increase M1 retention rate by 2% :large_green_circle:" or "KR1.1: Reduce arrears by 3% to unlock $5.10 ARPU"
NOT like: "Shipped loan offer happy path" or "Building fixes for app init time issues"

${squadContext}

Extract:
- squadName: map to the closest known squad name above
- tldr: 1-2 sentence summary
- krs: array of ONLY formal key results, each with:
  - objective: the parent objective
  - name: the KR name (e.g. "KR1: Total Paid LTV:CPA", "Launch EWA MVP in UK")
  - rag: "green" | "amber" | "red" | "not_started"
  - metric: actual vs target string if present (e.g. "2.86x vs 3x target"), or null

RAG emoji mapping:
- :large_green_circle: / :green_circle: → green
- :large_orange_circle: / :large_yellow_circle: → amber
- :red_circle: → red
- :white_circle: / :black_circle: → not_started
- :apple: → amber

If the message is NOT a weekly squad OKR update (e.g. meeting agenda, action items, planning discussion, question, or general chat), return: null

Return ONLY valid JSON (object or null). No markdown code blocks.`;
}

/**
 * Use Claude to parse a raw Slack message into structured OKR data.
 * Returns null if the message is not an OKR update.
 */
export async function llmParseOkrUpdate(
  messageText: string,
  channelContext: string,
  systemPrompt?: string
): Promise<ParsedOkrUpdate | null> {
  // Build prompt from DB if not provided
  const prompt =
    systemPrompt ??
    buildSystemPromptFromContext(await buildSquadContext());

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: prompt,
    messages: [
      {
        role: "user",
        content: `Channel: ${channelContext}\n\nSlack message:\n${messageText}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Parse the JSON response — strip markdown code blocks if present
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  if (trimmed === "null" || trimmed === "") return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || !parsed.squadName || !Array.isArray(parsed.krs))
      return null;

    return {
      squadName: parsed.squadName,
      tldr: parsed.tldr || "",
      krs: parsed.krs
        .filter(
          (kr: Record<string, unknown>) =>
            kr.name && typeof kr.name === "string"
        )
        .map((kr: Record<string, unknown>) => ({
          objective: (kr.objective as string) || "",
          name: (kr.name as string).slice(0, 200),
          rag: ["green", "amber", "red", "not_started"].includes(
            kr.rag as string
          )
            ? (kr.rag as ParsedKr["rag"])
            : "not_started",
          metric: (kr.metric as string) || null,
        })),
    };
  } catch {
    console.warn("Failed to parse LLM response:", trimmed.slice(0, 200));
    return null;
  }
}
