# Stripe Integration Design

**Date**: 2026-03-22
**Status**: Approved
**Author**: Tanmai + Claude

## Overview

Integrate Stripe into Synapse to enable paid subscriptions. Two tiers: Free and Pro ($5.99/mo). Stripe is the source of truth for billing state — no `tier` column in the database.

## Tiers

| Feature | Free | Pro ($5.99/mo) |
|---------|------|----------------|
| Max files | 50 | 500 |
| Max connections | 3 | Unlimited |
| Version history | No | Yes |

## Decisions

- **Stripe Checkout (hosted)** for payment collection — redirect to Stripe, no custom payment UI
- **Stripe Customer Portal** for subscription management — cancel, update payment, view invoices
- **No free trial** — straight free-to-paid upgrade
- **End-of-billing-period downgrade** on cancellation (`cancel_at_period_end`)
- **Soft downgrade** — downgraded users keep read/edit/delete access to existing files, but can't create new files if over free limits. No data deletion.
- **Stripe-as-source-of-truth** — a `subscriptions` table synced via webhooks derives the tier. No `tier` column on users.

## Database Changes

### New `subscriptions` table

```sql
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  stripe_customer_id text unique not null,
  stripe_subscription_id text unique,
  status text not null default 'inactive',  -- 'active', 'canceled', 'past_due', 'inactive'
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_subscriptions_user_id on subscriptions(user_id);
create index idx_subscriptions_stripe_customer_id on subscriptions(stripe_customer_id);
```

### Alter `users` table

```sql
alter table users add column stripe_customer_id text unique;
```

## Backend API — Billing Endpoints

New route file: `backend/src/api/billing.ts`, mounted at `/api/billing` in `index.ts`.

### New environment variables

| Variable | Secret | Storage | Purpose |
|----------|--------|---------|---------|
| `STRIPE_SECRET_KEY` | Yes | Wrangler secrets | Stripe API authentication |
| `STRIPE_WEBHOOK_SECRET` | Yes | Wrangler secrets | Webhook signature verification |
| `STRIPE_PRO_PRICE_ID` | No | wrangler.jsonc | Price ID for the Pro plan |

### Endpoints

#### `POST /api/billing/checkout` (authenticated)

Creates a Stripe Checkout session for the Pro plan.

- Lazily creates a Stripe Customer if the user doesn't have a `stripe_customer_id` yet
- Stores `stripe_customer_id` on the `users` row
- Returns `{ url: string }` — the Stripe Checkout URL
- Frontend redirects the user to this URL
- `success_url`: `{APP_URL}/account?upgraded=true`
- `cancel_url`: `{APP_URL}/account`

#### `POST /api/billing/portal` (authenticated)

Creates a Stripe Customer Portal session.

- Requires user to have a `stripe_customer_id` (returns 400 if not)
- Returns `{ url: string }` — the Portal URL
- Frontend redirects the user to this URL

#### `GET /api/billing/status` (authenticated)

Returns the user's current billing state.

- Response: `{ tier: "free" | "pro", subscription: { status, current_period_end, cancel_at_period_end } | null }`
- Reads from the local `subscriptions` table (no Stripe API call)

#### `POST /api/billing/webhook` (unauthenticated — Stripe signature verified)

Receives Stripe webhook events. Skips auth middleware. Verifies `stripe-signature` header using `stripe.webhooks.constructEvent()`.

**Events handled:**

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Create/update subscription row, set status=active |
| `customer.subscription.updated` | Update status, current_period_end, cancel_at_period_end |
| `customer.subscription.deleted` | Set status=inactive (downgrade to free) |
| `invoice.payment_failed` | Set status=past_due |

Idempotent: uses `stripe_subscription_id` as unique key — replayed events are safe.

## Tier Resolution Changes

### Current behavior (removed)

```typescript
// OLD: reads user.tier directly
const tier = user.tier ?? "free";
```

### New behavior

Tier is resolved once per request in the auth middleware by querying the `subscriptions` table:

```typescript
// In auth middleware, after resolving user:
const sub = await getActiveSubscription(db, user.id);
const tier = sub?.status === "active" ? "pro" : "free";
c.set("tier", tier);
```

All downstream functions (`enforceFileLimit`, `enforceConnectionLimit`, `requirePro`) read `c.get("tier")` instead of `user.tier`.

### Type changes

- Remove `tier` field from `User` interface
- Add `tier` to Hono's `ContextVariableMap` (like `user` is today)

### Downgrade behavior

When a Pro subscription ends (status becomes `inactive`):
- Tier resolves to `"free"` on next request
- Existing files: full read, edit, delete access
- New file creation: blocked if over free limit (50 files)
- History/restore endpoints: return 403
- Connection limit: not enforced retroactively — only checked on new entry creation with new source

## Frontend Changes

### Account page (`/account`)

Add a `BillingCard.svelte` component below the existing cards.

**States:**

1. **Free user**: Shows current tier, file/connection usage, and an "Upgrade to Pro — $5.99/mo" button
   - Button calls `POST /api/billing/checkout` and redirects to the returned URL

2. **Pro user (active)**: Shows "Pro" badge, renewal date, and a "Manage Subscription" button
   - Button calls `POST /api/billing/portal` and redirects to the returned URL

3. **Pro user (canceling)**: Shows "Pro until {date}" with a note that it won't renew
   - "Manage Subscription" button still available (user can re-subscribe via Portal)

4. **Checkout success**: When redirected back with `?upgraded=true`, show a brief success toast

### No standalone pricing page

The upgrade flow lives entirely within the account page. No `/pricing` route.

### Error handling

Existing 403 responses with `code: "TIER_LIMIT"` already include upgrade text. The upgrade link (`/account`) now has a working checkout button. No changes needed to MCP server or API client error handling.

## Dependencies

- Add `stripe` npm package to `backend/package.json`

## Stripe Dashboard Configuration (manual, one-time)

1. Create Product: "Synapse Pro"
2. Create Price: $5.99/mo recurring, copy Price ID to `STRIPE_PRO_PRICE_ID`
3. Configure Customer Portal: allow cancellation, no plan switching
4. Create Webhook endpoint: `https://api.synapse.dev/api/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/003_subscriptions.sql` | New migration: subscriptions table + stripe_customer_id on users |
| `backend/package.json` | Add `stripe` dependency |
| `backend/src/lib/env.ts` | Add Stripe env vars to `Env` interface |
| `backend/src/db/types.ts` | Remove `tier` from `User`, add `Subscription` type |
| `backend/src/db/queries/subscriptions.ts` | New: CRUD for subscriptions table |
| `backend/src/api/billing.ts` | New: 4 billing endpoints |
| `backend/src/index.ts` | Mount billing routes |
| `backend/src/lib/auth.ts` | Resolve tier in middleware, set on context |
| `backend/src/lib/tier.ts` | Read from `c.get("tier")` instead of `user.tier` |
| `frontend/src/lib/components/account/BillingCard.svelte` | New: billing UI component |
| `frontend/src/routes/(app)/account/+page.svelte` | Add BillingCard |
| `frontend/src/routes/(app)/account/+page.server.ts` | Fetch billing status |
