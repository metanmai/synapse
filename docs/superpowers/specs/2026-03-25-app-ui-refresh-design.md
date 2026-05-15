# App UI Refresh — Landing Page Parity

**Date**: 2026-03-25
**Status**: Approved
**Author**: Tanmai + Claude

## Problem

The landing page uses a premium design language — backdrop blur, gradient accents, floating orbs, generous spacing, elevated shadows, and pill buttons. The app pages (dashboard, workspace, account, auth) use the same color palette but apply it flat and cramped: solid fills, 1px borders, minimal shadows, 11-13px fonts, tight padding. Users experience a jarring quality drop when they sign in.

## Goal

Bring the landing page's visual language into every app surface. The app should feel like the same product as the landing page — glass-morphism, warm cream, depth everywhere.

## Design System Changes

### Color Palette (unchanged)
The CSS variables remain the same. The difference is how they're applied:
- `--color-bg`: #e8d8c4 (cream base)
- `--color-bg-raised`: #fffdf8 (card surfaces — now semi-transparent)
- `--color-bg-muted`: #f5ede0
- `--color-text`: #561c24 (burgundy)
- `--color-text-muted`: #8a7565
- `--color-border`: #c7b7a3
- `--color-accent`: #561c24
- `--color-pink`: #6d2932
- `--color-pink-dark`: #561c24

### New CSS Tokens (add to app.css)
```
--shadow-sm: 0 2px 8px rgba(86, 28, 36, 0.06);
--shadow-md: 0 8px 32px rgba(86, 28, 36, 0.08);
--shadow-lg: 0 12px 40px rgba(86, 28, 36, 0.12);
--shadow-xl: 0 20px 60px rgba(86, 28, 36, 0.12);
--blur-sm: blur(12px);
--blur-md: blur(20px);
--radius-sm: 12px;
--radius-md: 16px;
--radius-pill: 9999px;
--transition-base: all 150ms ease;
```

## Section 1: Global Foundation

### Background
The app shell gets floating gradient orbs behind all content via a `::before` pseudo-element:
- Two blurred circles: `rgba(86, 28, 36, 0.05)` and `rgba(199, 183, 163, 0.08)`
- Fixed position, `pointer-events: none`, z-index behind content
- Matching the landing page's `float-orb` animation (20s infinite, subtle drift)

### Card/Panel Pattern
Every raised surface (cards, panels, sidebars, modals) uses:
```css
background: rgba(255, 253, 248, 0.7);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid var(--color-border);
border-radius: 16px;
box-shadow: 0 8px 32px rgba(86, 28, 36, 0.08);
```

### Typography
- Base body: 15px (from 13-14px)
- File tree: 12px (from 11px)
- Headlines: font-weight 700-900, letter-spacing -0.02em
- Line-height: 1.6-1.7 for body text

### Buttons
- **Primary**: gradient background (`--color-pink-dark` → `--color-pink`), `border-radius: 9999px`, `padding: 12px 28px`, hover: `scale(1.03)` + `box-shadow: 0 8px 32px rgba(109, 41, 50, 0.35)`
- **Secondary**: `rgba(86, 28, 36, 0.06)` background with backdrop blur, pill shape, `border: 1px solid var(--color-pink)`, hover: `rgba(86, 28, 36, 0.1)`

### Transitions
All interactive elements: `transition: all 150ms ease`. Hover states include subtle scale transforms (1.02-1.05) and shadow elevation.

## Section 2: Header

- Background: `rgba(86, 28, 36, 0.85)` with `backdrop-filter: blur(20px)` (semi-transparent, not solid)
- Bottom shadow: `0 4px 24px rgba(86, 28, 36, 0.15)`
- Padding: `py-4 px-6` (from `py-3 px-6`)
- Logo/title: 18px, font-weight 800
- Nav links: 14px, white with `opacity: 0.8` default, `opacity: 1` on hover

## Section 3: Sidebar

- Background: `rgba(255, 253, 248, 0.5)` with `backdrop-filter: blur(16px)`
- Right border: replaced with shadow `4px 0 24px rgba(86, 28, 36, 0.04)`
- Nav items:
  - Font: 14px, weight 500
  - Padding: `py-2.5 px-3`
  - Border-radius: 12px
  - Hover: `scale(1.02)`, background `rgba(86, 28, 36, 0.06)`, subtle shadow
  - Active: `rgba(86, 28, 36, 0.12)` fill, 3px rounded left accent bar in burgundy (not flat burgundy block)

## Section 4: Workspace

### File Tree Panel
- Card treatment (blur, shadow, 16px radius)
- Font: 12px, line-height 1.6
- Item padding: `py-1.5 px-2`
- Hover: background `rgba(86, 28, 36, 0.05)` fade-in, 150ms
- Selected: warm cream highlight `rgba(86, 28, 36, 0.08)` with 3px left accent bar
- Icons: 14px (from 12px)

### Editor/Viewer Panel
- Card treatment with blur/shadow
- Content padding: 2rem
- Body text: 15px, line-height 1.7
- Code blocks: `rgba(86, 28, 36, 0.04)` background, 14px monospace, 16px border-radius
- Headings: weight 700, letter-spacing -0.01em

### Resizable Divider
- 4px handle area (from 1px)
- Visible on hover as a subtle burgundy gradient pill
- Cursor: `col-resize`

### Search Panel
- Input: py-3 px-4, 12px border-radius, subtle inner shadow on focus
- Results: card items with hover elevation

## Section 5: Dashboard

### Project Cards
- 16px radius, 2rem padding
- Shadow: `0 8px 32px rgba(86, 28, 36, 0.08)`
- Project name: 18px, weight 700
- Metadata: 13px, muted color
- Hover: `translateY(-2px)`, shadow deepens to `0 12px 40px rgba(86, 28, 36, 0.12)`
- Transition: `all 150ms ease`

### Create Project Card
- Dashed 2px border, same dimensions as project cards
- Hover: fills with subtle cream `rgba(255, 253, 248, 0.5)`

## Section 6: Account Page

- All cards (billing, API keys, connected accounts): same card treatment as Section 1
- Section headers inside cards: 16px, weight 700, letter-spacing -0.01em
- API key rows: alternating `rgba(86, 28, 36, 0.02)` shading
- Buttons: gradient pill style matching landing CTAs

## Section 7: Auth Pages (login, signup, forgot-password, reset-password)

- Card: add backdrop blur + shadow (matching Section 1 card pattern)
- Inputs: `py-3 px-4`, 12px border-radius, subtle inner shadow (`inset 0 2px 4px rgba(86, 28, 36, 0.06)`) on focus
- Submit buttons: gradient pill style
- Background: single floating orb for visual continuity with landing page
- "Back to login" links: pill style with hover background

## Files to Modify

| File | What Changes |
|------|-------------|
| `frontend/src/app.css` | Add new CSS tokens (shadows, blur, radius, transition), floating orb keyframes, glass card utility |
| `frontend/src/lib/components/layout/AppShell.svelte` | Add floating orb `::before` background |
| `frontend/src/lib/components/layout/Sidebar.svelte` | Glassmorphism background, nav item restyle |
| `frontend/src/routes/(app)/+layout.svelte` | Header restyle (blur, shadow, sizing) |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Workspace panels: card treatment, spacing |
| `frontend/src/lib/components/workspace/FolderTree.svelte` | Font size, spacing, hover/active states |
| `frontend/src/lib/components/workspace/EntryViewer.svelte` | Card treatment, typography, code blocks |
| `frontend/src/lib/components/workspace/EntryEditor.svelte` | Card treatment, input styling |
| `frontend/src/lib/components/workspace/SearchPanel.svelte` | Input restyle, result card hover |
| `frontend/src/lib/components/workspace/PathActivityPanel.svelte` | Card treatment |
| `frontend/src/lib/components/workspace/PathSharePanel.svelte` | Card treatment |
| `frontend/src/routes/(app)/account/+page.svelte` | Section spacing |
| `frontend/src/lib/components/account/BillingCard.svelte` | Card + button restyle |
| `frontend/src/lib/components/account/ApiKeysCard.svelte` | Card + row shading + button restyle |
| `frontend/src/lib/components/account/ConnectedAccounts.svelte` | Card restyle |
| `frontend/src/routes/login/+page.svelte` | Card blur, input/button restyle, floating orb |
| `frontend/src/routes/signup/+page.svelte` | Same as login |
| `frontend/src/routes/forgot-password/+page.svelte` | Same as login |
| `frontend/src/routes/reset-password/+page.svelte` | Same as login |
| `frontend/src/routes/(app)/+error.svelte` | Card treatment |
| `frontend/src/routes/+error.svelte` | Card treatment |

## Out of Scope

- Landing page (already has the target design)
- Backend API (no changes)
- Data model / functionality (purely visual)
- Mobile responsive adjustments (follow-up)
