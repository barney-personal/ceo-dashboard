/**
 * Manual overrides to the Talent-team employment state, sourced from Lucy
 * Lynn's roster spreadsheet `Talent Team Dec-April.xlsx` (2026-04-23).
 *
 * These take precedence over HiBob's `lifecycle_status` because HR takes a
 * while to process exits — a recruiter can be marked `employed` in HiBob for
 * weeks after Lucy's team has actually let them go. Until HR catches up this
 * list is the ground truth.
 *
 * Entries also cover sourcers. Cleo tracks sourcing in a separate Mode query
 * (`Sourced candidates`) that the dashboard doesn't yet consume — but for
 * people who show up as a recruiter via `all_hires.hired_by` we can still
 * classify them correctly here.
 *
 * **Keep this list updated.** Ask Lucy quarterly for a fresh roster, or add
 * entries as exits happen. Stale entries only misclassify by one direction
 * (marking a re-hire as still-departed) so the risk is bounded.
 */

export const TALENT_ROSTER_AS_OF = "2026-04-23";

export type TalentRosterEntry = {
  status: "active" | "departed";
  role: "talent_partner" | "sourcer";
  /** Alternate spellings the same person shows up as in Mode data. */
  aliases?: string[];
  /** Free-text note surfaced on the page tooltip/row for context. */
  notes?: string;
};

export const TALENT_ROSTER: Record<string, TalentRosterEntry> = {
  // ── Active Talent Partners (17) ─────────────────────────────────────────
  "Gowtam Rajasegaran": {
    status: "active",
    role: "talent_partner",
    notes: "Manager in T1",
  },
  "Millie Di Luzio": { status: "active", role: "talent_partner" },
  "Aliecee Cummings": { status: "active", role: "talent_partner" },
  "Declan Kerr": {
    status: "active",
    role: "talent_partner",
    notes: "Started January 2026",
  },
  "Brent Cunningham": { status: "active", role: "talent_partner" },
  "Olivia de Peyronnet": {
    status: "active",
    role: "talent_partner",
    notes: "Manager in T1",
  },
  "Beth Baron": {
    status: "active",
    role: "talent_partner",
    aliases: ["Bethany Baron"],
  },
  "Katya Riaposova": {
    status: "active",
    role: "talent_partner",
    notes: "2 offers outstanding",
  },
  "Sam Taylor": {
    status: "active",
    role: "talent_partner",
    notes: "Started January 2026",
  },
  "Kushla Egan": {
    status: "active",
    role: "talent_partner",
    notes: "Manager in T1",
  },
  "Scott Lazarus": {
    status: "active",
    role: "talent_partner",
    notes: "Started January 2026",
  },
  "Sara Knott": {
    status: "active",
    role: "talent_partner",
    notes: "Started January 2026",
  },
  "Sofia Thomaidou": {
    status: "active",
    role: "talent_partner",
    aliases: ["Sofia Thom"],
    notes: "Started December 2025",
  },
  "Sophie Elliott": {
    status: "active",
    role: "talent_partner",
    notes: "Manager in T1",
  },
  "Lily Giedd": {
    status: "active",
    role: "talent_partner",
    notes: "Started December 2025",
  },
  "Iona Hamilton": { status: "active", role: "talent_partner" },
  "Emma Feneley": { status: "active", role: "talent_partner" },

  // ── Active Sourcers (9) ─────────────────────────────────────────────────
  "Aleksandra Belica": {
    status: "active",
    role: "sourcer",
    aliases: ["Ola Belica"],
  },
  "Adam Szleszynski": { status: "active", role: "sourcer" },
  "María Molina Rey": {
    status: "active",
    role: "sourcer",
    aliases: ["Maria Molina Rey"],
    notes: "Started January 2026",
  },
  "Santiago Remolina": {
    status: "active",
    role: "sourcer",
    notes: "Started March 2026",
  },
  "Calum McMahon": {
    status: "active",
    role: "sourcer",
    notes: "Manager in T1 — parental leave 26 Jan – 2 Mar 2026",
  },
  "Victoria Zolotar": { status: "active", role: "sourcer" },
  "Lucia Burgos": { status: "active", role: "sourcer" },
  "Julissa Santacruz": {
    status: "active",
    role: "sourcer",
    notes: "Sick leave 6 Mar – 14 Apr 2026",
  },
  "Oleksandra Votintseva": { status: "active", role: "sourcer" },

  // ── Recent Exits (18) — departed per Lucy's roster ─────────────────────
  // Several of these still show "employed" in HiBob; override wins.
  "Marta Kowalczyk": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster — HR not yet updated",
  },
  "Viktoriia Tsvetkova": {
    status: "departed",
    role: "talent_partner",
    aliases: ["Victoria Tsvetkova"],
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Mario Tavares": {
    status: "departed",
    role: "talent_partner",
    aliases: ["Mário Tavares"],
    notes: "Exit per Lucy's Apr 23 roster — HR not yet updated",
  },
  "Nick Spong": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Ellis Jolly": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster — HR not yet updated",
  },
  "Daniela García Romero": {
    status: "departed",
    role: "sourcer",
    aliases: ["Daniela Garcia Romero"],
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Florian Rose": {
    status: "departed",
    role: "talent_partner",
    notes: "Garden leave, termination 2026-06-17",
  },
  "Luis Bravo": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Ceon White": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Chinmoy Sarker": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Jeremy Barnes": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster — HR not yet updated",
  },
  "Fernanda Prado e Silva": {
    status: "departed",
    role: "talent_partner",
    aliases: ["Fernanda Prado"],
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Angelika Komornik": {
    status: "departed",
    role: "talent_partner",
    aliases: ["Angela Komornik"],
    notes: "Exit 2026-04-17",
  },
  "Chloe Fleming": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit 2026-03-30",
  },
  "Adriana P": {
    status: "departed",
    role: "sourcer",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Sinead Nix": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Maeve Condon": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit per Lucy's Apr 23 roster",
  },
  "Laura Scott": {
    status: "departed",
    role: "talent_partner",
    notes: "Exit 2026-04-07",
  },
};
