import { Hono } from "hono";
import {
  getActiveSubscription,
  getSubscriptionByProviderId,
  getSubscriptionByUserId,
  upsertSubscription,
} from "../db/queries";
import { authMiddleware } from "../lib/auth";
import { creemRequest, verifyCreemWebhook } from "../lib/creem";
import { envOr } from "../lib/env";
import type { Env } from "../lib/env";
import { AppError } from "../lib/errors";

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

  const db = c.get("db");

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
  const db = c.get("db");
  const appUrl = envOr(c.env, "APP_URL", "https://synapsesync.app");

  // Guard against duplicate subscriptions
  const existingSub = await getActiveSubscription(db, user.id);
  if (existingSub) {
    throw new AppError(
      "You already have an active subscription. Manage it from the billing portal.",
      400,
      "VALIDATION_ERROR",
    );
  }

  const result = await creemRequest<{ checkout_url: string }>(c.env, "POST", "/checkouts", {
    product_id: c.env.CREEM_PRO_PRODUCT_ID,
    success_url: `${appUrl}/account?upgraded=true`,
    customer: { email: user.email },
    metadata: { synapse_user_id: user.id },
  });

  if (!result.checkout_url) {
    throw new AppError("Failed to create checkout session", 500, "CREEM_ERROR");
  }

  return c.json({ url: result.checkout_url });
});

// POST /api/billing/verify — verify checkout completion via Creem API (fallback for webhooks)
billing.post("/verify", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  // Already activated?
  const existingSub = await getActiveSubscription(db, user.id);
  if (existingSub) {
    return c.json({ status: "active" });
  }

  const body = (await c.req.json().catch(() => ({}))) as { checkout_id?: string };
  if (!body.checkout_id) {
    throw new AppError("Missing checkout_id", 400, "VALIDATION_ERROR");
  }

  // Ask Creem directly for the checkout status
  let checkout: {
    status: string;
    subscription?: { id: string; current_period_end_date?: string } | string;
    customer?: { id: string } | string;
  };
  try {
    checkout = await creemRequest(c.env, "GET", `/checkouts?checkout_id=${encodeURIComponent(body.checkout_id)}`);
  } catch {
    throw new AppError("Could not verify checkout — invalid or unknown checkout ID", 400, "VALIDATION_ERROR");
  }

  if (checkout.status !== "completed") {
    return c.json({ status: "pending" });
  }

  const subId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription?.id;
  const custId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id;
  const periodEnd =
    typeof checkout.subscription === "object" ? (checkout.subscription?.current_period_end_date ?? null) : null;

  await upsertSubscription(db, {
    user_id: user.id,
    provider: "creem",
    provider_subscription_id: subId ?? body.checkout_id,
    provider_customer_id: custId ?? null,
    status: "active",
    current_period_end: periodEnd,
    cancel_at_period_end: false,
  });

  return c.json({ status: "active" });
});

// POST /api/billing/portal
billing.post("/portal", async (c) => {
  const user = c.get("user");
  const db = c.get("db");

  const sub = await getSubscriptionByUserId(db, user.id);
  if (!sub?.provider_customer_id) {
    throw new AppError("No billing account found. Subscribe to Plus first.", 400, "VALIDATION_ERROR");
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
  const db = c.get("db");

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
