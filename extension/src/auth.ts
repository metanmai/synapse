// Browser-extension sign-in: PKCE via chrome.identity.launchWebAuthFlow against the
// existing /cli-auth web flow (Slice B's scope=capture + chromiumapp.org redirect_uri),
// exchanged for a capture-scoped backend token. The token lands in chrome.storage.local
// where the service worker reads it to POST captures directly to the backend.

import { API_URL, APP_URL } from "./config.js";

const CAPTURE_TOKEN_KEY = "synapseCaptureToken";
const CAPTURE_EMAIL_KEY = "synapseEmail";

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Hex SHA-256 — MUST match the backend's sha256hex (the /cli-exchange PKCE check). */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

/** Random hex string of `bytes` bytes — the PKCE verifier and the opaque state. */
export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);
}

/** Build the /cli-auth sign-in URL (capture scope + the chromiumapp.org redirect target). */
export function buildAuthUrl(redirectUri: string, challenge: string, state: string): string {
  const p = new URLSearchParams({ challenge, state, scope: "capture", redirect_uri: redirectUri });
  return `${APP_URL}/cli-auth?${p.toString()}`;
}

/**
 * Extract the auth code from launchWebAuthFlow's returned URL, verifying state.
 * Returns null (reject) on a missing code or a state mismatch — the CSRF guard.
 */
export function parseCallback(redirectUrl: string, expectedState: string): string | null {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return null;
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || state !== expectedState) return null;
  return code;
}

export interface ExchangeResult {
  api_key: string;
  email: string;
}

/** Exchange the code + PKCE verifier for the capture-scoped API key (mirrors cliExchangeCode). */
export async function exchangeCode(code: string, codeVerifier: string): Promise<ExchangeResult> {
  const res = await fetch(`${API_URL}/auth/cli-exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: codeVerifier }),
  });
  if (!res.ok) throw new Error(`Sign-in exchange failed (${res.status})`);
  const data = (await res.json()) as { api_key?: string; email?: string };
  if (!data.api_key) throw new Error("Sign-in exchange returned no api_key");
  return { api_key: data.api_key, email: data.email ?? "" };
}

/**
 * Full interactive sign-in. MUST be called from a user gesture (a button click) so
 * launchWebAuthFlow's interactive window is allowed. Stores the capture token + email.
 */
export async function signIn(): Promise<{ email: string }> {
  const verifier = randomHex(64);
  const challenge = await sha256Hex(verifier);
  const state = randomHex(16);
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = buildAuthUrl(redirectUri, challenge, state);

  const returned = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  if (!returned) throw new Error("Sign-in was cancelled");

  const code = parseCallback(returned, state);
  if (!code) throw new Error("Sign-in failed: invalid callback (state mismatch or no code)");

  const { api_key, email } = await exchangeCode(code, verifier);
  await chrome.storage.local.set({ [CAPTURE_TOKEN_KEY]: api_key, [CAPTURE_EMAIL_KEY]: email });
  return { email };
}

export async function getCaptureToken(): Promise<string | undefined> {
  const data = await chrome.storage.local.get([CAPTURE_TOKEN_KEY]);
  const v = data[CAPTURE_TOKEN_KEY];
  return typeof v === "string" && v ? v : undefined;
}

export async function getSignedInEmail(): Promise<string | undefined> {
  const data = await chrome.storage.local.get([CAPTURE_EMAIL_KEY]);
  const v = data[CAPTURE_EMAIL_KEY];
  return typeof v === "string" && v ? v : undefined;
}

/** Clear the stored capture token + email (set to "" — falsy, treated as signed-out). */
export async function signOut(): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_TOKEN_KEY]: "", [CAPTURE_EMAIL_KEY]: "" });
}
