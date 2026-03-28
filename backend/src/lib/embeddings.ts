export interface EmbeddingConfig {
  url?: string;
  key?: string;
  timeoutMs?: number;
}

type EmbedType = "search_query" | "search_document";

/**
 * Call the embedding service to get vectors for the given texts.
 * Returns null on any failure (network, timeout, bad response) — caller
 * should degrade gracefully.
 *
 * Accepts an optional fetchFn for testing (defaults to global fetch).
 */
export async function embedTexts(
  texts: string[],
  type: EmbedType,
  config: EmbeddingConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<number[][] | null> {
  if (!config.url) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 3000);

    const resp = await fetchFn(`${config.url}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key ?? ""}`,
      },
      body: JSON.stringify({ texts, type }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`[embeddings] Service returned ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = (await resp.json()) as { embeddings: number[][] };
    return data.embeddings;
  } catch (err) {
    console.error(`[embeddings] Failed to embed: ${err}`);
    return null;
  }
}

/**
 * Build EmbeddingConfig from Worker env vars.
 */
export function embeddingConfigFromEnv(env: {
  EMBEDDING_SERVICE_URL?: string;
  EMBEDDING_SERVICE_KEY?: string;
}): EmbeddingConfig {
  return {
    url: env.EMBEDDING_SERVICE_URL,
    key: env.EMBEDDING_SERVICE_KEY,
    timeoutMs: 3000,
  };
}
