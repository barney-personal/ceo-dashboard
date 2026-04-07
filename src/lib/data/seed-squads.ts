import { db } from "@/lib/db";
import { squads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface SquadSeed {
  name: string;
  pillar: string;
  channelId: string;
  pmName: string;
}

const SQUAD_SEEDS: SquadSeed[] = [
  // Growth
  { name: "Growth Marketing (EWA)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Amanda" },
  { name: "Growth Marketing (Diversification)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Ricky Dhaliwal" },
  { name: "Growth Onboarding", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Areej Al Medinah" },
  { name: "Personalisation", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Bruno Haag" },
  { name: "Referrals", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Sevda Kiratli" },
  { name: "Retention", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Mathew Taskin" },
  { name: "PPC (Price, Packaging & Conversion)", pillar: "Growth", channelId: "C05LACCBKPU", pmName: "Alexis Benslimane" },

  // EWA & Credit Products
  { name: "EWA-Core", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Chris Jan Dudley" },
  { name: "Geo-expansion", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Lovneet Singh" },
  { name: "Instalment Loans", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Jani Kiilunen" },
  { name: "Card (Flex)", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Oladipo Oladitan (Ladi)" },
  { name: "BNPL (Pay Later)", pillar: "EWA & Credit Products", channelId: "C09E6L6336G", pmName: "Dogan Ates" },

  // Chat
  { name: "Autopilot Adoption", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Santiago Vaquero" },
  { name: "Daily Plans", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Fede Behrens" },
  { name: "Autopilot Retention", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Matej Sip" },
  { name: "Broccoli (Chat Platform)", pillar: "Chat", channelId: "C09E30B8PD0", pmName: "Cassie Johnstone" },

  // New Bets
  { name: "Discovery Liquidity (Flex Card)", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Samuel Rueesch" },
  { name: "Discovery Grow/Wealth", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Kelly Bueno Martinez" },
  { name: "Discovery Spend", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Surabhi Nimkar" },
  { name: "Mobile", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Glenn Drawbridge" },
  { name: "Instalment Loans (New Bets)", pillar: "New Bets", channelId: "C09DMP0UBGX", pmName: "Jani Kiilunen" },

  // Access, Trust & Money, Risk & Payments
  { name: "Payments Infrastructure & Expansion", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Daniela Padilla Vivero" },
  { name: "Payment Intelligence", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Ken Dobson" },
  { name: "Risk Decisioning", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Charlie Davies" },
  { name: "Fraud Infrastructure", pillar: "Access, Trust & Money, Risk & Payments", channelId: "C09EG0TTJQ1", pmName: "Jillian Pellagatti" },
];

/**
 * Seed squads table with canonical data. Upserts — safe to call repeatedly.
 */
export async function seedSquads(): Promise<number> {
  let count = 0;

  for (const seed of SQUAD_SEEDS) {
    const existing = await db
      .select()
      .from(squads)
      .where(eq(squads.name, seed.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(squads).values({
        name: seed.name,
        pillar: seed.pillar,
        channelId: seed.channelId,
        pmName: seed.pmName,
      });
      count++;
    } else {
      // Update pillar/PM if changed
      await db
        .update(squads)
        .set({
          pillar: seed.pillar,
          channelId: seed.channelId,
          pmName: seed.pmName,
          updatedAt: new Date(),
        })
        .where(eq(squads.name, seed.name));
    }
  }

  return count;
}
