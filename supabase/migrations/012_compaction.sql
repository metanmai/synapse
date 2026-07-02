-- 012_compaction.sql
-- Add compaction fields to conversations + project_context table

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS compacted_summary TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS compaction_model TEXT;

CREATE TABLE IF NOT EXISTS project_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_context_project ON project_context(project_id);
