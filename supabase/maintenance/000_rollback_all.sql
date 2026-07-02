-- ROLLBACK: Drop everything and start fresh
-- Run this BEFORE running migrations 001-007

-- Drop triggers first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS entries_updated_at ON entries;
DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;

-- Drop functions
DROP FUNCTION IF EXISTS handle_new_auth_user();
DROP FUNCTION IF EXISTS update_updated_at();

-- Drop tables in dependency order (children before parents)
-- Conversations (007)
DROP TABLE IF EXISTS conversation_limits CASCADE;
DROP TABLE IF EXISTS conversation_context CASCADE;
DROP TABLE IF EXISTS conversation_media CASCADE;
DROP TABLE IF EXISTS conversation_messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
-- Insights (006)
DROP TABLE IF EXISTS insights CASCADE;
-- Core (001-005)
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS share_links CASCADE;
DROP TABLE IF EXISTS entry_history CASCADE;
DROP TABLE IF EXISTS user_preferences CASCADE;
DROP TABLE IF EXISTS entries CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS users CASCADE;
