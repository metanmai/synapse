# Synapse Browser Capture (MV3 extension)

Opt-in, **default-off** capture of your `claude.ai` and `chatgpt.com` conversations
into your Synapse, via the local daemon. Chromium (Chrome/Edge) committed; Firefox
if WebExtension parity holds; Safari is out of v1.

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
                    └─ buffers (chrome.storage.session) + POSTs to the daemon's
                       loopback ingest (127.0.0.1) with a shared-secret token
```

Per-host parsing lives in `src/content/adapters/{claude-ai,chatgpt}.ts` (golden-fixture
tested). The single source of truth for which hosts are captured is
`@synapse/shared` `CAPTURE_HOSTS`; an anti-drift test pins the manifest + adapters to it.

## Enable + install

1. Run `synapsesync wizard` (or re-run it) and answer **yes** to
   *"Also capture browser AI sessions?"*. It mints a loopback **ingest token**, writes
   it to `~/.synapse/proxy-config.json`, and prints it. Restart the capture daemon so
   it starts the ingest server (`synapsesync capture proxy enable`, or reboot).
2. Build the extension:
   ```
   npm run bundle -w @synapse/extension
   ```
   This writes a loadable extension to `extension/dist/` (uses the repo's vite; no extra install).
3. Load it (Chrome/Edge): `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select `extension/dist/`.
   *(Enterprise-managed browsers that block developer mode need the unlisted Web Store
   build instead — see "Distribution" below.)*
4. Open the extension's **Options**, paste the ingest token, confirm the daemon port
   (default `7726`), and Save.

That's it — open a `claude.ai` or `chatgpt.com` tab and your conversations flow into
Synapse alongside CLI/proxy captures.

## Privacy

- The content script reads **conversation data only** — never `document.cookie`,
  `localStorage`, auth headers, or non-conversation traffic.
- The daemon ingest route **allowlists** the payload to `{host, messages:[{role,content,ts}]}`
  and scrubs token-shaped values before anything is persisted or synced.
- Transport is **loopback-only** with a required shared-secret token; web origins are rejected.

## Distribution

- **Dev / dogfood:** load-unpacked from `extension/dist/` (above).
- **Unlisted Chrome Web Store:** zip `extension/dist/` and upload as an unlisted item —
  needed for enterprise browsers where developer mode is policy-blocked. (Open item.)

## Tests

`npm run test -w @synapse/extension` — adapter golden fixtures, `CaptureBuffer`
(dedupe/cap/eviction-survival), and the `CAPTURE_HOSTS` anti-drift checks. These run in
CI via the root `--workspaces` test. The browser glue (content scripts, worker) is
validated by the manual smoke in `docs/E2E-PROTOCOL.md`.
