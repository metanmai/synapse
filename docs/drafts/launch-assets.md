# Launch Assets -- Drafts (v2: B+C identity)

## 1. Show HN Post

**Title:** `Show HN: Synapse – captures your AI coding sessions and distills them into lasting knowledge`

**Text:**

I use Claude Code, Cursor, and ChatGPT daily. Hundreds of conversations -- architecture decisions, debugging sessions, design explorations. But none of my tools remember any of it. Every morning, back to zero.

So I built Synapse. It has three stages:

1. A background daemon silently captures your sessions from Claude Code, Cursor, Codex, and Gemini (watches their session files on disk -- no plugins needed).

2. When you go idle, it sends the session to an LLM that extracts the valuable parts -- decisions, architecture, learnings -- and writes them to a cloud workspace.

3. Next time you open any MCP-capable tool, it reads from that workspace. Your AI already knows what you decided, what you built, what you learned.

The cycle is automatic: sessions in, knowledge out, context everywhere.

Setup: `npm install -g synapsesync-mcp && synapsesync-mcp wizard && synapsesync-mcp capture start`

Supports Anthropic, OpenAI, and Google for the distillation step. Workspace has semantic search, version history, E2E encryption, and team sharing.

Free tier: 50 files, 3 devices. $5.99/mo for teams.

https://synapsesync.app | MIT license

Solo dev -- happy to answer questions.

---

## 2. Twitter/X Thread

**Tweet 1 (Hook):**
Your best AI conversations disappear the moment you close the tab.

Decisions, architecture, debugging insights -- gone. Every morning you re-explain your own project to your own tools.

I built something to fix this. Thread:

**Tweet 2 (Problem):**
The problem isn't that AI tools forget. The problem is the knowledge inside your conversations never gets extracted.

It's buried in 200-message transcripts you'll never scroll back to.

**Tweet 3 (Solution):**
Synapse captures your AI sessions automatically and distills them into knowledge.

A background daemon watches Claude Code, Cursor, Codex, and Gemini. When you go idle, an LLM extracts decisions, architecture notes, and learnings into a searchable workspace.

**Tweet 4 (How it works):**
Three stages:
- Capture: daemon watches silently, zero effort
- Distill: LLM extracts the signal from the noise
- Remember: your AI tools read the workspace via MCP

Next session, your tools already know what you decided last time.

**Tweet 5 (Demo):**
Setup is three commands:

```
npm install -g synapsesync-mcp
synapsesync-mcp wizard
synapsesync-mcp capture start
```

Go back to work. Synapse handles the rest.

**Tweet 6 (Personal):**
I built the first version as a manual context workspace. I kept forgetting to save things.

So I automated it. Capture everything, distill the valuable parts, throw away the noise.

A few hundred people are using it. If you're tired of re-explaining your project every morning, try it:

https://synapsesync.app

**Tweet 7 (CTA):**
It's open source (MIT), self-hostable, and supports E2E encryption.

If you try it, let me know what you think.

---

## 3. Reddit Post -- r/ClaudeAI

**Title:** I built a tool that automatically captures your Claude sessions and turns them into persistent knowledge

**Body:**

I've been using Claude Code daily for months. My biggest frustration wasn't Claude's capabilities -- it was the context loss. Every session starts fresh. Decisions from yesterday? Gone. That architecture we designed last week? Explain it again.

The conversations existed in `~/.claude/projects/` as JSONL files. The knowledge was there, just trapped in raw transcripts I'd never reopen.

So I built Synapse. It does three things:

**1. Captures automatically.** A background daemon watches Claude Code's session files (and Cursor, Codex, Gemini). You don't do anything -- it just runs.

```
synapsesync-mcp capture start
```

**2. Distills the knowledge.** When a session goes idle, Synapse sends it to an LLM that extracts decisions, architecture notes, and learnings. Trivial exchanges are skipped. Only the valuable stuff is kept.

**3. Feeds it back.** The extracted knowledge lives in a cloud workspace accessible via MCP. Next time you open Claude, it searches the workspace and already has context from every previous session.

The result: your Claude sessions build on each other instead of starting from zero.

It also works across tools -- knowledge captured from Claude is available in Cursor, and vice versa. And across teammates -- your team's AI tools share the same knowledge base.

Free tier: 50 files, 3 devices. Open source (MIT).

https://synapsesync.app

Happy to answer questions about how the capture daemon works, the distillation prompt, or anything else.

---

## 4. Reddit Post -- r/MCP

**Title:** Synapse: automatic session capture + LLM distillation for MCP clients

**Body:**

Built an MCP server that solves context persistence in a different way than most.

Instead of requiring AI tools to explicitly write context, Synapse captures sessions automatically by watching the filesystem where tools store their data:

- Claude Code: `~/.claude/projects/*.jsonl`
- Cursor: `workspaceStorage/*/chatSessions/*.json`
- Codex CLI: `~/.codex/sessions/rollout-*.jsonl`
- Gemini CLI: `~/.gemini/tmp/*/chats/*.json`

A background daemon (chokidar, event queue, mtime+size dedup) parses these into a standard session format, then:

1. Syncs to Synapse cloud after 5 min idle
2. Optionally distills via LLM (Anthropic/OpenAI/Google) into structured knowledge files
3. Writes distilled output to the workspace via `POST /api/context/save`

The MCP server then exposes the workspace to any client:
- `search` (semantic + full-text via pgvector)
- `read`, `tree`, `ls`, `history`

Adapter pattern makes adding new tools trivial -- implement `watchPaths()` and `parse()`.

Tech: TypeScript, Cloudflare Workers + Hono, Supabase, SvelteKit dashboard, chokidar for filesystem watching.

```
synapsesync-mcp capture start
synapsesync-mcp distill --latest
```

MIT license. npm: synapsesync-mcp. https://synapsesync.app

Interested in how others are handling context persistence across MCP clients.

---

## 5. Product Hunt -- First Comment

Hey! I'm the solo dev behind Synapse.

I built it because I was tired of re-explaining my project to AI tools every morning. I use Claude Code, Cursor, and ChatGPT daily -- hundreds of conversations full of architecture decisions, debugging insights, and design choices. But none of it persisted.

Synapse fixes this automatically. A background daemon captures your AI sessions silently. When you stop typing, an LLM distills the conversation into structured knowledge -- decisions, architecture notes, learnings. That knowledge lives in a workspace your AI tools can search and read via MCP.

The result: your AI sessions build on each other. No manual saving, no copy-pasting context, no re-explaining.

It works across tools (Claude, Cursor, Codex, Gemini), across devices, and across teammates.

Would love your feedback.

---

## 6. DevHunt Submission

**Tagline:** Captures AI sessions, distills them into knowledge, feeds it back to your tools

**Description:** Synapse automatically records your AI coding sessions from Claude Code, Cursor, Codex, and Gemini. When you go idle, it distills the conversation into decisions, architecture notes, and learnings using an LLM. The extracted knowledge lives in a searchable cloud workspace that any MCP-capable tool can read. Your AI sessions build on each other instead of starting from zero.
