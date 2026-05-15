-- v1.1 Task 3: Drop FK constraints on handoff_events.session_id and
-- handoff_issues.originated_in_session_id.
--
-- Why: the v1 migration (015_handoff_layer.sql) created handoff_sessions
-- and handoff_issues tables with FK constraints, but no code path inserts
-- session rows. Events are emitted by the SessionStart hook with a freshly
-- generated session_id ULID; no corresponding row in handoff_sessions
-- exists. The first production POST /api/events/batch would have failed
-- at the FK check.
--
-- The reducer (packages/shared/src/handoff/reducer.ts) materializes
-- session and actor state purely from events — the tables were redundant
-- in v1's design. v1.1 drops the FKs; the columns remain as loose text
-- references so queries grouping by session_id still work. The tables
-- themselves stay (RLS preserved) in case a future version wants to
-- denormalize for query performance.

alter table handoff_events
  drop constraint if exists handoff_events_session_id_fkey;

alter table handoff_issues
  drop constraint if exists handoff_issues_originated_in_session_id_fkey;
