# Stripe to Creem Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stripe billing with Creem — provider-agnostic subscriptions table, Creem API via raw fetch, HMAC webhook verification.

**Architecture:** Edit the unapplied migration to use generic column names. Replace Stripe SDK/endpoints with Creem raw fetch calls. Same tier resolution, same frontend.

**Tech Stack:** Hono (backend), Supabase PostgreSQL, Creem REST API (no SDK)

**Spec:** `docs/superpowers/specs/2026-03-22-creem-migration-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `supabase/migrations/003_stripe_billing.sql` | Rewrite: provider-agnostic subscriptions table |
| `backend/package.json` | Modify: remove `stripe` dependency |
| `backend/src/db/types.ts` | Modify: remove `stripe_customer_id` from User, update Subscription |
| `backend/src/lib/stripe.ts` | Delete |
| `backend/src/lib/creem.ts` | New: Creem API helper + webhook verification |
| `backend/src/lib/env.ts` | Modify: replace Stripe env vars with Creem |
| `backend/src/db/queries/subscriptions.ts` | Modify: rename stripe_* → provider_* |
| `backend/src/db/queries/users.ts` | Modify: remove `updateStripeCustomerId` |
| `backend/src/api/billing.ts` | Rewrite: Creem checkout, portal, webhook |
| `backend/wrangler.jsonc` | Modify: replace STRIPE_PRO_PRICE_ID with CREEM_PRO_PRODUCT_ID |

---

### Task 1: Migration and Types

**Files:**
- Modify: `supabase/migrations/003_stripe_billing.sql`
- Modify: `backend/src/db/types.ts`

- [ ] **Step 1: Rewrite `supabase/migrations/003_stripe_billing.sql`**

Replace the entire file with:

```sql
-- Subscriptions table (provider-agnostic, synced via webhooks)
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'creem',
  provider_subscription_id text unique not null,
  provider_customer_id text,
  status text not null default 'inactive'
    check (status in ('active', 'canceled', 'past_due', 'inactive')),
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on subscriptions(user_id);
create index idx_subscriptions_provider_sub_id on subscriptions(provider_subscription_id);

-- RLS (defense-in-depth; Worker uses service key which bypasses RLS)
alter table subscriptions enable row level security;

create policy "subscriptions_read_own" on subscriptions for select
  using (user_id = auth.uid());

-- updated_at trigger (matches entries pattern from migration 001)
create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();
```

Note: The old version had `ALTER TABLE users ADD COLUMN stripe_customer_id` — that's gone entirely.

- [ ] **Step 2: Update `backend/src/db/types.ts`**

Remove `stripe_customer_id` from the `User` interface:

```typescript
export interface User {
  id: string;
  email: string;
  google_oauth_tokens: GoogleOAuthTokens | null;
  created_at: string;
}
```

Replace the `Subscription` interface:

```typescript
export interface Subscription {
  id: string;
  user_id: string;
  provider: string;
  provider_subscription_id: string;
  provider_customer_id: string | null;
  status: "active" | "canceled" | "past_due" | "inactive";
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/003_stripe_billing.sql backend/src/db/types.ts
git commit -m "refactor: provider-agnostic subscriptions table, remove stripe_customer_id"
```

---

### Task 2: Creem Helper and Env Vars

**Files:**
- Delete: `backend/src/lib/stripe.ts`
- Create: `backend/src/lib/creem.ts`
- Modify: `backend/src/lib/env.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Delete `backend/src/lib/stripe.ts`**

```bash
rm backend/src/lib/stripe.ts
```

- [ ] **Step 2: Remove `stripe` from `backend/package.json`**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm uninstall stripe`

- [ ] **Step 3: Create `backend/src/lib/creem.ts`**

```typescript
import type { Env } from "./env";

const CREEM_API_URL = "https://api.creem.io/v1";

export async function creemRequest<T>(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${CREEM_API_URL}${path}`, {
    method,
    headers: {
      "x-api-key": env.CREEM_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || `Creem API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function verifyCreemWebhook(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}
```

- [ ] **Step 4: Update `backend/src/lib/env.ts`**

Replace the Stripe section in the `Env` interface:

```typescript
// Stripe
STRIPE_SECRET_KEY: string;
STRIPE_WEBHOOK_SECRET: string;
STRIPE_PRO_PRICE_ID: string;
```

With:

```typescript
// Creem
CREEM_API_KEY: string;
CREEM_WEBHOOK_SECRET: string;
CREEM_PRO_PRODUCT_ID: string;
```

- [ ] **Step 5: Commit**

```bash
git rm backend/src/lib/stripe.ts
git add backend/src/lib/creem.ts backend/src/lib/env.ts backend/package.json
git commit -m "feat: replace Stripe SDK with Creem fetch helper"
```

---

### Task 3: Subscription Queries

**Files:**
- Modify: `backend/src/db/queries/subscriptions.ts`
- Modify: `backend/src/db/queries/users.ts`

- [ ] **Step 1: Replace `backend/src/db/queries/subscriptions.ts`**

Replace the full file:

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

export async function getSubscriptionByProviderId(
  db: SupabaseClient,
  providerSubscriptionId: string
): Promise<Subscription | null> {
  return singleOrNull<Subscription>(
    await db
      .from("subscriptions")
      .select("*")
      .eq("provider_subscription_id", providerSubscriptionId)
      .single()
  );
}

export async function upsertSubscription(
  db: SupabaseClient,
  params: {
    user_id: string;
    provider?: string;
    provider_subscription_id: string;
    provider_customer_id?: string | null;
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
        provider: params.provider ?? "creem",
        provider_subscription_id: params.provider_subscription_id,
        provider_customer_id: params.provider_customer_id ?? null,
        status: params.status,
        current_period_end: params.current_period_end ?? null,
        cancel_at_period_end: params.cancel_at_period_end ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider_subscription_id" }
    )
    .select()
    .single();

  if (error) throw error;
  return data as Subscription;
}
```

- [ ] **Step 2: Remove `updateStripeCustomerId` from `backend/src/db/queries/users.ts`**

Delete the `updateStripeCustomerId` function entirely (lines 47-58 of the current file). Keep everything else.

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/queries/subscriptions.ts backend/src/db/queries/users.ts
git commit -m "refactor: provider-agnostic subscription queries, remove updateStripeCustomerId"
```

---

### Task 4: Rewrite Billing API

**Files:**
- Modify: `backend/src/api/billing.ts`

- [ ] **Step 1: Replace `backend/src/api/billing.ts`**

Replace the full file:

```typescript
import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import { creemRequest, verifyCreemWebhook } from "../lib/creem";
import { createSupabaseClient } from "../db/client";
import { getSubscriptionByUserId, upsertSubscription, getSubscriptionByProviderId, getActiveSubscription } from "../db/queries";
import { AppError } from "../lib/errors";
import { envOr } from "../lib/env";
import type { Env } from "../lib/env";

const billing = new Hono<{ Bindings: Env }>();

// Webhook must be BEFORE auth middleware (Creem signs requests, no Bearer token)
billing.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("creem-signature");

  if (!signature) {
    throw new AppError("Missing creem-signature header", 400, "VALIDATION_ERROR");
  }

  const valid = await verifyCreemWebhook(body, signature, c.env.CREEM_WEBHOOK_SECRET);
  if (!valid) {
    console.error("[billing] Webhook signature verification failed");
    throw new AppError("Invalid webhook signature", 400, "VALIDATION_ERROR");
  }

  const event = JSON.parse(body);
  const eventType = event.event_type as string;
  const obj = event.object;

  const db = createSupabaseClient(c.env);

  switch (eventType) {
    case "checkout.completed": {
      const userId = obj.metadata?.synapse_user_id;
      if (!userId) {
        console.warn("[billing] checkout.completed missing synapse_user_id in metadata");
        break;
      }

      await upsertSubscription(db, {
        user_id: userId,
        provider: "creem",
        provider_subscription_id: obj.subscription?.id ?? obj.id,
        provider_customer_id: obj.customer?.id ?? null,
        status: "active",
        current_period_end: obj.subscription?.current_period_end ?? null,
        cancel_at_period_end: false,
      });
      break;
    }

    case "subscription.active":
    case "subscription.paid": {
      const existing = await getSubscriptionByProviderId(db, obj.id);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        provider_subscription_id: obj.id,
        provider_customer_id: obj.customer?.id ?? existing.provider_customer_id,
        status: "active",
        current_period_end: obj.current_period_end ?? existing.current_period_end,
        cancel_at_period_end: false,
      });
      break;
    }

    case "subscription.scheduled_cancel": {
      const existing = await getSubscriptionByProviderId(db, obj.id);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        provider_subscription_id: obj.id,
        status: existing.status,
        current_period_end: obj.current_period_end ?? existing.current_period_end,
        cancel_at_period_end: true,
      });
      break;
    }

    case "subscription.canceled":
    case "subscription.expired": {
      const existing = await getSubscriptionByProviderId(db, obj.id);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        provider_subscription_id: obj.id,
        status: "inactive",
        current_period_end: null,
        cancel_at_period_end: false,
      });
      break;
    }

    case "subscription.past_due": {
      const existing = await getSubscriptionByProviderId(db, obj.id);
      if (!existing) break;

      await upsertSubscription(db, {
        user_id: existing.user_id,
        provider_subscription_id: obj.id,
        status: "past_due",
        current_period_end: obj.current_period_end ?? existing.current_period_end,
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
  const db = createSupabaseClient(c.env);
  const appUrl = envOr(c.env, "APP_URL", "https://synapsesync.app");

  // Guard against duplicate subscriptions
  const existingSub = await getActiveSubscription(db, user.id);
  if (existingSub) {
    throw new AppError("You already have an active subscription. Manage it from the billing portal.", 400, "VALIDATION_ERROR");
  }

  const result = await creemRequest<{ checkout_url: string }>(c.env, "POST", "/checkouts", {
    product_id: c.env.CREEM_PRO_PRODUCT_ID,
    success_url: `${appUrl}/account?upgraded=true`,
    request_url: `${appUrl}/account`,
    customer_email: user.email,
    metadata: { synapse_user_id: user.id },
  });

  if (!result.checkout_url) {
    throw new AppError("Failed to create checkout session", 500, "CREEM_ERROR");
  }

  return c.json({ url: result.checkout_url });
});

// POST /api/billing/portal
billing.post("/portal", async (c) => {
  const user = c.get("user");
  const db = createSupabaseClient(c.env);
  const appUrl = envOr(c.env, "APP_URL", "https://synapsesync.app");

  const sub = await getSubscriptionByUserId(db, user.id);
  if (!sub?.provider_customer_id) {
    throw new AppError("No billing account found. Subscribe to Pro first.", 400, "VALIDATION_ERROR");
  }

  const result = await creemRequest<{ customer_portal_url: string }>(c.env, "POST", "/customers/billing", {
    customer_id: sub.provider_customer_id,
  });

  return c.json({ url: result.customer_portal_url });
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

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 3: Run tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

Fix any test failures from the removed Stripe types/imports.

- [ ] **Step 4: Commit**

```bash
git add backend/src/api/billing.ts
git commit -m "feat: rewrite billing API for Creem — checkout, portal, webhook"
```

---

### Task 5: Wrangler Config and Final Verification

**Files:**
- Modify: `backend/wrangler.jsonc`

- [ ] **Step 1: Update `backend/wrangler.jsonc`**

Replace `STRIPE_PRO_PRICE_ID` with `CREEM_PRO_PRODUCT_ID` in the `vars` section:

```jsonc
"vars": {
  "CREEM_PRO_PRODUCT_ID": "prod_PLACEHOLDER"
}
```

- [ ] **Step 2: Run full backend type check**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npx tsc --noEmit`

- [ ] **Step 3: Run full backend tests**

Run: `cd /Users/Tanmai.N/Documents/synapse/backend && npm test`

- [ ] **Step 4: Run full frontend check**

Run: `cd /Users/Tanmai.N/Documents/synapse/frontend && npx svelte-check 2>&1 | head -30`

- [ ] **Step 5: Commit**

```bash
git add backend/wrangler.jsonc
git commit -m "chore: replace Stripe vars with Creem in wrangler config"
```

- [ ] **Step 6: Verify clean working tree**

Run: `git status`
