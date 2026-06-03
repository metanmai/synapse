-- 022_activity_log_action_check_expand.sql
-- Bug: 6 action strings the application code writes are NOT in the
-- activity_log_action_check CHECK constraint. Because logActivity()
-- swallows the resulting 23514 (check constraint violation) via
-- console.error and does not throw, this has been silently corrupting
-- the audit trail for weeks — every merge / move / role change /
-- message append / media upload / member role change produced a worker
-- log line but no activity_log row.
--
-- Verified via wrangler tail on 2026-05-24: `activity_log violates
-- check constraint activity_log_action_check` was firing on every
-- POST /api/conversations/:id/messages call from the capture daemon.
--
-- Adds the 6 missing action strings (audited against
-- `grep -rn 'action:\s*"' backend/src/api/` on 2026-05-24):
--   - messages_appended      (POST /:id/messages)
--   - media_uploaded         (POST /:id/media)
--   - conversation_moved_in  (POST /:id/reassign  — target side)
--   - conversation_moved_out (POST /:id/reassign  — source side)
--   - member_role_changed    (PATCH /:id/members/:email)
--   - project_merged         (POST /:id/merge-into/:target_id)

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;

ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check CHECK (action IN (
  -- Pre-existing (from migration 008)
  'entry_created', 'entry_updated', 'entry_deleted',
  'member_added', 'member_removed',
  'settings_changed', 'share_link_created', 'share_link_revoked',
  'project_created',
  'insight_created', 'insight_updated', 'insight_deleted',
  'conversation_created', 'conversation_imported', 'conversation_loaded',
  -- Added by 022 (closing the silent-audit-corruption bug)
  'messages_appended',
  'media_uploaded',
  'conversation_moved_in',
  'conversation_moved_out',
  'member_role_changed',
  'project_merged'
));
