-- 006_insights.sql
-- Key Insights: standalone memory/learnings system for all users

create table insights (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references users(id),
  type            text not null check (type in ('decision', 'learning', 'preference', 'architecture', 'action_item')),
  summary         text not null,
  detail          text,
  source          jsonb,
  search_vector   tsvector generated always as (
    setweight(to_tsvector('english', coalesce(summary, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(detail, '')), 'B')
  ) stored,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_insights_project on insights(project_id);
create index idx_insights_user on insights(user_id);
create index idx_insights_type on insights(project_id, type);
create index idx_insights_search on insights using gin(search_vector);

-- RLS (enforced at app level, but enable for safety)
alter table insights enable row level security;
