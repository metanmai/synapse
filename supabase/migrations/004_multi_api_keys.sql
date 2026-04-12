-- New api_keys table
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key_hash text unique not null,
  label text not null,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz default now()
);

create index idx_api_keys_user_id on api_keys(user_id);
create index idx_api_keys_key_hash on api_keys(key_hash);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table api_keys enable row level security;

create policy "api_keys_read_own" on api_keys for select
  using (user_id = auth.uid());

create policy "api_keys_delete_own" on api_keys for delete
  using (user_id = auth.uid());

-- Migrate existing keys from users table
insert into api_keys (user_id, key_hash, label)
select id, api_key_hash, 'default'
from users
where api_key_hash is not null;

-- Drop the old column
alter table users drop column api_key_hash;
