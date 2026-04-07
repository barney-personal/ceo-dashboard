/**
 * Parses structured OKR updates from Slack messages.
 *
 * Expected format (consistent across all pillar channels):
 *   *Squad Name* :emoji:
 *   *OKR Status*
 *   • Objective 1: Description
 *     ◦ KR1: Description
 *       ▪ :large_green_circle: actual vs target
 *
 * RAG status emojis:
 *   :large_green_circle: → on_track
 *   :large_orange_circle: / :large_yellow_circle: → at_risk
 *   :red_circle: → behind
 *   :white_circle: → not_started
 *   :black_circle: → deprioritised
 */

export type OkrStatus =
  | "on_track"
  | "at_risk"
  | "behind"
  | "not_started"
  | "completed";

export interface ParsedKeyResult {
  name: string;
  status: OkrStatus;
  actual?: string;
  target?: string;
  rawLine: string;
}

export interface ParsedObjective {
  name: string;
  keyResults: ParsedKeyResult[];
}

export interface ParsedOkrUpdate {
  squadName: string;
  objectives: ParsedObjective[];
  tldr?: string;
  rawText: string;
}

const STATUS_EMOJI_MAP: Record<string, OkrStatus> = {
  ":large_green_circle:": "on_track",
  ":green_circle:": "on_track",
  ":large_orange_circle:": "at_risk",
  ":large_yellow_circle:": "at_risk",
  ":yellow_circle:": "at_risk",
  ":red_circle:": "behind",
  ":white_circle:": "not_started",
  ":black_circle:": "not_started",
};

/**
 * Check if a message looks like an OKR update (not a reminder or join message).
 */
export function isOkrUpdate(text: string): boolean {
  if (!text) return false;
  // Must contain at least one RAG emoji and mention of objective/KR/OKR
  const hasRag = Object.keys(STATUS_EMOJI_MAP).some((emoji) =>
    text.includes(emoji)
  );
  const hasOkrContent =
    /\b(objective|OKR|KR\d|key result)/i.test(text) ||
    /\b(TL;DR|TLDR|tl;dr)\b/.test(text);
  return hasRag && hasOkrContent;
}

/**
 * Extract the squad/team name from the message header.
 * Typically the first bold text: *Growth Marketing | EWA*
 */
function extractSquadName(text: string): string {
  const match = text.match(/^\*([^*]+)\*/m);
  if (match) {
    // Clean up emoji and whitespace
    return match[1].replace(/:[a-z_-]+:/g, "").trim();
  }
  return "Unknown Squad";
}

/**
 * Extract TL;DR section.
 */
function extractTldr(text: string): string | undefined {
  const match = text.match(
    /\*?(?:TL;DR|TLDR)\*?\s*\n?([\s\S]*?)(?=\n\*(?:OKR|Objective|Live|Last|This|Working)|$)/i
  );
  if (match) {
    return match[1]
      .replace(/^[•\-\s]+/gm, "")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .join("; ");
  }
  return undefined;
}

/**
 * Extract RAG status from a line of text.
 */
function extractStatus(line: string): OkrStatus {
  for (const [emoji, status] of Object.entries(STATUS_EMOJI_MAP)) {
    if (line.includes(emoji)) return status;
  }
  return "not_started";
}

/**
 * Extract actual vs target values from a line.
 * Common formats:
 *   "+5.0% vs +7.6% target"
 *   "2.86x vs 3.0x target"
 *   "+$0.58 vs. +$1.00 target"
 *   "[+0M vs. + $13M"
 */
function extractActualTarget(
  line: string
): { actual?: string; target?: string } {
  const match = line.match(
    /([+\-$£\d.,]+[%xMKm]*)\s*(?:vs\.?|versus)\s*([+\-$£\d.,]+[%xMKm]*)\s*(?:target|pro.?rated)?/i
  );
  if (match) {
    return { actual: match[1].trim(), target: match[2].trim() };
  }
  return {};
}

/**
 * Parse a full OKR update message into structured data.
 */
export function parseOkrUpdate(text: string): ParsedOkrUpdate | null {
  if (!isOkrUpdate(text)) return null;

  const squadName = extractSquadName(text);
  const tldr = extractTldr(text);
  const objectives: ParsedObjective[] = [];

  // Split into lines and look for objective/KR patterns
  const lines = text.split("\n");
  let currentObjective: ParsedObjective | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect objective lines
    const objMatch = trimmed.match(
      /\*?(?:Objective\s*\d*):?\s*\*?\s*(.+)/i
    );
    if (objMatch) {
      currentObjective = {
        name: objMatch[1]
          .replace(/\*+/g, "")
          .replace(/:[a-z_-]+:/g, "")
          .replace(/\([^)]*\)/g, "")
          .trim(),
        keyResults: [],
      };
      objectives.push(currentObjective);
      continue;
    }

    // Detect KR lines (contain a RAG emoji)
    const hasRag = Object.keys(STATUS_EMOJI_MAP).some((e) =>
      trimmed.includes(e)
    );
    if (hasRag && currentObjective) {
      // Try to extract KR name
      const krMatch = trimmed.match(
        /\*?(?:KR\s*[\d.]*):?\s*\*?\s*(.+?)(?:\s*[-–—]\s*|\s*$)/
      );

      const status = extractStatus(trimmed);
      const { actual, target } = extractActualTarget(trimmed);

      const krName = krMatch
        ? krMatch[1].replace(/\*+/g, "").replace(/:[a-z_-]+:/g, "").trim()
        : trimmed
            .replace(/\*+/g, "")
            .replace(/:[a-z_-]+:/g, "")
            .replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 120);

      if (krName) {
        currentObjective.keyResults.push({
          name: krName,
          status,
          actual,
          target,
          rawLine: trimmed,
        });
      }
    }
  }

  // If no objectives found but message has RAG emojis, create a generic one
  if (objectives.length === 0) {
    const genericObj: ParsedObjective = { name: squadName, keyResults: [] };
    for (const line of lines) {
      const hasRag = Object.keys(STATUS_EMOJI_MAP).some((e) =>
        line.includes(e)
      );
      if (hasRag) {
        const status = extractStatus(line);
        const { actual, target } = extractActualTarget(line);
        genericObj.keyResults.push({
          name: line
            .replace(/\*+/g, "")
            .replace(/:[a-z_-]+:/g, "")
            .replace(/<[^>]+>/g, "")
            .trim()
            .slice(0, 120),
          status,
          actual,
          target,
          rawLine: line,
        });
      }
    }
    if (genericObj.keyResults.length > 0) {
      objectives.push(genericObj);
    }
  }

  if (objectives.length === 0) return null;

  return { squadName, objectives, tldr, rawText: text };
}
