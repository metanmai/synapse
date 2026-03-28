# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public landing page at `/` for synapsesync.app with animated sections, tiramisu palette, and Opennote-inspired interactions.

**Architecture:** New `(public)` route group with its own layout. Existing `(app)/+page` moves to `(app)/dashboard/`. CSS-only animations with IntersectionObserver for scroll triggers.

**Tech Stack:** SvelteKit 5, CSS animations, Google Fonts (Lato)

**Spec:** `docs/superpowers/specs/2026-03-22-landing-page-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `frontend/src/routes/(public)/+layout.svelte` | New: landing page layout with scoped tiramisu palette, Lato font, no app shell |
| `frontend/src/routes/(public)/+page.svelte` | New: landing page assembling all sections |
| `frontend/src/routes/(public)/+page.server.ts` | New: redirect authenticated users to `/dashboard` |
| `frontend/src/routes/(app)/dashboard/+page.server.ts` | Moved from `(app)/+page.server.ts` — auto-redirect to first project |
| `frontend/src/routes/(app)/+page.svelte` | Delete (replaced by dashboard route) |
| `frontend/src/routes/(app)/+page.server.ts` | Delete (moved to dashboard/) |
| `frontend/src/lib/components/landing/ScrollReveal.svelte` | New: reusable IntersectionObserver wrapper |
| `frontend/src/lib/components/landing/LandingNav.svelte` | New: fixed nav with tiramisu palette |
| `frontend/src/lib/components/landing/Hero.svelte` | New: hero section with animated illustration |
| `frontend/src/lib/components/landing/ProblemSection.svelte` | New: pain points section |
| `frontend/src/lib/components/landing/HowItWorks.svelte` | New: 3-step horizontal flow |
| `frontend/src/lib/components/landing/FeatureCards.svelte` | New: sticky scroll tilted cards |
| `frontend/src/lib/components/landing/BuiltForBuilders.svelte` | New: testimonial use cases |
| `frontend/src/lib/components/landing/CtaSection.svelte` | New: final CTA section |
| `frontend/src/lib/components/landing/LandingFooter.svelte` | New: footer with link columns |
| `frontend/src/app.html` | Modify: add Lato font link |

---

## Current Routing Context

The existing flow:
- `hooks.server.ts` — resolves `locals.user` and `locals.token` for every request (does NOT redirect)
- `(app)/+layout.server.ts` — auth guard: redirects unauthenticated users to `/login`
- `(app)/+page.server.ts` — redirects to first project (or creates "My Workspace")
- `login/+page.server.ts` — redirects authenticated users to `/` (will become `/dashboard`)
- `signup/+page.server.ts` — redirects authenticated users to `/` (will become `/dashboard`)
- `auth/callback/+server.ts` — redirects to `redirect` param or `/` (will become `/dashboard`)
- `logout/+page.server.ts` — redirects to `/login`

After this work:
- `/` renders the landing page for unauthenticated users, redirects to `/dashboard` for authenticated users
- `/dashboard` replaces the old `(app)/+page` — redirects to first project
- Login/signup/callback redirect targets change from `/` to `/dashboard`

---

### Task 1: Route Restructuring

**Files:**
- Move: `frontend/src/routes/(app)/+page.server.ts` -> `frontend/src/routes/(app)/dashboard/+page.server.ts`
- Delete: `frontend/src/routes/(app)/+page.svelte`
- Create: `frontend/src/routes/(public)/+page.server.ts`
- Modify: `frontend/src/routes/login/+page.server.ts`
- Modify: `frontend/src/routes/signup/+page.server.ts`
- Modify: `frontend/src/routes/auth/callback/+server.ts`

- [ ] **Step 1: Create the `(app)/dashboard/` directory and move the page server load**

```bash
mkdir -p /Users/Tanmai.N/Documents/synapse/frontend/src/routes/\(app\)/dashboard
```

Create `frontend/src/routes/(app)/dashboard/+page.server.ts` with the same content as the current `(app)/+page.server.ts`:

```ts
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  const projects = await api.listProjects();

  if (projects.length > 0) {
    const first = projects[0];
    const slug = first.role === "owner" ? first.name : `${first.owner_email}~${first.name}`;
    redirect(303, `/projects/${encodeURIComponent(slug)}`);
  }

  // Auto-create a default project for the user
  await api.createProject("My Workspace");
  redirect(303, `/projects/${encodeURIComponent("My Workspace")}`);
};
```

- [ ] **Step 2: Delete the old `(app)/+page.svelte` and `(app)/+page.server.ts`**

```bash
rm /Users/Tanmai.N/Documents/synapse/frontend/src/routes/\(app\)/+page.svelte
rm /Users/Tanmai.N/Documents/synapse/frontend/src/routes/\(app\)/+page.server.ts
```

- [ ] **Step 3: Create `(public)/+page.server.ts` to redirect authenticated users**

```bash
mkdir -p /Users/Tanmai.N/Documents/synapse/frontend/src/routes/\(public\)
```

Create `frontend/src/routes/(public)/+page.server.ts`:

```ts
import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) {
    redirect(303, "/dashboard");
  }
};
```

- [ ] **Step 4: Update login redirect target from `/` to `/dashboard`**

In `frontend/src/routes/login/+page.server.ts`, change:

```ts
// Old:
if (locals.user) redirect(303, "/");
```

to:

```ts
// New:
if (locals.user) redirect(303, "/dashboard");
```

And change the default redirect in the `login` action:

```ts
// Old:
const redirectTo = url.searchParams.get("redirect") || "/";
```

to:

```ts
// New:
const redirectTo = url.searchParams.get("redirect") || "/dashboard";
```

- [ ] **Step 5: Update signup redirect target from `/` to `/dashboard`**

In `frontend/src/routes/signup/+page.server.ts`, change:

```ts
// Old:
if (locals.user) redirect(303, "/");
```

to:

```ts
// New:
if (locals.user) redirect(303, "/dashboard");
```

- [ ] **Step 6: Update auth callback default redirect from `/` to `/dashboard`**

In `frontend/src/routes/auth/callback/+server.ts`, change:

```ts
// Old:
const redirectTo = url.searchParams.get("redirect") || "/";
```

to:

```ts
// New:
const redirectTo = url.searchParams.get("redirect") || "/dashboard";
```

- [ ] **Step 7: Verify the route restructure**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check --threshold error 2>&1 | tail -20
```

Confirm no type errors. The `(app)/+layout.server.ts` auth guard still protects `/dashboard` since it's inside `(app)/`.

- [ ] **Step 8: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/routes/\(app\)/dashboard/+page.server.ts frontend/src/routes/\(public\)/+page.server.ts frontend/src/routes/login/+page.server.ts frontend/src/routes/signup/+page.server.ts frontend/src/routes/auth/callback/+server.ts frontend/src/routes/\(app\)/+page.svelte frontend/src/routes/\(app\)/+page.server.ts && git commit -m "refactor: move (app)/+page to (app)/dashboard/, create (public) route group" && git push
```

---

### Task 2: Landing Layout

**Files:**
- Create: `frontend/src/routes/(public)/+layout.svelte`
- Modify: `frontend/src/app.html`

- [ ] **Step 1: Add Lato font to `app.html`**

In `frontend/src/app.html`, add the Lato font link after the existing Armata font link (line 8):

```html
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet" />
```

The full `<head>` should look like:

```html
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Armata&display=swap" rel="stylesheet" />
    <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>Synapse</title>
    %sveltekit.head%
  </head>
```

- [ ] **Step 2: Create `(public)/+layout.svelte` with tiramisu palette CSS variables**

Create `frontend/src/routes/(public)/+layout.svelte`:

```svelte
<script>
  let { children } = $props();
</script>

<svelte:head>
  <title>Synapse — Your AI tools finally remember</title>
  <meta name="description" content="Synapse is a shared context layer that gives Claude, ChatGPT, Cursor, and every AI tool persistent memory across sessions." />
</svelte:head>

<div class="landing">
  {@render children()}
</div>

<style>
  .landing {
    /* Tiramisu palette — scoped to the landing page */
    --color-burgundy: #561C24;
    --color-brown: #6D2932;
    --color-tan: #C7B7A3;
    --color-cream: #E8D8C4;
    --color-white: #FFFDF8;

    font-family: 'Lato', sans-serif;
    color: var(--color-burgundy);
    background-color: var(--color-cream);
    overflow-x: hidden;
  }

  /* Override Tailwind/global body font within this layout */
  :global(.landing *) {
    font-family: 'Lato', sans-serif;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/app.html frontend/src/routes/\(public\)/+layout.svelte && git commit -m "feat: add landing page layout with tiramisu palette and Lato font" && git push
```

---

### Task 3: ScrollReveal Utility Component

**Files:**
- Create: `frontend/src/lib/components/landing/ScrollReveal.svelte`

- [ ] **Step 1: Create the `landing/` component directory**

```bash
mkdir -p /Users/Tanmai.N/Documents/synapse/frontend/src/lib/components/landing
```

- [ ] **Step 2: Create `ScrollReveal.svelte`**

Create `frontend/src/lib/components/landing/ScrollReveal.svelte`:

```svelte
<script lang="ts">
  import { onMount } from "svelte";

  let {
    children,
    threshold = 0.15,
    delay = 0,
    direction = "up",
  } = $props<{
    children: import("svelte").Snippet;
    threshold?: number;
    delay?: number;
    direction?: "up" | "down" | "left" | "right" | "none";
  }>();

  let element: HTMLDivElement;
  let visible = $state(false);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          visible = true;
          observer.unobserve(element);
        }
      },
      { threshold }
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  const transforms: Record<string, string> = {
    up: "translateY(40px)",
    down: "translateY(-40px)",
    left: "translateX(40px)",
    right: "translateX(-40px)",
    none: "none",
  };
</script>

<div
  bind:this={element}
  class="scroll-reveal"
  class:visible
  style="--sr-delay: {delay}ms; --sr-transform: {transforms[direction]};"
>
  {@render children()}
</div>

<style>
  .scroll-reveal {
    opacity: 0;
    transform: var(--sr-transform, translateY(40px));
    transition: opacity 0.7s ease-out, transform 0.7s ease-out;
    transition-delay: var(--sr-delay, 0ms);
  }

  .scroll-reveal.visible {
    opacity: 1;
    transform: none;
  }
</style>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/ScrollReveal.svelte && git commit -m "feat: add ScrollReveal utility component with IntersectionObserver" && git push
```

---

### Task 4: Hero Section

**Files:**
- Create: `frontend/src/lib/components/landing/LandingNav.svelte`
- Create: `frontend/src/lib/components/landing/Hero.svelte`
- Modify: `frontend/src/routes/(public)/+page.svelte`

- [ ] **Step 1: Create `LandingNav.svelte`**

Create `frontend/src/lib/components/landing/LandingNav.svelte`:

```svelte
<script lang="ts">
  let mobileOpen = $state(false);
</script>

<nav class="landing-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="/logo.svg" alt="" class="nav-logo-img" />
      Synapse
    </a>

    <div class="nav-links">
      <a href="#features" class="nav-link">Features</a>
      <a href="#how-it-works" class="nav-link">How It Works</a>
    </div>

    <a href="/signup" class="nav-cta">Get Started Free</a>

    <button class="nav-hamburger" onclick={() => mobileOpen = !mobileOpen} aria-label="Toggle menu">
      <span class="hamburger-bar" class:open={mobileOpen}></span>
      <span class="hamburger-bar" class:open={mobileOpen}></span>
      <span class="hamburger-bar" class:open={mobileOpen}></span>
    </button>
  </div>

  {#if mobileOpen}
    <div class="mobile-menu">
      <a href="#features" class="mobile-link" onclick={() => mobileOpen = false}>Features</a>
      <a href="#how-it-works" class="mobile-link" onclick={() => mobileOpen = false}>How It Works</a>
      <a href="/signup" class="mobile-cta" onclick={() => mobileOpen = false}>Get Started Free</a>
    </div>
  {/if}
</nav>

<style>
  .landing-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background-color: var(--color-burgundy);
  }

  .nav-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .nav-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-cream);
    text-decoration: none;
  }

  .nav-logo-img {
    width: 28px;
    height: 28px;
    filter: brightness(0) invert(0.9);
  }

  .nav-links {
    display: flex;
    gap: 2rem;
  }

  .nav-link {
    color: var(--color-tan);
    text-decoration: none;
    font-size: 0.9375rem;
    font-weight: 400;
    transition: color 0.2s;
  }

  .nav-link:hover {
    color: var(--color-cream);
  }

  .nav-cta {
    background-color: var(--color-brown);
    color: var(--color-cream);
    padding: 0.625rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, background-color 0.2s;
  }

  .nav-cta:hover {
    transform: scale(1.05);
    background-color: #7d3340;
  }

  .nav-hamburger {
    display: none;
    flex-direction: column;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
  }

  .hamburger-bar {
    display: block;
    width: 24px;
    height: 2px;
    background-color: var(--color-cream);
    transition: transform 0.3s, opacity 0.3s;
  }

  .hamburger-bar.open:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }

  .hamburger-bar.open:nth-child(2) {
    opacity: 0;
  }

  .hamburger-bar.open:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  .mobile-menu {
    display: none;
    flex-direction: column;
    padding: 1rem 2rem 1.5rem;
    background-color: var(--color-burgundy);
    border-top: 1px solid var(--color-brown);
  }

  .mobile-link {
    color: var(--color-tan);
    text-decoration: none;
    padding: 0.75rem 0;
    font-size: 1rem;
    border-bottom: 1px solid var(--color-brown);
  }

  .mobile-cta {
    display: inline-block;
    margin-top: 1rem;
    background-color: var(--color-brown);
    color: var(--color-cream);
    padding: 0.75rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.9375rem;
    font-weight: 700;
    text-decoration: none;
    text-align: center;
  }

  @media (max-width: 768px) {
    .nav-links,
    .nav-cta {
      display: none;
    }

    .nav-hamburger {
      display: flex;
    }

    .mobile-menu {
      display: flex;
    }
  }
</style>
```

- [ ] **Step 2: Create `Hero.svelte`**

Create `frontend/src/lib/components/landing/Hero.svelte`:

```svelte
<section class="hero">
  <div class="hero-content">
    <h1 class="hero-headline">Your AI tools finally remember</h1>
    <p class="hero-sub">
      Synapse is a shared context layer that gives Claude, ChatGPT, Cursor,
      and every AI tool persistent memory across sessions.
    </p>
    <a href="/signup" class="hero-cta">Get Started Free</a>
  </div>

  <div class="hero-visual">
    <!-- Animated context-flow illustration -->
    <div class="hub">
      <div class="hub-core">
        <img src="/logo.svg" alt="" class="hub-logo" />
      </div>
      <div class="orbit-ring"></div>
    </div>

    <div class="tool tool-1">
      <span class="tool-label">Claude</span>
    </div>
    <div class="tool tool-2">
      <span class="tool-label">ChatGPT</span>
    </div>
    <div class="tool tool-3">
      <span class="tool-label">Cursor</span>
    </div>

    <!-- Animated connection lines -->
    <svg class="connections" viewBox="0 0 400 300" fill="none">
      <line x1="200" y1="150" x2="80" y2="60" class="conn-line conn-1" />
      <line x1="200" y1="150" x2="320" y2="60" class="conn-line conn-2" />
      <line x1="200" y1="150" x2="200" y2="270" class="conn-line conn-3" />
    </svg>
  </div>
</section>

<style>
  .hero {
    min-height: 100vh;
    padding-top: 64px; /* nav height */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4rem;
    max-width: 1200px;
    margin: 0 auto;
    padding-left: 2rem;
    padding-right: 2rem;
  }

  .hero-content {
    flex: 1;
    max-width: 560px;
  }

  .hero-headline {
    font-size: clamp(2.5rem, 5vw, 4.5rem);
    font-weight: 900;
    line-height: 1.1;
    color: var(--color-burgundy);
    margin: 0 0 1.25rem;
  }

  .hero-sub {
    font-size: 1.25rem;
    font-weight: 300;
    line-height: 1.6;
    color: var(--color-tan);
    margin: 0 0 2rem;
  }

  .hero-cta {
    display: inline-block;
    background-color: var(--color-brown);
    color: var(--color-cream);
    padding: 1rem 2.5rem;
    border-radius: 9999px;
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, background-color 0.2s;
  }

  .hero-cta:hover {
    transform: scale(1.05);
    background-color: #7d3340;
  }

  .hero-visual {
    flex: 1;
    max-width: 400px;
    height: 300px;
    position: relative;
  }

  /* Central hub */
  .hub {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .hub-core {
    width: 64px;
    height: 64px;
    background-color: var(--color-burgundy);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pulse 3s ease-in-out infinite;
    position: relative;
    z-index: 2;
  }

  .hub-logo {
    width: 32px;
    height: 32px;
    filter: brightness(0) invert(0.9);
  }

  .orbit-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100px;
    height: 100px;
    transform: translate(-50%, -50%);
    border: 2px solid var(--color-tan);
    border-radius: 50%;
    opacity: 0.4;
    animation: orbit-pulse 3s ease-in-out infinite 0.5s;
  }

  /* Tool nodes */
  .tool {
    position: absolute;
    width: 56px;
    height: 56px;
    background-color: var(--color-white);
    border: 2px solid var(--color-brown);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
  }

  .tool-label {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-brown);
    text-align: center;
  }

  .tool-1 {
    top: 2%;
    left: 8%;
    animation: float 4s ease-in-out infinite;
  }

  .tool-2 {
    top: 2%;
    right: 8%;
    animation: float 4s ease-in-out infinite 1s;
  }

  .tool-3 {
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    animation: float 4s ease-in-out infinite 2s;
  }

  /* SVG connection lines */
  .connections {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .conn-line {
    stroke: var(--color-tan);
    stroke-width: 2;
    stroke-dasharray: 8 4;
  }

  .conn-1 { animation: dash 2s linear infinite; }
  .conn-2 { animation: dash 2s linear infinite 0.6s; }
  .conn-3 { animation: dash 2s linear infinite 1.2s; }

  @keyframes pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.08); }
  }

  @keyframes orbit-pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
    50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.15; }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  /* Override for tool-3 which already has a translateX */
  .tool-3 {
    animation: float3 4s ease-in-out infinite 2s;
  }

  @keyframes float3 {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50% { transform: translateX(-50%) translateY(-8px); }
  }

  @keyframes dash {
    to { stroke-dashoffset: -24; }
  }

  @media (max-width: 768px) {
    .hero {
      flex-direction: column;
      text-align: center;
      gap: 2rem;
      padding-top: calc(64px + 2rem);
    }

    .hero-visual {
      max-width: 300px;
      height: 240px;
    }
  }
</style>
```

- [ ] **Step 3: Create the initial `(public)/+page.svelte` with Nav + Hero**

Create `frontend/src/routes/(public)/+page.svelte`:

```svelte
<script>
  import LandingNav from "$lib/components/landing/LandingNav.svelte";
  import Hero from "$lib/components/landing/Hero.svelte";
</script>

<LandingNav />
<Hero />
```

- [ ] **Step 4: Verify the page renders**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check --threshold error 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/LandingNav.svelte frontend/src/lib/components/landing/Hero.svelte frontend/src/routes/\(public\)/+page.svelte && git commit -m "feat: add landing page hero section with animated context-flow illustration" && git push
```

---

### Task 5: Problem Statement Section

**Files:**
- Create: `frontend/src/lib/components/landing/ProblemSection.svelte`
- Modify: `frontend/src/routes/(public)/+page.svelte`

- [ ] **Step 1: Create `ProblemSection.svelte`**

Create `frontend/src/lib/components/landing/ProblemSection.svelte`:

```svelte
<script>
  import ScrollReveal from "./ScrollReveal.svelte";
</script>

<section class="problem">
  <div class="problem-inner">
    <ScrollReveal>
      <h2 class="problem-headline">Your AI tools forget everything</h2>
    </ScrollReveal>
    <div class="pain-points">
      <ScrollReveal delay={150}>
        <p class="pain-point">Every session starts from scratch</p>
      </ScrollReveal>
      <ScrollReveal delay={300}>
        <p class="pain-point">Decisions made yesterday are lost today</p>
      </ScrollReveal>
      <ScrollReveal delay={450}>
        <p class="pain-point">Switching tools means losing context</p>
      </ScrollReveal>
    </div>
  </div>
</section>

<style>
  .problem {
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
  }

  .problem-inner {
    max-width: 800px;
    margin: 0 auto;
    text-align: center;
  }

  .problem-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 3rem;
  }

  .pain-points {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .pain-point {
    font-size: 1.25rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0;
    line-height: 1.6;
  }

  @media (max-width: 768px) {
    .problem {
      padding: 4rem 1.5rem;
    }

    .pain-point {
      font-size: 1.125rem;
    }
  }
</style>
```

- [ ] **Step 2: Add ProblemSection to the page**

Update `frontend/src/routes/(public)/+page.svelte`:

```svelte
<script>
  import LandingNav from "$lib/components/landing/LandingNav.svelte";
  import Hero from "$lib/components/landing/Hero.svelte";
  import ProblemSection from "$lib/components/landing/ProblemSection.svelte";
</script>

<LandingNav />
<Hero />
<ProblemSection />
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/ProblemSection.svelte frontend/src/routes/\(public\)/+page.svelte && git commit -m "feat: add problem statement section with scroll-triggered fade-ins" && git push
```

---

### Task 6: How It Works Section

**Files:**
- Create: `frontend/src/lib/components/landing/HowItWorks.svelte`
- Modify: `frontend/src/routes/(public)/+page.svelte`

- [ ] **Step 1: Create `HowItWorks.svelte`**

Create `frontend/src/lib/components/landing/HowItWorks.svelte`:

```svelte
<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const steps = [
    {
      number: 1,
      title: "Connect",
      description: "Add Synapse to any AI tool in one line",
      illustration: "config",
    },
    {
      number: 2,
      title: "Work",
      description: "Your AI tools save and share context automatically",
      illustration: "sync",
    },
    {
      number: 3,
      title: "Share",
      description: "Invite your team, export your knowledge",
      illustration: "team",
    },
  ];
</script>

<section id="how-it-works" class="how-it-works">
  <div class="how-inner">
    <ScrollReveal>
      <h2 class="how-headline">How it works</h2>
    </ScrollReveal>
    <div class="steps">
      {#each steps as step, i}
        <ScrollReveal delay={i * 200} direction="up">
          <div class="step">
            <div class="step-number">{step.number}</div>
            <div class="step-illustration step-{step.illustration}">
              {#if step.illustration === "config"}
                <!-- MCP config illustration -->
                <div class="illus-config">
                  <div class="config-line"><span class="config-key">"mcpServers"</span>: &#123;</div>
                  <div class="config-line indent"><span class="config-key">"synapse"</span>: &#123; ... &#125;</div>
                  <div class="config-line">&#125;</div>
                </div>
              {:else if step.illustration === "sync"}
                <!-- Multiple tools syncing -->
                <div class="illus-sync">
                  <div class="sync-node sync-left">AI</div>
                  <div class="sync-arrows">
                    <span class="sync-arrow">&larr;</span>
                    <span class="sync-arrow">&rarr;</span>
                  </div>
                  <div class="sync-node sync-center">S</div>
                  <div class="sync-arrows">
                    <span class="sync-arrow">&larr;</span>
                    <span class="sync-arrow">&rarr;</span>
                  </div>
                  <div class="sync-node sync-right">AI</div>
                </div>
              {:else}
                <!-- Team sharing illustration -->
                <div class="illus-team">
                  <div class="team-avatar">A</div>
                  <div class="team-folder">
                    <span class="folder-icon">&#128193;</span>
                  </div>
                  <div class="team-avatar">B</div>
                </div>
              {/if}
            </div>
            <h3 class="step-title">{step.title}</h3>
            <p class="step-desc">{step.description}</p>
          </div>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .how-it-works {
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .how-inner {
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .how-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 4rem;
  }

  .steps {
    display: flex;
    gap: 3rem;
    justify-content: center;
  }

  .step {
    flex: 1;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .step-number {
    width: 48px;
    height: 48px;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
  }

  .step-illustration {
    width: 100%;
    height: 120px;
    background-color: var(--color-white);
    border: 2px solid var(--color-tan);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  /* Config illustration */
  .illus-config {
    text-align: left;
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--color-burgundy);
    line-height: 1.6;
  }

  .config-key {
    color: var(--color-brown);
    font-weight: 700;
  }

  .config-line.indent {
    padding-left: 1rem;
  }

  /* Sync illustration */
  .illus-sync {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sync-node {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .sync-left,
  .sync-right {
    background-color: var(--color-cream);
    border: 2px solid var(--color-tan);
    color: var(--color-burgundy);
  }

  .sync-center {
    background-color: var(--color-burgundy);
    color: var(--color-cream);
  }

  .sync-arrows {
    display: flex;
    flex-direction: column;
    font-size: 0.875rem;
    color: var(--color-tan);
    line-height: 1;
  }

  /* Team illustration */
  .illus-team {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .team-avatar {
    width: 40px;
    height: 40px;
    background-color: var(--color-brown);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .folder-icon {
    font-size: 2rem;
  }

  .step-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 0.5rem;
  }

  .step-desc {
    font-size: 1rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0;
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .steps {
      flex-direction: column;
      align-items: center;
    }

    .how-it-works {
      padding: 4rem 1.5rem;
    }
  }
</style>
```

- [ ] **Step 2: Add HowItWorks to the page**

Update `frontend/src/routes/(public)/+page.svelte`:

```svelte
<script>
  import LandingNav from "$lib/components/landing/LandingNav.svelte";
  import Hero from "$lib/components/landing/Hero.svelte";
  import ProblemSection from "$lib/components/landing/ProblemSection.svelte";
  import HowItWorks from "$lib/components/landing/HowItWorks.svelte";
</script>

<LandingNav />
<Hero />
<ProblemSection />
<HowItWorks />
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/HowItWorks.svelte frontend/src/routes/\(public\)/+page.svelte && git commit -m "feat: add How It Works section with 3-step animated flow" && git push
```

---

### Task 7: Feature Cards (Sticky Scroll, Tilted)

**Files:**
- Create: `frontend/src/lib/components/landing/FeatureCards.svelte`
- Modify: `frontend/src/routes/(public)/+page.svelte`

- [ ] **Step 1: Create `FeatureCards.svelte`**

Create `frontend/src/lib/components/landing/FeatureCards.svelte`:

```svelte
<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const features = [
    {
      title: "Context that persists",
      description: "Decisions, architecture notes, and session summaries \u2014 saved automatically, loaded on demand.",
      illustrationType: "timeline",
    },
    {
      title: "Every tool, one brain",
      description: "Switch between AI tools without losing a beat. They all share the same context.",
      illustrationType: "hub",
    },
    {
      title: "Version history",
      description: "Track every change. Restore any version. Know what changed and why.",
      illustrationType: "versions",
    },
    {
      title: "Team sharing",
      description: "Share projects with your team. Everyone\u2019s AI tools stay in sync.",
      illustrationType: "sharing",
    },
    {
      title: "Export & import",
      description: "Your data is yours. Export as markdown, import anytime.",
      illustrationType: "export",
    },
  ];
</script>

<section id="features" class="features-section">
  <div class="features-inner">
    <ScrollReveal>
      <h2 class="features-headline">Everything you need</h2>
    </ScrollReveal>
    <div class="cards-track">
      {#each features as feature, i}
        <ScrollReveal delay={i * 100}>
          <div
            class="feature-card"
            style="--tilt: {i % 2 === 0 ? '-2deg' : '2deg'}; --offset: {i * 20}px;"
          >
            <div class="card-illustration card-illus-{feature.illustrationType}">
              {#if feature.illustrationType === "timeline"}
                <div class="illus-timeline">
                  <div class="tl-dot"></div>
                  <div class="tl-line"></div>
                  <div class="tl-dot"></div>
                  <div class="tl-line"></div>
                  <div class="tl-dot"></div>
                </div>
              {:else if feature.illustrationType === "hub"}
                <div class="illus-hub-mini">
                  <div class="hub-mini-spoke">AI</div>
                  <div class="hub-mini-center">S</div>
                  <div class="hub-mini-spoke">AI</div>
                </div>
              {:else if feature.illustrationType === "versions"}
                <div class="illus-versions">
                  <div class="ver-bar ver-1"></div>
                  <div class="ver-bar ver-2"></div>
                  <div class="ver-bar ver-3"></div>
                  <div class="ver-label">v1 &rarr; v2 &rarr; v3</div>
                </div>
              {:else if feature.illustrationType === "sharing"}
                <div class="illus-sharing">
                  <div class="share-circle">A</div>
                  <div class="share-line"></div>
                  <div class="share-circle">B</div>
                </div>
              {:else}
                <div class="illus-export">
                  <div class="export-file">.md</div>
                  <div class="export-file">.md</div>
                  <div class="export-arrow">&darr;</div>
                  <div class="export-zip">.zip</div>
                </div>
              {/if}
            </div>
            <h3 class="card-title">{feature.title}</h3>
            <p class="card-desc">{feature.description}</p>
          </div>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .features-section {
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .features-inner {
    max-width: 900px;
    margin: 0 auto;
    text-align: center;
  }

  .features-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 4rem;
  }

  .cards-track {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    align-items: center;
  }

  .feature-card {
    position: sticky;
    top: calc(100px + var(--offset, 0px));
    width: 100%;
    max-width: 640px;
    background-color: var(--color-white);
    border: 2px solid var(--color-brown);
    border-radius: 16px;
    padding: 2.5rem;
    transform: rotate(var(--tilt, 0deg));
    box-shadow: 0 8px 32px rgba(86, 28, 36, 0.1);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    text-align: left;
  }

  .feature-card:hover {
    transform: rotate(0deg) translateY(-4px);
    box-shadow: 0 16px 48px rgba(86, 28, 36, 0.15);
  }

  .card-illustration {
    width: 100%;
    height: 100px;
    background-color: var(--color-cream);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  /* Timeline illustration */
  .illus-timeline {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .tl-dot {
    width: 16px;
    height: 16px;
    background-color: var(--color-burgundy);
    border-radius: 50%;
  }

  .tl-line {
    width: 40px;
    height: 3px;
    background-color: var(--color-tan);
  }

  /* Hub mini illustration */
  .illus-hub-mini {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .hub-mini-spoke {
    width: 36px;
    height: 36px;
    background-color: var(--color-cream);
    border: 2px solid var(--color-tan);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-burgundy);
  }

  .hub-mini-center {
    width: 44px;
    height: 44px;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 700;
  }

  /* Versions illustration */
  .illus-versions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .ver-bar {
    height: 6px;
    border-radius: 3px;
    background-color: var(--color-tan);
  }

  .ver-1 { width: 60px; }
  .ver-2 { width: 80px; background-color: var(--color-brown); }
  .ver-3 { width: 100px; background-color: var(--color-burgundy); }

  .ver-label {
    font-size: 0.625rem;
    color: var(--color-tan);
    margin-top: 0.25rem;
  }

  /* Sharing illustration */
  .illus-sharing {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .share-circle {
    width: 36px;
    height: 36px;
    background-color: var(--color-brown);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .share-line {
    width: 40px;
    height: 2px;
    background-color: var(--color-tan);
    position: relative;
  }

  /* Export illustration */
  .illus-export {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-burgundy);
  }

  .export-file {
    padding: 0.25rem 0.5rem;
    background-color: var(--color-white);
    border: 1px solid var(--color-tan);
    border-radius: 4px;
  }

  .export-arrow {
    font-size: 1rem;
    color: var(--color-tan);
  }

  .export-zip {
    padding: 0.25rem 0.75rem;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 6px;
  }

  .card-title {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 0.5rem;
  }

  .card-desc {
    font-size: 1rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0;
    line-height: 1.6;
  }

  @media (max-width: 768px) {
    .features-section {
      padding: 4rem 1.5rem;
    }

    .feature-card {
      position: relative;
      top: 0;
      transform: none;
      padding: 2rem;
    }

    .feature-card:hover {
      transform: translateY(-4px);
    }
  }
</style>
```

- [ ] **Step 2: Add FeatureCards to the page**

Update `frontend/src/routes/(public)/+page.svelte`:

```svelte
<script>
  import LandingNav from "$lib/components/landing/LandingNav.svelte";
  import Hero from "$lib/components/landing/Hero.svelte";
  import ProblemSection from "$lib/components/landing/ProblemSection.svelte";
  import HowItWorks from "$lib/components/landing/HowItWorks.svelte";
  import FeatureCards from "$lib/components/landing/FeatureCards.svelte";
</script>

<LandingNav />
<Hero />
<ProblemSection />
<HowItWorks />
<FeatureCards />
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/FeatureCards.svelte frontend/src/routes/\(public\)/+page.svelte && git commit -m "feat: add sticky scroll feature cards with tilt rotation" && git push
```

---

### Task 8: Built For Builders + CTA + Footer Sections

**Files:**
- Create: `frontend/src/lib/components/landing/BuiltForBuilders.svelte`
- Create: `frontend/src/lib/components/landing/CtaSection.svelte`
- Create: `frontend/src/lib/components/landing/LandingFooter.svelte`
- Modify: `frontend/src/routes/(public)/+page.svelte`

- [ ] **Step 1: Create `BuiltForBuilders.svelte`**

Create `frontend/src/lib/components/landing/BuiltForBuilders.svelte`:

```svelte
<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const quotes = [
    {
      text: "I use Synapse to keep Claude and Cursor in sync across my monorepo",
      role: "Indie developer",
    },
    {
      text: "My team shares architecture decisions through Synapse \u2014 everyone\u2019s AI knows the context",
      role: "Startup CTO",
    },
    {
      text: "I exported 6 months of AI conversations as a knowledge base",
      role: "Researcher",
    },
  ];
</script>

<section class="builders">
  <div class="builders-inner">
    <ScrollReveal>
      <h2 class="builders-headline">Built for builders</h2>
    </ScrollReveal>
    <div class="quotes-grid">
      {#each quotes as quote, i}
        <ScrollReveal delay={i * 150} direction="up">
          <blockquote class="quote-card">
            <p class="quote-text">"{quote.text}"</p>
            <footer class="quote-role">&mdash; {quote.role}</footer>
          </blockquote>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .builders {
    background-color: var(--color-tan);
    padding: 6rem 2rem;
  }

  .builders-inner {
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .builders-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 3rem;
  }

  .quotes-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2rem;
  }

  .quote-card {
    background-color: var(--color-white);
    border-radius: 12px;
    padding: 2rem;
    margin: 0;
    text-align: left;
    box-shadow: 0 4px 16px rgba(86, 28, 36, 0.08);
  }

  .quote-text {
    font-size: 1.0625rem;
    font-weight: 400;
    color: var(--color-burgundy);
    line-height: 1.6;
    margin: 0 0 1rem;
    font-style: italic;
  }

  .quote-role {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-brown);
  }

  @media (max-width: 768px) {
    .builders {
      padding: 4rem 1.5rem;
    }

    .quotes-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
```

- [ ] **Step 2: Create `CtaSection.svelte`**

Create `frontend/src/lib/components/landing/CtaSection.svelte`:

```svelte
<script>
  import ScrollReveal from "./ScrollReveal.svelte";
</script>

<section class="cta">
  <div class="cta-inner">
    <ScrollReveal>
      <h2 class="cta-headline">Start building with context</h2>
      <p class="cta-sub">Free to start. Pro at $5.99/mo for teams and power users.</p>
      <a href="/signup" class="cta-button">Get Started Free</a>
    </ScrollReveal>
  </div>
</section>

<style>
  .cta {
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
    text-align: center;
  }

  .cta-inner {
    max-width: 600px;
    margin: 0 auto;
  }

  .cta-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 1rem;
  }

  .cta-sub {
    font-size: 1.125rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0 0 2.5rem;
    line-height: 1.6;
  }

  .cta-button {
    display: inline-block;
    background-color: var(--color-cream);
    color: var(--color-burgundy);
    padding: 1rem 2.5rem;
    border-radius: 9999px;
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .cta-button:hover {
    transform: scale(1.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  @media (max-width: 768px) {
    .cta {
      padding: 4rem 1.5rem;
    }
  }
</style>
```

- [ ] **Step 3: Create `LandingFooter.svelte`**

Create `frontend/src/lib/components/landing/LandingFooter.svelte`:

```svelte
<footer class="landing-footer">
  <div class="footer-inner">
    <div class="footer-columns">
      <div class="footer-col">
        <h4 class="footer-heading">Product</h4>
        <a href="#features" class="footer-link">Features</a>
        <a href="#how-it-works" class="footer-link">How It Works</a>
      </div>
      <div class="footer-col">
        <h4 class="footer-heading">Company</h4>
        <a href="mailto:hello@synapsesync.app" class="footer-link">Contact</a>
      </div>
      <div class="footer-col">
        <h4 class="footer-heading">Legal</h4>
        <a href="/privacy" class="footer-link">Privacy</a>
        <a href="/terms" class="footer-link">Terms</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p class="footer-copy">&copy; 2026 Synapse. All rights reserved.</p>
    </div>
  </div>
</footer>

<style>
  .landing-footer {
    background-color: #461620;
    padding: 4rem 2rem 2rem;
  }

  .footer-inner {
    max-width: 1000px;
    margin: 0 auto;
  }

  .footer-columns {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3rem;
    margin-bottom: 3rem;
  }

  .footer-col {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .footer-heading {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--color-cream);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 0.25rem;
  }

  .footer-link {
    font-size: 0.9375rem;
    color: var(--color-tan);
    text-decoration: none;
    transition: color 0.2s;
  }

  .footer-link:hover {
    color: var(--color-cream);
  }

  .footer-bottom {
    border-top: 1px solid var(--color-brown);
    padding-top: 1.5rem;
  }

  .footer-copy {
    font-size: 0.8125rem;
    color: var(--color-tan);
    margin: 0;
    text-align: center;
  }

  @media (max-width: 768px) {
    .landing-footer {
      padding: 3rem 1.5rem 1.5rem;
    }

    .footer-columns {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }
</style>
```

- [ ] **Step 4: Assemble the complete page**

Update `frontend/src/routes/(public)/+page.svelte` to its final form:

```svelte
<script>
  import LandingNav from "$lib/components/landing/LandingNav.svelte";
  import Hero from "$lib/components/landing/Hero.svelte";
  import ProblemSection from "$lib/components/landing/ProblemSection.svelte";
  import HowItWorks from "$lib/components/landing/HowItWorks.svelte";
  import FeatureCards from "$lib/components/landing/FeatureCards.svelte";
  import BuiltForBuilders from "$lib/components/landing/BuiltForBuilders.svelte";
  import CtaSection from "$lib/components/landing/CtaSection.svelte";
  import LandingFooter from "$lib/components/landing/LandingFooter.svelte";
</script>

<LandingNav />
<Hero />
<ProblemSection />
<HowItWorks />
<FeatureCards />
<BuiltForBuilders />
<CtaSection />
<LandingFooter />
```

- [ ] **Step 5: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/lib/components/landing/BuiltForBuilders.svelte frontend/src/lib/components/landing/CtaSection.svelte frontend/src/lib/components/landing/LandingFooter.svelte frontend/src/routes/\(public\)/+page.svelte && git commit -m "feat: add Built For Builders, CTA, and footer sections" && git push
```

---

### Task 9: Mobile Responsive Pass

**Files:**
- Modify: `frontend/src/routes/(public)/+layout.svelte`
- Modify: `frontend/src/lib/components/landing/Hero.svelte` (if needed)
- Modify: `frontend/src/lib/components/landing/FeatureCards.svelte` (if needed)

- [ ] **Step 1: Add global responsive resets to the landing layout**

In `frontend/src/routes/(public)/+layout.svelte`, add to the `<style>` block:

```css
  /* Smooth scrolling for anchor links */
  :global(html) {
    scroll-behavior: smooth;
  }

  /* Ensure images don't overflow on mobile */
  .landing :global(img) {
    max-width: 100%;
    height: auto;
  }
```

The full updated `<style>` block in `(public)/+layout.svelte` should be:

```svelte
<style>
  .landing {
    /* Tiramisu palette — scoped to the landing page */
    --color-burgundy: #561C24;
    --color-brown: #6D2932;
    --color-tan: #C7B7A3;
    --color-cream: #E8D8C4;
    --color-white: #FFFDF8;

    font-family: 'Lato', sans-serif;
    color: var(--color-burgundy);
    background-color: var(--color-cream);
    overflow-x: hidden;
  }

  /* Override Tailwind/global body font within this layout */
  :global(.landing *) {
    font-family: 'Lato', sans-serif;
  }

  /* Smooth scrolling for anchor links */
  :global(html) {
    scroll-behavior: smooth;
  }

  /* Ensure images don't overflow on mobile */
  .landing :global(img) {
    max-width: 100%;
    height: auto;
  }
</style>
```

- [ ] **Step 2: Verify all breakpoints**

Run through each component and confirm the `@media (max-width: 768px)` blocks are in place. All components from Tasks 4-8 already include mobile breakpoints. Verify:

- `LandingNav.svelte` — hamburger menu appears at 768px, desktop links hide
- `Hero.svelte` — stacks vertically at 768px, centers text
- `ProblemSection.svelte` — reduces padding at 768px
- `HowItWorks.svelte` — steps stack vertically at 768px
- `FeatureCards.svelte` — cards become relative (no sticky), no tilt on mobile
- `BuiltForBuilders.svelte` — grid collapses to single column at 768px
- `CtaSection.svelte` — reduces padding at 768px
- `LandingFooter.svelte` — columns collapse to single column at 768px

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check --threshold error 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add frontend/src/routes/\(public\)/+layout.svelte && git commit -m "feat: add mobile responsive styles and smooth scrolling to landing layout" && git push
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full type-check**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check --threshold error
```

Fix any errors that appear. Common issues to watch for:
- Missing `$types` imports (these are auto-generated by SvelteKit, so run `npx svelte-kit sync` first if needed)
- Props type mismatches in Svelte 5 runes syntax

- [ ] **Step 2: Verify route structure**

```bash
find /Users/Tanmai.N/Documents/synapse/frontend/src/routes/ -type f | sort
```

Expected structure:

```
frontend/src/routes/
├── (app)/
│   ├── +error.svelte
│   ├── +layout.server.ts        # Auth guard (unchanged)
│   ├── +layout.svelte           # AppShell wrapper (unchanged)
│   ├── account/...              # (unchanged)
│   ├── dashboard/
│   │   └── +page.server.ts      # Moved from (app)/+page.server.ts
│   └── projects/[name]/...      # (unchanged)
├── (public)/
│   ├── +layout.svelte           # Landing layout with tiramisu palette
│   ├── +page.server.ts          # Redirect authenticated -> /dashboard
│   └── +page.svelte             # Landing page
├── +error.svelte                # (unchanged)
├── +layout.svelte               # Root layout (unchanged)
├── auth/callback/+server.ts     # Modified: default redirect -> /dashboard
├── login/...                    # Modified: redirects -> /dashboard
├── logout/...                   # (unchanged, already redirects to /login)
├── share/[token]/...            # (unchanged)
└── signup/...                   # Modified: redirects -> /dashboard
```

- [ ] **Step 3: Manual smoke test**

```bash
cd /Users/Tanmai.N/Documents/synapse/frontend && npm run dev
```

Test:
1. Open `http://localhost:5173/` in an incognito window — should see the landing page
2. Click "Get Started Free" — should navigate to `/signup`
3. Scroll through all sections — verify animations trigger on scroll
4. Test at mobile viewport (375px width) — verify hamburger menu works, sections stack
5. Log in — verify redirect to `/dashboard` which then redirects to first project
6. Navigate to `/` while logged in — should redirect to `/dashboard`

- [ ] **Step 4: Verify no regressions in existing app**

- The `(app)/+layout.server.ts` auth guard still protects all app routes
- `/projects/[name]` still works as before
- `/account` still works as before
- Login -> redirect -> project flow still works (redirect target changed to `/dashboard` but behavior is the same since `/dashboard` redirects to first project)

- [ ] **Step 5: Final commit (if any fixes were needed)**

```bash
cd /Users/Tanmai.N/Documents/synapse && git add -A && git status
```

Only commit if there are changes. Do not commit `package-lock.json` or `.DS_Store`.

---

## New Component Summary

| Component | Purpose | Lines (approx) |
|-----------|---------|----------------|
| `ScrollReveal.svelte` | Reusable IntersectionObserver wrapper for scroll-triggered animations | ~50 |
| `LandingNav.svelte` | Fixed top nav with hamburger on mobile | ~130 |
| `Hero.svelte` | Hero with headline, subheadline, CTA, animated SVG illustration | ~170 |
| `ProblemSection.svelte` | 3 pain points with staggered fade-in | ~50 |
| `HowItWorks.svelte` | 3-step horizontal flow with illustrations | ~160 |
| `FeatureCards.svelte` | 5 sticky scroll tilted cards with illustrations | ~220 |
| `BuiltForBuilders.svelte` | 3 testimonial-style quote cards | ~60 |
| `CtaSection.svelte` | Final CTA with pricing mention | ~40 |
| `LandingFooter.svelte` | 3-column footer with links | ~70 |

## Key Architectural Decisions

1. **Tiramisu CSS variables scoped to `(public)/+layout.svelte`** — they live on the `.landing` wrapper div and do not leak into `(app)` routes. The app's existing `--color-*` variables in `app.css` are unaffected.

2. **No new npm dependencies** — all animations are CSS-only with `IntersectionObserver`. No GSAP, Framer Motion, or animation libraries.

3. **`/dashboard` replaces `(app)/+page`** — this frees `/` for the landing page. All auth redirects (login, signup, callback) point to `/dashboard` instead of `/`. The `(app)/+layout.server.ts` auth guard protects `/dashboard` automatically since it's inside `(app)/`.

4. **Lato font added globally in `app.html`** but only used inside the landing layout via `font-family: 'Lato'`. The app's Armata font remains the default via `app.css`.
