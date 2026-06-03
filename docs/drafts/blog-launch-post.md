# I Built a Tool That Captures Your AI Sessions and Learns From Them

I use Claude Code, Cursor, and ChatGPT every day. Between them, I have hundreds of conversations -- architecture decisions, debugging sessions, design explorations. But none of my tools remember any of it.

Every morning I open a fresh session and start from zero. "Here's my project structure. Here's what we decided last week. Here's the auth flow we designed yesterday." Over and over.

The conversations exist somewhere -- buried in chat logs I'll never reopen. The knowledge is there, but it's trapped. So I built something to set it free.

---

## The problem: your best AI conversations disappear

Here's the reality of working with AI tools in 2026:

- **Sessions are disposable.** Close the tab, lose the context. Tomorrow you start from scratch.
- **Knowledge is siloed.** What you discussed in Claude, Cursor can't see. What ChatGPT helped you debug, nobody else knows.
- **Your team is blind.** Your teammate's AI assistant has no idea what decisions yours already made. Everyone re-discovers the same things independently.
- **The good stuff is buried.** That brilliant architecture decision from three weeks ago? It's somewhere in a 200-message transcript you'll never scroll back to.

The real waste isn't the conversations -- it's the knowledge inside them that never gets extracted.

---

## What I built: Synapse

[Synapse](https://synapsesync.app) captures your AI coding sessions and turns them into lasting knowledge.

It works in three stages:

**1. Capture.** A background daemon silently records your sessions from Claude Code, Cursor, Codex, and Gemini as you work. You don't do anything -- it just watches.

```bash
synapsesync capture start
# That's it. Go back to work.
```

**2. Distill.** When a session goes idle, Synapse extracts the valuable parts -- decisions, architecture notes, debugging insights -- and writes them to your workspace as structured knowledge.

```
decisions/
  chose-session-cookies.md     ← extracted from a 150-message Claude session
  api-rate-limiting.md         ← extracted from a Cursor session
architecture/
  auth-flow.md                 ← extracted from a ChatGPT design conversation
learnings/
  cf-workers-cookie-gotcha.md  ← extracted from a debugging session
```

**3. Remember.** Your AI tools read from the workspace via MCP. Next time you open Claude or Cursor, it already knows what you decided, what you built, and what you learned. No re-explaining.

The cycle is automatic: **sessions in, knowledge out, context everywhere.**

---

## How it works

Synapse has three components:

**The capture daemon** watches where your AI tools store session data on disk. When files change, tool-specific adapters parse them into a standard format. It handles Claude Code's JSONL, Cursor's JSON, Codex's rollout files, and Gemini's chat format.

Under the hood: filesystem watching with chokidar, event queue with deduplication, mtime+size change detection, copy-on-read safety, symlink rejection. It's lightweight -- no polling, no CPU overhead.

**The distiller** sends captured sessions to an LLM (your choice of Anthropic, OpenAI, or Google) with a prompt that extracts only non-trivial insights. It outputs structured markdown files with paths like `decisions/`, `architecture/`, `learnings/`. Trivial exchanges are skipped.

**The MCP server** exposes the resulting workspace to any MCP-capable tool:

| Tool | What it does |
|------|-------------|
| `search` | Semantic search across all your knowledge |
| `read` | Read a specific file |
| `tree` | Browse the workspace structure |
| `history` | View version history |

When your AI tool starts a new session, it searches Synapse and immediately has context from every previous session across every tool you've used.

---

## Setup

```bash
npm install -g synapsesync    # one-time install
synapsesync wizard            # interactive setup
synapsesync capture start     # start capturing sessions
```

The wizard detects your editor, walks you through signup, and writes config files. The daemon runs in the background until you stop it.

To distill a captured session:
```bash
export SYNAPSE_DISTILL_API_KEY=sk-ant-...  # your LLM provider key
synapsesync distill --latest
```

Or let it happen automatically when sessions go idle.

---

## What makes this different

There are tools that record AI sessions. There are tools that store AI context. Synapse does both, and connects them:

- **Capture is zero-effort.** No prompts to remember, no manual saving. The daemon watches silently.
- **Distillation is the core.** Raw transcripts are noise. Synapse extracts the signal -- decisions, architecture, learnings -- and makes it searchable.
- **The workspace fills itself.** You don't curate it. Your sessions do.
- **Cross-tool, cross-device, cross-team.** Knowledge captured in Claude is available in Cursor. On your laptop and your desktop. For you and your teammates.
- **Semantic search.** "Auth flow" finds documents about login and session tokens. Not just exact string matches.
- **E2E encryption.** Set a passphrase and content is encrypted client-side. The server never sees plaintext.

---

## The journey

I built the first version of Synapse as a simple context workspace -- manually saving decisions and notes so my AI tools could read them. It worked, but I was constantly forgetting to save things. The most valuable context was in conversations I'd already closed.

So I built the capture system. A daemon that records everything automatically. And then the distiller -- an LLM that reads the raw sessions and extracts the knowledge I would have forgotten to save manually.

The tech stack: Cloudflare Workers with Hono, SvelteKit, Supabase with pgvector, the MCP SDK, and chokidar for filesystem watching. TypeScript everywhere. Solo project, a few hundred npm downloads organically.

I'm launching publicly because it's reached a point where the full pipeline works: capture → distill → workspace → AI tools read it → better sessions → more knowledge captured. A flywheel.

---

## Try it

**Landing page:** [synapsesync.app](https://synapsesync.app)

**Quick start:**
```bash
npm install -g synapsesync
synapsesync wizard
synapsesync capture start
```

**Source:** [github.com/metanmai/synapse](https://github.com/metanmai/synapse) (MIT)

**npm:** [synapsesync](https://www.npmjs.com/package/synapsesync)

Free tier: 50 files, 3 devices. Plus: $5.99/mo for teams and power users.

If you've ever lost a valuable AI conversation to a closed tab, Synapse is the fix. I built it because I was tired of re-explaining my own project to my own tools.

Happy to answer questions about the architecture, the MCP protocol, or anything else.

---

*Synapse is open source (MIT). Self-hosting docs are in the repo.*
