import { Hono } from "hono";
import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import { createUser, findUserByEmail } from "../db/queries/users";
import { hashApiKey } from "../lib/auth";
import { AppError, ConflictError } from "../lib/errors";

const auth = new Hono<{ Bindings: Env }>();

auth.post("/signup", async (c) => {
  const body = await c.req.json<{ email?: string }>();

  if (!body.email || typeof body.email !== "string") {
    throw new AppError("Email is required", 400, "VALIDATION_ERROR");
  }

  const db = createSupabaseClient(c.env);
  const existing = await findUserByEmail(db, body.email);
  if (existing) {
    throw new ConflictError("User with this email already exists");
  }

  const apiKey = crypto.randomUUID() + "-" + crypto.randomUUID();
  const apiKeyHash = await hashApiKey(apiKey);

  const user = await createUser(db, body.email, apiKeyHash);

  return c.json({
    id: user.id,
    email: user.email,
    api_key: apiKey,
  }, 201);
});

export { auth };
