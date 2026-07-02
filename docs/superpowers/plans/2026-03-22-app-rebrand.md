# App Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the Synapse app from Armata/periwinkle to Lato/tiramisu palette.

**Architecture:** Update CSS custom properties in app.css, swap font in app.html, audit and fix hardcoded colors in components.

**Tech Stack:** SvelteKit 5, CSS custom properties, Google Fonts (Lato)

**Spec:** `docs/superpowers/specs/2026-03-22-app-rebrand-design.md`

---

## Task 1: Font Swap (Armata → Lato)

**Files:** `frontend/src/app.html`, `frontend/src/app.css`

- [ ] **1a.** In `frontend/src/app.html`, replace the Armata Google Fonts link with Lato (including weights 300, 400, 700, 900).

  **Find** (line 8):
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Armata&display=swap" rel="stylesheet" />
  ```

  **Replace with:**
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&display=swap" rel="stylesheet" />
  ```

- [ ] **1b.** In `frontend/src/app.css`, update the `body` font-family declaration.

  **Find** (line 20):
  ```css
  font-family: "Armata", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  ```

  **Replace with:**
  ```css
  font-family: 'Lato', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  ```

- [ ] **1c.** Commit:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse
  git add frontend/src/app.html frontend/src/app.css
  git commit -m "rebrand: swap Armata font to Lato"
  git push
  ```

---

## Task 2: CSS Variables Update

**File:** `frontend/src/app.css`

- [ ] **2a.** Replace the entire `:root` block (lines 3-17) with the new tiramisu palette.

  **Find:**
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

  **Replace with:**
  ```css
  :root {
    --color-bg: #E8D8C4;
    --color-bg-raised: #FFFDF8;
    --color-bg-muted: #F5EDE0;
    --color-border: #C7B7A3;
    --color-text: #561C24;
    --color-text-muted: #8A7565;
    --color-accent: #561C24;
    --color-accent-hover: #3D1018;
    --color-link: #6D2932;
    --color-pink: #6D2932;
    --color-pink-dark: #561C24;
    --color-success: #2D5016;
    --color-danger: #8B0000;
    --color-success-bg: #E8F0D8;
  }
  ```

  Note: `--color-success-bg` is a **new** variable that previously only existed as an inline fallback in components.

- [ ] **2b.** Commit:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse
  git add frontend/src/app.css
  git commit -m "rebrand: update CSS variables to tiramisu palette"
  git push
  ```

---

## Task 3: Component Audit and Fixes

**Files:** `frontend/src/lib/components/account/BillingCard.svelte`, `frontend/src/routes/(app)/projects/[name]/+page.svelte`

The grep audit found exactly **two** files with hardcoded hex colors that need updating. Both use inline fallback values for `--color-success-bg` and `--color-success` that are no longer needed since those variables are now defined in `:root`.

No `rgb()` hardcoded values were found in any `.svelte` files. Components using `color: white` on accent backgrounds are confirmed to still have good contrast with the new dark burgundy/brown values (per the spec), so no changes are needed there.

- [ ] **3a.** In `frontend/src/lib/components/account/BillingCard.svelte` (line 48), remove the inline fallback values.

  **Find:**
  ```html
  style="background-color: var(--color-success-bg, #ecfdf5); color: var(--color-success, #065f46);"
  ```

  **Replace with:**
  ```html
  style="background-color: var(--color-success-bg); color: var(--color-success);"
  ```

- [ ] **3b.** In `frontend/src/routes/(app)/projects/[name]/+page.svelte` (line 189), remove the inline fallback values.

  **Find:**
  ```html
  style="background-color: var(--color-success-bg, #ecfdf5); color: var(--color-success, #065f46);">
  ```

  **Replace with:**
  ```html
  style="background-color: var(--color-success-bg); color: var(--color-success);">
  ```

- [ ] **3c.** Commit:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse
  git add frontend/src/lib/components/account/BillingCard.svelte frontend/src/routes/\(app\)/projects/\[name\]/+page.svelte
  git commit -m "rebrand: remove hardcoded color fallbacks from components"
  git push
  ```

---

## Task 4: Meta/Favicon Update

**File:** `frontend/src/app.html`

- [ ] **4a.** Add a `<meta name="theme-color">` tag to `app.html`. Insert it after the viewport meta tag (after line 5).

  **Find:**
  ```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
  ```

  **Replace with:**
  ```html
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#561C24" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
  ```

- [ ] **4b.** Commit:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse
  git add frontend/src/app.html
  git commit -m "rebrand: add burgundy theme-color meta tag"
  git push
  ```

---

## Task 5: Final Verification

- [ ] **5a.** Run `svelte-check` to confirm no type or template errors were introduced:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse/frontend
  npx svelte-check --tsconfig ./tsconfig.json
  ```

- [ ] **5b.** Run a full grep to confirm no old palette hex values remain in `.svelte` or `.css` files:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse/frontend/src
  grep -rn --include="*.svelte" --include="*.css" -E "#(faf8f5|fce8ee|ebe5dd|3d3327|8a7e72|667BC6|5568b0|DA7297|FFB4C2|4ade80|ef4444|ecfdf5|065f46)" .
  ```

  Expected result: **no matches**. If any matches are found, replace the hardcoded value with the appropriate CSS variable.

- [ ] **5c.** Visual spot check — start the dev server and verify key pages:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse/frontend
  npm run dev
  ```

  Check these pages in a browser:
  - **Login/landing page** — cream background, burgundy text, Lato font
  - **Dashboard** — cards have warm white (`#FFFDF8`) background, tan borders
  - **Settings/Billing** — Pro badge and buttons use burgundy/warm brown
  - **Project page** — import success notification uses olive green background
  - **Sidebar** — active nav item has burgundy accent
  - **Entry viewer** — tags use warm brown badges, prose headings are burgundy
  - **Mobile** — theme-color bar should be burgundy

- [ ] **5d.** If all checks pass, commit any remaining fixes (if any), then confirm the branch is clean:
  ```bash
  cd /Users/Tanmai.N/Documents/synapse
  git status
  ```

---

## Summary of Changes

| File | What Changes |
|------|-------------|
| `frontend/src/app.html` | Armata → Lato font link, add `<meta name="theme-color" content="#561C24">` |
| `frontend/src/app.css` | All 14 CSS custom properties updated to tiramisu palette, 1 new variable (`--color-success-bg`) added, body font-family updated to Lato |
| `frontend/src/lib/components/account/BillingCard.svelte` | Remove `#ecfdf5` and `#065f46` inline fallbacks |
| `frontend/src/routes/(app)/projects/[name]/+page.svelte` | Remove `#ecfdf5` and `#065f46` inline fallbacks |

**Total files modified:** 4
**No structural/behavioral changes.** This is a pure visual rebrand.
