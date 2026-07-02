import { API_URL } from "./config.js";

interface ErrorResponse {
  error?: string;
}

type AuthResult<T> = { ok: true; data: T } | { ok: false; message: string };

export type KeyStatus = "valid" | "expired" | "unknown";

/**
 * Build a fetch-compatible abort signal that fires after `ms` milliseconds.
 *
 * Platform-conditional implementation:
 *   - Linux/macOS: `AbortSignal.timeout(ms)` — the documented helper. Its
 *     internal scheduling doesn't keep the event loop alive and handles
 *     cleanup automatically. Used here because the global change to a
 *     manual controller pattern broke happy-flow Stage 9 stats on
 *     Linux/macOS in metanmai run 27118865555 (process exited 1 mid-
 *     fetch with no diagnostic) — the static helper's lifecycle has
 *     subtle guarantees that the manual pattern doesn't replicate.
 *   - Windows: manual AbortController + setTimeout. The static
 *     `AbortSignal.timeout` triggers a Windows-only Node.js crash (exit
 *     3221226505 = STATUS_STACK_BUFFER_OVERRUN) when used with native
 *     fetch through an HTTP proxy — observed on metanmai runs
 *     27116735113-27118252389. The manual pattern uses a different
 *     internal code path and avoids the trigger.
 *
 * Caller MUST call `clear()` once the fetch settles (in a finally block)
 * — for Windows, this releases the setTimeout from keeping Node's event
 * loop alive. The Linux/macOS variant's clear is a no-op for behavior
 * but kept for symmetric calling convention.
 */
function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  if (process.platform === "win32") {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(id) };
  }
  return { signal: AbortSignal.timeout(ms), clear: () => {} };
}

/** Validate an API key by making a lightweight authenticated request. */
export async function validateApiKey(apiKey: string): Promise<{ status: KeyStatus }> {
  // 10s (was 5s) to match fetchMe: /api/projects can take ~8s for accounts
  // with many projects, and corporate-proxy first-connect adds latency. A
  // 5s cutoff made validateApiKey return "unknown" for working keys, which
  // resolveKey/stats then mis-reported as "expired". See proceed-on-unknown
  // in resolveKey (commands.ts) + runStats (stats.ts) for the matching guard.
  const { signal, clear } = timeoutSignal(10_000);
  try {
    const res = await fetch(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (res.ok) return { status: "valid" };
    if (res.status === 401) {
      // Confirm it's actually an auth error, not some other issue
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "UNAUTHORIZED" || body.code === "AUTH_ERROR") return { status: "expired" };
    }
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  } finally {
    clear();
  }
}

export interface ExchangeResponse {
  api_key: string;
  email: string;
}

export async function cliExchangeCode(code: string, codeVerifier: string): Promise<AuthResult<ExchangeResponse>> {
  const res = await fetch(`${API_URL}/auth/cli-exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorResponse;
    return { ok: false, message: body.error || res.statusText };
  }
  return { ok: true, data: (await res.json()) as ExchangeResponse };
}

export interface MeResponse {
  user_id: string;
  email: string;
  tier?: "free" | "plus";
}

/**
 * Phase 2 (D-02): fetch the authenticated user's canonical identity from the
 * backend. Called by `synapse init` BEFORE any disk write so that on /me
 * failure, we fail-fast (D-05) without leaving a half-configured config.json.
 *
 * Error messages are user-facing (init flow surfaces them via clack.log.error).
 * 10s timeout — longer than validateApiKey's 5s because init is interactive
 * and Netskope-proxy first-connect can take noticeably longer.
 */
export async function fetchMe(apiKey: string): Promise<MeResponse> {
  // Manual AbortController + setTimeout — see timeoutSignal docstring
  // for the Windows-only AbortSignal.timeout crash this avoids.
  const { signal, clear } = timeoutSignal(10_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/account/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    throw new Error(
      `Could not reach ${API_URL}/api/account/me. Check your network — if you're on a proxy (Netskope, corporate firewall), tether to a different network and retry.`,
    );
  } finally {
    clear();
  }
  if (res.status === 401) {
    throw new Error("API key rejected by server (401). Run 'synapse login' or paste a fresh key from synapsesync.app.");
  }
  if (!res.ok) {
    throw new Error(`/api/account/me returned ${res.status} ${res.statusText} — cannot proceed.`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error("/api/account/me returned non-JSON body — cannot proceed.");
  }
  const b = body as Partial<MeResponse>;
  if (typeof b.user_id !== "string" || typeof b.email !== "string") {
    throw new Error(`/api/account/me returned invalid shape: ${JSON.stringify(body)}`);
  }
  return { user_id: b.user_id, email: b.email, tier: b.tier };
}
