-- Tombstone table for deleted accounts — audit trail for account deletions.
-- Not subject to CASCADE or RPC cleanup since it exists outside the user's data.
create table deleted_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  deleted_at timestamptz default now() not null,
  had_subscription boolean default false not null,
  subscription_cancelled boolean default false not null,
  deleted_by text default 'self' not null
);
