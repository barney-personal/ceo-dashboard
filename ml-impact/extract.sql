-- Engineering Impact Feature Extraction
--
-- Produces one row per active engineer with:
--   - label: 360d impact score
--   - demographic features: level, discipline, pillar, squad, tenure, gender, location
--   - slack engagement: messages, reactions, active-day rate, desktop share, channel share
--   - ai usage: total tokens, total cost, days used, models used (in latest month)
--   - perf signal: latest & avg performance rating (if reviewed)
--
-- Run:
--   psql "$PROD_DB_URL" -A -F',' -P footer=off -f extract.sql > features.csv

\pset format csv
\pset tuples_only off

WITH active_engineers AS (
  SELECT
    lower(row->>'email') AS email,
    COALESCE(row->>'preferred_name', row->>'rp_full_name') AS name,
    row->>'hb_level' AS level_raw,
    row->>'rp_specialisation' AS specialisation,
    row->>'job_title' AS job_title,
    row->>'hb_squad' AS squad,
    row->>'rp_department_name' AS department,
    row->>'start_date' AS start_date,
    row->>'work_location' AS location,
    row->>'gender_identity' AS gender,
    row->>'seniority_name' AS seniority_name,
    (row->>'seniority_id')::int AS seniority_id
  FROM mode_report_data d
  JOIN mode_reports r ON r.id = d.report_id
  CROSS JOIN LATERAL jsonb_array_elements(d.data) AS row
  WHERE r.section = 'people' AND d.query_name = 'headcount'
    AND row->>'headcount_label' = 'FTE'
    AND (row->>'termination_date' IS NULL OR row->>'termination_date' = '')
    AND lower(COALESCE(row->>'hb_function', '')) LIKE '%engineer%'
    AND row->>'start_date' IS NOT NULL
    AND row->>'start_date' <= to_char(NOW(), 'YYYY-MM-DD')
),

-- Compute impact from github PRs over last 360 days
pr_window AS (
  SELECT MAX(merged_at) AS end_ts FROM github_prs
),
pr_agg AS (
  SELECT
    gem.employee_email AS email,
    COUNT(*)::int AS prs_360d,
    COALESCE(SUM(p.additions), 0)::bigint AS add_360d,
    COALESCE(SUM(p.deletions), 0)::bigint AS del_360d,
    COUNT(*) FILTER (WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '90 days')::int AS prs_90d,
    COUNT(*) FILTER (WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '30 days')::int AS prs_30d,
    -- PR size characteristics (robust stats over the full 360d window)
    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY p.additions + p.deletions), 0)::bigint AS pr_size_median,
    COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY p.additions + p.deletions), 0)::bigint AS pr_size_p90,
    -- Codebase breadth: distinct repos touched
    COUNT(DISTINCT p.repo) FILTER (WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days')::int AS distinct_repos_180d,
    -- Weekend PRs (Sat=6, Sun=0) and off-hours PRs (outside 08-18 UTC)
    (COUNT(*) FILTER (
      WHERE EXTRACT(DOW FROM p.merged_at) IN (0, 6)
        AND p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days'
    ))::numeric / NULLIF((COUNT(*) FILTER (
      WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days'
    ))::numeric, 0) AS weekend_pr_share,
    (COUNT(*) FILTER (
      WHERE (EXTRACT(HOUR FROM p.merged_at) < 8 OR EXTRACT(HOUR FROM p.merged_at) >= 18)
        AND p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days'
    ))::numeric / NULLIF((COUNT(*) FILTER (
      WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days'
    ))::numeric, 0) AS offhours_pr_share
  FROM github_prs p
  JOIN github_employee_map gem ON gem.github_login = p.author_login AND gem.is_bot = false
  WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '360 days'
  GROUP BY gem.employee_email
),

-- Activity trend: weekly PR count slope via linreg over last 90 days.
-- Positive slope = heating up; negative = cooling down.
pr_weekly AS (
  SELECT
    gem.employee_email AS email,
    date_trunc('week', p.merged_at) AS wk,
    COUNT(*)::numeric AS n
  FROM github_prs p
  JOIN github_employee_map gem ON gem.github_login = p.author_login AND gem.is_bot = false
  WHERE p.merged_at >= (SELECT end_ts FROM pr_window) - INTERVAL '90 days'
  GROUP BY 1, 2
),
pr_slope AS (
  SELECT
    email,
    regr_slope(n, EXTRACT(EPOCH FROM wk) / 604800)::numeric AS slope_prs_per_week,
    COUNT(*)::int AS weeks_observed
  FROM pr_weekly
  GROUP BY email
  HAVING COUNT(*) >= 3
),

-- Commit cadence: commits per PR (rework proxy) + weekly commits variance
commit_agg AS (
  SELECT
    gem.employee_email AS email,
    COUNT(*)::int AS commits_180d
  FROM github_commits c
  JOIN github_employee_map gem ON gem.github_login = c.author_login AND gem.is_bot = false
  WHERE c.committed_at >= (SELECT end_ts FROM pr_window) - INTERVAL '180 days'
  GROUP BY gem.employee_email
),

-- Slack engagement: join via slack_employee_map + latest snapshot
slack_latest_window AS (
  SELECT MAX(window_start) AS ws FROM slack_member_snapshots
),
-- Aggregate Slack rows per employee. Some engineers have more than one Slack
-- user mapped to their email (bot accounts, old handles, etc). Without this
-- SUM, the final LEFT JOIN would duplicate the engineer row and inflate both
-- the training set and the reported group stats.
slack_agg AS (
  SELECT
    email,
    SUM(days_active) AS days_active,
    SUM(days_active_desktop) AS days_active_desktop,
    SUM(messages_posted) AS messages_posted,
    SUM(messages_posted_in_channels) AS messages_posted_in_channels,
    SUM(reactions_added) AS reactions_added,
    AVG(window_days) AS window_days,
    MIN(days_since_active) AS days_since_active
  FROM (
    SELECT
      lower(sem.employee_email) AS email,
      sms.days_active,
      sms.days_active_desktop,
      sms.messages_posted,
      sms.messages_posted_in_channels,
      sms.reactions_added,
      EXTRACT(EPOCH FROM (sms.window_end - sms.window_start)) / 86400 AS window_days,
      EXTRACT(EPOCH FROM (sms.window_end - sms.last_active_at)) / 86400 AS days_since_active
    FROM slack_member_snapshots sms
    JOIN slack_employee_map sem ON sem.slack_user_id = sms.slack_user_id
    WHERE sms.window_start = (SELECT ws FROM slack_latest_window)
      AND sem.employee_email IS NOT NULL
  ) per_user
  GROUP BY email
),

-- AI usage per user: aggregated across all months in Query 3
ai_agg AS (
  SELECT
    lower(row->>'user_email') AS email,
    SUM((row->>'total_tokens')::bigint) AS total_tokens,
    SUM((row->>'total_cost')::numeric) AS total_cost,
    SUM((row->>'n_days')::int) AS ai_n_days,
    SUM((row->>'n_rows')::int) AS ai_n_rows,
    MAX((row->>'n_models_used')::int) AS max_models_used
  FROM mode_report_data d
  JOIN mode_reports r ON r.id = d.report_id
  CROSS JOIN LATERAL jsonb_array_elements(d.data) AS row
  WHERE r.section = 'people' AND d.query_name = 'Query 3'
    AND row->>'user_email' IS NOT NULL
  GROUP BY 1
),

-- Performance ratings: latest + avg per employee
perf_agg AS (
  SELECT
    lower(row->>'employee_email') AS email,
    AVG((row->>'performance_rating')::numeric) AS avg_rating,
    (ARRAY_AGG((row->>'performance_rating')::numeric ORDER BY row->>'review_cycle_name' DESC))[1] AS latest_rating,
    COUNT(*)::int AS rating_count
  FROM mode_report_data d
  JOIN mode_reports r ON r.id = d.report_id
  CROSS JOIN LATERAL jsonb_array_elements(d.data) AS row
  WHERE r.section = 'people' AND d.query_name = 'manager_distributions_individual_ratings'
    AND row->>'performance_rating' IS NOT NULL
    AND row->>'performance_rating' != ''
  GROUP BY 1
)

SELECT
  ae.email,
  ae.name,
  ae.level_raw,
  ae.specialisation,
  ae.job_title,
  ae.squad,
  ae.department,
  ae.start_date,
  ae.location,
  ae.gender,
  ae.seniority_name,
  ae.seniority_id,
  EXTRACT(DAY FROM NOW() - ae.start_date::timestamp)::int AS tenure_days,
  COALESCE(pa.prs_360d, 0) AS prs_360d,
  COALESCE(pa.prs_90d, 0) AS prs_90d,
  COALESCE(pa.prs_30d, 0) AS prs_30d,
  COALESCE(pa.add_360d, 0) AS add_360d,
  COALESCE(pa.del_360d, 0) AS del_360d,
  COALESCE(pa.pr_size_median, 0) AS pr_size_median,
  COALESCE(pa.pr_size_p90, 0) AS pr_size_p90,
  COALESCE(pa.distinct_repos_180d, 0) AS distinct_repos_180d,
  COALESCE(pa.weekend_pr_share, 0) AS weekend_pr_share,
  COALESCE(pa.offhours_pr_share, 0) AS offhours_pr_share,
  COALESCE(ps.slope_prs_per_week, 0) AS pr_slope_per_week,
  COALESCE(ps.weeks_observed, 0) AS pr_slope_weeks,
  COALESCE(ca.commits_180d, 0) AS commits_180d,
  CASE WHEN COALESCE(pa.prs_360d, 0) > 0
       THEN COALESCE(ca.commits_180d, 0)::numeric / pa.prs_360d
       ELSE 0 END AS commits_per_pr,
  COALESCE(sa.days_active, 0) AS slack_days_active,
  COALESCE(sa.days_active_desktop, 0) AS slack_days_desktop,
  COALESCE(sa.messages_posted, 0) AS slack_messages,
  COALESCE(sa.messages_posted_in_channels, 0) AS slack_msgs_channels,
  COALESCE(sa.reactions_added, 0) AS slack_reactions,
  sa.window_days AS slack_window_days,
  sa.days_since_active AS slack_days_since_active,
  COALESCE(ai.total_tokens, 0) AS ai_tokens,
  COALESCE(ai.total_cost, 0) AS ai_cost,
  COALESCE(ai.ai_n_days, 0) AS ai_n_days,
  COALESCE(ai.max_models_used, 0) AS ai_max_models,
  pr.avg_rating,
  pr.latest_rating,
  COALESCE(pr.rating_count, 0) AS rating_count
FROM active_engineers ae
LEFT JOIN pr_agg pa ON pa.email = ae.email
LEFT JOIN pr_slope ps ON ps.email = ae.email
LEFT JOIN commit_agg ca ON ca.email = ae.email
LEFT JOIN slack_agg sa ON sa.email = ae.email
LEFT JOIN ai_agg ai ON ai.email = ae.email
LEFT JOIN perf_agg pr ON pr.email = ae.email
ORDER BY ae.email;
