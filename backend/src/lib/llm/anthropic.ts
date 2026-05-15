import type { LLMProvider } from "./types";

export class AnthropicProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async complete(prompt: string, maxTokens: number): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const textBlock = data.content.find((c) => c.type === "text");
    return textBlock?.text ?? "";
  }
}
