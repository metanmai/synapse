-- Enable required extensions
create extension if not exists "pgcrypto";

-- Users table
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  api_key_hash text unique not null,
  google_oauth_tokens jsonb,
  created_at timestamptz default now() not null
);

-- Projects table
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users(id) on delete cascade,
  google_drive_folder_id text,
  created_at timestamptz default now() not null
);

-- Project members (join table)
create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  joined_at timestamptz default now() not null,
  primary key (project_id, user_id)
);

-- Context entries (virtual filesystem)
create table entries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  content text not null,
  content_type text not null default 'markdown' check (content_type in ('markdown', 'json')),
  author_id uuid references users(id) on delete set null,
  source text not null default 'claude' check (source in ('claude', 'chatgpt', 'human', 'google_docs')),
  tags text[] default '{}',
  google_doc_id text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique (project_id, path)
);

-- Full-text search index on entries
alter table entries add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored;

create index entries_search_idx on entries using gin(search_vector);
create index entries_project_path_idx on entries(project_id, path);
create index entries_project_updated_idx on entries(project_id, updated_at desc);
create index entries_project_tags_idx on entries using gin(tags);

-- Entry history (versioning)
create table entry_history (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references entries(id) on delete cascade,
  content text not null,
  source text not null,
  changed_at timestamptz default now() not null
);

create index entry_history_entry_idx on entry_history(entry_id, changed_at desc);

-- User preferences per project
create table user_preferences (
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  auto_capture text not null default 'moderate' check (auto_capture in ('aggressive', 'moderate', 'manual_only')),
  context_loading text not null default 'smart' check (context_loading in ('full', 'smart', 'on_demand', 'summary_only')),
  primary key (user_id, project_id)
);

-- Row-Level Security policies
alter table users enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table entries enable row level security;
alter table entry_history enable row level security;
alter table user_preferences enable row level security;

-- Note: RLS policies use the service key from the Worker (bypasses RLS).
-- Application-level authorization is enforced in the Worker code via
-- project membership checks. RLS here is defense-in-depth for direct
-- Supabase client access (e.g., Supabase dashboard, future client SDKs).

-- Users can read their own row
create policy "users_read_own" on users for select
  using (id = auth.uid());

-- Project members can read projects they belong to
create policy "projects_read_member" on projects for select
  using (id in (select project_id from project_members where user_id = auth.uid()));

-- Members can read membership of their projects
create policy "members_read" on project_members for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));

-- Entries: members can read entries in their projects
create policy "entries_read_member" on entries for select
  using (project_id in (select project_id from project_members where user_id = auth.uid()));

-- Entries: editors and owners can insert/update
create policy "entries_write_editor" on entries for insert
  with check (project_id in (
    select project_id from project_members
    where user_id = auth.uid() and role in ('owner', 'editor')
  ));

create policy "entries_update_editor" on entries for update
  using (project_id in (
    select project_id from project_members
    where user_id = auth.uid() and role in ('owner', 'editor')
  ));

-- Entry history: same as entries read
create policy "entry_history_read" on entry_history for select
  using (entry_id in (
    select e.id from entries e
    join project_members pm on pm.project_id = e.project_id
    where pm.user_id = auth.uid()
  ));

-- User preferences: users can read/write their own
create policy "preferences_read_own" on user_preferences for select
  using (user_id = auth.uid());

create policy "preferences_write_own" on user_preferences for insert
  with check (user_id = auth.uid());

create policy "preferences_update_own" on user_preferences for update
  using (user_id = auth.uid());

-- Updated_at trigger for entries
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger entries_updated_at
  before update on entries
  for each row execute function update_updated_at();
