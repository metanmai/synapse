-- 007_conversations.sql
-- Conversation sync: full transcript syncing across AI agents (Plus only)

-- Core conversation record
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  user_id         uuid not null references users(id),
  title           text,
  status          text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  fidelity_mode   text not null default 'summary' check (fidelity_mode in ('summary', 'full')),
  system_prompt   text,
  working_context jsonb,
  forked_from     uuid references conversations(id),
  fork_point      int,
  message_count   int not null default 0,
  media_size      bigint not null default 0,
  metadata        jsonb,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_conversations_project on conversations(project_id);
create index idx_conversations_user on conversations(user_id);
create index idx_conversations_status on conversations(project_id, status);

-- Individual messages in order
create table conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sequence        int not null,
  role            text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content         text,
  tool_interaction jsonb,
  source_agent    text not null,
  source_model    text,
  token_count     jsonb,
  cost            numeric,
  attachments_summary text,
  parent_message_id uuid references conversation_messages(id),
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique(conversation_id, sequence)
);

create index idx_messages_conversation on conversation_messages(conversation_id, sequence);

-- Media linked to messages
create table conversation_media (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null references conversation_messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  type            text not null check (type in ('image', 'file', 'pdf', 'audio', 'video')),
  mime_type       text not null,
  filename        text,
  size            bigint not null,
  storage_path    text not null,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_media_message on conversation_media(message_id);
create index idx_media_conversation on conversation_media(conversation_id);

-- File/repo context snapshots
create table conversation_context (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  type            text not null check (type in ('file', 'repo', 'env', 'dependency')),
  key             text not null,
  value           text,
  snapshot_at     int,
  encrypted       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index idx_context_conversation on conversation_context(conversation_id);

-- Tier limits for conversations
create table conversation_limits (
  tier              text primary key,
  max_conversations int,
  max_messages      int,
  max_media_bytes   bigint,
  sync_enabled      boolean not null default false
);

insert into conversation_limits (tier, max_conversations, max_messages, max_media_bytes, sync_enabled)
values
  ('free',  null, null, null, false),
  ('plus',  null, null, null, true);

-- RLS
alter table conversations enable row level security;
alter table conversation_messages enable row level security;
alter table conversation_media enable row level security;
alter table conversation_context enable row level security;
alter table conversation_limits enable row level security;
