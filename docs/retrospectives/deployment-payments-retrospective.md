# Deployment & Payments Retrospective — Synapse Project

**Date**: 2026-03-24
**Project**: Synapse (context management tool with web frontend, backend API, CLI/MCP server)

---

## Deployment Architecture

| Component | Platform | Config | Deploy Command |
|-----------|----------|--------|----------------|
| Backend API | Cloudflare Workers | `backend/wrangler.jsonc` | `wrangler deploy` |
| Frontend | SvelteKit (adapter-auto) | `frontend/svelte.config.js` | `vite build` |
| MCP Package | npm (`synapsesync-mcp`) | `mcp/package.json` | `npm publish` |
| Database | Supabase PostgreSQL | `supabase/config.toml` | `supabase db push` |

### Backend Details
- Custom domain: `api.synapsesync.app`
- Durable Objects: `SynapseAgent` for MCP streaming (Streamable HTTP transport)
- Scheduled jobs: Cron every 5 min (`*/5 * * * *`) for Google Drive sync
- Rate limiting: 120 req/min per API key or IP (in-memory per isolate)

### Secrets Management
- **Secrets** (via `wrangler secret put`): `SUPABASE_SERVICE_KEY`, `GOOGLE_CLIENT_SECRET`, `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`
- **Public vars** (in `wrangler.jsonc`): `CREEM_PRO_PRODUCT_ID`, `CORS_ORIGINS`, `APP_URL`
- **Local dev**: `.dev.vars` file (gitignored)
- **Frontend**: `.env` with `API_URL`, Supabase credentials

---

## Deployment Issues & Challenges

### 1. npm Package Name Collision
**Problem**: The original package name `synapse-mcp` was already taken on the npm registry.
**Fix** (commit `3b08dda`): Renamed to `synapsesync-mcp`. Had to update all references — package.json, bin entry, CLAUDE.md instructions, and documentation.
**Lesson**: Check npm name availability **before** writing docs and setup instructions that reference the package name. Reserve the name early with a placeholder publish if needed.

### 2. CLI Required Full SDK to Run Login
**Problem**: When users ran `npx synapsesync-mcp login`, it tried to import `@modelcontextprotocol/sdk` at the top level, which isn't installed during `npx` for a quick login. The entire CLI would crash before reaching the login handler.
**Fix** (commit `bbb3094`): Moved `require('@modelcontextprotocol/sdk/...')` to **after** CLI command handling. Login/signup code runs first with zero extra dependencies.
**Lesson**: Entry points for CLI tools published via `npx` must handle the bootstrap carefully. Auth commands (login/signup) should require only Node.js builtins. Defer heavy SDK imports to the actual server startup path.

### 3. Custom Domain Setup
**Config** (commit `faf593b`): Added `api.synapsesync.app` custom domain to `wrangler.jsonc` routes.
**Gotcha**: Cloudflare Workers custom domains require DNS to be managed through Cloudflare. If the domain's DNS is elsewhere, you need to use the `routes` configuration and set up a CNAME.
**Lesson**: Plan the domain/DNS setup early. Custom domain configuration for Workers is straightforward but requires Cloudflare-managed DNS.

### 4. Durable Objects for MCP Streaming
**Architecture decision**: The MCP server endpoint (`/mcp`) uses a Cloudflare Durable Object (`SynapseAgent`) to maintain session state for the Streamable HTTP transport. Workers are stateless — each request may hit a different isolate.
**Config**: Durable Object binding `MCP_OBJECT` with SQLite migration tag `v1`.
**Lesson**: If your Workers app needs session state or long-lived connections (WebSocket, SSE, streaming), Durable Objects are the answer. Plan for them from the start — they require migration configuration.

### 5. Rate Limiting with In-Memory State
**Challenge**: Cloudflare Workers have no shared memory between isolates. Rate limit state is per-isolate, meaning a user could potentially exceed limits by hitting different isolates.
**Current approach**: In-memory `Map` with TTL per isolate — good enough for most abuse prevention but not globally consistent.
**Lesson**: For strict rate limiting on Workers, use Durable Objects or Cloudflare's built-in rate limiting features. In-memory per-isolate is acceptable for "best effort" rate limiting.

### 6. No CI/CD Pipeline
**Current state**: Deployment is manual (`wrangler deploy`, `npm publish`). Only `.github/FUNDING.yml` exists.
**Lesson**: Fine for solo early-stage, but add GitHub Actions for deploy-on-push and publish-on-tag before onboarding contributors.

---

## Payments: Stripe → Creem Migration

### Why the Switch
Originally integrated Stripe for billing. Migrated to **Creem** (merchant of record) before launch. Creem handles tax compliance, invoicing, and acts as the merchant of record — removing the burden of tax handling that Stripe requires you to manage yourself.

### Migration Steps
1. Designed **provider-agnostic** `subscriptions` table (commit `49e52b2`) — removed `stripe_customer_id` from users table, added `provider` column defaulting to `'creem'`
2. Renamed migration from `003_stripe_billing.sql` → `003_subscriptions.sql` (commit `3148caa`)
3. Rewrote billing API endpoints for Creem (commit `7bf5ebb`)
4. Updated wrangler config: replaced Stripe env vars with Creem vars (commit `3578373`)

### Billing Architecture

**Provider**: Creem (no SDK — raw `fetch()` via helper `creemRequest<T>()`)

**Endpoints** (`backend/src/api/billing.ts`):
- `POST /api/billing/checkout` — Creates checkout session (passes `user_id` in metadata)
- `POST /api/billing/portal` — Generates customer portal URL
- `GET /api/billing/status` — Returns tier + subscription state
- `POST /api/billing/webhook` — Handles Creem webhook events (no auth required, signature verified)

**Webhook Signature**: HMAC-SHA256 via Web Crypto API (`crypto.subtle`), not Node.js `crypto`

**Database Schema** (`supabase/migrations/003_subscriptions.sql`):
```sql
create table subscriptions (
  id uuid primary key,
  user_id uuid not null references users(id),
  provider text default 'creem',
  provider_subscription_id text unique not null,
  provider_customer_id text,
  status text,  -- active, canceled, past_due, inactive
  current_period_end timestamptz,
  cancel_at_period_end boolean,
  created_at timestamptz,
  updated_at timestamptz
);
```

### Webhook Events Handled
| Event | Action |
|-------|--------|
| `checkout.completed` | Extract user from metadata, create subscription as active |
| `subscription.active` / `subscription.paid` | Update status=active, refresh period_end |
| `subscription.scheduled_cancel` | Set cancel_at_period_end=true |
| `subscription.canceled` / `subscription.expired` | Set status=inactive |
| `subscription.past_due` | Set status=past_due (**user retains access** during retry window) |

### Tier Enforcement
| Resource | Free | Pro |
|----------|------|-----|
| Files | 50 | 500 |
| Connections | 3 | Unlimited |
| History versions | 3 | Unlimited |
| Team members | 2 | Unlimited |

- Tier resolved per-request in auth middleware (reads subscription status)
- All limits configurable via env vars (`TIER_FREE_MAX_FILES`, etc.)
- Error responses include `TIER_LIMIT` code and upgrade URL (`{APP_URL}/account`)
- Pro pricing: $5.99/month

---

## Payments Issues & Challenges

### 1. Provider-Agnostic Schema Design
**Challenge**: Initially designed schema with Stripe-specific columns (`stripe_customer_id` on users table). Migrating to Creem required restructuring.
**Solution**: Redesigned to use `provider`, `provider_subscription_id`, `provider_customer_id` — generic columns that work with any payment provider.
**Lesson**: **Design billing schema provider-agnostically from the start.** The extra abstraction costs nothing but saves a painful migration.

### 2. Web Crypto API vs Node.js `crypto`
**Challenge**: Webhook signature verification needed HMAC-SHA256. Cloudflare Workers don't have Node.js `crypto` module.
**Solution**: Used Web Crypto API (`crypto.subtle.importKey`, `crypto.subtle.sign`) — all async operations.
**Lesson**: Always use platform-appropriate crypto. Workers = Web Crypto API. Test signature verification with the provider's test mode before going live.

### 3. Handling All Webhook Event Types
**Challenge**: Initially only handled `checkout.completed`. Cancellation, expiry, and past-due states were unhandled.
**Solution**: Mapped out ALL events from Creem's docs and implemented handlers for each. Key decision: `past_due` still grants access (don't cut off users during payment retry window).
**Lesson**: Map out ALL webhook events your payment provider can send before implementing. Don't just handle the happy path. Cancellation, expiry, and past_due are critical for UX.

### 4. User ID Linking in Checkout
**Challenge**: After checkout, the webhook needs to know which user just paid. The user isn't authenticated in the webhook — it's server-to-server.
**Solution**: Pass `user_id` in the checkout session metadata. Extract it in the webhook handler.
**Gotcha**: If metadata structure changes or isn't set correctly, the subscription can't be linked.
**Lesson**: Always pass your internal user ID in checkout metadata. Validate it exists in the webhook handler. Log clearly if it's missing.

### 5. No Creem SDK — Raw Fetch
**Decision**: Used raw `fetch()` with a typed helper instead of an SDK.
**Reasoning**: Creem's API is simple (REST + JSON, ~3 endpoints). An SDK would add a dependency and bundle size for minimal benefit.
**Lesson**: For simple REST APIs with few endpoints, a raw fetch wrapper is often better than an SDK dependency. Fewer dependencies = fewer things to break.

### 6. "Never Subscribed" Portal Edge Case
**Challenge**: If a user who never subscribed clicks "Manage Subscription," the portal endpoint would crash trying to look up a non-existent subscription.
**Solution**: Check for subscription record first, return a clear error.
**Lesson**: Handle the "never subscribed" case gracefully everywhere subscriptions are referenced.

---

## Key Takeaways for Future Projects

### Deployment
1. **Check npm name availability before writing docs** — name collisions require updating every reference
2. **Defer heavy imports in CLI entry points** — auth commands should work with minimal deps
3. **Plan custom domain/DNS early** — especially with Cloudflare Workers
4. **Use Durable Objects for session state** — Workers are stateless, plan accordingly
5. **In-memory rate limiting is "good enough" but not strict** — per-isolate on Workers
6. **Document all required secrets** — new devs need to know what to set and where
7. **Add CI/CD before onboarding contributors** — manual deploys are fine solo

### Payments
1. **Design billing schema provider-agnostically** — `provider` + `provider_*_id` columns
2. **Handle ALL webhook events** — not just the happy path
3. **Keep users on past_due** — don't cut off access immediately on payment failure
4. **Pass user ID in checkout metadata** — it's the link between payment and your user record
5. **Use Web Crypto API on Workers** — not Node.js crypto for webhook verification
6. **Make tier limits env-var-configurable** — avoids redeployment for changes
7. **Include upgrade URL in tier limit errors** — enables immediate frontend action
8. **Raw fetch over SDK for simple APIs** — fewer dependencies, less to break
9. **Merchant of record (Creem) vs self-managed (Stripe)** — Creem handles tax/invoicing; worth the tradeoff for small teams
