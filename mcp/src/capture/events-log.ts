import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Event } from "@synapse/shared/handoff/types.js";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeStr = ENCODING[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10);
  let randStr = "";
  for (let i = 0; i < 16; i++) randStr += ENCODING[rand[i % 10] % 32];
  return timeStr + randStr;
}

export function eventsPath(projectDir: string): string {
  return path.join(projectDir, "events.jsonl");
}

export function appendEvent(projectDir: string, partial: Omit<Event, "event_id" | "received_at">): string {
  fs.mkdirSync(projectDir, { recursive: true });
  const id = ulid();
  const event: Event = { ...partial, event_id: id, received_at: new Date().toISOString() };
  const fd = fs.openSync(eventsPath(projectDir), "a");
  try {
    fs.writeSync(fd, `${JSON.stringify(event)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return id;
}

export function readEvents(projectDir: string): Event[] {
  const p = eventsPath(projectDir);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Event);
}

export function watermark(projectDir: string): string | null {
  const events = readEvents(projectDir);
  return events.at(-1)?.event_id ?? null;
}
