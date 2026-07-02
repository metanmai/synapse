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
