# App Rebrand Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Rebrand the Synapse web app from its current dark theme with pink accents to the "Tiramisu" palette (burgundy, warm brown, tan, cream) with Lato font. The landing page uses this palette; the app should match for a consistent experience.

## Current State

The app uses CSS custom properties defined in `frontend/src/app.css` (or equivalent). Components reference variables like `--color-bg`, `--color-bg-raised`, `--color-accent`, `--color-pink`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-link`, `--color-danger`, etc.

Current theme: dark backgrounds, white/gray text, pink accent color (`--color-pink`, `--color-pink-dark`).

## New Palette Mapping

| CSS Variable | Old Value (approx) | New Value | Notes |
|-------------|-------------------|-----------|-------|
| `--color-bg` | `#1a1a2e` (dark navy) | `#E8D8C4` (cream) | Main background |
| `--color-bg-raised` | `#25253e` (slightly lighter dark) | `#FFFDF8` (warm white) | Cards, panels |
| `--color-bg-muted` | `#2a2a4a` (muted dark) | `#F5EDE0` (light cream) | Code blocks, inputs |
| `--color-text` | `#e0e0e0` (light gray) | `#561C24` (burgundy) | Primary text |
| `--color-text-muted` | `#888` (gray) | `#C7B7A3` (tan) | Secondary text |
| `--color-accent` | `#e0e0e0` (white) | `#561C24` (burgundy) | Headings, emphasis |
| `--color-pink` | `#ff6b8a` (pink) | `#6D2932` (warm brown) | Primary action color |
| `--color-pink-dark` | `#cc5570` (dark pink) | `#561C24` (burgundy) | Hover/active state |
| `--color-border` | `#333` (dark gray) | `#C7B7A3` (tan) | Borders, dividers |
| `--color-link` | `#88ccff` (light blue) | `#6D2932` (warm brown) | Links |
| `--color-danger` | `#ff4444` (red) | `#8B0000` (dark red) | Errors, destructive |
| `--color-success` | `#065f46` (green) | `#2D5016` (olive green) | Success states |
| `--color-success-bg` | `#ecfdf5` (light green) | `#E8F0D8` (light olive) | Success backgrounds |

## Typography

Replace the current font stack with Lato:

```css
font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif;
```

The Lato font link is already added in the landing page spec (in `app.html`), so it's available app-wide.

## What Changes

### CSS custom properties file

Update the root `:root` block (or the existing theme definition) with the new values. Since all components use CSS variables, this single change rebrands the entire app.

### Component-specific adjustments

Some components have inline styles or hardcoded colors that bypass the CSS variables. These need to be audited and updated:

- **BillingCard.svelte**: Uses `var(--color-pink)` for the Pro badge and upgrade button — this maps automatically.
- **ApiKeysCard.svelte**: Uses `var(--color-pink)` for Create Key button — maps automatically.
- **Sidebar.svelte**: Uses `var(--color-pink-dark)` for active nav item — maps automatically.
- **Login/Signup pages**: May have hardcoded styles that need checking.

Most components should rebrand automatically through the CSS variable update. A manual audit identifies any that don't.

### Scrollbar and selection colors

Update `::selection` and scrollbar styles to match the new palette.

### Favicon and meta

Update the favicon/meta theme color to burgundy (`#561C24`).

## What Doesn't Change

- Component structure — no HTML changes
- Layout — no spacing or positioning changes
- Functionality — no behavior changes
- Just colors and fonts

## Implementation Approach

1. Update CSS variables in the global stylesheet
2. Add Lato font import (shared with landing page)
3. Audit all components for hardcoded colors — grep for hex codes and `rgb(` in `.svelte` files
4. Update any hardcoded values to use CSS variables
5. Update favicon/meta theme-color
6. Visual QA

## Files touched

| File | Change |
|------|--------|
| `frontend/src/app.css` (or global styles) | Update all CSS custom property values |
| `frontend/src/app.html` | Add Lato font link (if not already from landing page), update meta theme-color |
| Various `.svelte` components | Fix any hardcoded colors that don't use CSS variables |
