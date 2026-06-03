import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventKind } from "@synapse/shared/handoff/events.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, readEvents, watermark } from "../../src/capture/events-log.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("events-log", () => {
  it("appendEvent creates events.jsonl and writes one line", () => {
    appendEvent(tmp, {
      project_id: "p",
      session_id: "s",
      actor: actor(),
      attached_to: null,
      kind: EventKind.SessionOpened,
      occurred_at: now(),
      payload: {},
    });
    const lines = fs.readFileSync(path.join(tmp, "events.jsonl"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.kind).toBe("session_opened");
    expect(parsed.event_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("readEvents returns all events as objects", () => {
    appendEvent(tmp, makeEv("session_opened"));
    appendEvent(tmp, makeEv("user_prompted"));
    const events = readEvents(tmp);
    expect(events.map((e) => e.kind)).toEqual(["session_opened", "user_prompted"]);
  });

  it("watermark returns the last event_id", () => {
    appendEvent(tmp, makeEv("session_opened"));
    const lastId = appendEvent(tmp, makeEv("user_prompted"));
    expect(watermark(tmp)).toBe(lastId);
  });

  it("appendEvent is O_APPEND-safe with concurrent writers (simulated)", async () => {
    await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve().then(() => appendEvent(tmp, makeEv("tool_used")))),
    );
    const events = readEvents(tmp);
    expect(events).toHaveLength(50);
  });
});

function actor() {
  return {
    user_id: "u",
    kind: "human" as const,
    device_id: "d",
    hostname: "h",
    client: "claude-code",
  };
}
function now() {
  return new Date().toISOString();
}
function makeEv(kind: string) {
  return {
    project_id: "p",
    session_id: "s",
    actor: actor(),
    attached_to: null,
    kind: kind as EventKind,
    occurred_at: now(),
    payload: {},
  };
}
