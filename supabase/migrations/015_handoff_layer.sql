-- Handoff layer: events log, materialized ProjectStatus, sessions + issues

create table if not exists handoff_sessions (
  id text primary key,                       -- ULID
  number integer not null,
  project_id uuid not null references projects(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete cascade,
  actor_device_id text not null,
  actor_hostname text,
  state text not null default 'open' check (state in ('open','closed')),
  branch_at_start text,
  base_commit_sha text,
  base_commit_message text,
  started_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  closed_at timestamptz
);

create index handoff_sessions_project_idx on handoff_sessions(project_id, last_event_at desc);
create unique index handoff_sessions_number_uq on handoff_sessions(project_id, number);

create table if not exists handoff_events (
  event_id text primary key,                 -- ULID, idempotency key
  project_id uuid not null references projects(id) on delete cascade,
  session_id text not null references handoff_sessions(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete cascade,
  actor_kind text not null check (actor_kind in ('human','synapse-daemon')),
  actor_device_id text not null,
  attached_to jsonb,
  kind text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create index handoff_events_project_occurred_idx on handoff_events(project_id, occurred_at);
create index handoff_events_session_idx on handoff_events(session_id, occurred_at);

create table if not exists handoff_issues (
  id text primary key,
  number integer not null,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('decision','question')),
  state text not null default 'open' check (state in ('open','resolved','superseded')),
  title text not null,
  body text not null default '',
  author_user_id uuid not null references users(id) on delete cascade,
  resolved_by_user_id uuid references users(id) on delete set null,
  superseded_by_id text references handoff_issues(id) on delete set null,
  originated_in_session_id text references handoff_sessions(id) on delete set null,
  labels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index handoff_issues_number_uq on handoff_issues(project_id, number);

create table if not exists handoff_project_status (
  project_id uuid primary key references projects(id) on delete cascade,
  status jsonb not null,                     -- materialized ProjectStatus blob
  updated_at timestamptz not null default now()
);

-- RLS
alter table handoff_sessions enable row level security;
alter table handoff_events enable row level security;
alter table handoff_issues enable row level security;
alter table handoff_project_status enable row level security;

-- Mirror the access pattern used by project_members
create policy handoff_sessions_member_read on handoff_sessions for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_sessions.project_id and pm.user_id = auth.uid()));
create policy handoff_events_member_read on handoff_events for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_events.project_id and pm.user_id = auth.uid()));
create policy handoff_issues_member_read on handoff_issues for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_issues.project_id and pm.user_id = auth.uid()));
create policy handoff_project_status_member_read on handoff_project_status for select
  using (exists (select 1 from project_members pm where pm.project_id = handoff_project_status.project_id and pm.user_id = auth.uid()));

-- Writes only via service role (backend), not directly from clients
