/**
 * Shared helpers for the CLI-auth handshake.
 *
 * The CLI starts a local HTTP server, opens the browser to /cli-auth with PKCE
 * params, and the browser forwards them through form posts. Some auth flows
 * (OAuth, magic link) round-trip through external services, so we must
 * preserve the CLI params across the redirect. These helpers do the
 * extract+restore work.
 *
 * Fields tracked:
 *   - challenge / state / port  — PKCE handshake
 *   - device                    — human-readable device name (e.g. os.hostname())
 *                                 that becomes the API key label on the new
 *                                 cli-* key. Optional — backend falls back to
 *                                 a synthetic label when absent.
 */

export interface CliParams {
  challenge: string | null;
  state: string | null;
  port: string | null;
  device: string | null;
  /**
   * Phase 03-05: per-machine UUID from the CLI's ~/.synapse/device.json.
   * Forwarded to /auth/cli-session so the backend can match on
   * (user_id, machine_id) and ROTATE an existing api_keys row instead
   * of creating a duplicate that would burn a device-cap slot on
   * re-running `synapsesync wizard`. Optional — legacy CLIs that don't
   * send it still work (machine_id stays NULL on the row, the legacy
   * device-name cap-check applies).
   */
  machine_id: string | null;
  /**
   * Slice B: the browser-extension OAuth redirect target
   * (`https://<ext-id>.chromiumapp.org/`). When present, the post-sign-in
   * callback is built from this (validated) URL instead of the CLI's localhost
   * loopback port. chrome.identity.launchWebAuthFlow catches the navigation.
   */
  redirect_uri: string | null;
  /**
   * Slice B: 'capture' asks /auth/cli-session for a browser-extension
   * capture-scoped key. Absent/'full' → a normal CLI device key.
   */
  scope: string | null;
}

export function getCliParams(formData: FormData): CliParams {
  return {
    challenge: (formData.get("cli_challenge") as string) || null,
    state: (formData.get("cli_state") as string) || null,
    port: (formData.get("cli_port") as string) || null,
    device: (formData.get("cli_device") as string) || null,
    machine_id: (formData.get("cli_machine_id") as string) || null,
    redirect_uri: (formData.get("cli_redirect_uri") as string) || null,
    scope: (formData.get("cli_scope") as string) || null,
  };
}

export function buildRedirect(cli: CliParams): string {
  const params = new URLSearchParams();
  if (cli.challenge) params.set("challenge", cli.challenge);
  if (cli.state) params.set("state", cli.state);
  if (cli.port) params.set("port", cli.port);
  if (cli.device) params.set("device", cli.device);
  if (cli.machine_id) params.set("machine_id", cli.machine_id);
  if (cli.redirect_uri) params.set("redirect_uri", cli.redirect_uri);
  if (cli.scope) params.set("scope", cli.scope);
  const qs = params.toString();
  return qs ? `/cli-auth?${qs}` : "/cli-auth";
}

/**
 * Slice B: is `uri` a legitimate Chrome-extension OAuth redirect target?
 *
 * chrome.identity.launchWebAuthFlow only ever redirects to
 * `https://<extension-id>.chromiumapp.org/`. We allowlist EXACTLY that shape so
 * /cli-auth can never be coerced into bouncing a freshly-minted credential to
 * an attacker-controlled URL (open-redirect / phishing). Because we URL-parse,
 * userinfo / embedded-host tricks (`https://x.chromiumapp.org@evil.com`,
 * `https://chromiumapp.org.evil.com`) resolve to a non-matching hostname and are
 * rejected. Defense-in-depth: PKCE already makes a leaked code useless without
 * the verifier, but we still refuse to emit an unvetted redirect.
 */
export function isAllowedExtensionRedirect(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false; // no userinfo
  if (parsed.port !== "") return false; // chromiumapp.org uses the default https port
  const host = parsed.hostname;
  // Require a non-empty subdomain label before ".chromiumapp.org" — the bare
  // apex is never a real extension callback.
  return host !== "chromiumapp.org" && host.endsWith(".chromiumapp.org");
}

/**
 * Slice B: build the post-sign-in callback URL the browser navigates to.
 *
 *   - Extension flow: a VALIDATED `redirect_uri` (chromiumapp.org). Chrome's
 *     launchWebAuthFlow catches the navigation and hands the URL to the SW.
 *   - CLI flow: the localhost loopback `http://localhost:<port>/callback`.
 *
 * Returns null when neither a valid redirect_uri nor a numeric port is present.
 * The caller MUST treat null as "refuse to redirect" — never fall back to an
 * unvalidated target.
 */
export function buildCallbackUrl(cli: CliParams, code: string): string | null {
  const qs = `code=${encodeURIComponent(code)}&state=${encodeURIComponent(cli.state ?? "")}`;
  if (cli.redirect_uri) {
    if (!isAllowedExtensionRedirect(cli.redirect_uri)) return null;
    const sep = cli.redirect_uri.includes("?") ? "&" : "?";
    return `${cli.redirect_uri}${sep}${qs}`;
  }
  if (cli.port && /^\d+$/.test(cli.port)) {
    return `http://localhost:${cli.port}/callback?${qs}`;
  }
  return null;
}
