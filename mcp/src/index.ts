import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.SYNAPSE_API_URL || "https://api.synapsesync.app";

// --- Interfaces for API response shapes ---

interface LoginResponse {
  email: string;
  api_key: string;
  label: string;
}

interface SignupResponse {
  email: string;
  api_key: string;
}

interface ErrorResponse {
  error?: string;
}

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

// --- CLI commands (run before MCP server starts, no SDK needed) ---
const args = process.argv.slice(2);

if (args[0] === "login") {
  (async () => {
    const emailIdx = args.indexOf("--email");
    const passIdx = args.indexOf("--password");
    const labelIdx = args.indexOf("--label");

    const email = emailIdx !== -1 ? args[emailIdx + 1] : null;
    const password = passIdx !== -1 ? args[passIdx + 1] : null;
    const label = labelIdx !== -1 ? args[labelIdx + 1] : "cli";

    if (!email || !password) {
      console.error("Usage: synapsesync-mcp login --email <email> --password <password> [--label <label>]");
      process.exit(1);
    }

    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, label }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        console.error(`Login failed: ${body.error || res.statusText}`);
        process.exit(1);
      }

      const data = (await res.json()) as LoginResponse;
      console.log(`\nLogged in as ${data.email}`);
      console.log(`API Key: ${data.api_key}`);
      console.log(`Label: ${data.label}`);
      console.log("\nAdd this to your .mcp.json:");
      console.log(
        JSON.stringify(
          {
            mcpServers: {
              synapse: {
                command: "npx",
                args: ["synapsesync-mcp"],
                env: { SYNAPSE_API_KEY: data.api_key },
              },
            },
          },
          null,
          2,
        ),
      );
      console.log(`\nOr run: claude mcp add synapse npx synapsesync-mcp --env SYNAPSE_API_KEY=${data.api_key}`);
    } catch (err) {
      console.error(`Login failed: ${(err as Error).message}`);
      process.exit(1);
    }

    process.exit(0);
  })();
} else if (args[0] === "signup") {
  (async () => {
    const emailIdx = args.indexOf("--email");
    const email = emailIdx !== -1 ? args[emailIdx + 1] : null;

    if (!email) {
      console.error("Usage: synapsesync-mcp signup --email <email>");
      process.exit(1);
    }

    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        console.error(`Signup failed: ${body.error || res.statusText}`);
        process.exit(1);
      }

      const data = (await res.json()) as SignupResponse;
      console.log(`\nAccount created for ${data.email}`);
      console.log(`API Key: ${data.api_key}`);
      console.log("\nAdd this to your .mcp.json:");
      console.log(
        JSON.stringify(
          {
            mcpServers: {
              synapse: {
                command: "npx",
                args: ["synapsesync-mcp"],
                env: { SYNAPSE_API_KEY: data.api_key },
              },
            },
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error(`Signup failed: ${(err as Error).message}`);
      process.exit(1);
    }

    process.exit(0);
  })();
} else if (args[0] === "init") {
  (() => {
    const keyIdx = args.indexOf("--key");
    const apiKey = keyIdx !== -1 ? args[keyIdx + 1] : process.env.SYNAPSE_API_KEY;

    if (!apiKey) {
      console.error("Usage: synapsesync-mcp init --key <api-key>");
      console.error("  Or set SYNAPSE_API_KEY environment variable");
      console.error("\nGet a key: npx synapsesync-mcp login --email <email> --password <password>");
      process.exit(1);
    }

    const home = os.homedir();
    const cwd = process.cwd();

    const SYNAPSE_INSTRUCTIONS = `# Synapse — Shared Context Layer

You have access to a Synapse MCP server — a remote workspace for storing and retrieving context across sessions.

## Available Tools
- search — Semantic search across all files (finds by meaning, not just keywords)
- read — Read a file's content
- write — Create or update a file
- ls — List files in a directory
- tree — Show full directory tree
- history — View version history
- rm — Delete a file

## How to Use
1. BEFORE starting any task, search Synapse for existing context: search({ query: "topic" })
2. AFTER completing work, save important context: write({ path: "decisions/topic.md", content: "..." })
3. Use directory prefixes: decisions/, notes/, bugs/, architecture/, projects/<name>/

## Key Behaviors
- Always check Synapse before scanning the codebase — context may already exist
- Save decisions, architecture notes, bug diagnoses, and session summaries to Synapse
- Use semantic search — "auth flow" will find documents about "login and session tokens"
- Never write context to local files unless explicitly asked
`;

    function setupGeneric() {
      const mcpConfig = path.join(cwd, ".mcp.json");
      const config = { mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } } } };

      let existing: Record<string, unknown> = {};
      if (fs.existsSync(mcpConfig)) {
        try { existing = JSON.parse(fs.readFileSync(mcpConfig, "utf-8")); } catch {}
      }
      existing.mcpServers = { ...(existing.mcpServers as Record<string, unknown> || {}), ...config.mcpServers };
      fs.writeFileSync(mcpConfig, JSON.stringify(existing, null, 2) + "\n");

      const gitignore = path.join(cwd, ".gitignore");
      if (fs.existsSync(gitignore)) {
        const content = fs.readFileSync(gitignore, "utf-8");
        if (!content.includes(".mcp.json")) {
          fs.appendFileSync(gitignore, "\n.mcp.json\n");
        }
      }
      console.log("  ✓ .mcp.json");
    }

    function setupCursor() {
      const configDir = path.join(cwd, ".cursor");
      fs.mkdirSync(configDir, { recursive: true });
      const mcpConfig = path.join(configDir, "mcp.json");
      const config = { mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } } } };
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(mcpConfig)) {
        try { existing = JSON.parse(fs.readFileSync(mcpConfig, "utf-8")); } catch {}
      }
      existing.mcpServers = { ...(existing.mcpServers as Record<string, unknown> || {}), ...config.mcpServers };
      fs.writeFileSync(mcpConfig, JSON.stringify(existing, null, 2) + "\n");
      console.log("  ✓ .cursor/mcp.json");

      const rulesFile = path.join(cwd, ".cursorrules");
      let rulesContent = "";
      if (fs.existsSync(rulesFile)) {
        rulesContent = fs.readFileSync(rulesFile, "utf-8");
      }
      if (!rulesContent.includes("Synapse")) {
        fs.appendFileSync(rulesFile, "\n" + SYNAPSE_INSTRUCTIONS);
        console.log("  ✓ .cursorrules");
      } else {
        console.log("  ○ .cursorrules (already has Synapse)");
      }
    }

    function setupWindsurf() {
      const configDir = path.join(home, ".codeium", "windsurf");
      fs.mkdirSync(configDir, { recursive: true });
      const mcpConfig = path.join(configDir, "mcp_config.json");
      const config = { mcpServers: { synapse: { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } } } };
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(mcpConfig)) {
        try { existing = JSON.parse(fs.readFileSync(mcpConfig, "utf-8")); } catch {}
      }
      existing.mcpServers = { ...(existing.mcpServers as Record<string, unknown> || {}), ...config.mcpServers };
      fs.writeFileSync(mcpConfig, JSON.stringify(existing, null, 2) + "\n");
      console.log("  ✓ ~/.codeium/windsurf/mcp_config.json");

      const rulesFile = path.join(cwd, ".windsurfrules");
      let rulesContent = "";
      if (fs.existsSync(rulesFile)) {
        rulesContent = fs.readFileSync(rulesFile, "utf-8");
      }
      if (!rulesContent.includes("Synapse")) {
        fs.appendFileSync(rulesFile, "\n" + SYNAPSE_INSTRUCTIONS);
        console.log("  ✓ .windsurfrules");
      } else {
        console.log("  ○ .windsurfrules (already has Synapse)");
      }
    }

    function setupVSCode() {
      const settingsFile = path.join(cwd, ".vscode", "settings.json");
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsFile)) {
        try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8")); } catch {}
      }
      if (!settings.mcp) settings.mcp = {};
      const mcp = settings.mcp as Record<string, unknown>;
      if (!mcp.servers) mcp.servers = {};
      (mcp.servers as Record<string, unknown>).synapse = { command: "npx", args: ["synapsesync-mcp"], env: { SYNAPSE_API_KEY: apiKey } };
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
      console.log("  ✓ .vscode/settings.json");

      const ghDir = path.join(cwd, ".github");
      fs.mkdirSync(ghDir, { recursive: true });
      const instrFile = path.join(ghDir, "copilot-instructions.md");
      let instrContent = "";
      if (fs.existsSync(instrFile)) {
        instrContent = fs.readFileSync(instrFile, "utf-8");
      }
      if (!instrContent.includes("Synapse")) {
        fs.appendFileSync(instrFile, "\n" + SYNAPSE_INSTRUCTIONS);
        console.log("  ✓ .github/copilot-instructions.md");
      } else {
        console.log("  ○ .github/copilot-instructions.md (already has Synapse)");
      }
    }

    function setupClaudeCode() {
      const claudeMd = path.join(home, ".claude", "CLAUDE.md");
      let claudeContent = "";
      if (fs.existsSync(claudeMd)) {
        claudeContent = fs.readFileSync(claudeMd, "utf-8");
      }
      if (!claudeContent.includes("Synapse")) {
        fs.appendFileSync(claudeMd, "\n" + SYNAPSE_INSTRUCTIONS);
        console.log("  ✓ ~/.claude/CLAUDE.md");
      } else {
        console.log("  ○ ~/.claude/CLAUDE.md (already has Synapse)");
      }

      const cmdDir = path.join(home, ".claude", "commands", "synapse");
      fs.mkdirSync(cmdDir, { recursive: true });

      const commands: Record<string, string> = {
        "search.md": `Search the Synapse workspace. The search query is: $ARGUMENTS\n\nUses semantic search — understands meaning, not just keywords.\n\nRun \`mcp__synapse__search({ query: "$ARGUMENTS" })\` and display results. If not connected, say "Not connected."\n`,
        "tree.md": `Show the full Synapse workspace file tree.\n\nRun \`mcp__synapse__tree()\` and display the tree. If not connected, say "Not connected."\n`,
        "sync.md": `Sync project context to Synapse.\n\n1. Run \`mcp__synapse__tree()\` to check connection\n2. Summarize recent git changes\n3. Write project overview and recent changes to Synapse\n`,
        "whoami.md": `Show current Synapse account info.\n\n1. Run \`mcp__synapse__ls()\` to verify connection\n2. Run \`mcp__synapse__tree()\` to count files\n3. Show: "Connected. Files: [count]."\n`,
        "clean.md": `Clean up the Synapse workspace — remove duplicates, test files, and stale entries.\n\n1. Run \`mcp__synapse__tree()\`\n2. Identify duplicates, test files, empty entries\n3. Confirm with user before deleting\n4. Delete confirmed entries with \`mcp__synapse__rm()\`\n`,
      };

      for (const [filename, content] of Object.entries(commands)) {
        const filepath = path.join(cmdDir, filename);
        if (!fs.existsSync(filepath)) {
          fs.writeFileSync(filepath, content);
          console.log(`  ✓ ~/.claude/commands/synapse/${filename}`);
        } else {
          console.log(`  ○ ~/.claude/commands/synapse/${filename} (exists)`);
        }
      }

      // Also write .mcp.json in cwd
      setupGeneric();
    }

    const tools: { name: string; detected: boolean; setup: () => void }[] = [];

    // Claude Code
    const claudeDir = path.join(home, ".claude");
    if (fs.existsSync(claudeDir)) {
      tools.push({ name: "Claude Code", detected: true, setup: setupClaudeCode });
    }

    // Cursor
    const cursorDir = path.join(cwd, ".cursor");
    if (fs.existsSync(cursorDir) || fs.existsSync(path.join(cwd, ".cursorrules"))) {
      tools.push({ name: "Cursor", detected: true, setup: setupCursor });
    }

    // Windsurf
    const windsurfDir = path.join(home, ".codeium");
    if (fs.existsSync(windsurfDir)) {
      tools.push({ name: "Windsurf", detected: true, setup: setupWindsurf });
    }

    // VS Code
    const vscodeDir = path.join(cwd, ".vscode");
    if (fs.existsSync(vscodeDir)) {
      tools.push({ name: "VS Code", detected: true, setup: setupVSCode });
    }

    // Always offer generic .mcp.json
    tools.push({ name: "Generic MCP (.mcp.json)", detected: true, setup: setupGeneric });

    console.log("\n🧠 Synapse Init\n");
    console.log("Detecting AI tools...\n");

    if (tools.length === 0) {
      console.log("No AI tools detected. Writing generic .mcp.json...");
      setupGeneric();
    } else {
      console.log(`Found ${tools.length} tool(s):\n`);
      for (const tool of tools) {
        console.log(`${tool.name}`);
        tool.setup();
        console.log();
      }
    }

    console.log("Done! Restart your AI tools to connect to Synapse.\n");
    process.exit(0);
  })();
} else {
  // --- MCP Server (requires SDK + env vars) ---

  const API_KEY = process.env.SYNAPSE_API_KEY;
  const PASSPHRASE = process.env.SYNAPSE_PASSPHRASE;
  const USER_EMAIL = process.env.SYNAPSE_USER_EMAIL;
  const SOURCE = process.env.SYNAPSE_SOURCE || "claude";
  const DEFAULT_PROJECT_NAME = process.env.SYNAPSE_PROJECT || "My Workspace";

  if (!API_KEY) {
    console.error(
      "SYNAPSE_API_KEY is required. Run 'npx synapsesync-mcp login --email <email> --password <password>' to get one.",
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
    version: "0.2.0",
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
    "Write content to a file. Creates the file if it doesn't exist, updates it if it does. IMPORTANT: Always use the correct directory prefix: decisions/ for decisions, notes/ for meeting notes, bugs/ for bug diagnoses, architecture/ for architecture docs, retrospectives/ for retrospectives, projects/<name>/ for project-specific context, settings/ for settings. Never write to the root — always use a directory.",
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
    "Search across all files using semantic + full-text + keyword search. Understands meaning — e.g., 'auth flow' finds 'login and session tokens'. Returns matching files ranked by relevance.",
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
