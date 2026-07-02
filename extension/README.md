# Synapse Browser Capture (MV3 extension)

Opt-in, **default-off** capture of your `claude.ai` and `chatgpt.com` conversations
into your Synapse. Connect one of two ways — **sign in** to send captures directly to
your Synapse account, or point it at the **local daemon** (fallback). Chromium
(Chrome/Edge) committed; Firefox if WebExtension parity holds; Safari is out of v1.

> **Best-effort, may need periodic adapter updates (R2).** The web wire formats of
> these sites are private and unversioned. When a site changes its format, capture
> for that host can stop until its adapter is patched — the daemon surfaces a
> zero-capture warning so you find out within a session, not weeks later. Browser
> capture is explicitly **not** part of the must-not-degrade core loop.

## How it works

```
claude.ai / chatgpt.com tab
  └─ content/main.ts  (world: MAIN, document_start) — hooks window.fetch, reads
     conversation turns only (never cookies/auth/storage)
        └─ window.postMessage → content/relay.ts (ISOLATED)
              └─ chrome.runtime → service worker
                    └─ buffers (chrome.storage.session), then flushes — preferring:
                       (1) DIRECT  → POST https://api.synapsesync.app/api/capture/browser
                                     with a capture-scoped Bearer token (from sign-in), else
                       (2) FALLBACK → the daemon's loopback ingest (127.0.0.1) with a
                                     shared-secret token
```

The worker tries the direct backend first when you're signed in, and falls back to the
daemon if the backend POST fails. With neither configured, capture stays off (opt-out).

Per-host parsing lives in `src/content/adapters/{claude-ai,chatgpt}.ts` (golden-fixture
tested). The single source of truth for which hosts are captured is
`@synapse/shared` `CAPTURE_HOSTS`; an anti-drift test pins the manifest + adapters to it.

## Build

```
npm run bundle -w @synapse/extension
```

Writes a loadable extension to `extension/dist/` (uses the repo's vite; no extra install).
`dist/` is **gitignored** — rebuild it on whatever machine you load it from (a `git pull`
won't bring `dist/` with it).

## Load it (Chrome/Edge)

`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `extension/dist/`.

> **Enterprise-managed browsers** (e.g. a Netskope/MDM-managed Chrome) usually **policy-block
> developer mode** and unpacked extensions. Use a personal profile / non-managed machine, or
> the unlisted Web Store build (see Distribution).

## Connect — pick one (or both)

### Option A — Sign in (direct to your account) · recommended

1. **Prerequisite:** migration `031_api_key_scope.sql` must be applied to the backend's prod
   database — it adds the `api_keys.scope` column the capture-scoped key needs. Without it,
   sign-in fails at the token mint (HTTP 500). Verify in the Supabase SQL editor:
   ```sql
   select column_name from information_schema.columns
   where table_name = 'api_keys' and column_name = 'scope';
   ```
   One row back → applied. No rows → apply it (the migration is idempotent: `ADD COLUMN IF
   NOT EXISTS`, so re-running is safe).
2. Open the extension's **Options** → click **Sign in to Synapse**. A Synapse sign-in window
   opens (`chrome.identity` + PKCE, scope=capture); approve it. The page then shows
   *Signed in as &lt;email&gt;*.
3. Done — captures POST directly to `/api/capture/browser` with a capture-scoped token. No
   daemon required.

### Option B — Local daemon (fallback)

1. Run `synapsesync wizard` (or re-run it) and answer **yes** to *"Also capture browser AI
   sessions?"*. It mints a loopback **ingest token**, writes it to
   `~/.synapse/proxy-config.json`, and prints it. Restart the capture daemon so it starts the
   ingest server (`synapsesync capture proxy enable`, or reboot).
2. Open the extension's **Options**, paste the ingest token, confirm the daemon port
   (default `7726`), and Save.

Set both and the worker uses the direct path, falling back to the daemon automatically.

## Smoke test

1. Build → load unpacked → connect via Option A or B (above).
2. Open a `claude.ai` or `chatgpt.com` tab and send a message; wait for the assistant reply.
3. Confirm the capture landed:
   - **Direct path (A):** the conversation appears in your Synapse under a per-host project
     named after the host (e.g. `claude.ai`).
   - **Daemon path (B):** the daemon's capture log records the turns.
   - The toolbar **badge** shows a number only when turns are *buffered* (destination
     unreachable); a clear badge means they flushed.
4. **Secret-scrub check:** include a fake token like `sk-ant-api03-AAAABBBBCCCCDDDD` in a
   message — it must arrive as `[REDACTED]` (scrubbed client-side before the POST on the
   direct path, and again server-side on both paths).

If you can't load a real browser, the glue is covered headlessly — see Tests.

## Privacy

- Reads **conversation data only** — never `document.cookie`, `localStorage`, auth headers,
  or non-conversation traffic.
- Both paths **scrub token-shaped values** from one shared definition (`@synapse/shared/redact`).
  The direct path scrubs **client-side**, so secrets never leave the browser unredacted.
- The **capture-scoped** sign-in token is fail-closed: it can reach **only** the browser-capture
  ingest endpoint — it cannot read or delete anything else in your account.
- Daemon transport is loopback-only with a required shared-secret token; web origins are rejected.

## Distribution

- **Dev / dogfood:** load-unpacked from `extension/dist/` (above).
- **Unlisted Chrome Web Store:** zip `extension/dist/` and upload as an unlisted item —
  needed for enterprise browsers where developer mode is policy-blocked. (Open item.)

## Tests

`npm run test -w @synapse/extension` — adapter golden fixtures, `CaptureBuffer`
(dedupe/cap/eviction-survival), the `CAPTURE_HOSTS` anti-drift checks, the **sign-in PKCE flow**
(`auth.test.ts`), and the worker's **backend-first / daemon-fallback** routing + client-side
scrub (`worker-backend.test.ts`). These run in CI via the root `--workspaces` test. Loading the
unpacked extension in a real browser remains the final manual check (above).
