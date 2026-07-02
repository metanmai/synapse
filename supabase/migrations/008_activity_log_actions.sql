-- 008_activity_log_actions.sql
-- Expand activity_log action constraint to include insight and conversation actions

ALTER TABLE activity_log DROP CONSTRAINT IF EXISTS activity_log_action_check;

ALTER TABLE activity_log ADD CONSTRAINT activity_log_action_check CHECK (action IN (
  'entry_created', 'entry_updated', 'entry_deleted',
  'member_added', 'member_removed',
  'settings_changed', 'share_link_created', 'share_link_revoked',
  'project_created',
  'insight_created', 'insight_updated', 'insight_deleted',
  'conversation_created', 'conversation_imported', 'conversation_loaded'
));
