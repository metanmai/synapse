-- Subscriptions table (provider-agnostic, synced via webhooks)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'creem',
  provider_subscription_id text unique not null,
  provider_customer_id text,
  status text not null default 'inactive'
    check (status in ('active', 'canceled', 'past_due', 'inactive')),
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on subscriptions(user_id);
create index idx_subscriptions_provider_sub_id on subscriptions(provider_subscription_id);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table subscriptions enable row level security;

create policy "subscriptions_read_own" on subscriptions for select
  using (user_id = auth.uid());

-- updated_at trigger (matches entries pattern from migration 001)
create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();
