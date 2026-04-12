-- 009_analytics_views.sql
-- Read-only role for Metabase analytics + 6 analytics views

-- 1. Read-only role for Metabase
-- NOTE: On Supabase, CREATE ROLE may require running via the SQL Editor
-- in the Supabase Dashboard since migrations run as the postgres user
-- but role creation may be restricted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'metabase_readonly') THEN
    CREATE ROLE metabase_readonly WITH LOGIN PASSWORD 'CHANGE_ME_BEFORE_RUNNING' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO metabase_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO metabase_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO metabase_readonly;

-- 2. analytics_signups_daily
-- Daily signup count with running cumulative total
CREATE OR REPLACE VIEW analytics_signups_daily AS
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS signups,
  SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) AS cumulative_total
FROM users
GROUP BY DATE(created_at)
ORDER BY day;

-- 3. analytics_tier_breakdown
-- Current free vs plus user counts
CREATE OR REPLACE VIEW analytics_tier_breakdown AS
WITH classified AS (
  SELECT
    u.id,
    CASE
      WHEN s.status IN ('active', 'past_due') THEN 'plus'
      ELSE 'free'
    END AS tier
  FROM users u
  LEFT JOIN subscriptions s ON s.user_id = u.id
)
SELECT
  tier,
  COUNT(*) AS user_count
FROM classified
GROUP BY tier;

-- 4. analytics_dau
-- Daily active users with 7-day and 30-day rolling unique counts
CREATE OR REPLACE VIEW analytics_dau AS
WITH daily AS (
  SELECT
    DATE(created_at) AS day,
    COUNT(DISTINCT user_id) AS dau
  FROM activity_log
  WHERE user_id IS NOT NULL
  GROUP BY DATE(created_at)
)
SELECT
  d.day,
  d.dau,
  (SELECT COUNT(DISTINCT user_id)
   FROM activity_log
   WHERE user_id IS NOT NULL
     AND DATE(created_at) BETWEEN d.day - 6 AND d.day) AS wau,
  (SELECT COUNT(DISTINCT user_id)
   FROM activity_log
   WHERE user_id IS NOT NULL
     AND DATE(created_at) BETWEEN d.day - 29 AND d.day) AS mau
FROM daily d
ORDER BY d.day;

-- 5. analytics_feature_usage
-- Action counts per day, grouped by action type and source
CREATE OR REPLACE VIEW analytics_feature_usage AS
SELECT
  DATE(created_at) AS day,
  action,
  source,
  COUNT(*) AS event_count
FROM activity_log
GROUP BY DATE(created_at), action, source
ORDER BY day DESC, event_count DESC;

-- 6. analytics_top_users
-- Most active users by action count in the last 30 days
CREATE OR REPLACE VIEW analytics_top_users AS
SELECT
  u.id,
  u.email,
  CASE
    WHEN s.status IN ('active', 'past_due') THEN 'plus'
    ELSE 'free'
  END AS tier,
  COUNT(a.id) AS action_count,
  COUNT(DISTINCT DATE(a.created_at)) AS active_days,
  MAX(a.created_at) AS last_active
FROM users u
JOIN activity_log a ON a.user_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id
WHERE a.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.email, s.status
ORDER BY action_count DESC;

-- 7. analytics_revenue
-- Active subscription count and churn metrics
CREATE OR REPLACE VIEW analytics_revenue AS
SELECT
  COUNT(*) FILTER (WHERE status IN ('active', 'past_due')) AS active_subscriptions,
  COUNT(*) FILTER (WHERE status = 'canceled') AS total_churned,
  COUNT(*) FILTER (WHERE status = 'canceled'
    AND updated_at >= NOW() - INTERVAL '30 days') AS churned_last_30d,
  COUNT(*) FILTER (WHERE status IN ('active', 'past_due')
    AND NOT cancel_at_period_end) AS non_churning_subscriptions
FROM subscriptions;

-- 8. Grant read access on analytics views to metabase_readonly
GRANT SELECT ON analytics_signups_daily TO metabase_readonly;
GRANT SELECT ON analytics_tier_breakdown TO metabase_readonly;
GRANT SELECT ON analytics_dau TO metabase_readonly;
GRANT SELECT ON analytics_feature_usage TO metabase_readonly;
GRANT SELECT ON analytics_top_users TO metabase_readonly;
GRANT SELECT ON analytics_revenue TO metabase_readonly;
