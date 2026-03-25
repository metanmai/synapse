# Stripe Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe billing to Synapse so users can upgrade from Free to Pro ($5.99/mo) via hosted Checkout, with subscription state synced via webhooks.

**Architecture:** A `subscriptions` table tracks billing state, synced from Stripe via webhooks. Tier is resolved per-request in auth middleware by querying this table. Frontend adds a BillingCard component to the account page with checkout/portal redirects.

**Tech Stack:** Stripe SDK, Hono (backend), Supabase PostgreSQL, SvelteKit 5 (frontend)

**Spec:** `docs/superpowers/specs/2026-03-22-stripe-integration-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/003_stripe_billing.sql` | New: subscriptions table, stripe_customer_id on users, RLS, trigger |
| `backend/src/db/types.ts` | Modify: remove `tier` from User, add `stripe_customer_id`, add `Subscription` interface |
| `backend/src/db/queries/subscriptions.ts` | New: CRUD for subscriptions table |
| `backend/src/db/queries/users.ts` | Modify: add `updateStripeCustomerId` |
| `backend/src/db/queries/index.ts` | Modify: re-export subscriptions |
| `backend/src/lib/env.ts` | Modify: add Stripe env vars |
| `backend/src/lib/stripe.ts` | New: Stripe client factory |
| `backend/src/lib/auth.ts` | Modify: resolve tier after user lookup, set on context |
| `backend/src/lib/tier.ts` | Modify: read `c.get("tier")` instead of `user.tier` |
| `backend/src/api/billing.ts` | New: checkout, portal, status, webhook endpoints |
| `backend/src/index.ts` | Modify: mount billing routes |
| `frontend/src/lib/server/api.ts` | Modify: add billing API methods |
| `frontend/src/lib/components/account/BillingCard.svelte` | New: billing UI component |
| `frontend/src/routes/(app)/account/+page.svelte` | Modify: add BillingCard |
| `frontend/src/routes/(app)/account/+page.server.ts` | Modify: load billing status, add checkout/portal actions |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/003_stripe_billing.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Add Stripe customer ID to users
alter table users add column stripe_customer_id text unique;

-- Subscriptions table (synced from Stripe via webhooks)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_subscription_id text unique not null,
  status text not null default 'inactive'
    check (status in ('active', 'canceled', 'past_due', 'inactive')),
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on subscriptions(user_id);
create index idx_subscriptions_stripe_sub_id on subscriptions(stripe_subscription_id);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table subscriptions enable row level security;

create policy "subscriptions_read_own" on subscriptions for select
  using (user_id = auth.uid());

-- updated_at trigger (matches entries pattern from migration 001)
create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd /Users/Tanmai.N/Documents/synapse && cat supabase/migrations/003_stripe_billing.sql`

Verify the file looks correct. The `update_updated_at()` function already exists from migration 001.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_stripe_billing.sql
git commit -m "feat: add subscriptions table and stripe_customer_id migration"
```

---

### Task 2: Types and Stripe Client

**Files:**
- Modify: `backend/src/db/types.ts`
- Modify: `backend/src/lib/env.ts`
- Create: `backend/src/lib/stripe.ts`

- [ ] **Step 1: Install stripe SDK**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm install stripe`

- [ ] **Step 2: Update `backend/src/db/types.ts`**

Remove `tier` from `User` interface, add `stripe_customer_id`. Add `Subscription` interface.

The `User` interface should become:

```typescript
export interface User {
  id: string;
  email: string;
  api_key_hash: string;
  stripe_customer_id: string | null;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}
```

Add after `ActivityLogEntry`:

```typescript
export interface Subscription {
  id: string;
  user_id: string;
  stripe_subscription_id: string;
  status: "active" | "canceled" | "past_due" | "inactive";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Update `backend/src/lib/env.ts`**

Add to the `Env` interface:

```typescript
// Stripe
STRIPE_SECRET_KEY: string;
STRIPE_WEBHOOK_SECRET: string;
STRIPE_PRO_PRICE_ID: string;
```

- [ ] **Step 4: Create `backend/src/lib/stripe.ts`**

```typescript
import Stripe from "stripe";
import type { Env } from "./env";

export function createStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-04-30.basil",
  });
}
```

Note: Check the latest Stripe API version when implementing. Use the version that matches the installed SDK.

- [ ] **Step 5: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

Fix any type errors. The `user.tier` references in `tier.ts` and `auth.ts` will error — that's expected and fixed in Task 4.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/src/db/types.ts backend/src/lib/env.ts backend/src/lib/stripe.ts
git commit -m "feat: add Stripe SDK, Subscription type, and Stripe env vars"
```

---

### Task 3: Subscription Queries

**Files:**
- Create: `backend/src/db/queries/subscriptions.ts`
- Modify: `backend/src/db/queries/users.ts`
- Modify: `backend/src/db/queries/index.ts`

- [ ] **Step 1: Create `backend/src/db/queries/subscriptions.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Subscription } from "../types";
import { singleOrNull } from "../query-helpers";

export async function getActiveSubscription(
  db: SupabaseClient,
  userId: string
): Promise<Subscription | null> {
  // Matches active or past_due (past_due retains Pro access per spec)
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as Subscription | null;
}

export async function getSubscriptionByUserId(
  db: SupabaseClient,
  userId: string
): Promise<Subscription | null> {
  const { data, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as Subscription | null;
}

export async function getSubscriptionByStripeId(
  db: SupabaseClient,
  stripeSubscriptionId: string
): Promise<Subscription | null> {
  return singleOrNull<Subscription>(
    await db
      .from("subscriptions")
      .select("*")
      .eq("stripe_subscription_id", stripeSubscriptionId)
      .single()
  );
}

export async function upsertSubscription(
  db: SupabaseClient,
  params: {
    user_id: string;
    stripe_subscription_id: string;
    status: Subscription["status"];
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  }
): Promise<Subscription> {
  const { data, error } = await db
    .from("subscriptions")
    .upsert(
      {
        user_id: params.user_id,
        stripe_subscription_id: params.stripe_subscription_id,
        status: params.status,
        current_period_end: params.current_period_end ?? null,
        cancel_at_period_end: params.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as Subscription;
}
```

- [ ] **Step 2: Add `updateStripeCustomerId` to `backend/src/db/queries/users.ts`**

Add at the end of the file:

```typescript
export async function updateStripeCustomerId(
  db: SupabaseClient,
  userId: string,
  stripeCustomerId: string
): Promise<void> {
  const { error } = await db
    .from("users")
    .update({ stripe_customer_id: stripeCustomerId })
    .eq("id", userId);

  if (error) throw error;
}
```

- [ ] **Step 3: Add re-export to `backend/src/db/queries/index.ts`**

Add this line:

```typescript
export * from "./subscriptions";
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

Expect errors from `tier.ts` still referencing `user.tier` — that's fixed next task.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/queries/subscriptions.ts backend/src/db/queries/users.ts backend/src/db/queries/index.ts
git commit -m "feat: add subscription queries and updateStripeCustomerId"
```

---

### Task 4: Tier Resolution Refactor

**Files:**
- Modify: `backend/src/lib/auth.ts`
- Modify: `backend/src/lib/tier.ts`

- [ ] **Step 1: Update `backend/src/lib/auth.ts`**

Add the tier resolution after the user is set on context. The key changes:

1. Import `createSupabaseClient` (already imported) and `getActiveSubscription`
2. After `c.set("user", user)`, resolve and set tier
3. Add `tier` to `ContextVariableMap`

Update the `ContextVariableMap` declaration:

```typescript
declare module "hono" {
  interface ContextVariableMap {
    user: User;
    tier: import("../db/types").Tier;
  }
}
```

At the end of `authMiddleware`, before `await next()`, add:

```typescript
  // Resolve tier from subscription status
  const sub = await getActiveSubscription(db, user.id);
  const tier = (sub?.status === "active" || sub?.status === "past_due") ? "pro" : "free";
  c.set("tier", tier);
```

Note: `db` is already created earlier in the function (`const db = createSupabaseClient(c.env)`). Import `getActiveSubscription` from `../db/queries`.

- [ ] **Step 2: Update `backend/src/lib/tier.ts`**

Replace the full file. Every function should read from `c.get("tier")` instead of `user.tier`:

```typescript
import { Context } from "hono";
import { getTierLimitsFromEnv } from "../db/types";
import { AppError } from "./errors";
import { envOr } from "./env";
import type { Env } from "./env";

export function getTierLimits(c: Context<{ Bindings: Env }>) {
  const tier = c.get("tier") ?? "free";
  const limits = getTierLimitsFromEnv(c.env as unknown as Record<string, string>);
  return limits[tier] ?? limits.free;
}

export function requirePro(c: Context<{ Bindings: Env }>, feature: string) {
  const tier = c.get("tier") ?? "free";
  if (tier !== "pro") {
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    const appUrl = envOr(c.env, "APP_URL", "https://app.synapse.dev");
    throw new AppError(
      `${feature} requires a Pro subscription ($${price}/mo). Upgrade at ${appUrl}/account`,
      403,
      "TIER_LIMIT"
    );
  }
}

export function enforceFileLimit(
  currentCount: number,
  c: Context<{ Bindings: Env }>
) {
  const limits = getTierLimits(c);
  if (currentCount >= limits.maxFiles) {
    const tier = c.get("tier") ?? "free";
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    throw new AppError(
      `File limit reached (${limits.maxFiles} files on ${tier} tier). Upgrade to Pro ($${price}/mo) for more files.`,
      403,
      "TIER_LIMIT"
    );
  }
}

export function enforceConnectionLimit(
  currentConnections: number,
  source: string,
  c: Context<{ Bindings: Env }>
) {
  const limits = getTierLimits(c);
  if (limits.maxConnections === 0) return; // 0 = unlimited
  if (currentConnections >= limits.maxConnections) {
    const tier = c.get("tier") ?? "free";
    const price = envOr(c.env, "TIER_PRO_PRICE", "5.99");
    throw new AppError(
      `Connection limit reached (${limits.maxConnections} sources on ${tier} tier). Upgrade to Pro ($${price}/mo) for unlimited connections.`,
      403,
      "TIER_LIMIT"
    );
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

All `user.tier` references should now be gone. Fix any remaining type errors.

- [ ] **Step 4: Run existing tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

All existing tests should still pass — the tier resolution change is backwards compatible (defaults to "free" when no subscription exists).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/auth.ts backend/src/lib/tier.ts
git commit -m "refactor: resolve tier from subscriptions table instead of user.tier"
```

---

### Task 5: Billing API Endpoints

**Files:**
- Create: `backend/src/api/billing.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Create `backend/src/api/billing.ts`**

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import { createStripeClient } from "../lib/stripe";
import { createSupabaseClient } from "../db/client";
import { getSubscriptionByUserId, upsertSubscription, getSubscriptionByStripeId } from "../db/queries";
import { updateStripeCustomerId } from "../db/queries";
import { AppError } from "../lib/errors";
import { envOr } from "../lib/env";
import type { Env } from "../lib/env";

const billing = new Hono<{ Bindings: Env }>();

// Webhook must be BEFORE auth middleware (Stripe signs requests, no Bearer token)
billing.post("/webhook", async (c) => {
  const stripe = createStripeClient(c.env);
  const body = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    throw new AppError("Missing stripe-signature header", 400, "VALIDATION_ERROR");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[billing] Webhook signature verification failed:", err);
    throw new AppError("Invalid webhook signature", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.client_reference_id;
      if (!userId || !session.subscription) break;

      // Ensure stripe_customer_id is persisted on the user row
      if (session.customer) {
        await updateStripeCustomerId(db, userId, session.customer as string);
      }

      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );

      await upsertSubscription(db, {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        status: "active",
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      });
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const existing = await getSubscriptionByStripeId(db, subscription.id);
      if (!existing) break;

      const status = subscription.status === "active" ? "active"
        : subscription.status === "past_due" ? "past_due"
        : subscription.status === "canceled" ? "canceled"
        : "inactive";

      await upsertSubscription(db, {
        user_id: existing.user_id,
        stripe_subscription_id: subscription.id,
        status,
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      });
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const existing = await getSubscriptionByStripeId(db, subscription.id);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        stripe_subscription_id: subscription.id,
        status: "inactive",
        current_period_end: null,
        cancel_at_period_end: false,
      });
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription as string | null;
      if (!subscriptionId) break;

      const existing = await getSubscriptionByStripeId(db, subscriptionId);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        stripe_subscription_id: subscriptionId,
        status: "past_due",
        current_period_end: existing.current_period_end,
        cancel_at_period_end: existing.cancel_at_period_end,
      });
      break;
    }
  }

  return c.json({ received: true });
});

// All routes below require auth
billing.use("/*", authMiddleware);

// POST /api/billing/checkout
billing.post("/checkout", async (c) => {
  const user = c.get("user");
  const stripe = createStripeClient(c.env);
  const db = createSupabaseClient(c.env);
  const appUrl = envOr(c.env, "APP_URL", "https://app.synapse.dev");

  // Lazily create Stripe customer
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { synapse_user_id: user.id },
    });
    customerId = customer.id;
    await updateStripeCustomerId(db, user.id, customerId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    client_reference_id: user.id,
    mode: "subscription",
    line_items: [{ price: c.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/account?upgraded=true`,
    cancel_url: `${appUrl}/account`,
  });

  if (!session.url) {
    throw new AppError("Failed to create checkout session", 500, "STRIPE_ERROR");
  }

  return c.json({ url: session.url });
});

// POST /api/billing/portal
billing.post("/portal", async (c) => {
  const user = c.get("user");
  const stripe = createStripeClient(c.env);
  const appUrl = envOr(c.env, "APP_URL", "https://app.synapse.dev");

  if (!user.stripe_customer_id) {
    throw new AppError("No billing account found. Subscribe to Pro first.", 400, "VALIDATION_ERROR");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${appUrl}/account`,
  });

  return c.json({ url: session.url });
});

// GET /api/billing/status
billing.get("/status", async (c) => {
  const user = c.get("user");
  const tier = c.get("tier") ?? "free";
  const db = createSupabaseClient(c.env);

  const sub = await getSubscriptionByUserId(db, user.id);

  return c.json({
    tier,
    subscription: sub
      ? {
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
        }
      : null,
  });
});

export { billing };
```

- [ ] **Step 2: Mount billing routes in `backend/src/index.ts`**

Add import:

```typescript
import { billing } from "./api/billing";
```

Add route mounting after the existing authenticated routes (before the MCP mount):

```typescript
app.route("/api/billing", billing);
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 4: Run existing tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/billing.ts backend/src/index.ts
git commit -m "feat: add billing API — checkout, portal, status, webhook endpoints"
```

---

### Task 6: Frontend — API Methods and Server Actions

**Files:**
- Modify: `frontend/src/lib/server/api.ts`
- Modify: `frontend/src/routes/(app)/account/+page.server.ts`

- [ ] **Step 1: Add billing methods to `frontend/src/lib/server/api.ts`**

Add inside the `createApi` return object, after the `setPreference` method:

```typescript
    // Billing
    getBillingStatus: () =>
      request<{
        tier: "free" | "pro";
        subscription: {
          status: string;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
        } | null;
      }>("/api/billing/status", token),
    createCheckout: () =>
      request<{ url: string }>("/api/billing/checkout", token, {
        method: "POST",
      }),
    createPortalSession: () =>
      request<{ url: string }>("/api/billing/portal", token, {
        method: "POST",
      }),
```

- [ ] **Step 2: Update `frontend/src/routes/(app)/account/+page.server.ts`**

Replace the full file with:

```typescript
import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { createApi } from "$lib/server/api";
import { getSupabase } from "$lib/server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  const api = createApi(locals.token);
  try {
    const billing = await api.getBillingStatus();
    return { billing };
  } catch {
    return { billing: { tier: "free" as const, subscription: null } };
  }
};

export const actions: Actions = {
  regenerateKey: async ({ locals }) => {
    const api = createApi(locals.token);
    try {
      const result = await api.regenerateApiKey();
      return { apiKey: result.api_key };
    } catch (err) {
      return fail(400, { error: err instanceof Error ? err.message : "Failed to generate key" });
    }
  },

  connectOAuth: async ({ request, cookies, url }) => {
    const data = await request.formData();
    const provider = data.get("provider") as "google" | "github";

    const supabase = getSupabase(cookies);
    const { data: oauthData, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${url.origin}/auth/callback?redirect=/account` },
    });

    if (error) return fail(400, { error: error.message });
    if (oauthData.url) redirect(303, oauthData.url);
  },

  checkout: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createCheckout();
    redirect(303, url);
    // Note: redirect() throws a Redirect object in SvelteKit.
    // If createCheckout() fails, the error propagates to SvelteKit's
    // default error handler (returns 500). For custom error handling,
    // split into two steps: fetch URL first, then redirect.
  },

  portal: async ({ locals }) => {
    const api = createApi(locals.token);
    const { url } = await api.createPortalSession();
    redirect(303, url);
  },
};
```

Note: The `redirect()` call in SvelteKit throws internally — the `catch` re-throws `Response` instances so the redirect works correctly.

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check`

If `svelte-check` isn't available, run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/server/api.ts frontend/src/routes/\(app\)/account/+page.server.ts
git commit -m "feat: add billing API methods and account page server actions"
```

---

### Task 7: Frontend — BillingCard Component

**Files:**
- Create: `frontend/src/lib/components/account/BillingCard.svelte`
- Modify: `frontend/src/routes/(app)/account/+page.svelte`

- [ ] **Step 1: Create `frontend/src/lib/components/account/BillingCard.svelte`**

```svelte
<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/stores";

  let { billing } = $props<{
    billing: {
      tier: "free" | "pro";
      subscription: {
        status: string;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
      } | null;
    };
  }>();

  let showUpgradeSuccess = $state($page.url.searchParams.has("upgraded"));

  const renewalDate = $derived(
    billing.subscription?.current_period_end
      ? new Date(billing.subscription.current_period_end).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null
  );
</script>

<div
  class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);"
>
  <div class="flex items-center gap-2 mb-2">
    <h3 class="font-medium" style="color: var(--color-accent);">Subscription</h3>
    {#if billing.tier === "pro"}
      <span
        class="text-xs font-semibold px-2 py-0.5 rounded-full"
        style="background-color: var(--color-pink); color: white;"
      >
        PRO
      </span>
    {/if}
  </div>

  {#if showUpgradeSuccess}
    <div
      class="rounded-lg p-3 text-sm mb-3"
      style="background-color: var(--color-success-bg, #ecfdf5); color: var(--color-success, #065f46);"
    >
      Welcome to Pro! Your upgrade is active.
    </div>
  {/if}

  {#if billing.tier === "free"}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      You're on the <strong>Free</strong> plan. Upgrade to Pro for 500 files, unlimited
      connections, and version history.
    </p>
    <form method="POST" action="?/checkout" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-4 py-2 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-pink); color: white; border: none;"
      >
        Upgrade to Pro — $5.99/mo
      </button>
    </form>
  {:else if billing.subscription?.cancel_at_period_end}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Your Pro subscription is active until <strong>{renewalDate}</strong>. It will not renew.
    </p>
    <form method="POST" action="?/portal" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      >
        Manage Subscription
      </button>
    </form>
  {:else}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Pro plan — renews <strong>{renewalDate}</strong>.
    </p>
    <form method="POST" action="?/portal" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      >
        Manage Subscription
      </button>
    </form>
  {/if}
</div>
```

- [ ] **Step 2: Update `frontend/src/routes/(app)/account/+page.svelte`**

Replace the full file:

```svelte
<script>
  import ApiKeyCard from "$lib/components/account/ApiKeyCard.svelte";
  import ConnectedAccounts from "$lib/components/account/ConnectedAccounts.svelte";
  import BillingCard from "$lib/components/account/BillingCard.svelte";

  let { data, form } = $props();
</script>

<div class="max-w-2xl mx-auto p-8">
  <h1 class="text-2xl font-semibold mb-6" style="color: var(--color-accent);">Account</h1>
  <div class="mb-4 text-sm" style="color: var(--color-text-muted);">
    Signed in as {data.user.email}
  </div>
  <div class="space-y-6">
    <BillingCard billing={data.billing} />
    <ApiKeyCard apiKey={form?.apiKey} error={form?.error} />
    <ConnectedAccounts />
  </div>
</div>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/components/account/BillingCard.svelte frontend/src/routes/\(app\)/account/+page.svelte
git commit -m "feat: add BillingCard component to account page"
```

---

### Task 8: Wrangler Config and Final Verification

**Files:**
- Modify: `backend/wrangler.jsonc`

- [ ] **Step 1: Add `STRIPE_PRO_PRICE_ID` to `backend/wrangler.jsonc`**

Add to the `[vars]` section (create if it doesn't exist):

```jsonc
"vars": {
  "STRIPE_PRO_PRICE_ID": "price_PLACEHOLDER"
}
```

The actual value gets set after creating the Stripe product. `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are secrets — set via `wrangler secret put STRIPE_SECRET_KEY` and `wrangler secret put STRIPE_WEBHOOK_SECRET` (not in the config file).

- [ ] **Step 2: Run full backend type check**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 3: Run full backend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 4: Run full frontend check**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check`

- [ ] **Step 5: Commit**

```bash
git add backend/wrangler.jsonc
git commit -m "chore: add STRIPE_PRO_PRICE_ID to wrangler config"
```

- [ ] **Step 6: Final commit — verify clean working tree**

Run: `git status`

Verify no uncommitted changes remain.
