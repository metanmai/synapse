import Stripe from "stripe";
import type { Env } from "./env";

export function createStripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY);
}
