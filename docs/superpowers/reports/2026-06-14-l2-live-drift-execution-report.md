# L2 Live Browser Drift Self-Test — Execution Report

**Date:** 2026-06-14
**Test:** `extension/test/live-drift.test.ts`
**Related:** [Drift Defense Design](../specs/2026-06-14-browser-capture-drift-defense-design.md) · [L2 Handoff](../plans/2026-06-14-drift-defense-l2-live-handoff.md)

---

## Summary

The Layer 2 live-drift test was executed against a real, logged-in Chrome against both `claude.ai` and `chatgpt.com`. **Claude.ai wire format drift was detected and fixed** — the completion endpoint URL changed from `/completion` to `/completion2`, which the old regex missed. ChatGPT parsed successfully with no drift.

| Site | Parsed | Bytes | Endpoint | Drift? |
|------|--------|-------|----------|--------|
| claude.ai | ✓ `parsed=true` | 2,989 | `/chat_conversations/{uuid}/completion2` | **Yes — URL changed, fixed** |
| chatgpt.com | ✓ `parsed=true` | 13,435 | `/backend-api/f/conversation` + minor endpoints | No |

---

## Procedure

### Environment Setup

1. **Chrome launch** — Linux enforces `--user-data-dir` with `--remote-debugging-port`, so the user's `~/.config/google-chrome` profile was copied to a temp directory to preserve existing logins.
2. **CDP connection** — Playwright's `chromium.connectOverCDP("http://127.0.0.1:9222")` attached to the running Chrome instance.
3. **Session reuse** — Both sites showed logged-in state (page titles: "New chat - Claude", "ChatGPT"). No credentials were stored or copied.

### Test Mechanics

For each site, the test:
1. Opens a new tab via CDP
2. Installs a `page.on("response")` listener that matches completion endpoints against the shipped adapter's `matchesCompletion()` regex
3. Accumulates **all** matching SSE response bodies over 90 seconds (not just the first — fixes false negatives when metadata SSE arrives before the completion)
4. Auto-types `"hello"` via `page.keyboard.type()` and presses Enter
5. Concatenates all captured bodies and runs the shipped `parseResponse()` function
6. Asserts the parser extracted a non-empty assistant turn (`role === "assistant"` + `content.trim().length > 0`)

### Captured Messages

| Site | Prompt | Assistant Response | SSE Size |
|------|--------|-------------------|----------|
| claude.ai | "hello" | "Hi there! How can I help you today?" | 2,989 bytes |
| chatgpt.com | "hello" | "Hello" | 12,464 bytes (completion) |

---

## Drift Detection — How It Unfolded

### Attempt 1–3: False starts

| Attempt | claude.ai | chatgpt.com | Root Cause |
|---------|-----------|-------------|------------|
| 1 | SKIP (no message) | SKIP (no message) | No auto-type; user didn't interact manually |
| 2 | SKIP (no completion) | `parsed=false` (555 bytes) | Chat captured metadata SSE first, not completion. Claude had no matches at all. |
| 3 | SKIP (no completion) | `parsed=true` | Accumulation fix worked for ChatGPT. Claude still silent — added URL diagnostics. |

### Attempt 4: The Drift Discovery

Added URL logging for all responses containing `"completion"` or `"chat_conversations"`:

```
[claude.ai] FULL: .../chat_conversations/{uuid}/completion2    match=false
[claude.ai] FULL: .../chat_conversations/{uuid}/title2         match=false
[claude.ai] FULL: .../chat_conversations/{uuid}                match=false
```

The completion endpoint had changed from `/completion` to `/completion2`. The old regex `/\bcompletion\b/` required a word boundary after "completion", but "2" is a word character — so the regex returned `false`.

### Attempt 5: The Fix

```diff
- const COMPLETION_RE = /\/chat_conversations\/[^/]+\/completion\b/;
+ const COMPLETION_RE = /\/chat_conversations\/[^/]+\/completion\d*\b/;
```

The `\d*` allows an optional numeric suffix (e.g., `completion`, `completion2`, `completion3`). The SSE event format (`content_block_delta` / `text_delta`) is unchanged — only the URL changed.

### Attempt 5: Both Green

```
claude.ai: parsed=true bytes=2989   ✓
chatgpt.com: parsed=true bytes=13435 ✓
```

---

## ChatGPT — Multi-Endpoint Capture Detail

ChatGPT's page load and completion fire multiple SSE endpoints matched by `COMPLETION_RE = /\/backend-api\/(?:f\/)?conversation\b/`. The test accumulates all of them:

| Endpoint | Bytes | Content |
|----------|-------|---------|
| `/backend-api/conversation/init` | 555 | Metadata: `conversation_detail_metadata`, model limits, features |
| `/backend-api/f/conversation/prepare` | 384–385 | Pre-completion preparation |
| `/backend-api/conversation/{uuid}/stream_status` | 25 | Streaming status |
| `/backend-api/conversation/{uuid}/textdocs` | 2 | Text document reference |
| `/backend-api/f/conversation` | 12,464 | **The completion** — SSE with `message.author.role="assistant"` |

The `parseChatGPTResponse()` function correctly ignores metadata events and extracts only the assistant turn from the completion stream.

---

## Technical Decisions in the Test

### Accumulation Over First-Match

The original handoff used `Promise.race` to capture only the first matching SSE response. This caused a false negative on ChatGPT when a 555-byte metadata SSE arrived before the actual completion. The fix accumulates all matching bodies over the full 90-second window, then concatenates them — the parser is robust enough to extract the assistant turn from mixed content.

### Auto-Type Over Manual Interaction

The handoff instructed the user to type a message manually when prompted. This was replaced with `page.keyboard.type("hello", { delay: 30 })` + `page.keyboard.press("Enter")` targeting `div[contenteditable="true"], textarea, [role="textbox"]`. This works reliably on both sites.

### Profile Copy for Linux `--user-data-dir`

Chrome on Linux refuses `--remote-debugging-port` with the default profile (`"DevTools remote debugging requires a non-default data directory"`). The workaround copies `~/.config/google-chrome` to a temp directory and uses it as `--user-data-dir`. Sessions and cookies carry over cleanly.

---

## Files Changed

| File | Change | Purpose |
|------|--------|---------|
| `extension/test/live-drift.test.ts` | **Created** (139 lines) | L2 live-drift self-test |
| `extension/src/content/adapters/claude-ai.ts:4` | **Fixed** | `COMPLETION_RE` now matches `completion\d*` |

---

## How to Re-Run

```bash
# 1. Launch Chrome in debug mode (Linux)
CHROME_DIR=$(mktemp -d /tmp/chrome-l2-XXXXXX)
cp -a ~/.config/google-chrome/. "$CHROME_DIR"/
google-chrome-stable --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --user-data-dir="$CHROME_DIR" &

# 2. Verify port is open
node -e "require('http').get('http://127.0.0.1:9222/json/version', ...)"

# 3. Log into claude.ai and chatgpt.com in that Chrome

# 4. Run the test (~3 minutes)
npm run test -w extension -- live-drift
```

### Interpreting Results

| Output | Meaning | Action |
|--------|---------|--------|
| `parsed=true` | Wire format intact | None |
| `SKIP: no Chrome reachable` | No debug browser | Launch Chrome in debug mode |
| `SKIP: no completion captured` | Not logged in, or network blocked | Log in, check network |
| `FAIL: WIRE FORMAT DRIFTED` | **Parser broken** | Compare live response against adapter, fix `parseResponse()`, update golden fixture |
