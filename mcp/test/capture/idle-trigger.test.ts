import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeFireInferNextStep } from "../../src/capture/daemon.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-idle-");
  process.env.SYNAPSE_HOME = tmp;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: real delete required
  delete process.env.SYNAPSE_HOME;
});

interface TestEvent {
  kind: string;
  occurred_at: string;
  payload?: Record<string, unknown>;
}

function minutesAgo(m: number) {
  return new Date(Date.now() - m * 60_000).toISOString();
}

function setupEvents(home: string, pid: string, events: TestEvent[]) {
  const dir = path.join(home, "projects", pid);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "events.jsonl"),
    `${events
      .map((e) =>
        JSON.stringify({
          event_id: Math.random().toString(36).slice(2),
          project_id: pid,
          session_id: "s",
          actor: {
            user_id: "tanmai",
            kind: "human" as const,
            device_id: "d",
            hostname: "h",
            client: "claude-code",
          },
          attached_to: null,
          payload: {},
          received_at: e.occurred_at,
          ...e,
        }),
      )
      .join("\n")}\n`,
  );
}

describe("auto-infer next_step", () => {
  it("does not fire when an explicit next_step_set was made within idle window", async () => {
    setupEvents(tmp, "p2", [
      { kind: "user_prompted", occurred_at: minutesAgo(45) },
      { kind: "next_step_set", occurred_at: minutesAgo(40), payload: { text: "explicit" } },
    ]);
    const spy = vi.fn();
    await maybeFireInferNextStep({
      project_id: "p2",
      idle_threshold_ms: 30 * 60_000,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      spawnFn: spy as any,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fires when idle >threshold and no explicit handoff", async () => {
    setupEvents(tmp, "p3", [{ kind: "user_prompted", occurred_at: minutesAgo(45) }]);
    const stub = vi.fn(async () => "wire /callback");
    await maybeFireInferNextStep({
      project_id: "p3",
      idle_threshold_ms: 30 * 60_000,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      spawnFn: stub as any,
    });
    expect(stub).toHaveBeenCalled();
    const events = fs
      .readFileSync(path.join(tmp, "projects/p3/events.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events.at(-1).kind).toBe("next_step_inferred");
    expect(events.at(-1).payload.inferred_method).toBe("llm");
  });

  it("falls back to heuristic when spawn fails", async () => {
    setupEvents(tmp, "p4", [
      { kind: "user_prompted", occurred_at: minutesAgo(45), payload: { prompt_excerpt: "implement /callback" } },
    ]);
    const failingSpawn = vi.fn(async () => {
      throw new Error("claude not found");
    });
    await maybeFireInferNextStep({
      project_id: "p4",
      idle_threshold_ms: 30 * 60_000,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      spawnFn: failingSpawn as any,
    });
    const events = fs
      .readFileSync(path.join(tmp, "projects/p4/events.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(events.at(-1).kind).toBe("next_step_inferred");
    expect(events.at(-1).payload.inferred_method).toBe("heuristic");
    expect(events.at(-1).payload.text).toContain("/callback");
  });
});
