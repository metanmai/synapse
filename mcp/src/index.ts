import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as clack from "@clack/prompts";
import { runCapture } from "./capture/cli.js";
import { runTree } from "./cli/commands.js";
import { API_URL } from "./cli/config.js";
import { HANDLERS, registerPrintHelp, runLegacyStatus } from "./cli/handlers.js";
import { accent, bold, muted } from "./cli/theme.js";
import { runWizard } from "./cli/wizard.js";

// --- Interfaces for MCP server response shapes ---

interface ProjectResponse {
  id: string;
  name: string;
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

// Register the `wizard` handler — it lives in index.ts rather than handlers.ts
// because it needs the local `readPackageVersion` helper (which reads the
// package.json sitting next to this file via `import.meta.url`).
HANDLERS.wizard = async () => runWizard(readPackageVersion());

// Wire `help` (the printer is defined just below) into the dispatch table.
// `printHelp` is a function declaration so it's hoisted — safe to reference
// here. The registerPrintHelp indirection keeps `handlers.ts` free of
// theme / banner dependencies.
registerPrintHelp(() => printHelp());

// --- CLI help ---

function printHelp(): void {
  const v = readPackageVersion();
  const c = (cmd: string, desc: string) => `  ${accent(cmd.padEnd(20))} ${muted(desc)}`;

  const lines = [
    "",
    `  ${bold("synapsesync")} ${muted(`v${v}`)}`,
    `  ${muted("Capture sessions. Remember everything.")}`,
    "",
    `  ${bold("Setup")}`,
    c("wizard", "Interactive setup + connect tools"),
    c("init", "Install hooks, slash commands, daemon"),
    c("status", "Daemon health + tracked projects"),
    c("doctor", "Diagnose handoff layer health"),
    c("refresh", "Rotate API key, update all configs"),
    "",
    `  ${bold("Handoff layer")}`,
    c("brief", "Emit project brief (for SessionStart hook)"),
    c("handoff", "Compose a handoff brief to next session"),
    c("set-focus", "Set the active focus statement"),
    c("note", "Add a contextual note"),
    c("issue create", "File a decision or question to track"),
    c("issue resolve", "Mark an issue resolved"),
    c("issue supersede", "Replace an issue with a newer one"),
    c("invite", "Invite a collaborator to a project"),
    "",
    `  ${bold("Capture")}`,
    c("capture start", "Start the session capture daemon"),
    c("capture stop", "Stop the capture daemon"),
    c("capture status", "Daemon health + session count"),
    c("capture list", "Browse captured sessions"),
    "",
    `  ${bold("Workspace")}`,
    c("tree", "File tree"),
    c("stats", "Lifetime stats"),
    c("whoami", "Account info"),
    c("upgrade", "Upgrade to Plus ($5.99/mo)"),
    "",
    `  ${bold("Account")}`,
    c("reset", "Wipe all data, keep account"),
    c("uninstall", "Remove all Synapse configs"),
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

  // Dispatch via the single-source HANDLERS map — no drift between
  // allow-list and dispatcher possible, because they're the same table.
  const cmd = raw[0];
  if (cmd) {
    const handler = HANDLERS[cmd];
    if (!handler) {
      unknownSubcommand(cmd);
    }
    await handler(raw.slice(1));
    process.exit(0);
  }

  // No subcommand in interactive mode → show menu
  if (isInteractiveTerminal()) {
    await runMenu();
    process.exit(0);
  }

  // Non-interactive + no MCP mode → show help
  printHelp();
  process.exit(0);
}

async function runMenu(): Promise<void> {
  const v = readPackageVersion();
  clack.intro(`${bold("synapsesync")} ${muted(`v${v}`)}`);

  const choice = await clack.select({
    message: "What would you like to do?",
    options: [
      { value: "status", label: "Status", hint: "connection health + config locations" },
      { value: "capture-start", label: "Start capture", hint: "begin recording AI sessions" },
      { value: "capture-status", label: "Capture status", hint: "daemon health + session count" },
      { value: "tree", label: "Workspace tree", hint: "browse your files" },
      { value: "wizard", label: "Setup wizard", hint: "connect tools + configure" },
      { value: "help", label: "Help", hint: "show all commands" },
    ],
  });

  if (clack.isCancel(choice)) {
    clack.outro(muted("synapsesync.app"));
    return;
  }

  console.log("");

  switch (choice) {
    case "status":
      await runLegacyStatus();
      break;
    case "capture-start":
      await runCapture(["start"]);
      break;
    case "capture-status":
      await runCapture(["status"]);
      break;
    case "tree":
      await runTree();
      break;
    case "wizard":
      await runWizard(readPackageVersion());
      break;
    case "help":
      printHelp();
      break;
  }
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
  const SOURCE = process.env.SYNAPSE_SOURCE || "claude";

  if (!API_KEY) {
    console.error("SYNAPSE_API_KEY is required. Install: npm install -g synapsesync, then run: synapsesync wizard");
    process.exit(1);
  }

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

  const server = new McpServer({
    name: "synapse",
    version: "0.6.0",
  });

  // DEPRECATED: legacy MCP surface. Prefer REST API or handoff CLI. Removal target: v2.0
  // Only `save_insight` and `list_insights` remain — the filesystem-style tools
  // (ls/read/search/history/tree/list_conversations/load_conversation) were removed in v1.1.

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

  // --- save_insight: store a decision/learning/preference/architecture/action_item ---
  server.tool(
    "save_insight",
    "Save a key insight about the project — a decision, learning, preference, architecture note, or action item. BREVITY IS CRITICAL: `summary` MUST be ≤12 words (one short sentence). `detail` is optional and MUST be ≤2 sentences. Insights accumulate and clog future briefs if verbose. CONSOLIDATE AGGRESSIVELY: before saving, call `list_insights` to see existing IDs — if your new insight replaces, contradicts, or makes obsolete any existing ones, pass their IDs in `supersedes` so they are removed from future briefs. Saving without superseding when you should creates clutter.",
    {
      project: z.string().describe("Project name"),
      type: z.enum(["decision", "learning", "preference", "architecture", "action_item"]).describe("Type of insight"),
      summary: z.string().describe("Short summary of the insight"),
      detail: z.string().optional().describe("Optional longer explanation or context"),
      supersedes: z
        .array(z.string().uuid())
        .optional()
        .describe(
          "Optional list of insight IDs that this new insight replaces. Pass when your save makes an earlier insight obsolete or wrong. The named insights will be marked as 'superseded' and excluded from future briefs.",
        ),
    },
    { destructiveHint: true },
    async ({ project, type, summary, detail, supersedes }) => {
      const projectId = await resolveProjectId(project, true);
      if (!projectId) {
        return { content: [{ type: "text" as const, text: `Project "${project}" not found.` }], isError: true };
      }

      try {
        const body: Record<string, unknown> = {
          project_id: projectId,
          type,
          summary,
          detail: detail ?? null,
          source: { type: "session", agent: SOURCE },
        };
        if (supersedes && supersedes.length > 0) {
          body.supersedes = supersedes;
        }
        const insight = (await api("POST", "/api/insights", body)) as InsightResponse;

        const supersedeNote =
          supersedes && supersedes.length > 0 ? ` (superseded ${supersedes.length} prior insight(s))` : "";
        return {
          content: [{ type: "text" as const, text: `Saved ${type} insight: "${insight.summary}"${supersedeNote}` }],
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
            `- [${i.type}] ${i.summary}${i.detail ? ` — ${i.detail}` : ""} (${new Date(i.updated_at).toLocaleDateString()}) [id: ${i.id}]`,
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

  async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
