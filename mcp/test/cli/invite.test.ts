import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_URL } from "../../src/cli/config.js";
import { runInviteCmd } from "../../src/cli/invite.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync("/tmp/synapse-invite-");
  process.env.SYNAPSE_HOME = tmp;
  // Seed config so readApiKey() succeeds.
  fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ api_key: "test-key" }));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
  // biome-ignore lint/performance/noDelete: env var cleanup
  delete process.env.SYNAPSE_HOME;
});

describe("runInviteCmd", () => {
  it("posts to /api/projects/:id/invites and prints the join URL", async () => {
    const captured: { url: string; init: RequestInit | undefined }[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          token: "tok123",
          join_url: "https://synapsesync.app/invite/tok123",
          expires_at: "2026-05-21T09:00:00Z",
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runInviteCmd({ email: "alice@example.com", project_id: "proj-xyz" });
    } finally {
      process.stdout.write = origWrite;
    }

    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe(`${API_URL}/api/projects/proj-xyz/invites`);
    expect(captured[0].init?.method).toBe("POST");
    const body = JSON.parse(String(captured[0].init?.body));
    expect(body).toEqual({ email: "alice@example.com" });
    const headers = captured[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");

    const joined = out.join("");
    expect(joined).toContain("Invited alice@example.com");
    expect(joined).toContain("https://synapsesync.app/invite/tok123");
    expect(joined).toContain("Expires: 2026-05-21T09:00:00Z");
  });

  it("throws when no project_id is given and cwd is untracked", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;
    await expect(runInviteCmd({ email: "alice@example.com" })).rejects.toThrow(/no project/);
  });

  it("throws when the API returns a non-2xx", async () => {
    global.fetch = vi.fn(async () => new Response("forbidden", { status: 403 })) as typeof fetch;
    await expect(runInviteCmd({ email: "alice@example.com", project_id: "p1" })).rejects.toThrow(/invite failed: 403/);
  });

  it("throws a helpful error when no API key is configured", async () => {
    fs.rmSync(path.join(tmp, "config.json"));
    // biome-ignore lint/performance/noDelete: env var cleanup
    delete process.env.SYNAPSE_API_KEY;
    await expect(runInviteCmd({ email: "alice@example.com", project_id: "p1" })).rejects.toThrow(/no API key/);
  });
});
