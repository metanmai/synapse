// --- Canonical message format ---

export interface CanonicalMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  media?: MediaAttachment[];
  toolInteraction?: ToolInteraction;
  source: MessageSource;
  tokenCount?: { input?: number; output?: number };
  cost?: number;
  parentMessageId?: string;
  createdAt: string;
}

export interface ToolInteraction {
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  summary: string;
}

export interface MessageSource {
  agent: string;
  model?: string;
}

export interface MediaAttachment {
  id: string;
  type: "image" | "file" | "pdf" | "audio" | "video";
  mimeType: string;
  filename: string;
  size: number;
  storagePath: string;
  url?: string;
}

// --- Database row types ---

export type ConversationStatus = "active" | "archived" | "deleted";
export type FidelityMode = "summary" | "full";
export type MessageRole = "user" | "assistant" | "system" | "tool";
export type MediaType = "image" | "file" | "pdf" | "audio" | "video";
export type ContextType = "file" | "repo" | "env" | "dependency";

export interface Conversation {
  id: string;
  project_id: string;
  user_id: string;
  title: string | null;
  status: ConversationStatus;
  fidelity_mode: FidelityMode;
  system_prompt: string | null;
  working_context: Record<string, unknown> | null;
  forked_from: string | null;
  fork_point: number | null;
  message_count: number;
  media_size: number;
  metadata: Record<string, unknown> | null;
  encrypted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  status: ConversationStatus;
  message_count: number;
  metadata: Record<string, unknown> | null;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sequence: number;
  role: MessageRole;
  content: string | null;
  tool_interaction: ToolInteraction | null;
  source_agent: string;
  source_model: string | null;
  token_count: { input?: number; output?: number } | null;
  cost: number | null;
  attachments_summary: string | null;
  parent_message_id: string | null;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationMediaRecord {
  id: string;
  message_id: string;
  conversation_id: string;
  type: MediaType;
  mime_type: string;
  filename: string | null;
  size: number;
  storage_path: string;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationContext {
  id: string;
  conversation_id: string;
  type: ContextType;
  key: string;
  value: string | null;
  snapshot_at: number | null;
  encrypted: boolean;
  created_at: string;
}

export interface ConversationLimits {
  tier: string;
  max_conversations: number | null;
  max_messages: number | null;
  max_media_bytes: number | null;
  sync_enabled: boolean;
}
