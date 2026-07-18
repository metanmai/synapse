import { describe, expect, it } from "vitest";
import indexSource from "../../src/index.ts?raw";
import wranglerSource from "../../wrangler.jsonc?raw";

describe("Sentry observability wiring", () => {
  it("registers Sentry before every other Hono middleware", () => {
    const firstMiddleware = indexSource.indexOf("app.use(");
    const sentryMiddleware = indexSource.search(/app\.use\(\s*sentry\(/);

    expect(sentryMiddleware).toBeGreaterThan(-1);
    expect(sentryMiddleware).toBe(firstMiddleware);
    expect(indexSource).toContain('import { sentry } from "@sentry/hono/cloudflare"');
    expect(indexSource).toContain("dsn: env.SENTRY_DSN");
    expect(indexSource).toContain("sendDefaultPii: false");
    expect(indexSource).toContain("tracesSampleRate: 0.1");
    expect(indexSource).toContain("beforeSend: scrubPayload");
  });

  it("reports missing configuration and defensively captures unknown errors", () => {
    expect(indexSource).toContain("[observability] SENTRY_DSN unset — Sentry disabled");
    expect(indexSource).toContain("Sentry.captureException(err)");
  });

  it("documents the secret without committing a DSN value", () => {
    expect(wranglerSource).toContain("wrangler secret put SENTRY_DSN");
    expect(wranglerSource).toContain('"nodejs_compat"');
    expect(wranglerSource).not.toMatch(/^\s*["']?SENTRY_DSN["']?\s*:/m);
  });
});
