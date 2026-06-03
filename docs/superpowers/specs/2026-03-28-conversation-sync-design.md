# Conversation Sync & Key Insights — Design Spec

**Date:** 2026-03-28
**Status:** Draft
**Tier:** Conversation Sync = Plus only | Key Insights = All users

---

## Overview

Two interconnected features that make Synapse the persistent memory layer across AI agents and machines:

1. **Key Insights** — A standalone memory/learnings system. Agents extract and store decisions, preferences, architecture choices, and learnings during any session. Available to all users. Searchable alongside entries.

2. **Conversation Sync** — Full conversation transcript syncing across AI agents (Claude Code, ChatGPT, Gemini, etc.). A conversation started in Claude Code can be picked up by ChatGPT and continued as if that agent had been there the entire time. Includes all media (images, files, PDFs, screenshots). Plus only.

---

## Key Insights

### Purpose

A persistent, cross-session knowledge base — like Claude's memory, but agent-agnostic and stored in Synapse. Any agent can write insights during any session. Insights accumulate into a searchable knowledge base of decisions, learnings, preferences, and patterns.

### Data Model

```sql
insights (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  type            text NOT NULL,        -- decision | learning | preference | architecture | action_item
  summary         text NOT NULL,        -- concise insight (one line)
  detail          text,                 -- fuller context if needed
  source          jsonb,                -- origin: { type: 'conversation', id: '...' }
                                        --         { type: 'session', agent: 'claude-code' }
                                        --         { type: 'manual' }
  search_vector   tsvector,             -- generated from summary + detail
  encrypted       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_insights_project ON insights(project_id);
CREATE INDEX idx_insights_user ON insights(user_id);
CREATE INDEX idx_insights_type ON insights(project_id, type);
CREATE INDEX idx_insights_search ON insights USING gin(search_vector);
```

### MCP Tools

#### `save_insight`

Store a key insight. Available to all tiers.

```typescript
{
  name: 'save_insight',
  input: {
    type: 'decision' | 'learning' | 'preference' | 'architecture' | 'action_item',
    summary: string,       // required — concise one-liner
    detail?: string,       // optional — fuller context
    source?: {             // optional — where this came from
      type: 'conversation' | 'session' | 'manual',
      id?: string,
      agent?: string
    }
  },
  output: { id: string }
}
```

#### `list_insights`

Browse and filter insights. Available to all tiers.

```typescript
{
  name: 'list_insights',
  input: {
    type?: string,         // filter by type
    limit?: number,        // default 20
    offset?: number
  },
  output: { insights: Insight[], total: number }
}
```

#### `search_context` (existing tool, extended)

The existing search tool is extended to search across entries, insights, and conversation content. No new tool — just broader results.

When a user or agent searches for context, results now include:
- Matching entries (existing behavior)
- Matching insights (new — matched against summary + detail)
- Matching conversation messages (new — Plus only, matched against message content)

### Web UI

**Insights page** (`/projects/[name]/insights`):
- Available to all tiers
- List view with type badges (decision, learning, preference, etc.)
- Search and filter by type
- Click to view detail, edit, or delete
- Source link — if insight came from a conversation, link to the conversation viewer (Plus only)

### API Endpoints

```
GET    /api/insights                — List insights (paginated, filterable by type)
POST   /api/insights               — Create insight
PATCH  /api/insights/:id           — Update insight
DELETE /api/insights/:id           — Delete insight
```

---

## Conversation Sync

### Purpose

Sync full conversation transcripts across AI agents and machines. A conversation started in one agent can be resumed in another with full context — the receiving agent sees every message as if it had been part of the conversation from the start. All media shared during the conversation travels with it.

### Canonical Message Format

All conversations are normalized to a universal format on ingest and translated to the target agent's format on export.

```typescript
interface CanonicalMessage {
  id: string;                          // uuid
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;                     // text content (markdown)
  media?: MediaAttachment[];
  toolInteraction?: {
    name: string;
    input?: Record<string, any>;       // present in full fidelity mode
    output?: string;                   // present in full fidelity mode
    summary: string;                   // always present ("Read file.ts, 120 lines")
  };
  source: {
    agent: string;                     // 'claude-code' | 'chatgpt' | 'gemini' | etc.
    model?: string;                    // 'claude-opus-4-6' | 'gpt-4o' | etc.
  };
  tokenCount?: {
    input?: number;
    output?: number;
  };
  cost?: number;                       // estimated USD
  parentMessageId?: string;            // for branching within a conversation
  createdAt: string;                   // ISO 8601
}

interface MediaAttachment {
  id: string;
  type: 'image' | 'file' | 'pdf' | 'audio' | 'video';
  mimeType: string;                    // 'image/png', 'application/pdf', etc.
  filename: string;
  size: number;                        // bytes
  storagePath: string;                 // path in Supabase Storage
  url?: string;                        // signed URL, generated on read
}
```

### Data Model

```sql
-- Core conversation record
conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  title           text,
  status          text NOT NULL DEFAULT 'active',    -- active | archived | deleted
  fidelity_mode   text NOT NULL DEFAULT 'summary',   -- summary | full
  system_prompt   text,                               -- active instructions/persona
  working_context jsonb,                              -- { repo, cwd, branch, project }
  forked_from     uuid REFERENCES conversations(id),  -- if this is a fork
  fork_point      int,                                -- sequence number of fork
  message_count   int NOT NULL DEFAULT 0,
  media_size      bigint NOT NULL DEFAULT 0,          -- total bytes of media
  metadata        jsonb,                              -- flexible: tags, source agent, etc.
  encrypted       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(project_id, status);

-- Individual messages in order
conversation_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence        int NOT NULL,
  role            text NOT NULL,                      -- user | assistant | system | tool
  content         text,
  tool_interaction jsonb,                             -- null for plain messages
  source_agent    text NOT NULL,
  source_model    text,
  token_count     jsonb,                              -- { input: N, output: N }
  cost            numeric,                            -- estimated USD
  attachments_summary text,                           -- quick text summary of media
  parent_message_id uuid REFERENCES conversation_messages(id),
  encrypted       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, sequence)
);

CREATE INDEX idx_messages_conversation ON conversation_messages(conversation_id, sequence);

-- Media linked to messages
conversation_media (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  type            text NOT NULL,                      -- image | file | pdf | audio | video
  mime_type       text NOT NULL,
  filename        text,
  size            bigint NOT NULL,
  storage_path    text NOT NULL,                      -- Supabase Storage path
  encrypted       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_message ON conversation_media(message_id);
CREATE INDEX idx_media_conversation ON conversation_media(conversation_id);

-- File/repo context snapshots
conversation_context (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  type            text NOT NULL,                      -- file | repo | env | dependency
  key             text NOT NULL,                      -- file path, repo URL, env var name
  value           text,                               -- content snapshot, branch name, etc.
  snapshot_at     int,                                -- message sequence when captured
  encrypted       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_context_conversation ON conversation_context(conversation_id);

-- Tier limits (toggles, no enforcement yet)
conversation_limits (
  tier              text PRIMARY KEY,                 -- free | plus
  max_conversations int,                              -- null = unlimited
  max_messages      int,                              -- null = unlimited
  max_media_bytes   bigint,                           -- null = unlimited
  sync_enabled      boolean NOT NULL DEFAULT false
);

-- Seed data
INSERT INTO conversation_limits (tier, max_conversations, max_messages, max_media_bytes, sync_enabled)
VALUES
  ('free',  null, null, null, false),
  ('plus',  null, null, null, true);
```

### Media Storage

**Supabase Storage** bucket: `conversation-media`

**Path convention:**
```
conversations/{conversation_id}/{message_id}/{filename}
```

**Upload flow:**
1. Agent calls `upload_media` or `POST /conversations/:id/media` with file + message ID
2. Backend validates mime type, stores encrypted blob in Supabase Storage
3. Returns `media_id`, links to message in `conversation_media` table
4. On read, generates short-lived signed URL for download

**On conversation load:**
- Media references included as metadata per message (id, type, filename, size)
- Actual content NOT inlined — receiving agent fetches on demand via signed URL
- For images, agents with vision support get the signed URL in a native image content block

**On import:**
- If imported conversation references external media (e.g., ChatGPT export with images), the import endpoint downloads them and re-uploads encrypted to Supabase Storage

### API Endpoints

```
POST   /api/conversations                     — Create conversation
GET    /api/conversations                     — List (paginated, filterable by status)
GET    /api/conversations/:id                 — Full conversation (messages, context, media refs)
                                                Query params: ?fidelity=full|summary
                                                              ?page=1&limit=50
PATCH  /api/conversations/:id                 — Update metadata / soft-delete

POST   /api/conversations/:id/messages        — Append message(s) with optional context snapshot
                                                Accepts single message or array

POST   /api/conversations/:id/media           — Upload media attachment
GET    /api/conversations/:id/media/:mediaId  — Signed download URL

POST   /api/conversations/import              — Import from external format (ChatGPT JSON, etc.)
GET    /api/conversations/:id/export/:format  — Export to target agent format (anthropic | openai | raw)
```

**All write endpoints** check `sync_enabled` on the user's tier. Read endpoints work for all tiers (web UI viewing).

### MCP Tools

#### `sync_conversation`

Push new messages to a conversation. Called by MCP-connected agents during or after a session.

```typescript
{
  name: 'sync_conversation',
  input: {
    conversationId?: string,   // omit to create new conversation
    title?: string,
    systemPrompt?: string,
    workingContext?: {
      repo?: string,
      cwd?: string,
      branch?: string,
      project?: string
    },
    fidelity?: 'full' | 'summary',
    messages: {                // in the agent's native format
      role: string,
      content: any,
      // ... agent-specific fields
    }[]
  },
  output: {
    conversationId: string,
    messageCount: number
  }
}
```

Messages are normalized to canonical format via the appropriate agent adapter before storage.

#### `load_conversation`

Load a conversation into context. Returns messages in the requesting agent's preferred format.

```typescript
{
  name: 'load_conversation',
  input: {
    conversationId: string,
    fidelity?: 'full' | 'summary',  // override conversation default
    fromSequence?: number            // load from a specific point
  },
  output: {
    conversation: {
      id: string,
      title: string,
      systemPrompt: string,
      workingContext: object,
      messageCount: number
    },
    messages: any[],               // in the requesting agent's format
    context: ContextSnapshot[]
  }
}
```

#### `list_conversations`

List available conversations for the current project.

```typescript
{
  name: 'list_conversations',
  input: {
    status?: 'active' | 'archived',
    limit?: number,
    offset?: number
  },
  output: {
    conversations: {
      id: string,
      title: string,
      status: string,
      messageCount: number,
      lastAgent: string,
      updatedAt: string
    }[],
    total: number
  }
}
```

#### `upload_media`

Attach a file/image/screenshot to a conversation message.

```typescript
{
  name: 'upload_media',
  input: {
    conversationId: string,
    messageId: string,
    filename: string,
    mimeType: string,
    content: string              // base64-encoded, encrypted client-side
  },
  output: {
    mediaId: string,
    storagePath: string
  }
}
```

### Auto-Sync Flow (MCP Agents)

1. Agent starts session
2. If user explicitly requests resume (or agent finds highly relevant conversation via search), call `load_conversation` to load full history into context
3. During session, agent periodically calls `sync_conversation` to push new messages
4. Session ends — final `sync_conversation` to capture everything

**Resume behavior:**
- User explicitly triggers via command (e.g., `/resume`) or by asking the agent to load a conversation
- Agent may proactively suggest resuming ONLY if a search result returns a conversation highly relevant to the current task — not simply because a recent conversation exists

### Format Translation Layer

Agent adapters normalize on ingest and format on export:

```typescript
interface AgentAdapter {
  name: string;                        // 'anthropic' | 'openai' | 'gemini' | etc.
  detect(raw: unknown): boolean;       // can this adapter handle this format?
  toCanonical(raw: unknown): CanonicalMessage[];
  fromCanonical(
    messages: CanonicalMessage[],
    fidelity: 'full' | 'summary'
  ): unknown;
}
```

**Adapters:**

| Adapter | Ingest handling | Export handling |
|---------|----------------|----------------|
| `anthropic` | Content blocks (text, image, tool_use, tool_result), separate system prompt, thinking blocks | Reconstructs content blocks, separates system, maps tool interactions to tool_use/tool_result |
| `openai` | System-as-first-message, function_call/tool_calls, image_url content parts, code interpreter | Inlines system as first message, maps tool interactions to tool_calls format |
| `raw` | Passthrough canonical format | Returns canonical format as-is |

Adding a new agent = writing one adapter file. Storage, search, insights, media all stay the same.

**Manual import flow (non-MCP agents):**
1. User exports conversation from ChatGPT (JSON) or copies transcript
2. Uploads via web UI drag-and-drop or paste
3. Backend auto-detects format (or user selects), runs through adapter's `toCanonical`
4. Stored as a normal conversation — fully searchable, resumable

### Fidelity Modes

Configurable per conversation, overridable per load:

| Mode | Tool interactions | Size |
|------|-------------------|------|
| `summary` | Collapsed to one-line summaries ("Read auth.ts, 120 lines") | Compact |
| `full` | Complete input/output preserved as structured data | Large |

Default is `summary`. User can set per conversation or override when loading.

---

## Encryption

**Zero-knowledge architecture.** The Synapse admin cannot access any user data.

### What Gets Encrypted (client-side, before hitting the server)

- Message content
- Tool interaction data
- System prompt
- Working context
- Insight summaries and details
- Media files (encrypted before upload to Supabase Storage)
- Conversation title and metadata
- Context snapshot values

### What Stays Plaintext (needed for server-side operations)

- IDs, foreign keys, sequence numbers
- Timestamps
- Roles (user/assistant/system/tool)
- Source agent name and model
- File sizes and mime types (quota tracking)
- Insight `type` field (decision/learning/etc. — needed for filtering, no user content)
- Conversation status

### Encryption Scheme

Identical to existing Synapse entry encryption:

```
Key derivation: PBKDF2(passphrase, email_as_salt, 100_000_iterations, SHA-256)
Cipher:         AES-256-GCM
IV:             Random 12 bytes per encryption
Format:         enc:v1:<iv_hex>:<ciphertext_base64>
```

One passphrase unlocks entries, insights, and conversations. No extra passwords.

**Encryption is mandatory for conversations.** Passphrase is required to use conversation sync.

### Encryption Scope by Feature

| Feature | Encryption | Rationale |
|---------|-----------|-----------|
| Conversations | **Mandatory** — passphrase required to use sync | Conversations contain full transcripts, media, system prompts — highest sensitivity |
| Insights | **Optional** — follows existing entry model | Insights are short summaries; user can choose. If encrypted, search_vector cannot be populated server-side |
| Entries | **Optional** — existing behavior unchanged | No change |

### Impact on Search

- Encrypted content cannot be full-text searched server-side (applies to entries, insights, and conversations equally)
- MCP server decrypts client-side (using `SYNAPSE_PASSPHRASE`) before returning results
- Insight `type` field and conversation `status`/`role` fields are plaintext — server-side filtering by category still works
- Unencrypted insights get full server-side search via `search_vector`; encrypted insights rely on client-side search

### Impact on Media

- Files encrypted client-side before upload using AES-256-GCM
- Decrypted client-side on download
- Signed URLs serve the encrypted blob; client decrypts

---

## Web UI

### Conversations Page (`/projects/[name]/conversations`)

**Plus users:**
- List of conversations: title, last active agent (with icon), message count, last updated
- Filter by status (active/archived), search by title
- Click to open conversation viewer

**Free users:**
- Feature teaser explaining what conversation sync does
- "Upgrade to Plus" prompt
- No data synced, no empty lists — just the upgrade CTA

### Conversation Viewer (`/projects/[name]/conversations/[id]`)

- Full message thread rendered as chat UI
- Messages color-coded by source agent
- Media displayed inline (images rendered, files/PDFs as download links)
- Sidebar showing key insights linked to this conversation
- Fidelity toggle: show/hide tool interactions
- "Resume in..." dropdown with commands/links for specific agents

### Conversation Import (`/projects/[name]/conversations/import`)

- Drag-and-drop zone for JSON exports (ChatGPT, etc.)
- Paste field for raw conversation text
- Format auto-detection with manual override
- Preview before confirming import

### Insights Page (`/projects/[name]/insights`)

- Available to all tiers
- List view with type badges (decision, learning, preference, architecture, action_item)
- Search and filter by type
- Click to view detail, edit, or delete
- Source link — if insight came from a conversation, link to conversation viewer (Plus)

### Existing Pages Affected

- **Search results** now include insights alongside entries (and conversation content for Plus)
- **Dashboard/activity feed** shows conversation sync events and new insights

---

## Tier Gating

| Feature | Free | Plus |
|---------|------|------|
| Key insights (save, search, browse) | Yes | Yes |
| View conversations in web UI | Teaser + upgrade prompt | Yes |
| Sync conversations (MCP) | No | Yes |
| Import/export conversations | No | Yes |
| Media upload | No | Yes |
| Search conversations | No | Yes |
| Search insights | Yes | Yes |

### Enforcement

```typescript
async function checkConversationAccess(userId: string, action: 'sync' | 'read') {
  const tier = await getUserTier(userId);
  const limits = await getConversationLimits(tier);

  if (action === 'sync' && !limits.sync_enabled) {
    throw new TierLimitError('Conversation sync requires Plus');
  }

  // Toggles for future caps — all null (unlimited) for now
  if (limits.max_conversations !== null) { /* check count */ }
  if (limits.max_messages !== null) { /* check count */ }
  if (limits.max_media_bytes !== null) { /* check total size */ }
}
```

### Limits Table

```sql
conversation_limits (
  tier              text PRIMARY KEY,
  max_conversations int,           -- null = unlimited
  max_messages      int,           -- null = unlimited
  max_media_bytes   bigint,        -- null = unlimited
  sync_enabled      boolean NOT NULL DEFAULT false
);

-- Current config: no caps, sync gated by tier
INSERT INTO conversation_limits VALUES ('free',  null, null, null, false);
INSERT INTO conversation_limits VALUES ('plus',  null, null, null, true);
```

To enforce caps later, update the row. Middleware already checks. No code changes needed.
