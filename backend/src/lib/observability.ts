import * as Sentry from "@sentry/cloudflare";
import type { Event, EventHint } from "@sentry/cloudflare";
import type { Env } from "./env";

const SAFE_EVENT_KEYS = new Set(["event_id", "project_id", "kind", "actor_user_id", "occurred_at"]);

export function scrubPayload<T extends Event>(event: T, _hint: EventHint): T | null {
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      const value = event.extra[key];
      if (isSynapseEventShape(value)) {
        event.extra[key] = stripPayload(value);
      }
    }
  }

  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.data && isSynapseEventShape(breadcrumb.data)) {
      breadcrumb.data = stripPayload(breadcrumb.data);
    }
  }

  if (event.request?.data && typeof event.request.data === "object") {
    event.request.data = sanitizeRequestBody(event.request.data);
  }

  return event;
}

export function reportError(err: unknown, _env: Env, ctx?: ExecutionContext): void {
  Sentry.captureException(err);
  if (ctx) {
    ctx.waitUntil(Promise.resolve(Sentry.flush(2000)));
  }
}

function isSynapseEventShape(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "kind" in value && "event_id" in value);
}

function stripPayload(event: Record<string, unknown>): Record<string, unknown> {
  const safeEvent: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (SAFE_EVENT_KEYS.has(key)) {
      safeEvent[key] = value;
    }
  }
  return safeEvent;
}

function sanitizeRequestBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const { payload: _payload, ...safeBody } = body as Record<string, unknown>;
  return safeBody;
}
