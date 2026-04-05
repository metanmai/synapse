# Analytics Dashboard — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Approach:** Self-hosted Metabase on Railway, connected to Supabase Postgres via read-only role

## Goal

Founder-facing analytics dashboard covering growth, engagement, feature adoption, revenue, and retention. Near-real-time (fresh on page load). No user-facing analytics — admin only.

## Infrastructure

- **Metabase** (open source) self-hosted on **Railway** as a Docker container (`metabase/metabase`)
- Connects to **Supabase Postgres** via direct connection string (not pooler)
- Uses a dedicated **read-only Postgres role** (`metabase_readonly`) with SELECT-only grants
- Metabase's internal config stored in H2 database on Railway's persistent volume
- Estimated cost: ~$5/mo (Railway Hobby plan)
- Access: Metabase's built-in email/password auth, single admin account

## Database Setup

### Read-Only Role

New Supabase migration creates a read-only role for Metabase:

```sql
CREATE ROLE metabase_readonly WITH LOGIN PASSWORD '<secure-password>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO metabase_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO metabase_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO metabase_readonly;
```

### SQL Views (6)

Standard Postgres views (not materialized). Always fresh on query. Can be materialized later if performance requires it.

#### 1. `analytics_signups_daily`

**Source:** `users`

Daily signup count with running cumulative total.

```sql
CREATE VIEW analytics_signups_daily AS
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS signups,
  SUM(COUNT(*)) OVER (ORDER BY DATE(created_at)) AS cumulative_total
FROM users
GROUP BY DATE(created_at)
ORDER BY day;
```

#### 2. `analytics_tier_breakdown`

**Source:** `users` + `subscriptions`

Current count of free vs plus users and conversion rate.

```sql
CREATE VIEW analytics_tier_breakdown AS
WITH classified AS (
  SELECT
    u.id,
    CASE WHEN s.status IN ('active', 'past_due') THEN 'plus' ELSE 'free' END AS tier
  FROM users u
  LEFT JOIN subscriptions s ON s.user_id = u.id
)
SELECT
  tier,
  COUNT(*) AS user_count,
  ROUND(100.0 * SUM(CASE WHEN tier = 'plus' THEN 1 ELSE 0 END) OVER () / NULLIF(COUNT(*) OVER (), 0), 1) AS conversion_rate_pct
FROM classified
GROUP BY tier;
```

#### 3. `analytics_dau`

**Source:** `activity_log`

Distinct active users per day, plus 7-day and 30-day rolling unique counts (WAU/MAU).

```sql
CREATE VIEW analytics_dau AS
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
  (SELECT COUNT(DISTINCT user_id) FROM activity_log
   WHERE user_id IS NOT NULL AND DATE(created_at) BETWEEN d.day - 6 AND d.day) AS wau,
  (SELECT COUNT(DISTINCT user_id) FROM activity_log
   WHERE user_id IS NOT NULL AND DATE(created_at) BETWEEN d.day - 29 AND d.day) AS mau
FROM daily d
ORDER BY d.day;
```

#### 4. `analytics_feature_usage`

**Source:** `activity_log`

Action counts per day, grouped by action type and source (mcp/human).

```sql
CREATE VIEW analytics_feature_usage AS
SELECT
  DATE(created_at) AS day,
  action,
  source,
  COUNT(*) AS event_count
FROM activity_log
GROUP BY DATE(created_at), action, source
ORDER BY day, event_count DESC;
```

#### 5. `analytics_top_users`

**Source:** `activity_log` + `users`

Most active users by action count in the last 30 days.

```sql
CREATE VIEW analytics_top_users AS
SELECT
  u.id,
  u.email,
  COALESCE(
    CASE WHEN s.status IN ('active', 'past_due') THEN 'plus' ELSE 'free' END,
    'free'
  ) AS tier,
  COUNT(a.id) AS action_count,
  COUNT(DISTINCT DATE(a.created_at)) AS active_days,
  MAX(a.created_at) AS last_active
FROM users u
JOIN activity_log a ON a.user_id = u.id
LEFT JOIN subscriptions s ON s.user_id = u.id
WHERE a.created_at >= NOW() - INTERVAL '30 days'
GROUP BY u.id, u.email, tier
ORDER BY action_count DESC;
```

#### 6. `analytics_revenue`

**Source:** `subscriptions`

Active subscription count, MRR estimate, and monthly churn.

```sql
CREATE VIEW analytics_revenue AS
SELECT
  COUNT(*) FILTER (WHERE status IN ('active', 'past_due')) AS active_subscriptions,
  COUNT(*) FILTER (WHERE status = 'canceled') AS total_churned,
  COUNT(*) FILTER (WHERE status = 'canceled' AND updated_at >= NOW() - INTERVAL '30 days') AS churned_last_30d,
  COUNT(*) FILTER (WHERE status IN ('active', 'past_due') AND NOT cancel_at_period_end) AS non_churning_subscriptions
FROM subscriptions;
```

MRR is computed in Metabase as `active_subscriptions * price_per_month` (price configured as a Metabase variable since it's a business constant, not DB data).

## Metabase Dashboards

Single dashboard: **Synapse Overview**

### Growth Section
| Card | Type | Source |
|------|------|--------|
| Total users | Number | `SELECT cumulative_total FROM analytics_signups_daily ORDER BY day DESC LIMIT 1` |
| Signups over time | Line chart | `analytics_signups_daily` (day vs signups) |
| Free vs Plus | Pie chart | `analytics_tier_breakdown` (tier vs user_count) |
| Conversion rate | Number | `analytics_tier_breakdown` (conversion_rate_pct) |

### Engagement Section
| Card | Type | Source |
|------|------|--------|
| DAU / WAU / MAU | Line chart (3 series) | `analytics_dau` |
| DAU/MAU ratio | Number | Latest row from `analytics_dau`, compute `dau / mau` |
| Actions per day | Line chart | `analytics_feature_usage` aggregated by day |
| Top 10 users | Table | `analytics_top_users LIMIT 10` |

### Feature Adoption Section
| Card | Type | Source |
|------|------|--------|
| Feature usage by day | Stacked bar | `analytics_feature_usage` (action × day) |
| MCP vs Web | Pie chart | `analytics_feature_usage` grouped by source |
| Most used features | Horizontal bar | `analytics_feature_usage` last 30 days, grouped by action |

### Revenue Section
| Card | Type | Source |
|------|------|--------|
| Active subscriptions | Number | `analytics_revenue.active_subscriptions` |
| MRR | Number | `active_subscriptions * $price_per_month` (Metabase variable) |
| Churned last 30d | Number | `analytics_revenue.churned_last_30d` |
| Churn over time | Line chart | Direct query: cancellations per month from `subscriptions` |

### Retention Section
| Card | Type | Source |
|------|------|--------|
| Cohort retention | Table/heatmap | Direct SQL: signup-week cohort, % active in subsequent weeks |

## Deployment Steps

1. **Create Supabase migration** — read-only role + 6 analytics views
2. **Deploy Metabase on Railway** — `metabase/metabase` Docker image, persistent volume, `MB_JETTY_PORT=3000`
3. **Connect Metabase to Supabase** — Admin → Add Database → PostgreSQL, use direct connection string with `metabase_readonly` credentials
4. **Build dashboard** — create the 5 sections with saved questions mapped to the views
5. **Set up access** — create admin account, optionally restrict URL via Cloudflare Access

## Out of Scope

- User-facing analytics (per-project stats for users)
- Real-time streaming / WebSocket updates
- Materialized views or caching (can add later if needed)
- Custom event tracking beyond what `activity_log` already captures
- Embedding Metabase charts in the Synapse frontend
