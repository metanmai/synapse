import type { LLMProvider } from "./types.js";

export class GoogleProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google AI API ${res.status}: ${err}`);
    }

    const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
    return data.candidates[0]?.content?.parts[0]?.text ?? "";
  }
}
