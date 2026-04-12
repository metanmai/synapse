import type { Env } from "./env";

function getCreemUrl(apiKey: string): string {
  return apiKey.startsWith("creem_test_") ? "https://test-api.creem.io/v1" : "https://api.creem.io/v1";
}

export async function creemRequest<T>(
  env: Env,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  if (!env.CREEM_API_KEY) {
    console.error("[creem] CREEM_API_KEY secret is not set");
    throw new Error("Billing is not configured");
  }

  const baseUrl = getCreemUrl(env.CREEM_API_KEY);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-api-key": env.CREEM_API_KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => res.statusText);
    console.error(`[creem] ${method} ${path} failed: ${res.status} — ${raw}`);
    let msg = `Creem API error: ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as { message?: string; error?: string };
      msg = parsed.message || parsed.error || msg;
    } catch {
      // raw wasn't JSON
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

export async function verifyCreemWebhook(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return expected === signature;
}
