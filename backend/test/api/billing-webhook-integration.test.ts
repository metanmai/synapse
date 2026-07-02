// backend/test/api/billing-webhook-integration.test.ts
//
// End-to-end webhook contract through the REAL worker: HMAC verification →
// JSON parse → dispatch → DB write. billing.test.ts only covers the reject
// paths (missing/invalid signature); this covers the accept path, which is
// the one that actually moves a subscription.
//
// Bug class under guard: "a correctly-signed Creem webhook is accepted but
// never reaches the dispatcher (routing/middleware regression), so paid
// events are dropped at the HTTP layer." Also pins that an UNKNOWN event
// still returns 200 — Creem retries non-2xx, so a 500 on an unhandled event
// would create a retry storm.

import { vi } from "vitest";
import { __mockState__ } from "../helpers/supabase-mock";

vi.mock("../../src/db/client", () => ({
  createSupabaseClient: () => __mockState__.db?.client,
}));

import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/index";
import { makeContractTestEnv, makeMockSupabase, resetMockState, setMockDb } from "../helpers/supabase-mock";
import { createExecutionContext, waitOnExecutionContext } from "../setup";

const WEBHOOK_SECRET = "test-webhook-secret";

/** Sign a body exactly as verifyCreemWebhook expects (HMAC-SHA256, hex). */
async function sign(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookEnv() {
  return { ...makeContractTestEnv(), CREEM_WEBHOOK_SECRET: WEBHOOK_SECRET };
}

async function postWebhook(body: string, signature: string, env: Record<string, unknown>) {
  const req = new Request("http://localhost/api/billing/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "creem-signature": signature },
    body,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("POST /api/billing/webhook — valid-signature happy path", () => {
  beforeEach(() => resetMockState());

  it("a correctly-signed checkout.completed reaches dispatch and writes the subscription", async () => {
    const db = makeMockSupabase();
    setMockDb(db);

    const body = JSON.stringify({
      event_type: "checkout.completed",
      object: {
        id: "chk_int",
        metadata: { synapse_user_id: "user-int" },
        subscription: { id: "sub_int", current_period_end: "2026-09-01T00:00:00.000Z" },
        customer: { id: "cust_int" },
      },
    });
    const res = await postWebhook(body, await sign(body, WEBHOOK_SECRET), webhookEnv());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });

    const upsert = db.calls.find((c) => c.op === "upsert" && c.table === "subscriptions");
    expect(upsert, "dispatch should have upserted the subscription").toBeDefined();
    expect((upsert?.args as Record<string, unknown>).status).toBe("active");
    expect((upsert?.args as Record<string, unknown>).user_id).toBe("user-int");
  });

  it("a correctly-signed UNKNOWN event returns 200 (no Creem retry storm) but writes nothing", async () => {
    const db = makeMockSupabase();
    setMockDb(db);

    const body = JSON.stringify({ event_type: "invoice.paid", object: { id: "sub_int" } });
    const res = await postWebhook(body, await sign(body, WEBHOOK_SECRET), webhookEnv());

    expect(res.status).toBe(200);
    expect(db.calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("a tampered body (signature no longer matches) is rejected, not dispatched", async () => {
    const db = makeMockSupabase();
    setMockDb(db);

    const signed = JSON.stringify({ event_type: "checkout.completed", object: { id: "a" } });
    const signature = await sign(signed, WEBHOOK_SECRET);
    const tampered = JSON.stringify({ event_type: "checkout.completed", object: { id: "TAMPERED" } });

    const res = await postWebhook(tampered, signature, webhookEnv());

    expect(res.status).toBe(400);
    expect(db.calls.some((c) => c.op === "upsert")).toBe(false);
  });
});
