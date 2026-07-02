// mcp/test/capture/proxy/endpoint-recognition.test.ts
//
// Bug class: "the proxy daemon's URL classifier marks telemetry/registry/
// settings endpoints as chat endpoints" — captures noise as sessions.
// The spike against claude CLI observed 31 of 37 flows being non-chat;
// every one of those must be classified capture=false.

import { describe, expect, it } from "vitest";
import { recognizeEndpoint } from "../../../src/capture/proxy/endpoint-recognition.js";

describe("recognizeEndpoint", () => {
  describe("Anthropic", () => {
    it("recognizes /v1/messages as the chat endpoint", () => {
      expect(recognizeEndpoint("api.anthropic.com", "/v1/messages")).toEqual({
        provider: "anthropic",
        kind: "messages",
        capture: true,
      });
    });

    it("strips query strings before matching (/v1/messages?beta=true must still match)", () => {
      // claude CLI was observed hitting /v1/messages?beta=true during the spike.
      expect(recognizeEndpoint("api.anthropic.com", "/v1/messages?beta=true")).toEqual({
        provider: "anthropic",
        kind: "messages",
        capture: true,
      });
    });

    it.each([
      // All these were observed during the spike — they MUST be capture=false.
      "/mcp-registry/v0/servers",
      "/api/event_logging/v2/batch",
      "/api/eval/sdk-zAZezfDKGoZuXXKe",
      "/api/claude_code/settings",
      "/api/claude_code/policy_limits",
      "/api/claude_code_penguin_mode",
      "/api/claude_code/metrics",
      "/api/claude_cli/bootstrap",
      "/v1/mcp_servers",
    ])("classifies %s as non-chat (capture=false)", (path) => {
      const result = recognizeEndpoint("api.anthropic.com", path);
      expect(result.provider).toBe("anthropic");
      expect(result.capture).toBe(false);
    });

    it("normalizes host casing (API.Anthropic.com is still Anthropic)", () => {
      expect(recognizeEndpoint("API.Anthropic.com", "/v1/messages").capture).toBe(true);
    });
  });

  describe("OpenAI", () => {
    it("recognizes /v1/chat/completions as the chat endpoint", () => {
      expect(recognizeEndpoint("api.openai.com", "/v1/chat/completions")).toEqual({
        provider: "openai",
        kind: "chat",
        capture: true,
      });
    });

    it("does NOT classify /v1/embeddings as chat (it's not a conversation)", () => {
      const result = recognizeEndpoint("api.openai.com", "/v1/embeddings");
      expect(result.provider).toBe("openai");
      expect(result.capture).toBe(false);
    });

    it("does NOT classify /v1/audio/transcriptions as chat", () => {
      expect(recognizeEndpoint("api.openai.com", "/v1/audio/transcriptions").capture).toBe(false);
    });
  });

  describe("Google", () => {
    it("recognizes :generateContent on a versioned model path as chat", () => {
      const result = recognizeEndpoint(
        "generativelanguage.googleapis.com",
        "/v1/models/gemini-1.5-pro:generateContent",
      );
      expect(result).toEqual({ provider: "google", kind: "generateContent", capture: true });
    });

    it("recognizes :streamGenerateContent as chat (streaming variant)", () => {
      const result = recognizeEndpoint(
        "generativelanguage.googleapis.com",
        "/v1beta/models/gemini-1.5-flash:streamGenerateContent",
      );
      expect(result.capture).toBe(true);
    });

    it("does NOT classify :countTokens as chat (it's a token-counting helper)", () => {
      const result = recognizeEndpoint("generativelanguage.googleapis.com", "/v1/models/gemini-1.5-pro:countTokens");
      expect(result.provider).toBe("google");
      expect(result.capture).toBe(false);
    });
  });

  describe("OpenRouter (OpenAI-shaped on /api/v1/chat/completions)", () => {
    it("recognizes /api/v1/chat/completions and classifies as provider:openai", () => {
      // OpenRouter's chat endpoint is one path segment deeper than
      // OpenAI's. Session-reconstruction's existing OpenAI extractor
      // handles its body (OpenRouter is OpenAI-API-compatible), so we
      // tag it provider:"openai" rather than introducing a new variant.
      expect(recognizeEndpoint("openrouter.ai", "/api/v1/chat/completions")).toEqual({
        provider: "openai",
        kind: "chat",
        capture: true,
      });
    });

    it("does NOT match OpenAI's /v1/chat/completions on openrouter.ai (wrong prefix)", () => {
      // Defensive: if a future client mistakenly hits the bare /v1
      // path on openrouter.ai, mark non-capture rather than silently
      // misroute. OpenRouter only serves chat on /api/v1.
      const result = recognizeEndpoint("openrouter.ai", "/v1/chat/completions");
      expect(result.provider).toBe("openai");
      expect(result.capture).toBe(false);
    });
  });

  describe("DeepSeek (OpenAI-shaped on /v1/chat/completions)", () => {
    it("recognizes /v1/chat/completions and classifies as provider:openai", () => {
      // DeepSeek's chat endpoint shape matches OpenAI exactly; we tag
      // provider:"openai" so session-reconstruction's OpenAI extractor
      // handles its bodies without per-provider branching.
      expect(recognizeEndpoint("api.deepseek.com", "/v1/chat/completions")).toEqual({
        provider: "openai",
        kind: "chat",
        capture: true,
      });
    });
  });

  describe("provider host registry — bug class guard", () => {
    // BUG CLASS: "scripts/e2e-llm-driver.mjs can dispatch to a provider
    // whose host is not in recognizeEndpoint's allowlist."
    //
    // Failure mode: silent capture loss. The proxy forwards the request
    // (because that's what unknown hosts do), but never buffers it, so
    // the conversation never reaches the backend. The Stage 2 hook
    // session-start creates the project, the curl call appears to
    // succeed, but the conversation never lands. Symptom looks like a
    // sync race; cause is classification drift.
    //
    // Discovered 2026-06-07: CI was configured with OPENROUTER_API_KEY +
    // DEEPSEEK_API_KEY (no ANTHROPIC_API_KEY); the e2e driver dispatched
    // to openrouter.ai which wasn't in the allowlist. Stage 4.1 of
    // happy-flow-e2e timed out waiting 8 minutes for a conversation that
    // could never arrive. This table-driven test enforces the contract:
    // every provider in the e2e harness MUST be a recognized chat host.
    //
    // When adding a provider to scripts/e2e-llm-driver.mjs PROVIDERS,
    // also add a row here AND update the comment block at the top of
    // mcp/src/capture/proxy/endpoint-recognition.ts.
    it.each([
      { name: "Anthropic", host: "api.anthropic.com", path: "/v1/messages", expectedProvider: "anthropic" },
      { name: "OpenAI", host: "api.openai.com", path: "/v1/chat/completions", expectedProvider: "openai" },
      { name: "OpenRouter", host: "openrouter.ai", path: "/api/v1/chat/completions", expectedProvider: "openai" },
      { name: "DeepSeek", host: "api.deepseek.com", path: "/v1/chat/completions", expectedProvider: "openai" },
      {
        name: "Google Gemini",
        host: "generativelanguage.googleapis.com",
        path: "/v1/models/gemini-1.5-pro:generateContent",
        expectedProvider: "google",
      },
    ])(
      "$name @ $host$path must be capture=true (e2e-llm-driver dispatches here)",
      ({ host, path, expectedProvider }) => {
        const result = recognizeEndpoint(host, path);
        expect(result.capture, `${host}${path} must be a recognized chat endpoint`).toBe(true);
        expect(result.provider).toBe(expectedProvider);
      },
    );
  });

  describe("unknown hosts", () => {
    it("returns provider=null and capture=false for non-LLM hosts", () => {
      expect(recognizeEndpoint("github.com", "/api/repos")).toEqual({
        provider: null,
        kind: null,
        capture: false,
      });
    });

    it("returns provider=null even for paths that look like chat endpoints on unknown hosts", () => {
      // A phishing/lookalike host shouldn't be mis-classified as Anthropic.
      expect(recognizeEndpoint("evil.example.com", "/v1/messages").capture).toBe(false);
    });
  });
});
