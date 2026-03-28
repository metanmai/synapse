# Stripe to Creem Migration Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Replace Stripe billing integration with Creem (merchant of record). The `subscriptions` table becomes provider-agnostic. Creem's API is simpler — no customer pre-creation, raw fetch instead of an SDK.

## Decisions

- **Provider-agnostic data model** — `subscriptions` table uses `provider`, `provider_subscription_id`, `provider_customer_id` instead of Stripe-specific column names
- **No provider-specific fields on users** — drop `stripe_customer_id` from User type (never applied to DB)
- **No SDK** — Creem's API is simple enough for raw `fetch` calls. Remove the `stripe` npm package.
- **Same tier resolution** — auth middleware checks `subscriptions.status` exactly as before. Provider doesn't matter.
- **Same frontend** — BillingCard and server actions call the same `/api/billing/*` endpoints. No frontend changes needed.

## Creem API Reference

- **Base URL**: `https://api.creem.io/v1` (production), `https://test-api.creem.io/v1` (sandbox)
- **Auth**: `x-api-key` header with API key (prefixed `creem_` or `creem_test_`)
- **Checkout**: `POST /v1/checkouts` with `{ product_id, success_url, customer_email }`
- **Customer Portal**: `POST /v1/customers/billing` with `{ customer_id }`
- **Webhook verification**: HMAC-SHA256 on request body using webhook secret, compared to `creem-signature` header

## Database Changes

### Edit `003_stripe_billing.sql` (not yet applied)

Replace the entire migration with provider-agnostic columns:

```sql
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

alter table subscriptions enable row level security;

create policy "subscriptions_read_own" on subscriptions for select
  using (user_id = auth.uid());

create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();
```

**Removed**: The `ALTER TABLE users ADD COLUMN stripe_customer_id` line is gone entirely.

### User type

Remove `stripe_customer_id` from the `User` interface in `types.ts`. The field was never in the database (migration 003 wasn't applied).

### Subscription type

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

## Backend Changes

### Remove Stripe

- Delete `backend/src/lib/stripe.ts`
- Remove `stripe` from `backend/package.json`

### New: `backend/src/lib/creem.ts`

Simple fetch helper for Creem API:

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

Note: `verifyCreemWebhook` uses Web Crypto API (works on Cloudflare Workers). No SDK needed.

### Env var changes

Replace in `Env` interface:

```
STRIPE_SECRET_KEY      → CREEM_API_KEY
STRIPE_WEBHOOK_SECRET  → CREEM_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID    → CREEM_PRO_PRODUCT_ID
```

### Rewrite `backend/src/api/billing.ts`

#### `POST /api/billing/checkout`

```typescript
const result = await creemRequest(c.env, "POST", "/checkouts", {
  product_id: c.env.CREEM_PRO_PRODUCT_ID,
  success_url: `${appUrl}/account?upgraded=true`,
  customer_email: user.email,
  metadata: { synapse_user_id: user.id },
});
return c.json({ url: result.checkout_url });
```

No customer pre-creation needed. Creem creates the customer from the email during checkout.

#### `POST /api/billing/portal`

Requires a `creem_customer_id` which we store on the subscription row (from the webhook).

```typescript
const sub = await getSubscriptionByUserId(db, user.id);
if (!sub?.provider_customer_id) {
  throw new AppError("No billing account found.", 400, "VALIDATION_ERROR");
}
const result = await creemRequest(c.env, "POST", "/customers/billing", {
  customer_id: sub.provider_customer_id,
});
return c.json({ url: result.customer_portal_url });
```

#### `GET /api/billing/status`

No change — already reads from local `subscriptions` table.

#### `POST /api/billing/webhook`

Verify `creem-signature` header with HMAC-SHA256, then handle events:

| Creem Event | Action |
|-------------|--------|
| `checkout.completed` | Upsert subscription: status=active, store provider_subscription_id, provider_customer_id from payload |
| `subscription.active` / `subscription.paid` | Update status=active, update current_period_end |
| `subscription.scheduled_cancel` | Set cancel_at_period_end=true |
| `subscription.canceled` / `subscription.expired` | Set status=inactive, cancel_at_period_end=false |
| `subscription.past_due` | Set status=past_due |

**User resolution in webhooks**: Creem supports `metadata` on checkouts. We pass `{ synapse_user_id: user.id }` during checkout creation. The `checkout.completed` webhook payload includes this metadata — used to find the user. For subscription events, we look up by `provider_subscription_id`.

### Subscription query changes

Update `upsertSubscription` to use the new column names:

- `stripe_subscription_id` → `provider_subscription_id` (onConflict key)
- Add `provider` and `provider_customer_id` fields

Update `getSubscriptionByStripeId` → `getSubscriptionByProviderId`:

```typescript
export async function getSubscriptionByProviderId(
  db: SupabaseClient,
  providerSubscriptionId: string
): Promise<Subscription | null> {
  // ... .eq("provider_subscription_id", providerSubscriptionId)
}
```

### Wrangler config

Replace `STRIPE_PRO_PRICE_ID` with `CREEM_PRO_PRODUCT_ID` in `vars`. Secrets: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET` via `wrangler secret put`.

## Frontend Changes

**None required.** The frontend calls `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/status` — all of which keep the same request/response shapes. `BillingCard.svelte` and the server actions work unchanged.

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/003_stripe_billing.sql` | Rewrite: provider-agnostic subscriptions table, no stripe_customer_id on users |
| `backend/package.json` | Remove `stripe` dependency |
| `backend/src/db/types.ts` | Remove `stripe_customer_id` from User, update Subscription to provider-agnostic |
| `backend/src/lib/stripe.ts` | Delete |
| `backend/src/lib/creem.ts` | New: Creem API fetch helper + webhook verification |
| `backend/src/lib/env.ts` | Replace Stripe env vars with Creem env vars |
| `backend/src/api/billing.ts` | Rewrite: Creem checkout, portal, webhook handlers |
| `backend/src/db/queries/subscriptions.ts` | Rename columns: stripe_* → provider_* |
| `backend/wrangler.jsonc` | Replace STRIPE_PRO_PRICE_ID with CREEM_PRO_PRODUCT_ID |

## Creem Dashboard Setup (manual, one-time)

1. Sign up at creem.io
2. Create Product: "Synapse Pro", $5.99/mo recurring
3. Copy Product ID → `CREEM_PRO_PRODUCT_ID`
4. Create Webhook: URL `https://api.synapsesync.app/api/billing/webhook`, events: all subscription + checkout events
5. Copy Webhook Secret → `CREEM_WEBHOOK_SECRET`
6. Copy API Key → `CREEM_API_KEY`
