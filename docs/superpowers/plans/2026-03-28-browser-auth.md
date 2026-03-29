# Browser-Based CLI Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PKCE-secured browser login flow to the CLI so users can authenticate via the web app (Google, GitHub, password, magic link) and have the API key returned to the terminal automatically.

**Architecture:** CLI starts a local HTTP server and opens the browser to a new `/cli-auth` frontend page. User logs in via the web app. Frontend calls a new backend endpoint to create a CLI session, then redirects to localhost with an auth code. CLI exchanges the code + PKCE verifier with the backend over HTTPS to get the API key.

**Tech Stack:** Node.js `node:http` + `node:crypto` (CLI), Hono endpoints (backend), SvelteKit page (frontend)

---

**Spec:** `docs/superpowers/specs/2026-03-28-browser-auth-design.md`

## File Structure

```
mcp/src/cli/
  browser-auth.ts       NEW — PKCE generation, local server, browser open, code exchange
  wizard.ts             MODIFY — simplify to 2 options (browser + API key)
  api.ts                MODIFY — add cliExchangeCode() function

mcp/src/index.ts        MODIFY — update runInteractiveLogin, remove runInteractiveSignup

backend/src/api/auth.ts MODIFY — add cli-session and cli-exchange endpoints
backend/src/lib/validate.ts MODIFY — add new schemas

frontend/src/routes/cli-auth/
  +page.server.ts       NEW — load function + form actions for CLI auth page
  +page.svelte          NEW — login UI with CLI context
```

---

### Task 1: Add backend schemas for CLI session endpoints

**Files:**
- Modify: `backend/src/lib/validate.ts`

- [ ] **Step 1: Add cliSession and cliExchange schemas**

Add these two schemas to the `schemas` object in `backend/src/lib/validate.ts`, after the existing `login` schema:

```typescript
  cliSession: z.object({
    code_challenge: z.string().min(1, "Code challenge is required"),
  }),

  cliExchange: z.object({
    code: z.string().min(1, "Code is required"),
    code_verifier: z.string().min(1, "Code verifier is required"),
  }),
```

- [ ] **Step 2: Verify build**

Run: `npm run build -w backend`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/validate.ts
git commit -m "feat(backend): add CLI session schemas for browser auth"
```

---

### Task 2: Add backend CLI session endpoints

**Files:**
- Modify: `backend/src/api/auth.ts`

- [ ] **Step 1: Add in-memory session store and cleanup helper**

Add this at the top of `backend/src/api/auth.ts`, after the existing imports and before the `auth` Hono instance:

```typescript
interface CliSession {
  code: string;
  code_challenge: string;
  api_key: string;
  email: string;
  created_at: number;
}

const CLI_SESSION_TTL = 5 * 60 * 1000; // 5 minutes
const cliSessions = new Map<string, CliSession>();

function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [code, session] of cliSessions) {
    if (now - session.created_at > CLI_SESSION_TTL) {
      cliSessions.delete(code);
    }
  }
}

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 2: Add POST /auth/cli-session endpoint**

Add this after the existing `auth.post("/login", ...)` block (around line 84) and before the Google OAuth routes:

```typescript
// POST /auth/cli-session — create a CLI auth session after browser login
auth.post("/cli-session", authMiddleware, async (c) => {
  const body = await parseBody(c, schemas.cliSession);
  const user = c.get("user");

  cleanExpiredSessions();

  const db = createSupabaseClient(c.env);

  // Delete existing "cli" key and create a fresh one
  const existingKeys = await listApiKeys(db, user.id);
  const existingCliKey = existingKeys.find((k) => k.label === "cli");
  if (existingCliKey) {
    await deleteApiKey(db, existingCliKey.id, user.id);
  }

  const apiKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKeyHash = await hashApiKey(apiKey);
  await createApiKey(db, user.id, apiKeyHash, "cli");

  const code = crypto.randomUUID();
  cliSessions.set(code, {
    code,
    code_challenge: body.code_challenge,
    api_key: apiKey,
    email: user.email ?? "",
    created_at: Date.now(),
  });

  return c.json({ code });
});
```

- [ ] **Step 3: Add POST /auth/cli-exchange endpoint**

Add this immediately after the `cli-session` endpoint:

```typescript
// POST /auth/cli-exchange — exchange code + verifier for API key (no auth required)
auth.post("/cli-exchange", async (c) => {
  const body = await parseBody(c, schemas.cliExchange);

  const session = cliSessions.get(body.code);
  if (!session) {
    throw new AppError("Invalid or expired code", 404, "NOT_FOUND");
  }

  // Check expiry
  if (Date.now() - session.created_at > CLI_SESSION_TTL) {
    cliSessions.delete(body.code);
    throw new AppError("Code expired", 404, "NOT_FOUND");
  }

  // PKCE verification
  const challengeFromVerifier = await sha256hex(body.code_verifier);
  if (challengeFromVerifier !== session.code_challenge) {
    throw new AppError("Invalid code verifier", 401, "AUTH_ERROR");
  }

  // Single-use: delete after successful exchange
  cliSessions.delete(body.code);

  return c.json({
    api_key: session.api_key,
    email: session.email,
  });
});
```

- [ ] **Step 4: Verify build**

Run: `npm run build -w backend`
Expected: compiles without errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/auth.ts
git commit -m "feat(backend): add cli-session and cli-exchange endpoints for browser auth"
```

---

### Task 3: Add cliExchangeCode to CLI api module

**Files:**
- Modify: `mcp/src/cli/api.ts`

- [ ] **Step 1: Add the exchange function**

Add this at the end of `mcp/src/cli/api.ts`:

```typescript
export interface ExchangeResponse {
  api_key: string;
  email: string;
}

export async function cliExchangeCode(
  code: string,
  codeVerifier: string,
): Promise<AuthResult<ExchangeResponse>> {
  const res = await fetch(`${API_URL}/auth/cli-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error || res.statusText };
  }
  return { ok: true, data: (await res.json()) as ExchangeResponse };
}
```

Note: `AuthResult<T>` and `API_URL` are already defined in this file.

- [ ] **Step 2: Verify build**

Run: `npm run build -w mcp`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add mcp/src/cli/api.ts
git commit -m "feat(mcp): add cliExchangeCode for browser auth PKCE exchange"
```

---

### Task 4: Create browser-auth.ts

**Files:**
- Create: `mcp/src/cli/browser-auth.ts`

- [ ] **Step 1: Write the browser auth module**

Create `mcp/src/cli/browser-auth.ts`:

```typescript
import crypto from "node:crypto";
import { exec } from "node:child_process";
import http from "node:http";
import { cliExchangeCode } from "./api.js";

const AUTH_TIMEOUT = 120_000; // 120 seconds
const APP_URL = "https://synapsesync.app";

function generateVerifier(): string {
  return crypto.randomBytes(64).toString("hex");
}

async function generateChallenge(verifier: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(verifier).digest("hex");
  return hash;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`);
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Synapse</title></head>
<body style="background:#151010;color:#ffe4c4;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="text-align:center;">
    <div style="font-size:2rem;margin-bottom:1rem;color:#c87941;">\u25C6</div>
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem;">Login successful!</h1>
    <p style="color:#7a6455;font-size:0.875rem;">You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

export async function browserAuth(): Promise<{ api_key: string; email: string }> {
  const codeVerifier = generateVerifier();
  const codeChallenge = await generateChallenge(codeVerifier);
  const state = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Browser login timed out after 120 seconds. Please try again."));
      }
    }, AUTH_TIMEOUT);

    server.on("request", async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid state parameter");
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code parameter");
        return;
      }

      // Serve success page immediately so the browser shows feedback
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHtml());

      if (settled) return;

      // Exchange code + verifier for API key over HTTPS
      const result = await cliExchangeCode(code, codeVerifier);

      settled = true;
      clearTimeout(timeout);
      server.close();

      if (result.ok) {
        resolve({ api_key: result.data.api_key, email: result.data.email });
      } else {
        reject(new Error(`Login failed: ${result.message}`));
      }
    });

    // Bind to localhost only, random port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const authUrl = `${APP_URL}/cli-auth?challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&port=${port}`;

      openBrowser(authUrl);
    });
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build -w mcp`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add mcp/src/cli/browser-auth.ts
git commit -m "feat(mcp): add browser-auth module with PKCE local server flow"
```

---

### Task 5: Update wizard.ts to use browser auth

**Files:**
- Modify: `mcp/src/cli/wizard.ts`

- [ ] **Step 1: Rewrite wizard.ts with 2-option auth**

Replace the entire contents of `mcp/src/cli/wizard.ts` with:

```typescript
import * as clack from "@clack/prompts";
import { browserAuth } from "./browser-auth.js";
import { detectEditors, writeEditorConfigs } from "./editors.js";
import { createGlyphSpinner } from "./spinner.js";
import { accent, bold, muted, success } from "./theme.js";
import { showWelcome } from "./welcome.js";

export async function runWizard(version: string): Promise<void> {
  // Step 1: Animated welcome
  await showWelcome(version);

  // Step 2: Auth method
  clack.intro(`${accent("\u25C6")} ${bold("Synapse setup")}`);

  const authMethod = await clack.select({
    message: "How do you want to connect?",
    options: [
      { value: "browser" as const, label: "Sign in with browser", hint: "opens synapsesync.app" },
      { value: "key" as const, label: "Paste an API key", hint: "from the dashboard" },
    ],
  });

  if (clack.isCancel(authMethod)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  // Step 3 + 4: Auth
  let apiKey: string;

  if (authMethod === "browser") {
    const spin = createGlyphSpinner();
    spin.start("Waiting for browser login\u2026");

    try {
      const result = await browserAuth();
      spin.stop(`Signed in as ${result.email}`);
      apiKey = result.api_key;
    } catch (err) {
      spin.stop("Login failed");
      clack.log.error((err as Error).message);
      process.exit(1);
    }
  } else {
    clack.log.info("Create a key at synapsesync.app \u2192 Account \u2192 API keys");
    const key = await clack.password({
      message: "API key",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    if (clack.isCancel(key)) {
      clack.cancel("Cancelled.");
      process.exit(0);
    }
    apiKey = key.trim();
  }

  // Step 5: Editor selection
  const allEditors = detectEditors();
  const editorChoice = await clack.multiselect({
    message: "Which tools should Synapse connect to?",
    options: allEditors.map((e) => ({
      value: e.id,
      label: e.name,
      hint: e.detected ? e.hint : "not detected",
    })),
    initialValues: allEditors.filter((e) => e.detected).map((e) => e.id),
    required: true,
  });

  if (clack.isCancel(editorChoice)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  const selectedEditors = allEditors.filter((e) => (editorChoice as string[]).includes(e.id));

  // Step 6: Confirmation
  const filePreview = selectedEditors.map((e) => `  ${muted(e.hint)}`).join("\n");
  clack.log.message(`Files to create/update:\n${filePreview}`);

  const confirmed = await clack.confirm({
    message: "Ready to write config files?",
  });

  if (clack.isCancel(confirmed) || !confirmed) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }

  // Write configs
  const configSpin = createGlyphSpinner();
  configSpin.start("Writing configs\u2026");
  const written = writeEditorConfigs(selectedEditors, apiKey);
  configSpin.stop("Config files written");

  // Step 7: Success summary
  const summary = written.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
  clack.log.message(summary);

  clack.outro(`Restart your editor to connect. ${muted("synapsesync.app/docs")}`);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build -w mcp`
Expected: compiles without errors

- [ ] **Step 3: Commit**

```bash
git add mcp/src/cli/wizard.ts
git commit -m "feat(mcp): simplify wizard to browser auth + API key options"
```

---

### Task 6: Update index.ts standalone commands

**Files:**
- Modify: `mcp/src/index.ts`

- [ ] **Step 1: Add browser-auth import**

At the top of `mcp/src/index.ts`, add to the CLI imports (after the existing `import { runWizard }` line):

```typescript
import { browserAuth } from "./cli/browser-auth.js";
```

- [ ] **Step 2: Replace runInteractiveLogin with browser auth**

Replace the `runInteractiveLogin` function (lines 132-168) with:

```typescript
async function runInteractiveLogin(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Sign in to Synapse")}`);

  const spin = createGlyphSpinner();
  spin.start("Waiting for browser login\u2026");

  try {
    const result = await browserAuth();
    spin.stop(`Signed in as ${result.email}`);

    const written = writeAllDetected(result.api_key);
    const summary = written.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
    clack.log.message(summary);
    clack.outro("Restart your editor to connect.");
  } catch (err) {
    spin.stop("Login failed");
    clack.log.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 3: Replace runInteractiveSignup with browser auth**

Replace the `runInteractiveSignup` function (lines 170-197) with:

```typescript
async function runInteractiveSignup(): Promise<void> {
  clack.intro(`${accent("\u25C6")} ${bold("Create a Synapse account")}`);

  const spin = createGlyphSpinner();
  spin.start("Waiting for browser\u2026");

  try {
    const result = await browserAuth();
    spin.stop(`Signed in as ${result.email}`);

    const written = writeAllDetected(result.api_key);
    const summary = written.map((f) => `  ${success("\u2713")} ${f}`).join("\n");
    clack.log.message(summary);
    clack.outro("Restart your editor to connect.");
  } catch (err) {
    spin.stop("Signup failed");
    clack.log.error((err as Error).message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Remove unused imports if needed**

After the changes, check if `cliAuthSignup` is still used in index.ts. It's used in the non-interactive `signup --email` path, so it stays. `cliAuthLogin` is used in the non-interactive `login --email --password` path, so it also stays.

- [ ] **Step 5: Verify build + lint**

Run: `npm run build -w mcp && npx biome check mcp/src/`
Expected: compiles and lints without errors

- [ ] **Step 6: Commit**

```bash
git add mcp/src/index.ts
git commit -m "feat(mcp): use browser auth for interactive login and signup commands"
```

---

### Task 7: Create frontend /cli-auth page server

**Files:**
- Create: `frontend/src/routes/cli-auth/+page.server.ts`

- [ ] **Step 1: Write the page server with load function and form actions**

Create `frontend/src/routes/cli-auth/+page.server.ts`:

```typescript
import { API_URL } from "$env/static/private";
import { getSupabase } from "$lib/server/auth";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");

  if (!challenge || !state || !port) {
    return { error: "This page should be opened from the Synapse CLI.", challenge: null, state: null, port: null };
  }

  // If user is already authenticated, create CLI session and redirect to localhost
  if (locals.user && locals.token) {
    const res = await fetch(`${API_URL}/auth/cli-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${locals.token}`,
      },
      body: JSON.stringify({ code_challenge: challenge }),
    });

    if (res.ok) {
      const data = (await res.json()) as { code: string };
      redirect(303, `http://localhost:${port}/callback?code=${encodeURIComponent(data.code)}&state=${encodeURIComponent(state)}`);
    }

    return { error: "Failed to create CLI session. Please try again.", challenge, state, port };
  }

  // Not authenticated — render login form
  return { challenge, state, port, error: null };
};

function cliParams(url: URL): URLSearchParams {
  const params = new URLSearchParams();
  const challenge = url.searchParams.get("challenge");
  const state = url.searchParams.get("state");
  const port = url.searchParams.get("port");
  if (challenge) params.set("challenge", challenge);
  if (state) params.set("state", state);
  if (port) params.set("port", port);
  return params;
}

export const actions: Actions = {
  login: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        return fail(400, {
          error: "Incorrect email or password. If you signed up with Google or GitHub, try that method instead.",
          email,
        });
      }
      return fail(400, { error: error.message, email });
    }

    // Redirect back to this page — load function will handle CLI session
    redirect(303, `/cli-auth?${cliParams(url)}`);
  },

  magicLink: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const params = cliParams(url);
    const cliRedirect = `/cli-auth?${params}`;

    const supabase = getSupabase(cookies);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(cliRedirect)}`,
      },
    });

    if (error) return fail(400, { error: error.message, email });
    return { magicLinkSent: true, email };
  },

  oauth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";
    const params = cliParams(url);
    const cliRedirect = `/cli-auth?${params}`;

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${url.origin}/auth/callback?redirect=${encodeURIComponent(cliRedirect)}`,
      },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },

  signup: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const email = data.get("email") as string;
    const password = data.get("password") as string;

    const supabase = getSupabase(cookies);

    // Check for existing user
    const { data: existingUsers } = await supabase.from("users").select("id").eq("email", email).limit(1);
    if (existingUsers && existingUsers.length > 0) {
      return fail(400, {
        error: 'An account with this email already exists. Try signing in instead.',
        email,
      });
    }

    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return fail(400, { error: error.message, email });

    return { signupSuccess: true, email };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/routes/cli-auth/+page.server.ts
git commit -m "feat(frontend): add /cli-auth page server with login/signup/oauth actions"
```

---

### Task 8: Create frontend /cli-auth page UI

**Files:**
- Create: `frontend/src/routes/cli-auth/+page.svelte`

- [ ] **Step 1: Write the page component**

Create `frontend/src/routes/cli-auth/+page.svelte`:

```svelte
<script lang="ts">
import { enhance } from "$app/forms";

let { data, form } = $props();
let mode = $state<"login" | "signup">("login");
let loginMode = $state<"password" | "magic">("password");
let loading = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-bg);">
  <div style="position: fixed; inset: 0; pointer-events: none; overflow: hidden;">
    <div style="position: absolute; top: 20%; right: 20%; width: 350px; height: 350px; border-radius: 50%; background: rgba(86, 28, 36, 0.04); filter: blur(80px); animation: float-orb 20s ease-in-out infinite;"></div>
  </div>

  <div class="glass w-full max-w-md rounded-xl" style="padding: 2rem;">

    {#if data.error && !data.challenge}
      <!-- Missing CLI params -->
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2" style="color: var(--color-danger);">Invalid link</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">{data.error}</p>
      </div>

    {:else if form?.magicLinkSent}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm" style="color: var(--color-text-muted);">
          We sent a login link to {form.email}. Click it to complete setup in your terminal.
        </p>
      </div>

    {:else if form?.signupSuccess}
      <div class="text-center">
        <h2 class="text-lg font-semibold mb-2">Check your email</h2>
        <p class="text-sm mb-4" style="color: var(--color-text-muted);">
          We sent a confirmation link to {form.email}
        </p>
        <p class="text-xs" style="color: var(--color-text-muted);">
          After confirming, come back here and sign in to connect your terminal.
        </p>
      </div>

    {:else}
      <div class="text-center mb-6">
        <div style="font-size: 1.5rem; color: var(--color-accent); margin-bottom: 0.5rem;">&loz;</div>
        <h1 class="text-xl font-semibold" style="color: var(--color-accent);">
          {mode === "login" ? "Sign in to Synapse" : "Create your account"}
        </h1>
        <p class="text-sm mt-1" style="color: var(--color-text-muted);">Connecting from the terminal</p>
      </div>

      <!-- OAuth buttons -->
      <div class="space-y-3 mb-6">
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="google" />
          <button type="submit" class="btn-secondary w-full cursor-pointer">
            Continue with Google
          </button>
        </form>
        <form method="POST" action="?/oauth" use:enhance>
          <input type="hidden" name="provider" value="github" />
          <button type="submit" class="btn-secondary w-full cursor-pointer">
            Continue with GitHub
          </button>
        </form>
      </div>

      <div class="relative mb-6">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full" style="border-top: 1px solid var(--color-border);"></div>
        </div>
        <div class="relative flex justify-center text-xs">
          <span class="px-2" style="background-color: transparent; color: var(--color-text-muted);">or</span>
        </div>
      </div>

      {#if mode === "login"}
        {#if loginMode === "password"}
          <form method="POST" action="?/login" use:enhance={() => {
            loading = true;
            return async ({ update }) => {
              loading = false;
              await update();
            };
          }} class="space-y-4">
            <input type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            <input type="password" name="password" placeholder="Password" required
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
            {/if}
            <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
              {#if loading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span> Signing in...
                </span>
              {:else}
                Sign in
              {/if}
            </button>
          </form>
        {:else}
          <form method="POST" action="?/magicLink" use:enhance={() => {
            loading = true;
            return async ({ update }) => {
              loading = false;
              await update();
            };
          }} class="space-y-4">
            <input type="email" name="email" placeholder="Email" required
              value={form?.email ?? ""}
              class="w-full text-sm"
              style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
            />
            {#if form?.error}
              <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
            {/if}
            <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
              {#if loading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span> Sending...
                </span>
              {:else}
                Send magic link
              {/if}
            </button>
          </form>
        {/if}

        <div class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          <button onclick={() => loginMode = loginMode === "password" ? "magic" : "password"}
            class="cursor-pointer" style="color: var(--color-link);">
            {loginMode === "password" ? "Use magic link instead" : "Use password instead"}
          </button>
        </div>

        <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          Don't have an account?
          <button onclick={() => mode = "signup"} class="cursor-pointer" style="color: var(--color-link);">Sign up</button>
        </p>

      {:else}
        <!-- Signup mode -->
        <form method="POST" action="?/signup" use:enhance={() => {
          loading = true;
          return async ({ update }) => {
            loading = false;
            await update();
          };
        }} class="space-y-4">
          <input type="email" name="email" placeholder="Email" required
            value={form?.email ?? ""}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          <input type="password" name="password" placeholder="Password (min 6 characters)"
            required minlength={6}
            class="w-full text-sm"
            style="border-radius: 12px; padding: 12px 16px; transition: all 150ms ease; border: 1px solid var(--color-border); background-color: var(--color-bg); color: var(--color-text);"
          />
          {#if form?.error}
            <p class="text-sm" style="color: var(--color-danger);">{form.error}</p>
          {/if}
          <button type="submit" disabled={loading} class="btn-primary w-full cursor-pointer">
            {#if loading}
              <span class="flex items-center justify-center gap-2">
                <span class="spinner spinner-sm spinner-white"></span> Creating account...
              </span>
            {:else}
              Create account
            {/if}
          </button>
        </form>

        <p class="mt-4 text-center text-sm" style="color: var(--color-text-muted);">
          Already have an account?
          <button onclick={() => mode = "login"} class="cursor-pointer" style="color: var(--color-link);">Sign in</button>
        </p>
      {/if}
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Verify frontend builds**

Run: `npm run typecheck -w frontend`
Expected: no new errors (existing warnings are ok)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/routes/cli-auth/+page.svelte
git commit -m "feat(frontend): add /cli-auth page UI with login, signup, and OAuth"
```

---

### Task 9: Full build verification

**Files:** none (verification only)

- [ ] **Step 1: Run full workspace lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 2: Run full workspace typecheck**

Run: `npm run typecheck`
Expected: no new errors (existing frontend warnings are ok)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Fix any issues found**

If lint/typecheck/tests fail, fix the issues in the relevant files.

- [ ] **Step 5: Commit fixes if any**

```bash
git add -A
git commit -m "fix: address lint and type issues from browser auth"
```

---

### Task 10: Final commit and push

- [ ] **Step 1: Squash into a clean commit if multiple fix commits were needed**

If there were fix commits from Task 9, consider squashing. Otherwise, the individual task commits are fine as-is.

- [ ] **Step 2: Push**

```bash
git push
```
