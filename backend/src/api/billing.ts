import { Hono } from "hono";
import { authMiddleware } from "../lib/auth";
import { createStripeClient } from "../lib/stripe";
import { createSupabaseClient } from "../db/client";
import { getSubscriptionByUserId, upsertSubscription, getSubscriptionByStripeId, getActiveSubscription } from "../db/queries";
import { updateStripeCustomerId } from "../db/queries";
import { AppError } from "../lib/errors";
import { envOr } from "../lib/env";
import type { Env } from "../lib/env";
import type Stripe from "stripe";

/** In Stripe API v2025+ (SDK v20), current_period_end moved from Subscription to SubscriptionItem. */
function getSubscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  if (item?.current_period_end) {
    return new Date(item.current_period_end * 1000).toISOString();
  }
  return null;
}

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
    event = await stripe.webhooks.constructEventAsync(body, signature, c.env.STRIPE_WEBHOOK_SECRET);
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
        current_period_end: getSubscriptionPeriodEnd(subscription),
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
        current_period_end: getSubscriptionPeriodEnd(subscription),
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
      // In Stripe API v2025+, subscription moved to invoice.parent.subscription_details.subscription
      const subRef = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof subRef === "string" ? subRef : subRef?.id ?? null;
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

  // Guard against duplicate subscriptions
  const existingSub = await getActiveSubscription(db, user.id);
  if (existingSub) {
    throw new AppError("You already have an active subscription. Manage it from the billing portal.", 400, "VALIDATION_ERROR");
  }

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
