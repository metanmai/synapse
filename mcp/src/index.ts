import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { runCapture } from "./capture/cli.js";
import { runRefresh, runStatus, runTree, runUpgrade, runWhoami } from "./cli/commands.js";
import { API_URL } from "./cli/config.js";
import { runStats } from "./cli/stats.js";
import { accent, bold, muted } from "./cli/theme.js";
import { runWizard } from "./cli/wizard.js";
import { runDistill } from "./distill/cli.js";

// --- Interfaces for MCP server response shapes ---

interface ProjectResponse {
  id: string;
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

interface InsightResponse {
  id: string;
  type: string;
  summary: string;
  detail: string | null;
  updated_at: string;
  created_at: string;
}

interface ListInsightsResponse {
  insights: InsightResponse[];
  total: number;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  status: string;
  message_count: number;
  fidelity_mode: string;
  updated_at: string;
  created_at: string;
}

interface ListConversationsResponse {
  conversations: ConversationSummary[];
  total: number;
}

interface ConversationMessage {
  id: string;
  sequence: number;
  role: string;
  content: string | null;
  tool_interaction: { name?: string; summary?: string; input?: unknown; output?: string } | null;
  source_agent: string;
  source_model: string | null;
  created_at: string;
}

interface ConversationDetail {
  id: string;
  title: string | null;
  status: string;
  message_count: number;
  fidelity_mode: string;
  system_prompt: string | null;
  working_context: Record<string, unknown> | null;
  messages: ConversationMessage[];
  updated_at: string;
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

const CLI_SUBCOMMANDS = new Set([
  "wizard",
  "help",
  "stats",
  "tree",
  "status",
  "refresh",
  "upgrade",
  "whoami",
  "capture",
  "distill",
]);

// --- CLI help ---

function printHelp(): void {
  const v = readPackageVersion();
  const c = (cmd: string, desc: string) => `  ${accent(cmd.padEnd(20))} ${muted(desc)}`;

  const lines = [
    "",
    `  ${bold("synapsesync-mcp")} ${muted(`v${v}`)}`,
    `  ${muted("Capture sessions. Distill knowledge. Remember everything.")}`,
    "",
    `  ${bold("Setup")}`,
    c("wizard", "Interactive setup (default)"),
    c("status", "Connection health + config locations"),
    c("refresh", "Rotate API key, update all configs"),
    "",
    `  ${bold("Capture")}`,
    c("capture start", "Start the session capture daemon"),
    c("capture stop", "Stop the capture daemon"),
    c("capture status", "Daemon health + session count"),
    c("capture list", "Browse captured sessions"),
    "",
    `  ${bold("Distill")}`,
    c("distill <id>", "Extract knowledge from a session"),
    c("distill --latest", "Distill the most recent session"),
    "",
    `  ${bold("Workspace")}`,
    c("tree", "File tree"),
    c("stats", "Lifetime stats"),
    c("whoami", "Account info"),
    c("upgrade", "Upgrade to Plus ($5.99/mo)"),
    "",
    `  ${muted("-h, --help")}              ${muted("Show this help")}`,
    `  ${muted("-v, --version")}           ${muted("Show version")}`,
    "",
    `  ${muted("MCP server runs automatically when stdin is not a TTY.")}`,
    "",
    `  ${accent("synapsesync.app")}         ${muted("Dashboard + settings")}`,
    `  ${muted("github.com/metanmai/synapse")}`,
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

  if (cmd === "capture") {
    await runCapture(raw.slice(1));
    process.exit(0);
  }

  if (cmd === "distill") {
    await runDistill(raw.slice(1));
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
  /**
   * Resolve a file path using glob-like fuzzy matching.
   * Tries exact hit first, then progressively looser matches against all workspace entries.
   * Returns { match, suggestions } — match is the single resolved path (or null), suggestions
   * is a list of candidates when the match is ambiguous.
   */
  async function resolvePath(target: string): Promise<{ match: string | null; suggestions: string[] }> {
    const project = await getProject();

    // 1. Try exact fetch — fast path, no listing needed
    try {
      await api("GET", `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(target)}`);
      return { match: target, suggestions: [] };
    } catch {
      // Not found — fall through to fuzzy matching
    }

    // 2. List all entries and match
    const entries = (await api("GET", `/api/context/${encodeURIComponent(project)}/list`)) as EntryListResponse[];
    const paths = entries.map((e) => e.path);
    const q = target.toLowerCase().replace(/\.md$/, "");

    // Helper: filename without extension
    const stem = (p: string) => (p.split("/").pop() ?? p).toLowerCase().replace(/\.md$/, "");

    // Exact filename match (ignore directory)
    const byName = paths.filter((p) => stem(p) === q);
    if (byName.length === 1) return { match: byName[0], suggestions: [] };

    // Path ends with target (e.g. "auth.md" matches "retrospectives/auth.md")
    const bySuffix = paths.filter((p) => p.toLowerCase().endsWith(target.toLowerCase()));
    if (bySuffix.length === 1) return { match: bySuffix[0], suggestions: [] };

    // Path starts with target (prefix, like "decisions/conv" → "decisions/conversation-sync-design.md")
    const byPrefix = paths.filter((p) => p.toLowerCase().startsWith(q));
    if (byPrefix.length === 1) return { match: byPrefix[0], suggestions: [] };

    // Filename starts with query stem (e.g. "auth" → "auth-middleware-rewrite.md")
    const byFilenamePrefix = paths.filter((p) => stem(p).startsWith(q));
    if (byFilenamePrefix.length === 1) return { match: byFilenamePrefix[0], suggestions: [] };

    // Substring in path (e.g. "url-migration" matches "retrospectives/url-migration.md")
    const bySubstring = paths.filter((p) => p.toLowerCase().includes(q));
    if (bySubstring.length === 1) return { match: bySubstring[0], suggestions: [] };

    // Multiple matches — return as suggestions, preferring narrower match sets
    const candidates =
      byName.length > 0
        ? byName
        : bySuffix.length > 0
          ? bySuffix
          : byPrefix.length > 0
            ? byPrefix
            : byFilenamePrefix.length > 0
              ? byFilenamePrefix
              : bySubstring;
    return { match: null, suggestions: candidates.slice(0, 8) };
  }

  server.tool(
    "ls",
    "List files and folders. Like `ls` on a local filesystem. Returns directory contents with types and modification dates.",
    { path: z.string().optional().describe("Directory path to list. Omit for root.") },
    { readOnlyHint: true },
    async ({ path }) => {
      const folder = path || "";
      const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const project = await getProject();
      let entries: EntryListResponse[];
      try {
        entries = (await api("GET", `/api/context/${encodeURIComponent(project)}/list${qs}`)) as EntryListResponse[];
      } catch (_e) {
        return {
          content: [{ type: "text" as const, text: folder ? `Folder not found: ${folder}/` : "Workspace is empty." }],
          isError: true,
        };
      }

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
    { readOnlyHint: true },
    async ({ path }) => {
      const { match, suggestions } = await resolvePath(path);
      if (!match) {
        if (suggestions.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File not found: ${path}\n\nDid you mean:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: `File not found: ${path}` }], isError: true };
      }
      const project = await getProject();
      const entry = (await api(
        "GET",
        `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(match)}`,
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
    { destructiveHint: true },
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
    { destructiveHint: true },
    async ({ path }) => {
      const { match, suggestions } = await resolvePath(path);
      if (!match) {
        if (suggestions.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File not found: ${path}\n\nDid you mean:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: `File not found: ${path}` }], isError: true };
      }
      const project = await getProject();
      await api("DELETE", `/api/context/${encodeURIComponent(project)}/${encodeURIComponent(match)}`);
      return { content: [{ type: "text" as const, text: `Deleted ${match}` }] };
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
    { readOnlyHint: true },
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
    { readOnlyHint: true },
    async ({ path }) => {
      const { match, suggestions } = await resolvePath(path);
      if (!match) {
        if (suggestions.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File not found: ${path}\n\nDid you mean:\n${suggestions.map((s) => `  - ${s}`).join("\n")}`,
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: `File not found: ${path}` }], isError: true };
      }
      const versions = (await api(
        "GET",
        `/api/context/${encodeURIComponent(await getProject())}/history/${encodeURIComponent(match)}`,
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
  server.tool(
    "tree",
    "Show the full directory tree. Like the `tree` command on a local filesystem.",
    {},
    { readOnlyHint: true },
    async () => {
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
    },
  );

  // --- Conversation tools (Plus tier) ---

  /** Resolve a project name to its ID using fuzzy matching: exact → starts-with → includes. */
  async function resolveProjectId(projectName: string, autoCreate = false): Promise<string | null> {
    const projects = (await api("GET", "/api/projects")) as ProjectResponse[];
    const q = projectName.toLowerCase();

    // 1. Exact match
    const exact = projects.find((p) => p.name.toLowerCase() === q);
    if (exact) return exact.id;

    // 2. Starts-with
    const prefix = projects.filter((p) => p.name.toLowerCase().startsWith(q));
    if (prefix.length === 1) return prefix[0].id;

    // 3. Substring / includes
    const substring = projects.filter((p) => p.name.toLowerCase().includes(q));
    if (substring.length === 1) return substring[0].id;

    // 4. Reverse: query contains project name (e.g. "my synapse project" matches "synapse")
    const reverse = projects.filter((p) => q.includes(p.name.toLowerCase()));
    if (reverse.length === 1) return reverse[0].id;

    // 5. Auto-create if requested
    if (autoCreate) {
      const created = (await api("POST", "/api/projects", { name: projectName })) as ProjectResponse;
      return created.id;
    }

    return null;
  }

  // --- list_conversations: list conversations for a project ---
  server.tool(
    "list_conversations",
    "List conversations synced to a project. Returns titles, message counts, status, and IDs. Plus only.",
    {
      project: z.string().describe("Project name"),
      status: z.enum(["active", "archived"]).optional().describe("Filter by status (default: all non-deleted)"),
      limit: z.number().optional().describe("Maximum number of conversations to return (default 20)"),
    },
    { readOnlyHint: true },
    async ({ project, status, limit }) => {
      const projectId = await resolveProjectId(project);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      const params = new URLSearchParams({ project_id: projectId });
      if (status) params.set("status", status);
      if (limit) params.set("limit", String(limit));

      let result: ListConversationsResponse;
      try {
        result = (await api("GET", `/api/conversations?${params}`)) as ListConversationsResponse;
      } catch (_e) {
        return {
          content: [
            { type: "text" as const, text: "Failed to list conversations. This feature requires a Plus subscription." },
          ],
          isError: true,
        };
      }

      const { conversations, total } = result;
      if (conversations.length === 0) {
        const filterNote = status ? ` with status "${status}"` : "";
        return {
          content: [{ type: "text" as const, text: `No conversations${filterNote} found in project "${project}".` }],
        };
      }

      const lines = conversations.map((c) => {
        const title = c.title ?? "(untitled)";
        const date = new Date(c.updated_at).toLocaleDateString();
        return `- **${title}** — ${c.message_count} messages, ${c.status}, updated ${date}\n  ID: \`${c.id}\``;
      });

      const filterNote = status ? ` (status: ${status})` : "";
      const header = `${total} conversation(s) in "${project}"${filterNote} (showing ${conversations.length}):`;

      return { content: [{ type: "text" as const, text: `${header}\n\n${lines.join("\n")}` }] };
    },
  );

  // --- load_conversation: load a conversation to resume it ---
  server.tool(
    "load_conversation",
    "Load a conversation to resume it in another agent. Returns the system prompt, working context, and full message transcript. Plus only.",
    {
      project: z.string().describe("Project name"),
      conversationId: z.string().describe("Conversation ID to load"),
      fromSequence: z.number().optional().describe("Start from this message sequence number (for partial loads)"),
    },
    { readOnlyHint: true },
    async ({ project, conversationId, fromSequence }) => {
      const projectId = await resolveProjectId(project);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      const params = new URLSearchParams();
      if (fromSequence) params.set("from_sequence", String(fromSequence));
      const qs = params.toString() ? `?${params}` : "";

      let conv: ConversationDetail;
      try {
        conv = (await api(
          "GET",
          `/api/conversations/${encodeURIComponent(conversationId)}${qs}`,
        )) as ConversationDetail;
      } catch (_e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Conversation "${conversationId}" not found or access denied. This feature requires a Plus subscription.`,
            },
          ],
          isError: true,
        };
      }

      // Build formatted transcript
      const parts: string[] = [];

      parts.push(`# Conversation: ${conv.title ?? "(untitled)"}`);
      parts.push(`**ID:** ${conv.id}`);
      parts.push(
        `**Status:** ${conv.status} | **Fidelity:** ${conv.fidelity_mode} | **Messages:** ${conv.message_count}`,
      );
      parts.push("");

      if (conv.system_prompt) {
        parts.push("## System Prompt");
        parts.push(conv.system_prompt);
        parts.push("");
      }

      if (conv.working_context && Object.keys(conv.working_context).length > 0) {
        parts.push("## Working Context");
        for (const [key, value] of Object.entries(conv.working_context)) {
          parts.push(`- **${key}:** ${typeof value === "string" ? value : JSON.stringify(value)}`);
        }
        parts.push("");
      }

      const messages = conv.messages ?? [];
      if (messages.length > 0) {
        parts.push("## Messages");
        parts.push("");
        for (const msg of messages) {
          const agent = msg.source_agent
            ? ` (${msg.source_agent}${msg.source_model ? ` / ${msg.source_model}` : ""})`
            : "";
          parts.push(`### [${msg.sequence}] ${msg.role}${agent}`);
          if (msg.content) {
            parts.push(msg.content);
          }
          if (msg.tool_interaction) {
            if (conv.fidelity_mode === "summary" && msg.tool_interaction.summary) {
              parts.push(`> Tool: ${msg.tool_interaction.summary}`);
            } else {
              parts.push(`> Tool: ${msg.tool_interaction.name ?? "unknown"}`);
              if (msg.tool_interaction.input) {
                parts.push(`> Input: ${JSON.stringify(msg.tool_interaction.input)}`);
              }
              if (msg.tool_interaction.output) {
                parts.push(`> Output: ${msg.tool_interaction.output}`);
              }
            }
          }
          parts.push("");
        }
      } else {
        parts.push("*No messages found.*");
      }

      return { content: [{ type: "text" as const, text: parts.join("\n") }] };
    },
  );

  // --- save_insight: store a decision/learning/preference/architecture/action_item ---
  server.tool(
    "save_insight",
    "Save a key insight about the project — a decision, learning, preference, architecture note, or action item. Call this whenever something worth remembering comes up during a session.",
    {
      project: z.string().describe("Project name"),
      type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).describe("Type of insight"),
      summary: z.string().describe("Short summary of the insight"),
      detail: z.string().optional().describe("Optional longer explanation or context"),
    },
    { destructiveHint: true },
    async ({ project, type, summary, detail }) => {
      const projectId = await resolveProjectId(project, true);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      try {
        const insight = (await api("POST", "/api/insights", {
          project_id: projectId,
          type,
          summary,
          detail: detail ?? null,
          source: { type: "session", agent: SOURCE },
        })) as InsightResponse;

        return {
          content: [{ type: "text" as const, text: `Saved ${type} insight: "${insight.summary}"` }],
        };
      } catch (_e) {
        return {
          content: [{ type: "text" as const, text: "Failed to save insight." }],
          isError: true,
        };
      }
    },
  );

  // --- list_insights: browse insights for a project ---
  server.tool(
    "list_insights",
    "List insights for a project, optionally filtered by type. Returns insights sorted by most recently updated.",
    {
      project: z.string().describe("Project name"),
      type: z
        .enum(["decision", "learning", "preference", "architecture", "action_item"])
        .optional()
        .describe("Filter by insight type"),
      limit: z.number().optional().describe("Maximum number of insights to return (default 20)"),
    },
    { readOnlyHint: true },
    async ({ project, type, limit }) => {
      const projectId = await resolveProjectId(project);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      const params = new URLSearchParams({ project_id: projectId });
      if (type) params.set("type", type);
      if (limit) params.set("limit", String(limit));

      try {
        const result = (await api("GET", `/api/insights?${params}`)) as ListInsightsResponse;
        const { insights, total } = result;

        if (insights.length === 0) {
          const filterNote = type ? ` of type "${type}"` : "";
          return {
            content: [{ type: "text" as const, text: `No insights${filterNote} found in project "${project}".` }],
          };
        }

        const lines = insights.map(
          (i) =>
            `- [${i.type}] ${i.summary}${i.detail ? ` — ${i.detail}` : ""} (${new Date(i.updated_at).toLocaleDateString()})`,
        );
        const header = type
          ? `${total} ${type} insight(s) in "${project}" (showing ${insights.length}):`
          : `${total} insight(s) in "${project}" (showing ${insights.length}):`;

        return { content: [{ type: "text" as const, text: `${header}\n${lines.join("\n")}` }] };
      } catch (_e) {
        return {
          content: [{ type: "text" as const, text: "Failed to list insights." }],
          isError: true,
        };
      }
    },
  );

  // --- sync_conversation: push messages to a conversation ---
  server.tool(
    "sync_conversation",
    "Push messages to a conversation. Creates a new conversation if no conversationId is provided, otherwise appends. Plus only.",
    {
      project: z.string().describe("Project name"),
      conversationId: z
        .string()
        .optional()
        .describe("Existing conversation ID to append to. Omit to create a new conversation."),
      title: z.string().optional().describe("Conversation title (used when creating a new conversation)"),
      systemPrompt: z.string().optional().describe("System prompt for the conversation"),
      workingContext: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Working context (key-value metadata about the environment, repo, etc.)"),
      fidelity: z
        .enum(["summary", "full"])
        .optional()
        .describe("Fidelity mode: 'summary' collapses tool calls, 'full' preserves everything. Default: summary"),
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant", "system", "tool"]).describe("Message role"),
            content: z.string().describe("Message content"),
            toolSummary: z.string().optional().describe("One-line summary of a tool call (for fidelity=summary)"),
            sourceAgent: z.string().optional().describe("Agent that produced this message"),
            sourceModel: z.string().optional().describe("Model used"),
          }),
        )
        .describe("Messages to sync"),
    },
    { destructiveHint: true },
    async ({ project, conversationId, title, systemPrompt, workingContext, fidelity, messages }) => {
      const projectId = await resolveProjectId(project, true);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      let convId = conversationId;
      let action: string;

      if (!convId) {
        // Create new conversation
        let created: ConversationSummary;
        try {
          created = (await api("POST", "/api/conversations", {
            project_id: projectId,
            title: title ?? null,
            fidelity_mode: fidelity ?? "summary",
            system_prompt: systemPrompt ?? null,
            working_context: workingContext ?? null,
          })) as ConversationSummary;
        } catch (_e) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Failed to create conversation. This feature requires a Plus subscription.",
              },
            ],
            isError: true,
          };
        }
        convId = created.id;
        action = "Created";
      } else {
        action = "Updated";
      }

      // Append messages
      let appended = 0;
      if (messages.length > 0) {
        try {
          const msgRows = messages.map(
            (msg: {
              role: string;
              content: string;
              toolSummary?: string;
              sourceAgent?: string;
              sourceModel?: string;
            }) => ({
              role: msg.role,
              content: msg.content,
              tool_interaction: msg.toolSummary ? { name: "tool", summary: msg.toolSummary } : null,
              source_agent: msg.sourceAgent ?? SOURCE,
              source_model: msg.sourceModel ?? null,
            }),
          );
          await api("POST", `/api/conversations/${encodeURIComponent(convId)}/messages`, {
            messages: msgRows,
          });
          appended = messages.length;
        } catch (_e) {
          return {
            content: [
              { type: "text" as const, text: `${action} conversation "${convId}" but failed to append messages.` },
            ],
            isError: true,
          };
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `${action} conversation "${convId}" in project "${project}". ${appended} message(s) appended.`,
          },
        ],
      };
    },
  );

  async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
