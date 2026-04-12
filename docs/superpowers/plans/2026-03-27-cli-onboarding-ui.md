# CLI Onboarding UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the CLI onboarding wizard with animated glyph, coffee palette, editor picker, and branded flow.

**Architecture:** Extract CLI code from monolithic `index.ts` into focused modules under `mcp/src/cli/`. Layer custom animation and theming on top of existing @clack/prompts. Keep MCP server code unchanged.

**Tech Stack:** TypeScript, @clack/prompts, ANSI escape sequences for animation/color.

---

**Spec:** `docs/superpowers/specs/2026-03-27-cli-onboarding-ui-design.md`

## File Structure

```
mcp/src/
  index.ts              Modified — remove extracted code, wire new modules
  cli/
    api.ts              NEW — auth API functions (cliAuthSignup, cliAuthLogin)
    theme.ts            NEW — color palette, ANSI helpers, NO_COLOR support
    glyph.ts            NEW — intro frames + spinner frames
    spinner.ts          NEW — glyph-based spinner
    editors.ts          NEW — editor detection + config writing
    welcome.ts          NEW — animated welcome screen
    wizard.ts           NEW — full 7-step wizard orchestration
```

## Tasks

### Task 1: Create cli/theme.ts
Create color palette with Medium Roast coffee theme and ANSI helpers.

### Task 2: Create cli/api.ts
Extract auth API functions from index.ts.

### Task 3: Create cli/glyph.ts
Define intro animation frames and spinner frames using theme colors.

### Task 4: Create cli/spinner.ts
Custom glyph-based spinner with clack-compatible start/stop/update API.

### Task 5: Create cli/editors.ts
Extract editor detection and config writing from index.ts. Add EditorInfo interface, detectEditors(), writeEditorConfigs(), writeAllDetected().

### Task 6: Create cli/welcome.ts
Animated welcome screen with glyph intro and title/tagline reveal.

### Task 7: Create cli/wizard.ts
Full 7-step wizard: welcome → auth select → credentials → loading → editor picker → confirm → summary.

### Task 8: Update index.ts
Remove extracted code, add imports from cli/, rewrite standalone commands and help text to use new modules. Keep MCP server code unchanged.

### Task 9: Build, lint, typecheck, verify
Run `npm run build -w mcp`, `npm run lint`, `npm run typecheck` and fix any issues.

### Task 10: Commit and push
Single commit with all changes. Push to main.
