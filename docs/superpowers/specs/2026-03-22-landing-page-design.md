# Landing Page Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

A public landing page at `/` for synapsesync.app that explains what Synapse is, showcases features with animated illustrations, and funnels visitors toward signup. Unauthenticated users see the landing page; authenticated users are redirected to the app.

## Design Decisions

- **Lives in existing SvelteKit app** — new route at `/(public)/+page.svelte`, separate from the `/(app)` route group
- **Education-first** — most visitors won't know what a "context layer" is, so explanation comes before signup CTAs
- **Indie/builder tone** — warm, personal, avoids jargon
- **Animated mockups** — no real screenshots; stylized illustrations that don't break when UI changes
- **Minimal pricing mention** — "Free to start, Pro at $5.99/mo" line, no full comparison table
- **Opennote-inspired interactions** — sticky scroll cards, tilted feature cards, viewport-triggered animations

## Color Palette — "Tiramisu"

| Name | Hex | CSS Variable | Use |
|------|-----|-------------|-----|
| Burgundy | `#561C24` | `--color-burgundy` | Nav/footer backgrounds, primary dark |
| Warm Brown | `#6D2932` | `--color-brown` | Accents, hover states, buttons |
| Muted Tan | `#C7B7A3` | `--color-tan` | Secondary text, borders, muted elements |
| Cream | `#E8D8C4` | `--color-cream` | Page background, card surfaces |
| White | `#FFFDF8` | `--color-white` | Primary text on dark, card highlights |

## Typography

- **Primary font**: Lato (Google Fonts) — all headings and body text
- **Weights**: 300 (light, subheadlines), 400 (regular, body), 700 (bold, headings), 900 (black, hero headline)
- **Sizes**: Hero headline 4-5rem, section headings 2.5rem, body 1.125rem

## Page Sections

### 1. Navigation

Fixed top nav, burgundy background with cream text.
- Left: Logo + "Synapse" wordmark
- Center: Links — Features, How It Works
- Right: "Get Started Free" button (warm brown background, cream text, rounded)
- Mobile: hamburger menu

### 2. Hero

Full-viewport height, cream background.
- **Headline**: "Your AI tools finally remember" (Lato Black, 4-5rem)
- **Subheadline**: "Synapse is a shared context layer that gives Claude, ChatGPT, Cursor, and every AI tool persistent memory across sessions." (Lato Light, 1.25rem, tan color)
- **CTA**: "Get Started Free" button (warm brown, large)
- **Visual**: Animated illustration showing context flowing between tool icons (Claude, ChatGPT, Cursor) through a central Synapse node. CSS/SVG animation — no video needed.

### 3. Problem Statement

Burgundy background, cream text. Short and punchy.
- **Headline**: "Your AI tools forget everything"
- **3 pain points** as simple lines:
  - "Every session starts from scratch"
  - "Decisions made yesterday are lost today"
  - "Switching tools means losing context"
- Subtle fade-in on scroll

### 4. How It Works

Cream background. Three-step horizontal flow (stacks vertically on mobile).

1. **Connect** — "Add Synapse to any AI tool in one line" — illustration of MCP config
2. **Work** — "Your AI tools save and share context automatically" — illustration of multiple tools reading/writing to a shared workspace
3. **Share** — "Invite your team, export your knowledge" — illustration of shared project with multiple users

Each step has a numbered circle, title, description, and animated illustration. Steps animate in sequentially on scroll.

### 5. Features — Sticky Scroll Cards

Opennote-inspired: as the user scrolls, feature cards stick and rotate into view.

**Card 1: "Context that persists"**
- Illustration: A timeline showing sessions connected by a thread of context
- "Decisions, architecture notes, and session summaries — saved automatically, loaded on demand."

**Card 2: "Every tool, one brain"**
- Illustration: Claude, ChatGPT, Cursor icons connected to a central hub
- "Switch between AI tools without losing a beat. They all share the same context."

**Card 3: "Version history"**
- Illustration: A file with a timeline of versions branching off
- "Track every change. Restore any version. Know what changed and why."

**Card 4: "Team sharing"**
- Illustration: Two avatars with a shared folder between them
- "Share projects with your team. Everyone's AI tools stay in sync."

**Card 5: "Export & import"**
- Illustration: A zip file with markdown files spilling out
- "Your data is yours. Export as markdown, import anytime."

Cards: cream background, warm brown border, slight tilt rotation (alternating -3deg / +3deg), drop shadow. Sticky positioning so they overlap as you scroll.

### 6. Built For Builders

Tan background section. Short testimonial-style use cases:
- "I use Synapse to keep Claude and Cursor in sync across my monorepo" — indie dev
- "My team shares architecture decisions through Synapse — everyone's AI knows the context" — startup CTO
- "I exported 6 months of AI conversations as a knowledge base" — researcher

(These can be placeholder quotes for now, replaced with real ones later.)

### 7. CTA Section

Burgundy background, centered.
- **Headline**: "Start building with context"
- **Subline**: "Free to start. Pro at $5.99/mo for teams and power users."
- **Button**: "Get Started Free" (cream background, burgundy text)

### 8. Footer

Dark burgundy background, cream text.
- **Columns**: Product (Features, Pricing, Docs), Company (Blog, About), Legal (Privacy, Terms)
- **Bottom row**: "© 2026 Synapse. All rights reserved." + social links

## Animations

All animations use CSS only (no JS animation libraries) for performance:
- **Scroll-triggered fade-ins**: `IntersectionObserver` to add `.visible` class, CSS transitions handle the rest
- **Sticky feature cards**: `position: sticky` with `top` offset, CSS transforms for rotation
- **Hero illustration**: CSS keyframe animation (floating/pulsing context nodes)
- **Hover effects**: Buttons scale slightly, cards lift on hover

## Technical Implementation

### Route structure

The existing `(app)/+page.svelte` handles `/` for authenticated users (auto-redirect to first project). A `(public)/+page.svelte` would conflict since both route groups match `/`.

**Solution**: Add a root-level `+page.server.ts` that conditionally redirects:
- Authenticated → redirect to `/(app)` flow (which auto-redirects to first project)
- Unauthenticated → render the landing page

```
frontend/src/routes/
├── +page.server.ts         # Root: auth check, redirect authenticated users
├── +page.svelte            # Landing page (for unauthenticated users)
├── (public)/               # New route group — landing page layout
│   └── +layout.svelte      # Landing layout (no app shell, own nav/footer)
├── (app)/                  # Existing — requires auth
│   ├── +page.server.ts     # Existing: redirect to first project (rename to dashboard/)
│   └── ...
```

Actually, the simplest approach: **move the existing `(app)/+page.svelte` and `+page.server.ts` to `(app)/dashboard/`**, freeing up `/` for the landing page. Then the landing page lives at the root route `/` inside a `(public)` group:

```
frontend/src/routes/
├── (public)/               # Landing page layout (no app shell)
│   ├── +layout.svelte      # Own nav/footer, Lato font, tiramisu palette
│   ├── +page.svelte        # Landing page
│   └── +page.server.ts     # If authenticated, redirect to /dashboard
├── (app)/                  # Existing — requires auth
│   ├── dashboard/          # Moved from (app)/+page — auto-redirect to first project
│   │   └── +page.server.ts
│   └── projects/[name]/    # Existing
│       └── ...
```

The `(app)/+layout.server.ts` auth guard redirects unauthenticated users to `/login`. The `(public)/+page.server.ts` redirects authenticated users to `/dashboard`. No ambiguity.

### Landing page font scoping

The landing page layout (`(public)/+layout.svelte`) wraps everything in a container with `font-family: 'Lato', sans-serif` to override the app's global font. The tiramisu-specific CSS variables (like `--color-burgundy`, `--color-brown`) are scoped to this layout, not polluting `app.css`.

### Components

New components under `frontend/src/lib/components/landing/`:
- `LandingNav.svelte` — fixed nav
- `Hero.svelte` — hero section
- `ProblemSection.svelte` — pain points
- `HowItWorks.svelte` — 3-step flow
- `FeatureCards.svelte` — sticky scroll cards
- `BuiltForBuilders.svelte` — testimonials
- `CtaSection.svelte` — final CTA
- `LandingFooter.svelte` — footer
- `ScrollReveal.svelte` — reusable wrapper that adds fade-in on scroll via IntersectionObserver

### Google Fonts

Add Lato via `<link>` in `app.html` or the landing layout's `<svelte:head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet">
```

### No new dependencies

All animations are CSS-only. ScrollReveal uses native IntersectionObserver. No Framer Motion, GSAP, or Lottie.

## Files touched

| File | Change |
|------|--------|
| `frontend/src/routes/(public)/+layout.svelte` | New: landing page layout (no app shell) |
| `frontend/src/routes/(public)/+page.svelte` | New: landing page |
| `frontend/src/routes/(public)/+page.server.ts` | New: auth redirect check |
| `frontend/src/lib/components/landing/LandingNav.svelte` | New |
| `frontend/src/lib/components/landing/Hero.svelte` | New |
| `frontend/src/lib/components/landing/ProblemSection.svelte` | New |
| `frontend/src/lib/components/landing/HowItWorks.svelte` | New |
| `frontend/src/lib/components/landing/FeatureCards.svelte` | New |
| `frontend/src/lib/components/landing/BuiltForBuilders.svelte` | New |
| `frontend/src/lib/components/landing/CtaSection.svelte` | New |
| `frontend/src/lib/components/landing/LandingFooter.svelte` | New |
| `frontend/src/lib/components/landing/ScrollReveal.svelte` | New: reusable scroll animation wrapper |
| `frontend/src/app.html` | Add Lato font link |
