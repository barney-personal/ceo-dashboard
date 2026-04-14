import type { ModeRowAggregator } from "./mode-config";

type WeeklyRetentionRow = {
  cohort_week: string;
  relative_moving_week: number;
  active_users_weekly: number;
};

/**
 * Normalise Mode CSV timestamps like "2025-04-14 00:00:00.000" into the
 * timezone-stable ISO format ("2025-04-14T00:00:00.000Z") that the JSON
 * results endpoint used to emit. Without this, downstream `new Date(...)`
 * parsing would interpret the CSV string as local time and the WAU triangle
 * would shift cohorts by the server's UTC offset.
 */
function normaliseCsvTimestamp(value: string): string {
  if (!value) return value;
  // Mode CSV format: "YYYY-MM-DD HH:mm:ss.sss" — replace space with 'T' and
  // append 'Z' if no timezone marker is present.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    const iso = value.replace(" ", "T");
    return /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  }
  return value;
}

/**
 * Streaming aggregator for the App Retention Weekly query.
 *
 * The raw Mode result is ~230k rows broken down across segment dimensions
 * (d30_subscriber, age, user_segment, core_intent). For the WAU retention
 * triangle we only need the rollup `(cohort_week, relative_moving_week,
 * active_users_weekly)` per cohort-period, which is ~1.4k rows.
 *
 * Aggregating during streaming keeps peak heap bounded even though the raw
 * CSV is hundreds of MB.
 */
export const weeklyRetentionAggregator: ModeRowAggregator<
  Map<string, WeeklyRetentionRow>
> = {
  initial: () => new Map(),
  reduce: (state, row) => {
    const cohortWeek = normaliseCsvTimestamp(row.cohort_week);
    const weekIdx = Number(row.relative_moving_week);
    const users = Number(row.active_users_weekly);
    if (!cohortWeek || !Number.isFinite(weekIdx) || !Number.isFinite(users)) {
      return state;
    }

    const key = `${cohortWeek}|${weekIdx}`;
    const existing = state.get(key);
    if (existing) {
      existing.active_users_weekly += users;
    } else {
      state.set(key, {
        cohort_week: cohortWeek,
        relative_moving_week: weekIdx,
        active_users_weekly: users,
      });
    }
    return state;
  },
  finalize: (state) => Array.from(state.values()),
  columns: [
    { name: "cohort_week", type: "string" },
    { name: "relative_moving_week", type: "number" },
    { name: "active_users_weekly", type: "number" },
  ],
};
