import { AnthropicProvider } from "./anthropic.js";
import { GoogleProvider } from "./google.js";
import { OpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export function getProvider(name: string, apiKey: string, model: string): LLMProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "google":
      return new GoogleProvider(apiKey, model);
    default:
      throw new Error(`Unknown LLM provider: ${name}. Supported: anthropic, openai, google`);
  }
}
