# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a self-hosted Metabase instance on Railway connected to Supabase Postgres via a read-only role, with 6 SQL views powering a product analytics dashboard.

**Architecture:** Supabase migration creates a `metabase_readonly` Postgres role and 6 analytics views over existing tables (`users`, `activity_log`, `subscriptions`). Metabase connects as that role and queries the views. No application code changes.

**Tech Stack:** Supabase Postgres (SQL migration), Metabase (Docker on Railway), Railway CLI

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/migrations/009_analytics_views.sql` | Create | Read-only role + 6 analytics views |

That's it — this is a single migration file plus infrastructure deployment. No application code changes.

---

### Task 1: Write the Analytics Migration

**Files:**
- Create: `supabase/migrations/009_analytics_views.sql`

- [ ] **Step 1: Create the migration file with the read-only role**

```sql
-- 009_analytics_views.sql
-- Read-only role for Metabase analytics + 6 analytics views

-- 1. Read-only role for Metabase
-- NOTE: On Supabase, CREATE ROLE may require running via the SQL Editor
-- in the Supabase Dashboard (not via migrations) since migrations run
-- as the postgres user but role creation may be restricted.
-- If this fails in a migration, run it manually in the SQL Editor.
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
```

- [ ] **Step 2: Add the signups daily view**

Append to the same file:

```sql
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
```

- [ ] **Step 3: Add the tier breakdown view**

Append to the same file:

```sql
-- 3. analytics_tier_breakdown
-- Current free vs plus user counts and conversion rate
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
```

- [ ] **Step 4: Add the DAU/WAU/MAU view**

Append to the same file:

```sql
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
```

- [ ] **Step 5: Add the feature usage view**

Append to the same file:

```sql
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
```

- [ ] **Step 6: Add the top users view**

Append to the same file:

```sql
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
```

- [ ] **Step 7: Add the revenue view**

Append to the same file:

```sql
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
```

- [ ] **Step 8: Grant read access on the new views**

Append to the same file:

```sql
-- 8. Grant read access on analytics views to metabase_readonly
GRANT SELECT ON analytics_signups_daily TO metabase_readonly;
GRANT SELECT ON analytics_tier_breakdown TO metabase_readonly;
GRANT SELECT ON analytics_dau TO metabase_readonly;
GRANT SELECT ON analytics_feature_usage TO metabase_readonly;
GRANT SELECT ON analytics_top_users TO metabase_readonly;
GRANT SELECT ON analytics_revenue TO metabase_readonly;
```

- [ ] **Step 9: Commit the migration**

```bash
git add supabase/migrations/009_analytics_views.sql
git commit -m "feat(db): add analytics views and read-only role for Metabase"
```

---

### Task 2: Run the Migration on Supabase

This task is done manually in the Supabase Dashboard SQL Editor (not via CLI) since role creation may require elevated privileges.

- [ ] **Step 1: Open the Supabase SQL Editor**

Go to your Supabase project dashboard → SQL Editor.

- [ ] **Step 2: Set the read-only role password**

Before running, replace `CHANGE_ME_BEFORE_RUNNING` in the migration with a strong generated password. Save this password — you'll need it for Metabase configuration.

- [ ] **Step 3: Run the migration**

Paste the full contents of `supabase/migrations/009_analytics_views.sql` into the SQL Editor and execute. If `CREATE ROLE` fails due to permissions, run it as two separate statements:
1. First, run just the `DO $$ ... $$;` block and the `GRANT` statements
2. If role creation is blocked, go to Database → Roles in the Supabase dashboard and create the role there manually, then run the `GRANT` statements

- [ ] **Step 4: Verify the views exist**

Run in SQL Editor:

```sql
SELECT table_name FROM information_schema.views
WHERE table_schema = 'public' AND table_name LIKE 'analytics_%'
ORDER BY table_name;
```

Expected output: 6 rows (`analytics_dau`, `analytics_feature_usage`, `analytics_revenue`, `analytics_signups_daily`, `analytics_tier_breakdown`, `analytics_top_users`).

- [ ] **Step 5: Verify the views return data**

```sql
SELECT * FROM analytics_signups_daily LIMIT 5;
SELECT * FROM analytics_tier_breakdown;
SELECT * FROM analytics_dau LIMIT 5;
SELECT * FROM analytics_feature_usage LIMIT 5;
SELECT * FROM analytics_top_users LIMIT 5;
SELECT * FROM analytics_revenue;
```

All should return rows (assuming there are users and activity in the database).

---

### Task 3: Deploy Metabase on Railway

- [ ] **Step 1: Create a new Railway project**

Go to [railway.app](https://railway.app), create a new project. Name it `synapse-analytics`.

- [ ] **Step 2: Deploy the Metabase Docker image**

Add a new service → Docker Image → `metabase/metabase:latest`

Set these environment variables:

| Variable | Value |
|----------|-------|
| `MB_JETTY_PORT` | `3000` |
| `PORT` | `3000` |
| `MB_DB_TYPE` | `h2` |

Railway will auto-assign a public URL. Note it down.

- [ ] **Step 3: Wait for Metabase to boot**

First boot takes 2-3 minutes as Metabase initializes its internal database. Watch the Railway logs until you see `Metabase Initialization COMPLETE`.

- [ ] **Step 4: Complete Metabase setup wizard**

Open the Railway URL in your browser. The setup wizard will ask:
1. Language: English
2. Admin account: your email + a strong password
3. Skip the "Add your data" step for now (we'll do it manually)

- [ ] **Step 5: Connect Supabase as a database**

Go to Metabase Admin → Databases → Add Database:

| Field | Value |
|-------|-------|
| Database type | PostgreSQL |
| Display name | Synapse Production |
| Host | Your Supabase DB host (from Supabase Dashboard → Settings → Database → Connection string → Host) |
| Port | `5432` (or `6543` for connection pooler — use direct `5432`) |
| Database name | `postgres` |
| Username | `metabase_readonly` |
| Password | The password you set in Task 2 Step 2 |
| SSL | Require |

Click "Save". Metabase will sync the schema (takes ~30 seconds).

- [ ] **Step 6: Verify the analytics views appear**

Go to New → Question → Simple Question → Synapse Production. You should see the 6 `analytics_*` views listed alongside the regular tables.

Click on `analytics_signups_daily` — it should show data.

---

### Task 4: Build the Dashboard in Metabase

- [ ] **Step 1: Create the dashboard**

Go to New → Dashboard → name it "Synapse Overview". Save it in the default collection.

- [ ] **Step 2: Add Growth cards**

Add these saved questions to the dashboard:

**Total Users (Number card):**
```sql
SELECT cumulative_total FROM analytics_signups_daily ORDER BY day DESC LIMIT 1
```
Visualization: Number

**Signups Over Time (Line chart):**
```sql
SELECT day, signups FROM analytics_signups_daily ORDER BY day
```
Visualization: Line, X=day, Y=signups

**Free vs Plus (Pie chart):**
```sql
SELECT tier, user_count FROM analytics_tier_breakdown
```
Visualization: Pie, Dimension=tier, Measure=user_count

**Conversion Rate (Number card):**
```sql
SELECT
  ROUND(100.0 * SUM(CASE WHEN tier = 'plus' THEN user_count ELSE 0 END) / NULLIF(SUM(user_count), 0), 1) AS conversion_rate_pct
FROM analytics_tier_breakdown
```
Visualization: Number, suffix="%"

- [ ] **Step 3: Add Engagement cards**

**DAU / WAU / MAU (Line chart, 3 series):**
```sql
SELECT day, dau, wau, mau FROM analytics_dau WHERE day >= CURRENT_DATE - 90 ORDER BY day
```
Visualization: Line, X=day, Y=dau+wau+mau

**DAU/MAU Ratio (Number card):**
```sql
SELECT ROUND(dau::numeric / NULLIF(mau, 0), 2) AS stickiness
FROM analytics_dau ORDER BY day DESC LIMIT 1
```
Visualization: Number

**Actions Per Day (Line chart):**
```sql
SELECT day, SUM(event_count) AS total_actions
FROM analytics_feature_usage
WHERE day >= CURRENT_DATE - 90
GROUP BY day ORDER BY day
```
Visualization: Line

**Top 10 Users (Table):**
```sql
SELECT email, tier, action_count, active_days, last_active
FROM analytics_top_users LIMIT 10
```
Visualization: Table

- [ ] **Step 4: Add Feature Adoption cards**

**Feature Usage by Day (Stacked bar):**
```sql
SELECT day, action, SUM(event_count) AS count
FROM analytics_feature_usage
WHERE day >= CURRENT_DATE - 30
GROUP BY day, action ORDER BY day
```
Visualization: Bar (stacked), X=day, Y=count, Series=action

**MCP vs Web (Pie chart):**
```sql
SELECT source, SUM(event_count) AS total
FROM analytics_feature_usage
WHERE day >= CURRENT_DATE - 30
GROUP BY source
```
Visualization: Pie

**Most Used Features (Horizontal bar):**
```sql
SELECT action, SUM(event_count) AS total
FROM analytics_feature_usage
WHERE day >= CURRENT_DATE - 30
GROUP BY action ORDER BY total DESC
```
Visualization: Row (horizontal bar)

- [ ] **Step 5: Add Revenue cards**

**Active Subscriptions (Number):**
```sql
SELECT active_subscriptions FROM analytics_revenue
```

**MRR (Number):**
```sql
SELECT active_subscriptions * 10 AS mrr FROM analytics_revenue
```
Note: Replace `10` with the actual Plus price per month. Metabase supports variables — you can make this a dashboard parameter if the price changes.

**Churned Last 30d (Number):**
```sql
SELECT churned_last_30d FROM analytics_revenue
```

**Churn Over Time (Line):**
```sql
SELECT
  DATE_TRUNC('month', updated_at) AS month,
  COUNT(*) AS cancellations
FROM subscriptions
WHERE status = 'canceled'
GROUP BY month ORDER BY month
```

- [ ] **Step 6: Add Retention cohort**

**Cohort Retention (Table):**
```sql
WITH cohorts AS (
  SELECT
    id AS user_id,
    DATE_TRUNC('week', created_at)::date AS signup_week
  FROM users
),
activity AS (
  SELECT
    user_id,
    DATE_TRUNC('week', created_at)::date AS activity_week
  FROM activity_log
  WHERE user_id IS NOT NULL
)
SELECT
  c.signup_week,
  COUNT(DISTINCT c.user_id) AS cohort_size,
  COUNT(DISTINCT CASE WHEN a.activity_week = c.signup_week THEN a.user_id END) AS week_0,
  COUNT(DISTINCT CASE WHEN a.activity_week = c.signup_week + 7 THEN a.user_id END) AS week_1,
  COUNT(DISTINCT CASE WHEN a.activity_week = c.signup_week + 14 THEN a.user_id END) AS week_2,
  COUNT(DISTINCT CASE WHEN a.activity_week = c.signup_week + 21 THEN a.user_id END) AS week_3,
  COUNT(DISTINCT CASE WHEN a.activity_week = c.signup_week + 28 THEN a.user_id END) AS week_4
FROM cohorts c
LEFT JOIN activity a ON a.user_id = c.user_id
GROUP BY c.signup_week
ORDER BY c.signup_week DESC;
```
Visualization: Table

- [ ] **Step 7: Arrange the dashboard layout**

Organize cards into sections by dragging them in the dashboard editor:
1. **Growth** — top row (total users, signups line, pie, conversion)
2. **Engagement** — second row (DAU/WAU/MAU line, stickiness, actions/day, top users)
3. **Feature Adoption** — third row (stacked bar, MCP vs Web pie, most used bar)
4. **Revenue** — fourth row (active subs, churned, churn line)
5. **Retention** — bottom (cohort table, full width)

Save the dashboard.

- [ ] **Step 8: Optional — add a date filter**

Add a dashboard filter (Filter → Date → "Date Range") and wire it to the `day` column on the relevant cards. This lets you scope all charts to a custom time range.

---

### Task 5: Secure and Document

- [ ] **Step 1: Restrict Metabase access (optional)**

If you want extra protection beyond Metabase's built-in auth:
- Railway → Service Settings → enable "Private Networking" if on a paid plan
- Or add Cloudflare Access in front of the Railway URL

- [ ] **Step 2: Save Metabase credentials**

Store the following securely (e.g., in a password manager):
- Railway project URL
- Metabase admin email/password
- `metabase_readonly` Postgres password

- [ ] **Step 3: Commit the migration and push**

```bash
git add supabase/migrations/009_analytics_views.sql
git commit -m "feat(db): add analytics views and read-only role for Metabase"
git push
```

(If already committed in Task 1, this is a no-op.)
