import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface SquadSeed {
  name: string;
  pillar: string;
  channelId: string;
  pmName: string;
  pmSlackId?: string;
  isActive?: boolean;
}

const SQUAD_SEEDS: SquadSeed[] = [
  // Growth
  { name: "Growth Marketing (EWA)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Amanda", pmSlackId: "U0ADKEY64V9" },
  { name: "Growth Marketing (Diversification)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Ricky Dhaliwal", pmSlackId: "U09JNRJ69LK" },
  { name: "Growth Onboarding", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Areej Al Medinah", pmSlackId: "U098MP7D8UT" },
  { name: "Personalisation", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Bruno Haag", pmSlackId: "U0AJQ40MJ80" },
  { name: "Referrals", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Sevda Kiratli", pmSlackId: "U08S28S36P7" },
  { name: "Retention", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Mathew Taskin", pmSlackId: "U09NABPLYDV" },
  { name: "PPC (Price, Packaging & Conversion)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "" },

  // EWA & Credit Products
  { name: "EWA-Core", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Chris Jan Dudley", pmSlackId: "U063MT6S7CL" },
  { name: "Geo-expansion", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Lovneet Singh", pmSlackId: "U06G3UGP3J8" },
  { name: "Instalment Loans", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Jani Kiilunen", pmSlackId: "U0A69JC19HD" },
  { name: "Card (Flex)", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Oladipo Oladitan (Ladi)", pmSlackId: "UL48CU6N7" },
  { name: "BNPL (Pay Later)", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Dogan Ates", pmSlackId: "U09A57TT657" },

  // Chat
  { name: "Autopilot Adoption", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Sarah Varki", pmSlackId: "U09GS28JLTT" },
  { name: "Daily Plans", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Fede Behrens", pmSlackId: "U07AVLLUHSN" },
  { name: "Autopilot Retention", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Matej Sip", pmSlackId: "U08NXHLGTK3" },
  { name: "Broccoli (Chat Platform)", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Cassie Johnstone", pmSlackId: "U9QD86AGG" },

  // New Bets
  { name: "Discovery Liquidity (Flex Card)", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Samuel Rueesch", pmSlackId: "U08CZQ7RZM4" },
  { name: "Discovery Grow/Wealth", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Kelly Bueno Martinez", pmSlackId: "U0A8HSL8925" },
  { name: "Discovery Spend", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Surabhi Nimkar", pmSlackId: "U09NQNKHKV4" },
  { name: "Mobile", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Glenn Drawbridge", pmSlackId: "U08S28SEP9B" },
  { name: "Instalment Loans (New Bets)", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Jani Kiilunen", pmSlackId: "U0A69JC19HD" },

  // Access, Trust & Money, Risk & Payments
  { name: "Payments Infrastructure & Expansion", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Daniela Padilla Vivero", pmSlackId: "U0A9D5C0Q2Z" },
  { name: "Payment Intelligence", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Ken Dobson", pmSlackId: "U0ACPDNUYLR" },
  { name: "Risk Decisioning", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Charlie Davies", pmSlackId: "U0AC44HQ55H" },
  { name: "Fraud Infrastructure", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Jillian Pellagatti", pmSlackId: "U01AEAZB942" },
];

/**
 * Seed squads table with canonical data. Upserts — safe to call repeatedly.
 */
export async function seedSquads(): Promise<number> {
  let count = 0;

  for (const seed of SQUAD_SEEDS) {
    const result = await db
      .insert(squads)
      .values({
        name: seed.name,
        pillar: seed.pillar,
        channelId: seed.channelId,
        pmName: seed.pmName,
        pmSlackId: seed.pmSlackId ?? null,
        isActive: seed.isActive ?? true,
      })
      .onConflictDoUpdate({
        target: squads.name,
        set: {
          pillar: seed.pillar,
          channelId: seed.channelId,
          pmName: seed.pmName,
          pmSlackId: seed.pmSlackId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (result.length > 0) count++;
  }

  return count;
}
