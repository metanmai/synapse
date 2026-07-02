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
}

export function getCliParams(formData: FormData): CliParams {
  return {
    challenge: (formData.get("cli_challenge") as string) || null,
    state: (formData.get("cli_state") as string) || null,
    port: (formData.get("cli_port") as string) || null,
    device: (formData.get("cli_device") as string) || null,
    machine_id: (formData.get("cli_machine_id") as string) || null,
  };
}

export function buildRedirect(cli: CliParams): string {
  const params = new URLSearchParams();
  if (cli.challenge) params.set("challenge", cli.challenge);
  if (cli.state) params.set("state", cli.state);
  if (cli.port) params.set("port", cli.port);
  if (cli.device) params.set("device", cli.device);
  if (cli.machine_id) params.set("machine_id", cli.machine_id);
  const qs = params.toString();
  return qs ? `/cli-auth?${qs}` : "/cli-auth";
}
