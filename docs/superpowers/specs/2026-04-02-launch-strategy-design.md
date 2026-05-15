# Synapse Launch Strategy

**Date:** 2026-04-02
**Goal:** Maximum visibility + credibility (product and personal brand)
**Timeline:** 2-week sprint (Apr 2-14)
**Product:** [synapsesync.app](https://synapsesync.app) | [npm: synapsesync-mcp](https://www.npmjs.com/package/synapsesync-mcp)

---

## Approach: Credibility First, Then Amplify

Week 1 builds the foundation (directory listings, blog post, assets). Week 2 concentrates the public launch into a coordinated push across platforms.

---

## Week 1: Foundation (Apr 2-7)

### Day 1-2: MCP Directory Submissions

Submit to all MCP directories. These are mostly form fills and compound over time.

| Directory | Method | Notes |
|-----------|--------|-------|
| [Anthropic Official](https://support.claude.com/en/articles/12922832-local-mcp-server-submission-guide) | Google Form (https://forms.gle/tyiAZvch1kDADKoP9) | Requires: tool annotations (readOnlyHint/destructiveHint on every tool), privacy policy in README + manifest.json, 3+ usage examples, LICENSE file. Most demanding submission. |
| [Cline Marketplace](https://github.com/cline/mcp-marketplace) | GitHub Issue on cline/mcp-marketplace | Requires: GitHub repo URL, 400x400 PNG logo, description of why it benefits Cline users. Review in ~2 days. |
| [PulseMCP](https://www.pulsemcp.com/use-cases/submit) | Web form at pulsemcp.com/submit | Low effort. |
| [MCP.so](https://mcp.so/) | GitHub Issue on their repo (click Submit in nav) | Low effort. |
| [Glama](https://glama.ai/mcp/servers) | May auto-index from npm/GitHub; check if already listed, otherwise submit via their process | Low effort. |
| [LobeHub](https://lobehub.com/mcp) | Check submission process on site | Low effort. |
| [MCP Market](https://mcpmarket.com) | Check submission process on site | Low effort. |
| [Smithery](https://smithery.ai) | Check submission process on site | Low effort. |

**Pre-submission checklist for Anthropic Official (most strict):**
- [ ] Every MCP tool has `readOnlyHint: true` or `destructiveHint: true` annotations
- [ ] Privacy policy section in README.md
- [ ] Privacy policy URL in manifest.json (`privacy_policies` array, manifest v0.3+)
- [ ] 3+ usage examples in README (realistic prompts, expected behavior, actual output)
- [ ] LICENSE file in repo
- [ ] Test credentials with sample data prepared
- [ ] Tested on Claude Desktop and Claude Code

### Day 2-3: Logo

Current state: animated glyph (Minimal Cross: `·O· O-*-O ·O·`) with coffee "Medium Roast" palette (copper #c8a06a).

Options for fast turnaround:
- **Fiverr** -- $20-50, 24-48hr turnaround. Brief: "Developer tool logo. Minimal geometric mark inspired by a cross/node shape. Warm copper/brown palette. Must work at 400x400 and as a favicon."
- **Brandmark.io or Looka** -- AI logo generators, ~$25 for export files
- **Manual iteration** -- Use the existing glyph concept and refine in Figma/SVG

Deliverables needed:
- 400x400 PNG (for Cline Marketplace and other directories)
- SVG (for landing page, replacing current /logo.svg)
- Favicon (16x16, 32x32)
- Social share image (1200x630 for OpenGraph/Twitter cards)

### Day 3-5: Blog Post

Publish on **Dev.to** as canonical source. Cross-post to Hashnode and Medium with canonical URL.

**Title options:**
- "I Built an MCP Server That Gives AI Tools Persistent Memory"
- "Your AI Tools Forget Everything. I Fixed That."
- "How I Built a Shared Context Layer for Claude, ChatGPT, and Cursor"

**Structure:**
1. **Hook** -- "Every time I switched AI tools, I lost all my context."
2. **The problem** -- AI tools are stateless across sessions and tools. Context is siloed. You repeat yourself constantly.
3. **What I built** -- Synapse: persistent context as a cloud workspace accessible via MCP. Works across Claude, ChatGPT, Cursor, and any MCP client.
4. **How it works** -- MCP server exposes workspace as filesystem. Semantic search, version history, E2E encryption. `npx synapsesync-mcp` to install.
5. **The journey** -- Solo dev, built it because I needed it, a few hundred downloads on npm.
6. **Try it** -- Link to synapsesync.app, `npx synapsesync-mcp`

**Tone:** Honest, technical, personal. Not salesy. Show the problem from lived experience.

### Day 5-7: Prep Launch Assets

- [ ] Twitter/X thread draft (5-7 tweets, casual version of the blog post story)
- [ ] Show HN title + description (3-4 sentences, link to blog post)
- [ ] Reddit post for r/ClaudeAI (native text, not a link drop)
- [ ] Reddit post for r/MCP (native text, tailored to that community)
- [ ] 2-3 GIFs or screenshots showing Synapse in action (CLI onboarding, search, multi-tool usage)
- [ ] Product Hunt listing draft (tagline, description, 5+ screenshots/GIFs, first comment)

---

## Week 2: Launch (Apr 8-14)

### Day 8 (Tuesday): Launch Day

Tuesday chosen intentionally -- best engagement day on HN, Reddit, and Twitter.

**Morning (8-9am ET):**
1. **Show HN** -- Title: `Show HN: Synapse - Persistent, shared context for AI tools via MCP`. Link to blog post. 3-4 sentence description.
2. **DevHunt** -- Submit at devhunt.org. Developer-specific audience.
3. **Twitter/X** -- Post the prepared thread. Pin it. Tag relevant accounts naturally.

**Midday:**
4. **Reddit** -- Post to r/ClaudeAI and r/MCP as native text posts. Different text for each. Story + GIF + link at end.
5. **Cross-post** blog to Hashnode and Medium (canonical URL pointing to Dev.to).

### Day 9-10: Engage

Critical -- this is where credibility is built.

- Reply to every HN comment, including critical ones. Thoughtful responses to criticism = #1 credibility signal.
- Reply to every Reddit comment.
- Retweet/quote anyone who mentions Synapse on Twitter.
- Post follow-up tweet with early results: "X people tried Synapse yesterday -- here's what I learned."

### Day 11-12: Product Hunt

Launch on PH after HN/Reddit, not same day. By now you have:
- Social proof from HN discussion
- Real user feedback to reference
- Download numbers to cite

**PH checklist:**
- [ ] 5+ screenshots/GIFs
- [ ] Clear tagline (reuse from landing page)
- [ ] First comment: personal story of why you built it
- [ ] Ask a few dev friends to upvote and leave genuine comments in the first hour

### Day 13-14: Indie Hackers + Retrospective

- Post on Indie Hackers with download numbers and the story
- Twitter recap thread: "I launched Synapse last week. Here's what happened." -- numbers, learnings, what's next
- Launch retrospectives often get as much engagement as the launch itself

---

## Post-Sprint: Ongoing (Apr 15+)

- MCP directories compound organic discovery over months
- Dev.to post ranks for MCP-related searches on Google
- Add `/blog` to synapsesync.app as long-term canonical source
- Engage regularly in r/ClaudeAI and r/MCP -- answer questions, mention Synapse when relevant (not spammy)
- Consider a monthly "building in public" update on Twitter

---

## Platform-Specific Guidelines

### Hacker News
- Be technical, not salesy
- Title: "Show HN: [Name] - [what it does in plain terms]"
- Link to blog post, not product page
- Respond to every comment thoughtfully
- Don't ask for upvotes

### Reddit
- Write native posts, not link drops
- Different text for each subreddit
- Engage in comments genuinely
- Share the problem you solved, not just the product

### Twitter/X
- Personal account is an advantage (authenticity)
- Thread format: hook -> problem -> solution -> how it works -> try it
- Pin the thread
- "Building in public" framing resonates

### Product Hunt
- Polish matters: good screenshots, clear tagline
- First comment should be your personal story
- Early upvotes/comments in first hour are critical
- Schedule for 12:01am PT (PH resets daily at midnight PT)

---

## Assets Checklist

- [ ] Logo (400x400 PNG, SVG, favicon, OG image)
- [ ] Blog post on Dev.to
- [ ] Blog cross-posts on Hashnode and Medium
- [ ] Twitter/X thread draft
- [ ] Show HN post draft
- [ ] Reddit posts for r/ClaudeAI and r/MCP
- [ ] 2-3 GIFs/screenshots of Synapse in action
- [ ] Product Hunt listing (tagline, description, screenshots, first comment)
- [ ] Indie Hackers post draft

## Key Risks

- **Anthropic directory rejection** -- Their requirements are strict. Tool annotations and privacy policy may need work. Submit early, iterate if rejected.
- **HN doesn't gain traction** -- Not every post hits the front page. If it doesn't, the Reddit/Twitter/PH push still stands independently.
- **Logo delays** -- Don't let this block directory submissions. Submit with current logo where possible, update later.
