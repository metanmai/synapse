# CLI Onboarding UI Redesign

**Date:** 2026-03-27
**Status:** Approved
**Scope:** `mcp/src/` — the `synapsesync-mcp` CLI onboarding flow

## Summary

Redesign the CLI onboarding wizard with a sleek, branded experience: an animated geometric glyph, a coffee-themed (Medium Roast) color palette, keyboard-driven navigation, and a rethought flow that adds a welcome screen, editor picker, confirmation step, and success summary.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Inspiration | Stripe/Vercel CLI (clean, text-driven) + bespoke animated glyph | Familiar dev UX with distinctive branding |
| Glyph | Minimal Cross — `·○· ○─◆─○ ·○·` | Compact, works as both intro art and inline spinner |
| Animation timing | Launch intro (~1.5s) + loading states (replaces spinner) | Branded moments without slowing down the flow |
| Color palette | Coffee "Medium Roast" — copper/burnt orange accents, warm dark bg | Distinctive, warm, readable |
| Library | Keep @clack/prompts, layer custom rendering on top | Minimal deps change, clack handles keyboard well |
| Flow | 7-step wizard with editor picker + confirmation + summary | More intentional, user stays in control |

## Color Palette — Medium Roast

```
accent    #c87941   Copper — interactive elements, prompts, glyph nodes
text      #ffe4c4   Cream — primary text, headings
muted     #7a6455   Warm gray — hints, descriptions, pipes
dim       #5c3d2e   Dark brown — glyph edges, subtle details
success   #3fb950   Green — checkmarks (standard)
error     #f85149   Red — error messages (standard)
```

Uses ANSI 24-bit escape sequences (`\x1b[38;2;r;g;bm`). Falls back to 256-color approximation if `COLORTERM` is not `truecolor`/`24bit`. Respects `NO_COLOR` env var to disable all color.

## Glyph Animation

### Intro (welcome screen)

6 frames at ~250ms each. Glyph builds outward from center, then title and tagline fade in:

```
Frame 1:  just ◆ (center diamond)
Frame 2:  ◆ + dots above/below
Frame 3:  full glyph — all nodes + edges lit
Frame 4:  glyph holds
Frame 5:  + "Synapse v0.3.0"
Frame 6:  + "Shared context for your AI tools"
```

Rendered by overwriting terminal lines using ANSI cursor movement (`\x1b[<n>A` to reposition). If `NO_COLOR` is set, skip animation and print the static final frame (glyph + title + tagline) immediately.

### Inline Spinner (loading states)

4 frames at ~150ms, single-line. Nodes cycle through lit/dim states:

```
Frame 1:  ·○· ○─◆─○ ·○·     (all dim)
Frame 2:  ·●· ○─◆─○ ·○·     (top lit)
Frame 3:  ·○· ●─◆─● ·○·     (sides lit)
Frame 4:  ·○· ○─◆─○ ·●·     (bottom lit)
```

Drop-in replacement for clack's spinner — same `{ start(msg), stop(msg) }` interface.

## Onboarding Flow

### Step 1 — Animated Welcome
- Glyph animates in (6 frames, ~1.5s)
- Title: "Synapse" + version
- Tagline: "Shared context for your AI tools"
- Auto-advances to Step 2 after animation completes

### Step 2 — Auth Method
- `clack.select()` with three options:
  - Create account (email only)
  - Sign in (email + password)
  - Paste an API key (from dashboard)
- Keyboard hint: `↑/↓ navigate · enter select · ctrl+c cancel`

### Step 3 — Credentials
- Varies by auth method:
  - Signup: `clack.text()` for email
  - Login: `clack.text()` for email + `clack.password()` for password
  - API key: `clack.password()` for key input

### Step 4 — Loading
- Custom glyph spinner while calling the API
- Message: "Creating account…" / "Signing in…"
- On success: spinner stops with checkmark + email/confirmation

### Step 5 — Editor Selection (new)
- `clack.multiselect()` showing all known editors
- Detected editors are pre-checked, undetected shown but unchecked
- Each option shows what files it writes (as hint text)
- Keyboard hint: `space toggle · a all · enter confirm`
- Detection logic:
  - Claude Code: `~/.claude/` exists
  - Cursor: `.cursor/` or `.cursorrules` exists in cwd
  - Windsurf: `~/.codeium/` exists
  - VS Code: `.vscode/` exists in cwd
  - Generic MCP: always available, pre-checked

### Step 6 — Confirmation (new)
- Lists all files that will be created/updated
- `clack.confirm()` — "Ready to write config files?"
- On "no": cancel gracefully

### Step 7 — Success Summary (new)
- Checkmark for each file written
- Styled outro with: "Restart your editor to connect."
- Link to docs

## Code Architecture

```
mcp/src/
  index.ts            Entry point, CLI arg routing, MCP server (unchanged logic)
  cli/
    theme.ts          Color palette constants, ANSI helpers, NO_COLOR support
    glyph.ts          Glyph frame definitions, playIntro(), SPINNER_FRAMES
    welcome.ts        Animated welcome screen (calls playIntro, renders title)
    wizard.ts         Full 7-step wizard orchestration
    editors.ts        detectEditors() → data, writeEditorConfig() → file writes
    spinner.ts        Glyph-based spinner with clack-compatible API
```

### `theme.ts`
- Exports color functions: `accent(s)`, `text(s)`, `muted(s)`, `dim(s)`, `success(s)`, `error(s)`
- Detects `NO_COLOR` and `COLORTERM` at import time
- Exports `bold(s)` (already exists, moved here)

### `glyph.ts`
- `INTRO_FRAMES: string[][]` — each frame is array of lines
- `SPINNER_FRAMES: string[]` — each frame is single-line string
- `playIntro(): Promise<void>` — renders frames with ANSI cursor repositioning, resolves on completion
- `renderFrame(frame: string[], stream: NodeJS.WriteStream): void` — low-level frame render

### `welcome.ts`
- `showWelcome(): Promise<void>` — calls `playIntro()`, then renders title + tagline below glyph, pauses briefly, resolves

### `wizard.ts`
- `runWizard(): Promise<void>` — the full orchestrated flow
- Calls clack prompts for each interactive step
- Calls `detectEditors()` and presents results via `clack.multiselect()`
- Calls `writeEditorConfigs(selected, apiKey)` after confirmation
- Renders success summary

### `editors.ts`
- `interface EditorInfo { name: string; detected: boolean; hint: string; setup: (apiKey: string) => void }`
- `detectEditors(): EditorInfo[]` — returns list with detection status
- `writeEditorConfigs(editors: EditorInfo[], apiKey: string): string[]` — writes configs, returns list of files written
- Existing setup functions (`setupClaudeCode`, `setupCursor`, etc.) moved here

### `spinner.ts`
- `createGlyphSpinner(): { start(msg: string): void; stop(msg: string): void; update(msg: string): void }`
- Uses `SPINNER_FRAMES` from glyph.ts
- Cycles frames at 150ms using `setInterval`
- Overwrites current line with ANSI escape codes

## Standalone Subcommands

The individual `login`, `signup`, `init` subcommands continue to work independently. They use the same shared modules (`theme.ts`, `editors.ts`, `spinner.ts`) but skip the welcome animation and editor picker — they go straight to their specific flow as they do today, just with the new visual treatment (colors, glyph spinner).

## Non-Interactive / CI Mode

No changes. When stdin is not a TTY, all subcommands work with flags as they do today (no animation, no color if `NO_COLOR` is set, plain text output).
