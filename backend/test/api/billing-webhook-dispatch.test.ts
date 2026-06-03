// backend/test/api/billing-webhook-dispatch.test.ts
//
// Pure-function tests for the Creem webhook dispatch switch.
//
// Bug class under guard: "Creem starts emitting a new event_type (e.g.
// the monthly-renewal event), our switch has no case for it, and we
// return 200 OK with zero log lines. Production sees rows where
// created_at == updated_at on every active subscription — see
// docs/BUGS.md 'Creem webhook silently drops renewal events'."
//
// The defensive `default:` branch added in this commit logs and returns
// `{ handled: false }`. These tests pin BOTH that branch's existence
// AND its log emission, so a future removal regresses LOUDLY.
//
// Why a separate file: backend/test/api/billing.test.ts goes through
// the Hono worker + HMAC signature verification — we can't reach the
// switch without computing a valid HMAC. Extracting the dispatcher
// into a pure function (in src/api/billing.ts) lets us test it
// directly with a fake `db` and zero crypto setup.

import { describe, expect, it, vi } from "vitest";
import { dispatchCreemWebhookEvent } from "../../src/api/billing";

// Fake db client. The dispatcher only calls upsertSubscription /
// getSubscriptionByProviderId (both imported from db/queries). Those
// queries route through the supabase client at the top of their
// modules, NOT through the db arg directly — meaning passing a fake
// `db: any` here is a no-op at runtime. The tests below exercise:
//   - the default branch (no db calls needed)
//   - return shape per case (no db state needed)
const fakeDb = {} as never;

describe("dispatchCreemWebhookEvent — default branch (bug-class guard)", () => {
  it("returns { handled: false } for an unknown event_type", async () => {
    // Bug class: Creem starts emitting `subscription.renewed` (or
    // whatever Creem's monthly-renewal event_type turns out to be) and
    // our switch silently swallows it. The defensive default branch
    // makes this observable.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await dispatchCreemWebhookEvent(
      fakeDb,
      "subscription.renewed", // not in our case list
      { id: "sub_test_unknown", customer: { id: "cust_test" } },
    );

    expect(result.handled).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // The log MUST carry enough breadcrumbs to diagnose: event_type,
    // sub_id, customer_id. Without these, `wrangler tail` would show
    // a warn line but no way to correlate to the Creem dashboard.
    const [msg, payload] = warnSpy.mock.calls[0];
    expect(msg).toContain("unhandled Creem webhook event_type");
    expect(payload).toMatchObject({
      event_type: "subscription.renewed",
      sub_id: "sub_test_unknown",
      customer_id: "cust_test",
    });

    warnSpy.mockRestore();
  });

  it("returns { handled: false } AND logs even when obj is undefined", async () => {
    // Robustness: Creem could send a malformed event with no `object`.
    // The default branch must not crash on `obj?.id` chained access.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await dispatchCreemWebhookEvent(fakeDb, "totally.unknown.event", undefined);

    expect(result.handled).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [, payload] = warnSpy.mock.calls[0];
    expect(payload).toMatchObject({
      event_type: "totally.unknown.event",
      sub_id: null,
      customer_id: null,
    });

    warnSpy.mockRestore();
  });

  it("returns { handled: true } for KNOWN event_types even when no DB action is needed", async () => {
    // Positive control: a known event_type with `obj.metadata` lacking
    // `synapse_user_id` is a real production case (early Creem flows
    // before we plumbed metadata). The dispatcher logs and returns
    // handled:true — handled=true means "we recognised the event,"
    // not "we mutated state."
    //
    // If this assertion ever flips to handled:false, that means the
    // default branch is being hit for a recognised event — usually
    // because someone added a `break` without a `return`, falling
    // through to the default. That's the regression we're guarding.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await dispatchCreemWebhookEvent(fakeDb, "checkout.completed", {
      // No metadata.synapse_user_id → early-return path
      id: "sub_x",
    });

    expect(result.handled).toBe(true);
    warnSpy.mockRestore();
  });
});
