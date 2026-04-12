import { exec } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { cliExchangeCode } from "./api.js";

const AUTH_TIMEOUT = 120_000; // 120 seconds
const APP_URL = "https://synapsesync.app";

function generateVerifier(): string {
  return crypto.randomBytes(64).toString("hex");
}

function generateChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("hex");
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${JSON.stringify(url)}`);
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><title>Synapse</title></head>
<body style="background:#151010;color:#ffe4c4;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="text-align:center;">
    <div style="font-size:2rem;margin-bottom:1rem;color:#c87941;">\u25C6</div>
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem;">Login successful!</h1>
    <p style="color:#7a6455;font-size:0.875rem;">You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;
}

export async function browserAuth(): Promise<{ api_key: string; email: string }> {
  const codeVerifier = generateVerifier();
  const codeChallenge = generateChallenge(codeVerifier);
  const state = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error("Browser login timed out after 120 seconds. Please try again."));
      }
    }, AUTH_TIMEOUT);

    server.on("request", async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (url.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");

      if (returnedState !== state) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid state parameter");
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing code parameter");
        return;
      }

      // Serve success page immediately so the browser shows feedback
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(successHtml());

      if (settled) return;

      // Exchange code + verifier for API key over HTTPS
      const result = await cliExchangeCode(code, codeVerifier);

      settled = true;
      clearTimeout(timeout);
      server.close();

      if (result.ok) {
        resolve({ api_key: result.data.api_key, email: result.data.email });
      } else {
        reject(new Error(`Login failed: ${result.message}`));
      }
    });

    // Bind to localhost only, random port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        settled = true;
        clearTimeout(timeout);
        reject(new Error("Failed to start local server"));
        return;
      }

      const port = addr.port;
      const authUrl = `${APP_URL}/cli-auth?challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&port=${port}`;

      openBrowser(authUrl);
    });
  });
}
