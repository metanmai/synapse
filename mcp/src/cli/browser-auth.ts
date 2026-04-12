import { exec } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { cliExchangeCode } from "./api.js";

const AUTH_TIMEOUT = 120_000; // 120 seconds
const APP_URL = "https://synapsesync.app";

const SSH_ENV_VARS = ["SSH_TTY", "SSH_CONNECTION", "SSH_CLIENT"];

function generateVerifier(): string {
  return crypto.randomBytes(64).toString("hex");
}

function generateChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("hex");
}

function isSSH(): boolean {
  return SSH_ENV_VARS.some((v) => v in process.env);
}

function canOpenBrowser(): boolean {
  // No browser in SSH, Docker, CI, or non-TTY environments
  if (isSSH()) return false;
  if (!process.stdout.isTTY) return false;
  if (process.env.CI) return false;
  if (process.env.CODESPACES) return false;
  return true;
}

function openBrowser(url: string): boolean {
  try {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} ${JSON.stringify(url)}`);
    return true;
  } catch {
    return false;
  }
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Synapse</title><meta name="color-scheme" content="dark"></head>
<body style="background:#151010;color:#ffe4c4;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="text-align:center;max-width:360px;padding:2rem;">
    <div style="font-size:2rem;margin-bottom:1rem;color:#c87941;">\u25C6</div>
    <h1 style="font-size:1.25rem;font-weight:600;margin:0 0 0.5rem;">Login successful!</h1>
    <p style="color:#7a6455;font-size:0.875rem;margin:0;">You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

export interface BrowserAuthResult {
  api_key: string;
  email: string;
}

export interface BrowserAuthCallbacks {
  /** Called with the auth URL — display this as a fallback for the user to open manually. */
  onUrl?: (url: string, autoOpened: boolean) => void;
}

/**
 * Browser-based CLI authentication using PKCE.
 *
 * 1. Starts a local HTTP server on 127.0.0.1 (random port)
 * 2. Opens the browser (or shows URL for manual copy in SSH/headless)
 * 3. Waits for the redirect callback with an auth code
 * 4. Exchanges code + PKCE verifier for API key over HTTPS
 *
 * Handles Chrome preconnects by ignoring requests that don't have valid state+code.
 * Detects SSH/CI environments and skips browser open (URL-only mode).
 */
export async function browserAuth(callbacks?: BrowserAuthCallbacks): Promise<BrowserAuthResult> {
  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  const state = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    function settle(): void {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        server.close();
      }
    }

    const timeout = setTimeout(() => {
      if (!settled) {
        settle();
        reject(new Error("Browser login timed out after 120 seconds. Please try again."));
      }
    }, AUTH_TIMEOUT);

    server.on("request", async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      // Ignore anything that isn't our callback path — handles Chrome preconnects,
      // favicon requests, and other stray requests without consuming the one-shot flow.
      if (url.pathname !== "/callback") {
        res.writeHead(204);
        res.end();
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      // Ignore callbacks with wrong/missing state — could be a stale redirect or preconnect.
      // Don't close the server; keep waiting for the real callback.
      if (returnedState !== state || !code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid request — waiting for the correct callback.");
        return;
      }

      // Valid callback — serve success page immediately
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHtml());

      if (settled) return;

      // Exchange code + verifier for API key over HTTPS
      try {
        const result = await cliExchangeCode(code, codeVerifier);
        settle();

        if (result.ok) {
          resolve({ api_key: result.data.api_key, email: result.data.email });
        } else {
          reject(new Error(`Login failed: ${result.message}`));
        }
      } catch (err) {
        settle();
        reject(new Error(`Login failed: ${(err as Error).message}`));
      }
    });

    server.on("error", (err) => {
      settle();
      reject(new Error(`Failed to start local server: ${err.message}`));
    });

    // Bind to localhost only, random port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        settle();
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const authUrl = `${APP_URL}/cli-auth?challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&port=${port}`;

      // Try to open browser — skip in SSH/CI/headless
      const autoOpened = canOpenBrowser() && openBrowser(authUrl);

      // Always notify caller with the URL
      callbacks?.onUrl?.(authUrl, autoOpened);
    });
  });
}
