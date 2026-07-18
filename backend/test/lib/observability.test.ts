import type { Event, EventHint } from "@sentry/cloudflare";
import { describe, expect, it } from "vitest";
import { scrubPayload } from "../../src/lib/observability";

const hint: EventHint = {};

describe("scrubPayload", () => {
  it("removes event.extra payloads from Synapse event objects", () => {
    const event: Event = {
      extra: {
        handoffEvent: {
          event_id: "evt-1",
          project_id: "project-1",
          kind: "tool_used",
          actor_user_id: "user-1",
          occurred_at: "2026-07-18T00:00:00.000Z",
          payload: { prompt: "private prompt" },
          internal_note: "also private",
        },
      },
    };

    expect(scrubPayload(event, hint)?.extra?.handoffEvent).toEqual({
      event_id: "evt-1",
      project_id: "project-1",
      kind: "tool_used",
      actor_user_id: "user-1",
      occurred_at: "2026-07-18T00:00:00.000Z",
    });
  });

  it("preserves stack traces and request metadata", () => {
    const event: Event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "boom",
            stacktrace: { frames: [{ filename: "worker.ts", function: "handleRequest", lineno: 42 }] },
          },
        ],
      },
      request: {
        url: "https://api.synapsesync.app/api/events/batch",
        method: "POST",
        headers: { "content-type": "application/json" },
        data: { payload: { prompt: "private" }, batch_size: 2 },
      },
    };
    const originalException = event.exception;

    const result = scrubPayload(event, hint);

    expect(result?.exception).toBe(originalException);
    expect(result?.request).toMatchObject({
      url: "https://api.synapsesync.app/api/events/batch",
      method: "POST",
      headers: { "content-type": "application/json" },
      data: { batch_size: 2 },
    });
  });

  it("returns the same event when no Synapse-shaped data is attached", () => {
    const event: Event = { message: "ordinary error", extra: { retry_count: 2 } };

    expect(scrubPayload(event, hint)).toBe(event);
  });

  it("removes event.request.data payload and breadcrumb data payload", () => {
    const event: Event = {
      request: { data: { payload: { prompt: "private" }, request_id: "req-1" } },
      breadcrumbs: [
        {
          category: "handoff",
          data: {
            event_id: "evt-2",
            project_id: "project-2",
            kind: "session_opened",
            payload: { transcript: "private" },
          },
        },
      ],
    };

    const result = scrubPayload(event, hint);

    expect(result?.request?.data).toEqual({ request_id: "req-1" });
    expect(result?.breadcrumbs?.[0]?.data).toEqual({
      event_id: "evt-2",
      project_id: "project-2",
      kind: "session_opened",
    });
  });
});
