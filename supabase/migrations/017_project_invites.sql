-- 017_project_invites.sql
-- v1.1 invite flow: a member of a project can mint a shareable join token
-- that another user redeems via POST /api/invites/:token/accept.

create table if not exists project_invites (
  token text primary key,
  project_id uuid not null references projects(id) on delete cascade,
  invited_by_user_id uuid not null references users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete set null
);

create index project_invites_email_idx on project_invites(email);
create index project_invites_project_id_idx on project_invites(project_id);

alter table project_invites enable row level security;

-- Members of the project can see their pending invites.
create policy project_invites_member_read on project_invites for select
  using (exists (select 1 from project_members pm where pm.project_id = project_invites.project_id and pm.user_id = auth.uid()));
