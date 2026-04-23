import type {
  ImpactEngineerPrediction,
  ImpactShapContribution,
} from "./impact-model";

export interface CoachingSignal {
  feature: string;
  label: string;
  group: string;
  shap: number;
  pctMultiplier: number;
  value: number | null;
  headline: string;
  detail: string;
}

export interface CoachingCard {
  residualPct: number;
  residualDirection: "above" | "below" | "on";
  strengths: CoachingSignal[];
  conversations: CoachingSignal[];
}

const PLAIN_LABEL: Record<string, string> = {
  tenure_months: "How long they've been here",
  slack_msgs_per_day: "Slack messages per day",
  slack_reactions_per_day: "Slack reactions per day",
  slack_active_day_rate: "Share of days active on Slack",
  slack_desktop_share: "Share of Slack activity on desktop",
  slack_channel_share: "Share of Slack messages in channels vs DMs",
  slack_days_since_active: "Days since last active on Slack",
  ai_tokens_log: "Volume of AI tool usage",
  ai_cost_log: "Spend on AI tools",
  ai_n_days: "Days per month using AI",
  ai_max_models: "Number of different AI models tried",
  avg_rating: "Average performance rating",
  latest_rating: "Latest performance rating",
  rating_count: "Performance reviews received",
  level_num: "Seniority level",
  pr_size_median: "Typical PR size",
  distinct_repos_180d: "Distinct repos touched",
  weekend_pr_share: "Share of PRs merged on weekends",
  offhours_pr_share: "Share of PRs merged outside 9–6 UTC",
  pr_slope_per_week: "Whether their PR rate is speeding up",
  commits_180d_log: "Volume of commits shipped",
  commits_per_pr: "Commits per PR (rework proxy)",
  pr_gap_days: "Share of PRs older than 3 months",
  weekly_pr_cv: "Steadiness vs burstiness of PR output",
  ramp_slope_first90: "Recent PR rate per month of tenure",
};

// Per-feature narrative copy. `actionable: false` features (tenure, level,
// rating) appear as context/strengths but never as coaching conversations —
// you don't coach someone to have more tenure. Rating fields are also
// marked non-actionable because they're outcomes, not levers.
interface FeatureCopy {
  actionable: boolean;
  strength: (value: number | null) => string;
  conversation?: (value: number | null) => string;
}

const FEATURE_COPY: Record<string, FeatureCopy> = {
  tenure_months: {
    actionable: false,
    strength: (v) =>
      `${v != null ? `${Math.round(v)} months of tenure` : "Tenure"} — deep context and relationships.`,
  },
  level_num: {
    actionable: false,
    strength: () => "Seniority matches what the model expects for high impact.",
  },
  rating_count: {
    actionable: false,
    strength: () => "Well-reviewed — enough rating history for confident signal.",
  },
  avg_rating: {
    actionable: false,
    strength: () => "Consistently strong performance ratings.",
  },
  latest_rating: {
    actionable: false,
    strength: () => "Recent performance rating is strong.",
    conversation: () =>
      "Most recent rating is lower than expected — is there a recent change (manager, team, scope) worth understanding?",
  },

  ai_tokens_log: {
    actionable: true,
    strength: () => "Heavy AI-tool use — strong signal of modern workflow.",
    conversation: () =>
      "AI tool usage is low. Worth checking: is access blocked, is onboarding missing, or are they choosing not to? Engineers who lean on AI tools predict meaningfully higher impact.",
  },
  ai_cost_log: {
    actionable: true,
    strength: () => "Spending on AI tools at a level associated with high impact.",
    conversation: () =>
      "AI spend is low. Could be a budget or approval blocker — worth finding out whether the limit is there intentionally or by default.",
  },
  ai_n_days: {
    actionable: true,
    strength: (v) =>
      `Uses AI most days${v != null ? ` (~${Math.round(v)} days/month)` : ""} — consistent habit.`,
    conversation: (v) =>
      `Uses AI only ${v != null ? `~${Math.round(v)} days/month` : "occasionally"}. Daily-use engineers predict higher impact — worth exploring whether the tools fit their workflow.`,
  },
  ai_max_models: {
    actionable: true,
    strength: () => "Experiments across multiple AI models — sign of active tool exploration.",
    conversation: () =>
      "Only uses one or two AI models. Could point at a workflow not yet adapted to AI — worth a 1:1 on where tools could fit in.",
  },

  slack_msgs_per_day: {
    actionable: true,
    strength: () => "Active in Slack — strong collaboration signal.",
    conversation: () =>
      "Low Slack message volume. Could be heads-down focus, remote/async by nature, or disengagement — worth asking how they feel about how connected they are to the team.",
  },
  slack_reactions_per_day: {
    actionable: true,
    strength: () => "Engages with peers' posts — active participant in discussions.",
    conversation: () =>
      "Rarely reacts on Slack. Minor signal on its own — worth combining with other engagement cues.",
  },
  slack_active_day_rate: {
    actionable: true,
    strength: () => "Shows up in Slack on most working days.",
    conversation: () =>
      "Absent from Slack on many working days. Worth a check-in on how connected they feel vs how focused they need to be.",
  },
  slack_channel_share: {
    actionable: true,
    strength: () =>
      "Posts a lot in public channels — contributes visibly to team conversations.",
    conversation: () =>
      "Most of their Slack is in DMs rather than channels. Could be doing a lot of 1:1 support, or could be shy in public — worth encouraging public-channel posts where appropriate.",
  },
  slack_desktop_share: {
    actionable: true,
    strength: () => "Primarily on desktop Slack — deep work signal.",
    conversation: () =>
      "Mostly on mobile Slack. Minor signal — mainly flags working context.",
  },
  slack_days_since_active: {
    actionable: true,
    strength: () => "Active recently — present and responsive.",
    conversation: () =>
      "Hasn't been active on Slack for a while. Worth a direct check-in — is everything ok, or on leave/heads-down?",
  },

  pr_size_median: {
    actionable: true,
    strength: () => "Keeps PRs at a reviewable size — healthy delivery habit.",
    conversation: () =>
      "PRs are running large. Smaller, more frequent PRs correlate with higher impact — worth discussing scoping and whether review is becoming a bottleneck.",
  },
  distinct_repos_180d: {
    actionable: true,
    strength: () => "Works across a good breadth of repos.",
    conversation: () =>
      "Works in very few repos. Not always a problem — depends on the role — but worth checking if they're stuck on one area.",
  },
  weekend_pr_share: {
    actionable: true,
    strength: () => "Occasional weekend activity — flexible with timing.",
    conversation: () =>
      "High share of PRs landing on weekends. Can indicate engagement *or* over-extension — worth asking whether hours feel sustainable.",
  },
  offhours_pr_share: {
    actionable: true,
    strength: () => "Some off-hours activity — likely timezone or flexible schedule.",
    conversation: () =>
      "High share of PRs outside normal hours. Worth checking whether that's by choice or whether they feel pressure to be on after hours.",
  },
  pr_slope_per_week: {
    actionable: true,
    strength: () => "PR rate is accelerating — growing productivity.",
    conversation: () =>
      "PR rate is slowing. Could be blocked, context-switching, or finishing a large piece of work — worth a specific conversation about what's in flight.",
  },
  commits_180d_log: {
    actionable: true,
    strength: () => "High commit volume — actively shipping.",
    conversation: () =>
      "Commit volume is on the low side. Are they doing design, review, or mentoring work that isn't showing up in code metrics?",
  },
  commits_per_pr: {
    actionable: true,
    strength: () => "Clean commit-to-PR ratio — efficient iterations.",
    conversation: () =>
      "Lots of commits per PR — signals rework. Could be review churn, unclear requirements, or scope drift mid-PR.",
  },
  pr_gap_days: {
    actionable: true,
    strength: () => "Steady PR cadence — no long silent periods.",
    conversation: () =>
      "Meaningful share of PRs are stale (>3mo). Worth asking what's blocking them from landing or whether they should be closed.",
  },
  weekly_pr_cv: {
    actionable: true,
    strength: () => "Steady weekly output — predictable delivery.",
    conversation: () =>
      "Output is bursty week-to-week. Could be meeting-heavy weeks, context-switching, or cross-team dependencies — worth digging into.",
  },
  ramp_slope_first90: {
    actionable: true,
    strength: () => "Ramping up fast — productive early-tenure PR rate.",
    conversation: () =>
      "Ramp looks slow. How's onboarding going? Any environment or access blockers to landing meaningful PRs?",
  },
};

export function plainLabelFor(feature: string): string {
  if (PLAIN_LABEL[feature]) return PLAIN_LABEL[feature];
  if (feature.startsWith("pillar_")) return `Pillar: ${feature.slice(7).replace(/_/g, " ")}`;
  if (feature.startsWith("discipline_")) return `Discipline: ${feature.slice(11).replace(/_/g, " ")}`;
  if (feature.startsWith("level_track_")) return `Level track: ${feature.slice(12).replace(/_/g, " ")}`;
  return feature.replace(/_/g, " ");
}

// Mirrors feature_group() in ml-impact/train.py — the two must stay in sync.
// Used for building the features-per-group tooltip on the Section B chart
// (and anywhere else we need to derive the group label from a raw feature
// name on the client).
const PR_CADENCE_FEATURES = new Set([
  "pr_slope_per_week",
  "pr_gap_days",
  "weekly_pr_cv",
  "ramp_slope_first90",
]);
const PR_HABIT_FEATURES = new Set([
  "weekend_pr_share",
  "offhours_pr_share",
  "commits_per_pr",
  "distinct_repos_180d",
  "commits_180d_log",
  "pr_size_median",
  "pr_size_p90_log",
]);

export function groupForFeature(name: string): string {
  const lower = name.toLowerCase();
  if (lower.startsWith("slack_")) return "Slack engagement";
  if (lower.startsWith("ai_")) return "AI usage";
  if (PR_CADENCE_FEATURES.has(lower)) return "PR cadence";
  if (PR_HABIT_FEATURES.has(lower)) return "PR habits";
  if (
    lower.startsWith("latest_rating") ||
    lower.startsWith("avg_rating") ||
    lower === "rating_count"
  )
    return "Performance review";
  if (lower === "tenure_months") return "Tenure";
  if (
    lower === "level_num" ||
    lower.startsWith("level_track_") ||
    lower.startsWith("level_label_")
  )
    return "Level";
  if (lower.startsWith("discipline_")) return "Discipline";
  if (lower.startsWith("pillar_")) return "Pillar";
  return "Other";
}

function isActionable(feature: string): boolean {
  const entry = FEATURE_COPY[feature];
  if (!entry) return false;
  return entry.actionable;
}

function strengthText(contrib: ImpactShapContribution): string {
  const copy = FEATURE_COPY[contrib.feature];
  if (copy?.strength) return copy.strength(contrib.value);
  return `${plainLabelFor(contrib.feature)} — contributing positively to the prediction.`;
}

function conversationText(contrib: ImpactShapContribution): string | null {
  const copy = FEATURE_COPY[contrib.feature];
  if (!copy?.actionable || !copy.conversation) return null;
  return copy.conversation(contrib.value);
}

function signalFrom(contrib: ImpactShapContribution, detail: string): CoachingSignal {
  // `pct_multiplier` in the model JSON is always in "percent" units already
  // (e.g. 18.4 means +18.4%). train.py rounds SHAP log-contributions into
  // that unit before serialising, and the JS "+N other features" aggregate
  // in shap-waterfall.tsx uses the same convention. Pass through untouched.
  const pct = contrib.pct_multiplier;
  return {
    feature: contrib.feature,
    label: plainLabelFor(contrib.feature),
    group: contrib.group,
    shap: contrib.shap,
    pctMultiplier: pct,
    value: contrib.value,
    headline: plainLabelFor(contrib.feature),
    detail,
  };
}

/**
 * Turn an engineer's SHAP contributions into a manager-facing coaching card:
 * the top-N positive features framed as strengths, and the top-N *actionable*
 * negative features framed as conversations. Non-actionable features (tenure,
 * seniority, rating history) only appear as strengths — the UX intent is that
 * "worth a conversation" lists are things a manager can actually influence.
 */
export function buildCoachingCard(
  engineer: ImpactEngineerPrediction,
  maxEach = 3,
): CoachingCard {
  const predicted = engineer.predicted_insample;
  const actual = engineer.actual;
  const residualPct = predicted > 0 ? ((actual - predicted) / predicted) * 100 : 0;
  const residualDirection: "above" | "below" | "on" =
    residualPct > 5 ? "above" : residualPct < -5 ? "below" : "on";

  // Exclude the aggregate "+N other features" bucket from the coaching signal
  // — it doesn't point at a single feature a manager can act on.
  const contribs = engineer.shap_contributions.filter(
    (c) => !/_minor_features$/.test(c.feature),
  );

  const positive = contribs
    .filter((c) => c.shap > 0)
    .sort((a, b) => b.shap - a.shap)
    .slice(0, maxEach);

  const negativeActionable = contribs
    .filter((c) => c.shap < 0 && isActionable(c.feature))
    .sort((a, b) => a.shap - b.shap)
    .slice(0, maxEach);

  const strengths: CoachingSignal[] = positive.map((c) =>
    signalFrom(c, strengthText(c)),
  );
  const conversations: CoachingSignal[] = negativeActionable
    .map((c) => {
      const text = conversationText(c);
      return text ? signalFrom(c, text) : null;
    })
    .filter((x): x is CoachingSignal => x !== null);

  return { residualPct, residualDirection, strengths, conversations };
}
