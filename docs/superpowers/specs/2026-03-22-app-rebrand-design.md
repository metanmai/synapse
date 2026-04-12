# App Rebrand Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Rebrand the Synapse web app from its current light warm theme (Armata font, periwinkle/pink accents) to the "Tiramisu" palette (burgundy, warm brown, tan, cream) with Lato font. The landing page uses this palette; the app should match for a consistent experience.

## Current State

The app uses CSS custom properties defined in `frontend/src/app.css`. Current font is **Armata** (loaded via Google Fonts in `app.html`). Current theme is light with warm undertones — not dark.

```css
:root {
  --color-bg: #faf8f5;
  --color-bg-raised: #ffffff;
  --color-bg-muted: #fce8ee;
  --color-border: #ebe5dd;
  --color-text: #3d3327;
  --color-text-muted: #8a7e72;
  --color-accent: #667BC6;
  --color-accent-hover: #5568b0;
  --color-link: #DA7297;
  --color-pink: #FFB4C2;
  --color-pink-dark: #DA7297;
  --color-success: #4ade80;
  --color-danger: #ef4444;
}
```

## New Palette Mapping

| CSS Variable | Current Value | New Value | Notes |
|-------------|--------------|-----------|-------|
| `--color-bg` | `#faf8f5` (warm off-white) | `#E8D8C4` (cream) | Main background |
| `--color-bg-raised` | `#ffffff` (white) | `#FFFDF8` (warm white) | Cards, panels |
| `--color-bg-muted` | `#fce8ee` (light pink) | `#F5EDE0` (light cream) | Code blocks, inputs |
| `--color-border` | `#ebe5dd` (warm gray) | `#C7B7A3` (tan) | Borders, dividers |
| `--color-text` | `#3d3327` (dark brown) | `#561C24` (burgundy) | Primary text |
| `--color-text-muted` | `#8a7e72` (warm gray) | `#8A7565` (muted brown) | Secondary text — slightly darker than tan for readability |
| `--color-accent` | `#667BC6` (periwinkle) | `#561C24` (burgundy) | Headings, emphasis |
| `--color-accent-hover` | `#5568b0` (dark periwinkle) | `#3D1018` (dark burgundy) | Hover state for accent |
| `--color-link` | `#DA7297` (pink) | `#6D2932` (warm brown) | Links |
| `--color-pink` | `#FFB4C2` (light pink) | `#6D2932` (warm brown) | Primary action color, badges |
| `--color-pink-dark` | `#DA7297` (medium pink) | `#561C24` (burgundy) | Hover/active state |
| `--color-success` | `#4ade80` (green) | `#2D5016` (olive green) | Success states |
| `--color-danger` | `#ef4444` (red) | `#8B0000` (dark red) | Errors, destructive |

**New variables to add:**

| CSS Variable | Value | Notes |
|-------------|-------|-------|
| `--color-success-bg` | `#E8F0D8` (light olive) | Success backgrounds — currently only defined as inline fallback in components |

## Typography

Replace Armata with Lato. In `app.html`, swap the Google Fonts link:

```html
<!-- Remove -->
<link href="https://fonts.googleapis.com/css2?family=Armata&display=swap" rel="stylesheet">

<!-- Add -->
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
```

In `app.css`, update the body font:

```css
body {
  font-family: 'Lato', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
}
```

## Component Audit

Components using CSS variables rebrand automatically. The following need manual attention:

**Hardcoded `color: white` on accent backgrounds** — these elements use `color: white` on `--color-pink` or `--color-accent` backgrounds. With the new dark burgundy/brown values, white text will still have good contrast. **No change needed** — just confirming this is intentional.

Affected components:
- `BillingCard.svelte` — Pro badge, upgrade button
- `ApiKeysCard.svelte` — Create Key button
- `Sidebar.svelte` — active nav item
- `AppShell.svelte` — header uses `rgba(255,255,255,0.75)` on accent background
- `FolderTree.svelte` — context menu items
- `EntryViewer.svelte`, `EntryEditor.svelte` — tag badges
- `ShareLinkManager.svelte`, `MemberList.svelte` — role badges

**Inline fallback values to remove** — these components have `var(--color-success-bg, #ecfdf5)` with old fallback values. Once `--color-success-bg` is added to `:root`, remove the fallbacks:

- `BillingCard.svelte` — success toast
- `frontend/src/routes/(app)/projects/[name]/+page.svelte` — import result notification

## Favicon and Meta

Update `<meta name="theme-color">` in `app.html` to `#561C24` (burgundy).

## What Doesn't Change

- Component structure — no HTML changes
- Layout — no spacing or positioning changes
- Functionality — no behavior changes
- Just colors and fonts

## Implementation Approach

1. Swap Armata → Lato in `app.html`
2. Update all CSS variables in `app.css` `:root` block
3. Add `--color-success-bg` to `:root`
4. Grep for hardcoded hex codes in `.svelte` files — audit and fix any that should use variables
5. Remove inline fallback values where CSS variable is now defined
6. Update meta theme-color
7. Visual QA

## Files touched

| File | Change |
|------|--------|
| `frontend/src/app.css` | Update all CSS custom property values, add `--color-success-bg` |
| `frontend/src/app.html` | Swap Armata → Lato font link, update meta theme-color |
| `frontend/src/lib/components/account/BillingCard.svelte` | Remove inline `--color-success-bg` fallback |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Remove inline `--color-success-bg` fallback |
| Any components with hardcoded hex colors | Replace with CSS variable references |
