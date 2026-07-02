/**
 * Sanitize a user-supplied `?redirect=` target to prevent open-redirect attacks.
 *
 * The attack: `https://synapsesync.app/login?redirect=https://evil.com/phish`.
 * After successful login we'd 303 to evil.com with the user's session cookie
 * already trusted — the user lands on a hostile page assuming Synapse vouched
 * for it. Magic-link, OAuth-callback, and password-reset flows all build URLs
 * containing a `redirect` param that ends up in the same place, so any auth
 * entry-point is a vector.
 *
 * The rule: only allow same-origin paths (must start with `/` but NOT `//`,
 * which is the protocol-relative URL form `//evil.com/...`). Anything else
 * silently falls back to the safe default.
 *
 * Returns the cleaned target. Never throws — bad input degrades to fallback.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  // `//foo` is protocol-relative → browser treats it as cross-origin.
  if (raw.startsWith("//")) return fallback;
  // Anything not starting with `/` is either an absolute URL (https://...)
  // or some malformed thing. Reject both.
  if (!raw.startsWith("/")) return fallback;
  return raw;
}
