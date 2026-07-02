import { API_URL } from "./config.js";

export interface LoginResponse {
  email: string;
  api_key: string;
  label: string;
}

export interface SignupResponse {
  email: string;
  api_key: string;
}

interface ErrorResponse {
  error?: string;
}

type AuthResult<T> = { ok: true; data: T } | { ok: false; message: string };

export async function cliAuthSignup(email: string): Promise<AuthResult<SignupResponse>> {
  const res = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorResponse;
    return { ok: false, message: body.error || res.statusText };
  }
  return { ok: true, data: (await res.json()) as SignupResponse };
}

export async function cliAuthLogin(email: string, password: string, label: string): Promise<AuthResult<LoginResponse>> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, label }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ErrorResponse;
    return { ok: false, message: body.error || res.statusText };
  }
  return { ok: true, data: (await res.json()) as LoginResponse };
}

export type KeyStatus = "valid" | "expired" | "unknown";

/** Validate an API key by making a lightweight authenticated request. */
export async function validateApiKey(apiKey: string): Promise<{ status: KeyStatus }> {
  try {
    const res = await fetch(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
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
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: body.error || res.statusText };
  }
  return { ok: true, data: (await res.json()) as ExchangeResponse };
}
