import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runRefresh, runStatus, runTree, runUpgrade, runWhoami } from "./cli/commands.js";
import { runStats } from "./cli/stats.js";
import { accent, bold, muted } from "./cli/theme.js";
import { runWizard } from "./cli/wizard.js";

/** Public Synapse API — same for all published `synapsesync-mcp` users. Self-host: change this and `npm run build`. */
const API_URL = "https://api.synapsesync.app";

// --- Interfaces for MCP server response shapes ---

interface ProjectResponse {
  name: string;
}

interface EntryListResponse {
  path: string;
  updated_at: string;
  tags: string[];
}

interface EntryResponse {
  path: string;
  updated_at: string;
  source: string;
  tags: string[];
  content: string;
}

interface HistoryResponse {
  changed_at: string;
  source: string;
  content: string;
}

// --- CLI utilities ---

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function readPackageVersion(): string {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const j = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return j.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const CLI_SUBCOMMANDS = new Set(["wizard", "help", "stats", "tree", "status", "refresh", "upgrade", "whoami"]);

// --- CLI help ---

function printHelp(): void {
  const v = readPackageVersion();
  const s = (label: string, desc: string) => `  ${accent(label.padEnd(24))} ${desc}`;

  const lines = [
    `synapsesync-mcp v${v} \u2014 Synapse MCP server & CLI`,
    "",
    bold("Setup"),
    s("npx synapsesync-mcp", "Interactive setup wizard"),
    s("npx synapsesync-mcp status", "Show where configured + connection health"),
    s("npx synapsesync-mcp refresh", "Generate new API key, update all configs"),
    "",
    bold("Workspace"),
    s("npx synapsesync-mcp tree", "View workspace files as a tree"),
    s("npx synapsesync-mcp stats", "Show lifetime workspace stats"),
    s("npx synapsesync-mcp whoami", "Show account info"),
    "",
    bold("Account"),
    s("npx synapsesync-mcp upgrade", "Upgrade to Plus ($5.99/mo)"),
    "",
    s("-h, --help", "Show this help"),
    s("-v, --version", "Show version"),
    "",
    bold("MCP server"),
    `  Runs automatically when stdin is not a TTY and SYNAPSE_API_KEY is set.`,
    "",
    bold("Web app"),
    `  ${accent("synapsesync.app")}            Dashboard, file browser, settings`,
    `  ${accent("synapsesync.app/account")}    API keys, billing, connected accounts`,
    "",
    muted(`Made by @metanmai \u00B7 github.com/metanmai/synapse`),
    muted(`Star the repo or sponsor: github.com/sponsors/metanmai`),
    "",
  ];

  console.log(lines.join("\n"));
}

function isHelpArgv(args: string[]): boolean {
  const a = args[0];
  return a === "-h" || a === "--help" || a === "help";
}

function isVersionArgv(args: string[]): boolean {
  const a = args[0];
  return a === "-v" || a === "--version";
}

// --- CLI handler ---

function isMcpServerMode(raw: string[]): boolean {
  return raw.length === 0 && !isInteractiveTerminal();
}

function unknownOption(flag: string): never {
  console.error(`Unknown option: ${flag}\n`);
  printHelp();
  process.exit(1);
}

function unknownSubcommand(cmd: string): never {
  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}

async function handleCli(raw: string[]): Promise<void> {
  if (isHelpArgv(raw)) {
    printHelp();
    process.exit(0);
  }

  if (isVersionArgv(raw)) {
    console.log(readPackageVersion());
    process.exit(0);
  }

  if (raw.length > 0 && raw[0].startsWith("-")) {
    unknownOption(raw[0]);
  }

  if (raw.length > 0 && raw[0] && !CLI_SUBCOMMANDS.has(raw[0])) {
    unknownSubcommand(raw[0]);
  }

  // Subcommands
  const cmd = raw[0];
  if (cmd === "stats") {
    await runStats();
    process.exit(0);
  }
  if (cmd === "tree") {
    await runTree();
    process.exit(0);
  }
  if (cmd === "status") {
    await runStatus();
    process.exit(0);
  }
  if (cmd === "refresh") {
    await runRefresh();
    process.exit(0);
  }
  if (cmd === "upgrade") {
    await runUpgrade();
    process.exit(0);
  }
  if (cmd === "whoami") {
    await runWhoami();
    process.exit(0);
  }

  // Everything else interactive runs the wizard
  if (isInteractiveTerminal()) {
    await runWizard(readPackageVersion());
    process.exit(0);
  }

  // Non-interactive + no MCP mode → show help
  printHelp();
  process.exit(0);
}

// --- Entry point ---
const args = process.argv.slice(2);

if (!isMcpServerMode(args)) {
  handleCli(args).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  // --- MCP Server (requires SDK + env vars) ---

  const API_KEY = process.env.SYNAPSE_API_KEY;
  const PASSPHRASE = process.env.SYNAPSE_PASSPHRASE;
  const USER_EMAIL = process.env.SYNAPSE_USER_EMAIL;
  const SOURCE = process.env.SYNAPSE_SOURCE || "claude";
  const DEFAULT_PROJECT_NAME = process.env.SYNAPSE_PROJECT || "My Workspace";

  if (!API_KEY) {
    console.error(
      "SYNAPSE_API_KEY is required. In a terminal: npx synapsesync-mcp --help  then  npx synapsesync-mcp login  or  npx synapsesync-mcp init",
    );
    process.exit(1);
  }

  // Auto-detect or create the user's project
  let PROJECT: string | null = null;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  async function api(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err}`);
    }
    return res.json();
  }

  async function getProject(): Promise<string> {
    if (PROJECT) return PROJECT;

    // List existing projects
    const projects = (await api("GET", "/api/projects")) as ProjectResponse[];
    if (projects.length > 0) {
      PROJECT = projects[0].name;
      return PROJECT;
    }

    // No projects — create one
    const created = (await api("POST", "/api/projects", { name: DEFAULT_PROJECT_NAME })) as ProjectResponse;
    PROJECT = created.name;
    return PROJECT;
  }

  // --- E2E Encryption (matches frontend crypto.ts) ---
  const ENC_PREFIX = "enc:v1:";
  const PBKDF2_ITERATIONS = 100_000;

  let derivedKey: Buffer | null = null;

  async function deriveKeyNode(passphrase: string, salt: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(passphrase, salt, PBKDF2_ITERATIONS, 32, "sha256", (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }

  async function getEncKey(): Promise<Buffer | null> {
    if (derivedKey) return derivedKey;
    if (!PASSPHRASE || !USER_EMAIL) return null;
    derivedKey = await deriveKeyNode(PASSPHRASE, USER_EMAIL);
    return derivedKey;
  }

  async function encryptContent(plaintext: string): Promise<string> {
    const key = await getEncKey();
    if (!key) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([encrypted, authTag]);
    return `${ENC_PREFIX}${iv.toString("hex")}:${combined.toString("base64")}`;
  }

  async function decryptContent(text: string): Promise<string> {
    if (!text.startsWith(ENC_PREFIX)) return text;
    const key = await getEncKey();
    if (!key) return text;
    const payload = text.slice(ENC_PREFIX.length);
    const colonIdx = payload.indexOf(":");
    const ivHex = payload.slice(0, colonIdx);
    const ctBase64 = payload.slice(colonIdx + 1);
    const iv = Buffer.from(ivHex, "hex");
    const combined = Buffer.from(ctBase64, "base64");
    const authTag = combined.slice(-16);
    const ciphertext = combined.slice(0, -16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  const server = new McpServer({
    name: "synapse",
    version: "0.6.0",
  });

  // --- ls: list files and folders ---
  server.tool(
    "ls",
    "List files and folders. Like `ls` on a local filesystem. Returns directory contents with types and modification dates.",
    { path: z.string().optional().describe("Directory path to list. Omit for root.") },
    async ({ path }) => {
      const folder = path || "";
      const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const project = await getProject();
      const entries = (await api(
        "GET",
        `/api/context/${encodeURIComponent(project)}/list${qs}`,
      )) as EntryListResponse[];

      if (entries.length === 0) {
        return { content: [{ type: "text" as const, text: folder ? `${folder}/ is empty` : "(empty)" }] };
      }

      const lines = entries.map((e) => {
        const name = e.path.split("/").pop();
        const date = new Date(e.updated_at).toLocaleDateString();
        const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
        return `  ${name}  (${date})${tags}`;
      });

      const header = folder || ".";
      return { content: [{ type: "text" as const, text: `${header}\n${lines.join("\n")}` }] };
    },
  );

  // --- read: read a file ---
  server.tool(
    "read",
    "Read a file's content. Like `cat` on a local filesystem. Returns the full markdown/text content of the file at the given path.",
    { path: z.string().describe("File path to read (e.g. 'notes/meeting.md')") },
    async ({ path }) => {
      const project = await getProject();
      const entry = (await api(
        "GET",
        `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`,
      )) as EntryResponse;
      const meta = [
        `path: ${entry.path}`,
        `updated: ${new Date(entry.updated_at).toLocaleString()}`,
        `source: ${entry.source}`,
        entry.tags.length ? `tags: ${entry.tags.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const content = await decryptContent(entry.content);
      return { content: [{ type: "text" as const, text: `${meta}\n---\n${content}` }] };
    },
  );

  // --- write: create or update a file ---
  server.tool(
    "write",
    "Write content to a file. Creates the file if it doesn't exist, updates it if it does. IMPORTANT: Always use the correct directory prefix: decisions/ for decisions, notes/ for meeting notes, bugs/ for bug diagnoses, architecture/ for architecture docs, retrospectives/ for retrospectives, projects/<name>/ for project-specific context, settings/ for settings. Never write to the root \u2014 always use a directory.",
    {
      path: z
        .string()
        .describe(
          "File path with directory prefix (e.g. 'decisions/chose-redis.md', 'notes/standup-2026-03-22.md', 'bugs/auth-race.md', 'projects/myapp/overview.md'). Directories are created automatically.",
        ),
      content: z.string().describe("The full file content to write"),
      tags: z.array(z.string()).optional().describe("Optional tags for the file"),
    },
    async ({ path, content, tags }) => {
      const project = await getProject();
      const encrypted = await encryptContent(content);
      await api("POST", "/api/context/save", {
        project,
        path,
        content: encrypted,
        source: SOURCE,
        tags: tags || [],
      });
      return { content: [{ type: "text" as const, text: `Wrote ${path} (${content.length} chars)` }] };
    },
  );

  // --- rm: delete a file ---
  server.tool(
    "rm",
    "Delete a file. Like `rm` on a local filesystem. Permanently removes the file (history is preserved).",
    { path: z.string().describe("File path to delete") },
    async ({ path }) => {
      const project = await getProject();
      await api("DELETE", `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(path)}`);
      return { content: [{ type: "text" as const, text: `Deleted ${path}` }] };
    },
  );

  // --- search: search file contents ---
  server.tool(
    "search",
    "Search across all files using semantic + full-text + keyword search. Understands meaning \u2014 e.g., 'auth flow' finds 'login and session tokens'. Returns matching files ranked by relevance.",
    {
      query: z.string().describe("Search query (searches file contents)"),
      folder: z.string().optional().describe("Limit search to a specific directory"),
      tags: z.string().optional().describe("Comma-separated tags to filter by"),
    },
    async ({ query, folder, tags }) => {
      const params = new URLSearchParams({ q: query });
      if (folder) params.set("folder", folder);
      if (tags) params.set("tags", tags);

      let results: EntryResponse[];
      try {
        results = (await api(
          "GET",
          `/api/context/${encodeURIComponent(await getProject())}/search?${params}`,
        )) as EntryResponse[];
      } catch (_e) {
        // Gracefully handle errors (e.g., project not found) instead of throwing
        return { content: [{ type: "text" as const, text: `No results for "${query}"` }] };
      }

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No results for "${query}"` }] };
      }

      const decrypted = await Promise.all(
        results.map(async (e) => ({ ...e, content: await decryptContent(e.content) })),
      );
      const text = decrypted
        .map((e, i) => {
          const dir = e.path.includes("/") ? `${e.path.split("/").slice(0, -1).join("/")}/` : "(root)";
          const tags = e.tags?.length ? `  tags: ${e.tags.join(", ")}` : "";
          const updated = new Date(e.updated_at).toLocaleDateString();
          const preview = e.content.slice(0, 300).replace(/\n/g, " ");
          return `[${i + 1}] ${e.path}\n  dir: ${dir} | updated: ${updated}${tags}\n  ${preview}${e.content.length > 300 ? "..." : ""}`;
        })
        .join("\n\n");

      return {
        content: [
          { type: "text" as const, text: `${results.length} result${results.length === 1 ? "" : "s"}:\n\n${text}` },
        ],
      };
    },
  );

  // --- history: view file version history ---
  server.tool(
    "history",
    "View version history for a file. Shows past versions with timestamps and who made each change.",
    { path: z.string().describe("File path to get history for") },
    async ({ path }) => {
      const versions = (await api(
        "GET",
        `/api/context/${encodeURIComponent(await getProject())}/history/${encodeURIComponent(path)}`,
      )) as HistoryResponse[];

      if (versions.length === 0) {
        return { content: [{ type: "text" as const, text: `No history for ${path}` }] };
      }

      const decryptedVersions = await Promise.all(
        versions.map(async (v) => ({ ...v, content: await decryptContent(v.content) })),
      );
      const text = decryptedVersions
        .map((v, i) => {
          const date = new Date(v.changed_at).toLocaleString();
          const preview = v.content.slice(0, 100).replace(/\n/g, " ");
          return `[${i + 1}] ${date} (${v.source})\n    ${preview}...`;
        })
        .join("\n\n");

      return { content: [{ type: "text" as const, text: `${versions.length} versions of ${path}:\n\n${text}` }] };
    },
  );

  // --- tree: show full directory tree ---
  server.tool("tree", "Show the full directory tree. Like the `tree` command on a local filesystem.", {}, async () => {
    const project = await getProject();
    const entries = (await api("GET", `/api/context/${encodeURIComponent(project)}/list`)) as EntryListResponse[];

    if (entries.length === 0) {
      return { content: [{ type: "text" as const, text: "(empty workspace)" }] };
    }

    // Build tree structure
    const paths = entries.map((e) => e.path).sort();
    const lines = ["."];

    for (const p of paths) {
      const depth = p.split("/").length - 1;
      const indent = "  ".repeat(depth);
      const name = p.split("/").pop();
      lines.push(`${indent}${name}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  });

  async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
