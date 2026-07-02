// backend/test/api/billing-webhook-transitions.test.ts
//
// State-transition tests for the Creem webhook dispatcher.
//
// Bug class under guard: "a subscription lifecycle event maps to the WRONG
// status (or no write), so a paying user silently loses access — or a
// canceled user silently keeps it." This is the part that, if it breaks,
// breaks money.
//
// Why this complements billing-webhook-dispatch.test.ts: that file only
// pins the `default:` branch (handled:false + log breadcrumb) and its
// header claims a fake `db` is a runtime no-op. That claim is STALE — the
// dispatcher passes `db` straight through to upsertSubscription/
// getSubscriptionByProviderId (see src/db/queries/subscriptions.ts, which
// uses the `db` arg directly, no module-level client). So the mock's
// `calls` recorder DOES observe the write, and we can assert the exact
// status each event produces.
//
// No worker, no HMAC: the dispatcher is an exported pure function.

import { describe, expect, it } from "vitest";
import { dispatchCreemWebhookEvent } from "../../src/api/billing";
import { makeMockSupabase } from "../helpers/supabase-mock";

const EXISTING = {
  user_id: "user-existing",
  provider: "creem",
  provider_subscription_id: "sub_123",
  provider_customer_id: "cust_123",
  status: "active",
  current_period_end: "2026-07-01T00:00:00.000Z",
  cancel_at_period_end: false,
};

/** Build a mock whose subscriptions lookup returns `existing` (or null). */
function dbWithExisting(existing: unknown) {
  const db = makeMockSupabase();
  db.tables.subscriptions = { single: () => ({ data: existing, error: null }) };
  return db;
}

/** The recorded upsert payload to `subscriptions`, or undefined if none. */
function upsertPayload(db: ReturnType<typeof makeMockSupabase>) {
  const call = db.calls.find((c) => c.op === "upsert" && c.table === "subscriptions");
  return call?.args as Record<string, unknown> | undefined;
}

describe("dispatchCreemWebhookEvent — lifecycle transition matrix (the money path)", () => {
  // Each known lifecycle event for an EXISTING subscription must land the
  // row on a specific status. This is the contract access-gating reads.
  const matrix: Array<{
    event: string;
    obj: Record<string, unknown>;
    expectStatus: string;
    expectCancelAtPeriodEnd?: boolean;
  }> = [
    { event: "subscription.active", obj: { id: "sub_123" }, expectStatus: "active", expectCancelAtPeriodEnd: false },
    { event: "subscription.paid", obj: { id: "sub_123" }, expectStatus: "active", expectCancelAtPeriodEnd: false },
    {
      event: "subscription.canceled",
      obj: { id: "sub_123" },
      expectStatus: "inactive",
      expectCancelAtPeriodEnd: false,
    },
    { event: "subscription.expired", obj: { id: "sub_123" }, expectStatus: "inactive", expectCancelAtPeriodEnd: false },
    { event: "subscription.past_due", obj: { id: "sub_123" }, expectStatus: "past_due" },
    // scheduled_cancel keeps the current status (still active until it lapses)
    // but flips cancel_at_period_end on.
    {
      event: "subscription.scheduled_cancel",
      obj: { id: "sub_123" },
      expectStatus: "active",
      expectCancelAtPeriodEnd: true,
    },
  ];

  it.each(matrix)("$event → status '$expectStatus'", async ({ event, obj, expectStatus, expectCancelAtPeriodEnd }) => {
    const db = dbWithExisting(EXISTING);

    const result = await dispatchCreemWebhookEvent(db.client, event, obj);

    expect(result.handled).toBe(true);
    const payload = upsertPayload(db);
    expect(payload, "expected an upsert to subscriptions").toBeDefined();
    expect(payload?.status).toBe(expectStatus);
    expect(payload?.user_id).toBe(EXISTING.user_id);
    expect(payload?.provider_subscription_id).toBe("sub_123");
    if (expectCancelAtPeriodEnd !== undefined) {
      expect(payload?.cancel_at_period_end).toBe(expectCancelAtPeriodEnd);
    }
  });

  it("canceled/expired clear current_period_end (no lingering paid-through date)", async () => {
    const db = dbWithExisting(EXISTING);
    await dispatchCreemWebhookEvent(db.client, "subscription.canceled", { id: "sub_123" });
    expect(upsertPayload(db)?.current_period_end).toBeNull();
  });
});

describe("dispatchCreemWebhookEvent — checkout.completed (subscription birth)", () => {
  it("creates an ACTIVE subscription keyed to metadata.synapse_user_id", async () => {
    const db = makeMockSupabase();
    const result = await dispatchCreemWebhookEvent(db.client, "checkout.completed", {
      id: "chk_1",
      metadata: { synapse_user_id: "user-123" },
      subscription: { id: "sub_new", current_period_end: "2026-08-01T00:00:00.000Z" },
      customer: { id: "cust_new" },
    });

    expect(result.handled).toBe(true);
    const payload = upsertPayload(db);
    expect(payload?.status).toBe("active");
    expect(payload?.user_id).toBe("user-123");
    expect(payload?.provider).toBe("creem");
    expect(payload?.provider_subscription_id).toBe("sub_new");
    expect(payload?.current_period_end).toBe("2026-08-01T00:00:00.000Z");
  });

  it("does NOT write a row when synapse_user_id is missing (no orphan/un-attributable sub)", async () => {
    const db = makeMockSupabase();
    const result = await dispatchCreemWebhookEvent(db.client, "checkout.completed", { id: "chk_1" });

    expect(result.handled).toBe(true); // recognised, but intentionally a no-op
    expect(upsertPayload(db)).toBeUndefined();
  });
});

describe("dispatchCreemWebhookEvent — guards", () => {
  it("a lifecycle event for an UNKNOWN subscription does not fabricate a row", async () => {
    // getSubscriptionByProviderId returns null (default mock) → early return.
    const db = makeMockSupabase();
    const result = await dispatchCreemWebhookEvent(db.client, "subscription.canceled", { id: "sub_unknown" });

    expect(result.handled).toBe(true);
    expect(upsertPayload(db)).toBeUndefined();
  });

  it("an UNHANDLED event type (e.g. a renewal event) changes no state", async () => {
    // Bug class: Creem's actual monthly-renewal event_type isn't yet known
    // (`invoice.paid` / `subscription.renewed` / `invoice.succeeded`). Until
    // a case is added, such events MUST be observably inert — handled:false
    // and zero writes. The day a renewal case lands, this test flips RED and
    // forces the matrix above to be extended. That red is the signal, not a
    // failure.
    const db = dbWithExisting(EXISTING);
    const result = await dispatchCreemWebhookEvent(db.client, "invoice.paid", { id: "sub_123" });

    expect(result.handled).toBe(false);
    expect(upsertPayload(db)).toBeUndefined();
  });
});
