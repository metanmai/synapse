-- 023_conversations_updated_at_trigger.sql
-- Bug: `conversations.updated_at` was set on INSERT only (default now()),
-- but no BEFORE UPDATE trigger bumped it on subsequent writes. Result: a
-- long-running session's conversation row stayed at its creation timestamp
-- forever, even as 2000+ messages were appended via /api/conversations/:id/messages
-- and even as PreCompact wrote handoff_markdown via /api/conversations/:id/compact.
--
-- Cascading symptom: `listConversations` orders by `updated_at desc`, so
-- short-lived subprocess conversations (claude -p, gsd subagents) that
-- happened to be created later naturally outranked the actively-used main
-- session conversation. The SessionStart hook then pulled the *subprocess's*
-- handoff instead of the main session's, giving the next agent the wrong
-- "where I left off" context.
--
-- Verified 2026-05-24 against project d9353855 (synapse):
--   - Main session conv 9a621a5c: 2260 synced messages, updated_at=17:18:32 (creation time)
--   - Subprocess conv 60028d3b: 2 messages, updated_at=17:49:44 (creation time)
--   - Pull-compact picked the subprocess because it was "newer."
--
-- Fix: add a BEFORE UPDATE trigger on `conversations` that auto-bumps
-- `updated_at` on every UPDATE. Mirrors the existing `entries_updated_at`
-- pattern from migration 001 — the convention exists, was just missed for
-- this table.
--
-- This is the canonical fix. Application-code changes (explicit
-- `updated_at: new Date().toISOString()` in appendMessages /
-- updateConversation / reassignConversation / updateCompaction) ship as
-- belt-and-suspenders in the same PR, so the bug clears on backend
-- auto-deploy even before this migration lands.

create trigger conversations_updated_at
  before update on conversations
  for each row
  execute function update_updated_at();

-- Backfill: align stale updated_at with the most recent activity already
-- recorded against each conversation. We use the latest
-- `conversation_messages.created_at` because that's the only signal in the
-- existing schema that survives across all the UPDATE paths that were
-- previously dropping updated_at. Rows with no messages keep their
-- original updated_at (== created_at) — that's fine, listConversations
-- ordering against them was already correct.
--
-- Limited to rows where there IS a newer message timestamp, so we don't
-- backfill rows that were never touched. This is idempotent — re-running
-- moves nothing once aligned.
update conversations c
   set updated_at = sub.last_msg_at
  from (
    select conversation_id, max(created_at) as last_msg_at
      from conversation_messages
     group by conversation_id
  ) sub
 where c.id = sub.conversation_id
   and sub.last_msg_at > c.updated_at;
