import { describe, expect, it, vi } from "vitest";
import { handleIngest } from "../../src/capture/ingest/ingest-route.js";

const ok = { remoteAddress: "127.0.0.1", token: "T", expectedToken: "T", origin: "chrome-extension://abc" };

describe("handleIngest", () => {
  it("allowlists body, maps host→tool, scrubs values, syncs", async () => {
    const sync = vi.fn().mockResolvedValue(true);
    const body = {
      host: "claude.ai",
      messages: [{ role: "user", content: "key sk-live-abcdef0123456789", ts: "2026-06-11T00:00:00Z" }],
      headers: { cookie: "sessionKey=LEAK" }, // MUST be dropped by the allowlist
      evilExtra: { nested: "drop me" },
    };
    const res = await handleIngest(body, { ...ok, sync });
    expect(res.ok).toBe(true);
    const sent = sync.mock.calls[0][0];
    const blob = JSON.stringify(sent);
    expect(blob).not.toContain("LEAK"); // dropped key
    expect(blob).not.toContain("drop me"); // dropped key
    expect(blob).not.toContain("sk-live-abcdef0123456789"); // scrubbed value
    expect(sent.tool).toBe("claude-ai"); // host→tool map
    expect(sent.messages[0].content).toContain("key"); // prose preserved
    expect(sent.projectPath).toContain("claude.ai");
  });

  it("rejects non-loopback", async () => {
    expect((await handleIngest({}, { ...ok, remoteAddress: "10.0.0.5", sync: vi.fn() })).status).toBe(403);
  });

  it("rejects a bad token", async () => {
    expect((await handleIngest({}, { ...ok, token: "WRONG", sync: vi.fn() })).status).toBe(401);
  });

  it("rejects a web Origin (non-extension)", async () => {
    const r = await handleIngest(
      { host: "claude.ai", messages: [] },
      { ...ok, origin: "https://evil.com", sync: vi.fn() },
    );
    expect(r.status).toBe(403);
  });

  it("rejects a non-allowlisted host", async () => {
    const r = await handleIngest({ host: "evil.com", messages: [] }, { ...ok, sync: vi.fn() });
    expect(r.status).toBe(400);
  });
});
