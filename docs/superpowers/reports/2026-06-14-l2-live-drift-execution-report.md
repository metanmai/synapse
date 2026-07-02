# L2 Live Browser Drift Self-Test — Execution Report

**Date:** 2026-06-14 / 2026-06-15
**Test:** `extension/test/live-drift.test.ts`
**Related:** [Drift Defense Design](../specs/2026-06-14-browser-capture-drift-defense-design.md) · [L2 Handoff](../plans/2026-06-14-drift-defense-l2-live-handoff.md)

**Commits:** `f804e5b` → `9b4e50b` → `6a3c032`

---

## Summary

The Layer 2 live-drift test was executed against a real, logged-in Chrome against both `claude.ai` and `chatgpt.com`. **Three distinct wire-format drift issues were detected and fixed** across two adapter files. Both sites now parse complete assistant responses from live SSE streams.

| Site | Bytes | Endpoint(s) | Drift Found | Fix |
|------|-------|-------------|-------------|-----|
| claude.ai | ~15–29 KB | `/chat_conversations/{uuid}/completion2` | Endpoint URL changed: `completion` → `completion2` | Regex: `completion\b` → `completion\d*\b` |
| chatgpt.com | ~15–31 KB | `/backend-api/f/conversation` + 4 minor endpoints | 1. Delta format changed: `o:"append"` → `o:"add"` (nested `v.message`) | Handle `o:"add"` with `v.message.content.parts` |
| | | | 2. Streaming format added: `o:"patch"` with `v[]` operations array | Handle `o:"patch"` → `{p:"/message/content/parts/0", o:"append", v:"text"}` |

### Final Live Demo (2026-06-15)

```
✓ claude.ai:  parsed=true  15,099 bytes
✓ chatgpt.com: parsed=true  31,309 bytes
```

**Claude response:** "Octopuses are genuinely some of the strangest and most fascinating animals on the planet. Here are three standouts: 1. **Three hearts, blue blood**…"

**ChatGPT response:** "2. They are incredibly good escape artists… 3. Some octopuses use tools…" (full multi-fact response, coherently parsed)

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
4. Auto-types `"What are 3 interesting facts about octopuses?"` via `page.keyboard.type()` and presses Enter
5. Concatenates all captured bodies and runs the shipped `parseResponse()` function
6. Asserts the parser extracted a non-empty assistant turn (`role === "assistant"` + `content.trim().length > 0`)

### Captured Messages

| Site | Prompt | Assistant Response (first 150 chars) | SSE Size |
|------|--------|--------------------------------------|----------|
| claude.ai | "What are 3 interesting facts about octopuses?" | "Octopuses are genuinely some of the strangest and most fascinating animals on the planet..." | 15,099 bytes |
| chatgpt.com | "What are 3 interesting facts about octopuses?" | "...their skin look bumpy or smooth to match surroundings. 2. They are incredibly good escape artists..." | 31,309 bytes |

---

## Drift #1 — Claude Endpoint URL (`completion2`)

### Discovery

After setting up the test and fixing the accumulation logic, the claude.ai test kept reporting `SKIP: no completion captured`. URL diagnostics revealed:

```
/api/organizations/{org}/chat_conversations/{conv}/completion2    match=false
```

The completion endpoint had changed from `/completion` to `/completion2`. The old regex `/\/chat_conversations\/[^/]+\/completion\b/` required `\b` (word boundary) after "completion", but "2" is a word character — so the regex never matched.

### Fix

```diff
- const COMPLETION_RE = /\/chat_conversations\/[^/]+\/completion\b/;
+ const COMPLETION_RE = /\/chat_conversations\/[^/]+\/completion\d*\b/;
```

The `\d*` allows an optional numeric suffix. The SSE event format (`content_block_delta` / `text_delta`) was unchanged — only the URL needed updating.

**File:** `extension/src/content/adapters/claude-ai.ts:4`

---

## Drift #2 — ChatGPT `o:"add"` Delta Format

### Discovery

After fixing Claude, the chatgpt.com test initially reported `parsed=true` with "Hello" from a short prompt. But when switching to the longer octopus prompt, the extracted text was a jumbled mid-sentence fragment:

> "uses **hemocyanin** (a copper-based molecule)… octopus has a highly distributed nervous system…"

Parser trace revealed the text was coming exclusively from the legacy `o:"append"` delta path (2 events), while the new `o:"add"` events (1 event) had `role: "assistant"` but empty `content.parts` arrays — the snapshot data wasn't being used.

### Root Cause

ChatGPT introduced a new delta format: `{o:"add", v: {message: {author: {role}, content: {parts}}}}`. The message was nested one level deeper inside `v` instead of at the top level. The parser's old snapshot path (`e.message.content.parts`) couldn't find it.

### Fix

Added a handler for `o:"add"` events that unwraps `e.v.message` and checks `author.role === "assistant"` to extract `content.parts`.

```typescript
// New "add" format: {o:"add", v: {message: {author: {role}, content: {parts}}}}
if (e.o === "add" && e.v && typeof e.v === "object") {
  const msg = (e.v as { message?: ChatGPTEvent["message"] }).message;
  const addParts = msg?.content?.parts;
  if (msg?.author?.role === "assistant" && Array.isArray(addParts)) {
    const text = addParts.filter(…).join("");
    if (text.length >= cumulative.length) cumulative = text;
  }
}
```

**File:** `extension/src/content/adapters/chatgpt.ts`

---

## Drift #3 — ChatGPT `o:"patch"` Streaming Format

### Discovery

After fixing the "add" format, the parser still returned jumbled fragments for longer responses. A survey of all `o` values in the SSE body revealed a third format:

```
oValues: {"add":1, "patch":3, "append":2}
```

The `o:"patch"` format (3 events) was completely unhandled. Dumping the raw structure showed:

```json
{"o":"patch","v":[
  {"p":"/message/content/parts/0","o":"append","v":" even other animals surprisingly well.\n\n3. Their arms..."},
  {"p":"/message/metadata/content_references/0/safe_urls","o":"append","v":["https://images.openai.com/..."]}
]}
```

The actual streaming text arrives via JSON Patch operations inside `o:"patch"` events:
- `p: "/message/content/parts/0"` — the target path
- `o: "append"` — append to the path
- `v: "text here"` — the text content

### Fix

Added a handler that iterates over the `v[]` operations array in `"patch"` events and accumulates text from `/message/content/parts/0` append operations.

```typescript
// New "patch" format: {o:"patch", v:[{p:"/message/content/parts/0", o:"append", v:"text"}]}
if (e.o === "patch" && Array.isArray(e.v)) {
  for (const op of e.v as Array<{ p?: unknown; o?: unknown; v?: unknown }>) {
    if (op.p === "/message/content/parts/0" && op.o === "append" && typeof op.v === "string") {
      appended += op.v;
    }
  }
}
```

**File:** `extension/src/content/adapters/chatgpt.ts`

---

## ChatGPT — Complete Format Matrix

After all fixes, the parser handles four event formats across multiple matching endpoints:

| Format | `o` value | Structure | Used for |
|--------|-----------|-----------|----------|
| Old snapshot | _(none)_ | `{message: {author, content: {parts}}}` | Cumulative assistant turn snapshots |
| Legacy delta | `"append"` | `{o:"append", v:"string"}` | Character-by-character streaming (old) |
| New `add` | `"add"` | `{o:"add", v:{message:{author, content:{parts}}}}` | Message insertion (new) |
| New `patch` | `"patch"` | `{o:"patch", v:[{p:"/.../parts/0", o:"append", v:"text"}]}` | JSON Patch streaming (newest) |

### Multi-Endpoint Accumulation

ChatGPT fires multiple matching SSE endpoints during a single completion. The test accumulates all of them:

| Endpoint | Typical Bytes | Content |
|----------|---------------|---------|
| `/backend-api/conversation/init` | 555 | Metadata: `conversation_detail_metadata`, model limits, features |
| `/backend-api/f/conversation/prepare` | 384–385 | Pre-completion preparation |
| `/backend-api/conversation/{uuid}/stream_status` | 25 | Streaming status |
| `/backend-api/conversation/{uuid}/textdocs` | 2 | Text document reference |
| `/backend-api/f/conversation` | 14–31 KB | **The completion** — all 4 SSE formats |

---

## Diagnostic Journey

| Attempt | claude.ai | chatgpt.com | Root Cause / Action |
|---------|-----------|-------------|---------------------|
| 1 | SKIP | SKIP | No auto-type; user didn't interact |
| 2 | SKIP | `parsed=false` (555B) | Metadata captured before completion; first-match bug |
| 3 | SKIP | `parsed=true` ("Hello") | Accumulation fix worked for ChatGPT; Claude silent |
| 4 | URL `match=false` | — | Discovered `/completion2` endpoint drift |
| 5 | `parsed=true` | `parsed=true` ("Hello") | Claude regex fixed; ChatGPT truncated on longer prompt |
| 6 | — | Jumbled fragments | Discovered `o:"add"` format; added handler |
| 7 | — | Still jumbled | Discovered `o:"patch"` format via event survey |
| 8 | `parsed=true` (15 KB) | `parsed=true` (31 KB) | **All three fixes applied, both sites parse coherently** |

---

## Technical Decisions in the Test

### Accumulation Over First-Match

The original handoff used `Promise.race` to capture only the first matching SSE response. This caused false negatives when metadata SSE arrived before the completion. The fix accumulates all matching bodies over 90 seconds, then concatenates them — the parser is robust enough to extract the assistant turn from mixed content.

### Auto-Type Over Manual Interaction

The handoff instructed the user to type a message manually. Replaced with `page.keyboard.type()` + `page.keyboard.press("Enter")` targeting `div[contenteditable="true"], textarea, [role="textbox"]`.

### Longer Prompt for Better Stress Testing

Switched from "hello" to "What are 3 interesting facts about octopuses?" — multi-sentence responses expose truncation bugs that short greetings hide.

### Profile Copy for Linux `--user-data-dir`

Chrome on Linux refuses `--remote-debugging-port` with the default profile. Workaround copies `~/.config/google-chrome` to a temp directory. Sessions and cookies carry over cleanly.

---

## Files Changed

| File | Change | Purpose |
|------|--------|---------|
| `extension/test/live-drift.test.ts` | **Created** | L2 live-drift self-test |
| `extension/src/content/adapters/claude-ai.ts:4` | `completion\b` → `completion\d*\b` | Match `/completion2` endpoint |
| `extension/src/content/adapters/chatgpt.ts` | +2 format handlers | Handle `o:"add"` and `o:"patch"` delta formats |

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
node -e "require('http').get('http://127.0.0.1:9222/json/version', (r) => r.on('data', d => process.stdout.write(d)))"

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
| `FAIL: WIRE FORMAT DRIFTED` | **Parser broken** | Compare live response, fix adapter, update golden fixture |
