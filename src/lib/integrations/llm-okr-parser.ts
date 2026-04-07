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

const SYSTEM_PROMPT = `You extract structured OKR data from weekly squad update messages posted by product managers in Slack.

IMPORTANT: Only extract ACTUAL OKR Key Results — these are formal objectives with measurable targets and RAG status indicators. Do NOT extract:
- Experiments (live, upcoming, or shipped)
- "Last week" / "This week" / "Working on" items
- Shipped features or initiatives
- Discovery work or general status updates
- Delivery milestones (unless they ARE a formal KR)

A real KR looks like: "KR1: Increase M1 retention rate by 2% :large_green_circle:" or "KR1.1: Reduce arrears by 3% to unlock $5.10 ARPU"
NOT like: "Shipped loan offer happy path" or "Building fixes for app init time issues"

Known squads per pillar:
${Object.entries(PILLAR_SQUADS)
  .map(([pillar, squads]) => `${pillar}: ${squads.join(", ")}`)
  .join("\n")}

Known author → squad mapping (use these to identify the squad when the message doesn't have a clear header):
- Santiago Vaquero / Sarah Varki → Autopilot Adoption (Chat)
- Fede Behrens → Daily Plans (Chat)
- Matej Sip → Autopilot Retention (Chat)
- Cassie Johnstone → Broccoli (Chat Platform) (Chat)
- Amanda → Growth Marketing (EWA) (Growth)
- Areej Al Medinah → Growth Onboarding (Growth)
- Bruno Haag → Personalisation (Growth)
- Sevda Kiratli → Referrals (Growth)
- Mathew Taskin → Retention (Growth)
- Chris Jan Dudley / Ewa Pazdur → EWA-Core (EWA & Credit Products)
- Lovneet Singh → Geo-expansion (EWA & Credit Products)
- Jani Kiilunen → Instalment Loans (EWA & Credit Products or New Bets)
- Dogan Ates → BNPL (Pay Later) (EWA & Credit Products)
- Oladipo Oladitan (Ladi) → Card (Flex) (EWA & Credit Products)
- Glenn Drawbridge → Mobile (New Bets)
- Samuel Rueesch → Discovery Liquidity (Flex Card) (New Bets)
- Kelly Bueno Martinez → Discovery Grow/Wealth (New Bets)
- Surabhi Nimkar → Discovery Spend (New Bets)

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
