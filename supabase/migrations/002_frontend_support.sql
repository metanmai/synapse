-- Add supabase_auth_id to users for JWT auth
alter table users add column supabase_auth_id uuid unique;
create index users_supabase_auth_id_idx on users(supabase_auth_id);

-- Share links table
create table share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  token text unique not null default encode(gen_random_bytes(24), 'hex'),
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references users(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz default now() not null
);

create index share_links_token_idx on share_links(token);
create index share_links_project_idx on share_links(project_id);

-- RLS for share_links
alter table share_links enable row level security;

create policy "share_links_read_member" on share_links for select
  using (project_id in (
    select project_id from project_members where user_id = auth.uid()
  ));

-- Activity log table
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null check (action in (
    'entry_created', 'entry_updated', 'entry_deleted',
    'member_added', 'member_removed',
    'settings_changed', 'share_link_created', 'share_link_revoked'
  )),
  target_path text,
  target_email text,
  source text not null default 'human' check (source in ('claude', 'chatgpt', 'human', 'google_docs')),
  metadata jsonb,
  created_at timestamptz default now() not null
);

create index activity_log_project_idx on activity_log(project_id, created_at desc);

-- RLS for activity_log
alter table activity_log enable row level security;

create policy "activity_log_read_member" on activity_log for select
  using (project_id in (
    select project_id from project_members where user_id = auth.uid()
  ));

-- Trigger: auto-create users row when Supabase Auth user signs up
create or replace function handle_new_auth_user()
returns trigger as $$
begin
  insert into public.users (email, supabase_auth_id)
  values (new.email, new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
