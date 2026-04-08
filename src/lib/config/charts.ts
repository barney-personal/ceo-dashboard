export const CHART_HISTORY_START_DATE = "2023-01-01";

// Weekly chart series intentionally start on the first complete Monday bucket.
export const CHART_HISTORY_FIRST_FULL_WEEK = "2023-01-02";

export const CHART_HISTORY_START_TS = new Date(
  CHART_HISTORY_START_DATE,
).getTime();
