// backend/test/db/subscriptions-queries.test.ts
//
// Query-SHAPE contracts for the subscription/tier gating path.
//
// Bug class under guard: "the query that decides who has Plus access drifts
// — someone widens the status filter to include `inactive`, drops
// `past_due`, or changes the upsert conflict target so renewals duplicate
// rows." A passthrough mock can't EXECUTE the Postgres filter, so instead we
// assert the query is CONSTRUCTED correctly (the filter/conflict args are
// applied). Access gating reads `status` (NOT current_period_end — see
// getActiveSubscription), so this filter IS the gate.

import { describe, expect, it } from "vitest";
import { getActiveSubscription, upsertSubscription } from "../../src/db/queries/subscriptions";
import { getTierForUser } from "../../src/lib/tier";

type Op = [method: string, args: unknown[]];

/**
 * Recording query-builder mock. Unlike the shared supabase-mock helper, this
 * one captures the ARGS of every chained filter (eq/in/order/limit/upsert)
 * so we can assert query shape, not just terminal results.
 */
function makeRecordingDb(terminal: { data: unknown; error: unknown } = { data: null, error: null }) {
  const ops: Op[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "upsert"]) {
    builder[m] = (...args: unknown[]) => {
      ops.push([m, args]);
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(terminal);
  builder.single = () => Promise.resolve(terminal);
  const db = {
    ops,
    from: (table: string) => {
      ops.push(["from", [table]]);
      return builder;
    },
    // biome-ignore lint/suspicious/noExplicitAny: cast to SupabaseClient for the query fns under test.
  } as any;
  return { db, ops };
}

/** Find a recorded op by method name. */
function op(ops: Op[], method: string): unknown[] | undefined {
  return ops.find(([m]) => m === method)?.[1];
}

describe("getActiveSubscription — the gating filter (status-driven access)", () => {
  it("filters by user_id AND status IN (active, past_due) — the whole gate", async () => {
    const { db, ops } = makeRecordingDb({ data: null, error: null });

    await getActiveSubscription(db, "user-xyz");

    expect(op(ops, "from")).toEqual(["subscriptions"]);
    expect(op(ops, "eq")).toEqual(["user_id", "user-xyz"]);
    // The exact gate: only active + past_due count as "has access". If this
    // ever includes "inactive"/"canceled" or drops "past_due", access is
    // wrong and this test fails.
    expect(op(ops, "in")).toEqual(["status", ["active", "past_due"]]);
  });

  it("returns the row when one matches", async () => {
    const row = { user_id: "u", status: "active" };
    const { db } = makeRecordingDb({ data: row, error: null });
    expect(await getActiveSubscription(db, "u")).toEqual(row);
  });

  it("returns null when no active/past_due row exists", async () => {
    const { db } = makeRecordingDb({ data: null, error: null });
    expect(await getActiveSubscription(db, "u")).toBeNull();
  });

  it("throws (does not silently pass) on a query error", async () => {
    const { db } = makeRecordingDb({ data: null, error: { message: "boom", code: "XX000" } });
    await expect(getActiveSubscription(db, "u")).rejects.toBeTruthy();
  });
});

describe("getTierForUser — subscription → tier mapping", () => {
  it("active/past_due subscription resolves to 'plus'", async () => {
    const { db } = makeRecordingDb({ data: { user_id: "u", status: "active" }, error: null });
    expect(await getTierForUser(db, "u")).toBe("plus");
  });

  it("no active subscription resolves to 'free'", async () => {
    const { db } = makeRecordingDb({ data: null, error: null });
    expect(await getTierForUser(db, "u")).toBe("free");
  });
});

describe("upsertSubscription — conflict target + defaults", () => {
  it("upserts on the provider_subscription_id conflict target (renewals update, not duplicate)", async () => {
    const written = { id: "row" };
    const { db, ops } = makeRecordingDb({ data: written, error: null });

    await upsertSubscription(db, {
      user_id: "u",
      provider_subscription_id: "sub_1",
      status: "active",
    });

    const upsertArgs = op(ops, "upsert");
    expect(upsertArgs).toBeDefined();
    const [payload, options] = upsertArgs as [Record<string, unknown>, Record<string, unknown>];
    // Conflict target is what makes a repeat event update the existing row
    // instead of inserting a duplicate. Wrong target = stale duplicate rows.
    expect(options).toEqual({ onConflict: "provider_subscription_id" });
    // Defaults applied when caller omits them.
    expect(payload.provider).toBe("creem");
    expect(payload.provider_customer_id).toBeNull();
    expect(payload.current_period_end).toBeNull();
    expect(payload.cancel_at_period_end).toBe(false);
    expect(payload.status).toBe("active");
    expect(payload.user_id).toBe("u");
  });

  it("throws on upsert error (caller sees the failure, not a silent miss)", async () => {
    const { db } = makeRecordingDb({ data: null, error: { message: "conflict", code: "23505" } });
    await expect(
      upsertSubscription(db, { user_id: "u", provider_subscription_id: "s", status: "active" }),
    ).rejects.toBeTruthy();
  });
});
