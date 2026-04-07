import Anthropic from "@anthropic-ai/sdk";

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
 * Known pillar → squad mappings to help the LLM normalize squad names.
 */
const PILLAR_SQUADS: Record<string, string[]> = {
  Growth: [
    "Growth Marketing (EWA)",
    "Growth Marketing (Diversification)",
    "Growth Onboarding",
    "Personalisation",
    "Referrals",
    "Retention",
    "PPC (Price, Packaging & Conversion)",
  ],
  "EWA & Credit Products": [
    "EWA-Core",
    "Geo-expansion",
    "Instalment Loans",
    "Card (Flex)",
    "BNPL (Pay Later)",
  ],
  "New Bets": [
    "Discovery Liquidity (Flex Card)",
    "Discovery Grow/Wealth",
    "Discovery Spend",
    "Mobile",
  ],
  Chat: [
    "Autopilot Adoption",
    "Daily Plans",
    "Autopilot Retention",
    "Broccoli (Chat Platform)",
  ],
  "Access, Trust & Money, Risk & Payments": [
    "Payments Infrastructure & Expansion",
    "Payment Intelligence",
    "Risk Decisioning",
    "Fraud Infrastructure",
  ],
};

const SYSTEM_PROMPT = `You extract structured OKR update data from Slack messages posted by product managers.

Each message is from one of these pillar OKR channels. The known squads per pillar are:
${Object.entries(PILLAR_SQUADS)
  .map(([pillar, squads]) => `${pillar}: ${squads.join(", ")}`)
  .join("\n")}

Given a raw Slack message, extract:
- squadName: map to the closest known squad name above. If the message mentions a squad not in the list, use the name from the message.
- tldr: a 1-2 sentence summary of what happened / what's the status
- krs: array of key results, each with:
  - objective: the parent objective description
  - name: short KR name (e.g. "KR1: Total Paid LTV:CPA", "Reduce arrears by 3%", "Launch EWA MVP in UK")
  - rag: "green" (on track), "amber" (at risk), "red" (behind), or "not_started"
  - metric: the actual vs target string if present (e.g. "2.86x vs 3x target", "+5.0% vs +7.6% target"), or null

RAG mapping from Slack emoji:
- :large_green_circle: or :green_circle: → green
- :large_orange_circle: or :large_yellow_circle: → amber
- :red_circle: → red
- :white_circle: or :black_circle: → not_started
- :apple: → amber (used by some Chat squads as "needs attention")

If the message is NOT an OKR/squad update (e.g. it's a meeting agenda, action items, planning discussion, or general chat), return exactly: null

Return ONLY valid JSON — either a single object or null. No markdown, no explanation.`;

/**
 * Use Claude to parse a raw Slack message into structured OKR data.
 * Returns null if the message is not an OKR update.
 */
export async function llmParseOkrUpdate(
  messageText: string,
  channelContext: string
): Promise<ParsedOkrUpdate | null> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
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
    trimmed = trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }
  if (trimmed === "null" || trimmed === "") return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || !parsed.squadName || !Array.isArray(parsed.krs))
      return null;

    // Validate and normalize
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
