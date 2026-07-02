-- 031_api_key_scope.sql
--
-- Adds a capability SCOPE to api_keys so a browser-extension key can be minted
-- that ONLY writes browser captures (POST /api/capture/browser) and is rejected
-- on every other authenticated route (enforced fail-closed in authMiddleware).
--
-- Existing keys default to 'full' (unchanged behavior). The backend reads scope
-- feature-detected (SELECT *), so the reader can deploy BEFORE this migration is
-- applied without 500ing the core loop — an absent column reads as 'full'.
--
-- Idempotent: safe to re-run.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'full';

-- Defense-in-depth: constrain to known scopes (the app also validates on mint).
ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_scope_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_scope_check CHECK (scope IN ('full', 'capture'));
