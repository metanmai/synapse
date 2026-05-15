#!/usr/bin/env node

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const API_URL = process.env.SYNAPSE_API_URL || "http://localhost:8787";
const API_KEY = process.env.SYNAPSE_API_KEY;
const PROJECT = process.env.SYNAPSE_PROJECT || "My Workspace";

if (!API_KEY) {
  console.error("SYNAPSE_API_KEY is required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

async function api(method, path, body) {
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
  version: "1.0.0",
});

// --- ls: list files and folders ---
server.tool(
  "ls",
  "List files and folders. Like `ls` on a local filesystem. Returns directory contents with types and modification dates.",
  { path: z.string().optional().describe("Directory path to list. Omit for root.") },
  async ({ path }) => {
    const folder = path || "";
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    const entries = await api("GET", `/api/context/${encodeURIComponent(PROJECT)}/list${qs}`);

    if (entries.length === 0) {
      return { content: [{ type: "text", text: folder ? `${folder}/ is empty` : "(empty)" }] };
    }

    const lines = entries.map((e) => {
      const name = e.path.split("/").pop();
      const date = new Date(e.updated_at).toLocaleDateString();
      const tags = e.tags.length ? ` [${e.tags.join(", ")}]` : "";
      return `  ${name}  (${date})${tags}`;
    });

    const header = folder ? `${folder}/` : ".";
    return { content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }] };
  }
);

// --- read: read a file ---
server.tool(
  "read",
  "Read a file's content. Like `cat` on a local filesystem. Returns the full markdown/text content of the file at the given path.",
  { path: z.string().describe("File path to read (e.g. 'decisions/chose-svelte.md')") },
  async ({ path }) => {
    const entry = await api("GET", `/api/context/${encodeURIComponent(PROJECT)}/${encodeURIComponent(path)}`);
    const meta = [
      `path: ${entry.path}`,
      `updated: ${new Date(entry.updated_at).toLocaleString()}`,
      `source: ${entry.source}`,
      entry.tags.length ? `tags: ${entry.tags.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return { content: [{ type: "text", text: `${meta}\n---\n${entry.content}` }] };
  }
);

// --- write: create or update a file ---
server.tool(
  "write",
  "Write content to a file. Creates the file if it doesn't exist, updates it if it does. Like writing to a local file. Directories are created implicitly from the path.",
  {
    path: z.string().describe("File path to write (e.g. 'notes/meeting.md'). Directories in the path are created automatically."),
    content: z.string().describe("The full file content to write"),
    tags: z.array(z.string()).optional().describe("Optional tags for the file"),
  },
  async ({ path, content, tags }) => {
    await api("POST", "/api/context/save", {
      project: PROJECT,
      path,
      content,
      tags: tags || [],
    });
    return { content: [{ type: "text", text: `Wrote ${path} (${content.length} chars)` }] };
  }
);

// --- search: search file contents ---
server.tool(
  "search",
  "Search across all files by content. Like `grep -r` on a local filesystem. Returns matching files with their content.",
  {
    query: z.string().describe("Search query (searches file contents)"),
    folder: z.string().optional().describe("Limit search to a specific directory"),
    tags: z.string().optional().describe("Comma-separated tags to filter by"),
  },
  async ({ query, folder, tags }) => {
    const params = new URLSearchParams({ q: query });
    if (folder) params.set("folder", folder);
    if (tags) params.set("tags", tags);

    const results = await api(
      "GET",
      `/api/context/${encodeURIComponent(PROJECT)}/search?${params}`
    );

    if (results.length === 0) {
      return { content: [{ type: "text", text: `No results for "${query}"` }] };
    }

    const text = results
      .map((e) => {
        const preview = e.content.slice(0, 200).replace(/\n/g, " ");
        return `${e.path}\n  ${preview}${e.content.length > 200 ? "..." : ""}`;
      })
      .join("\n\n");

    return { content: [{ type: "text", text: `${results.length} results:\n\n${text}` }] };
  }
);

// --- history: view file version history ---
server.tool(
  "history",
  "View version history for a file. Shows past versions with timestamps and who made each change.",
  { path: z.string().describe("File path to get history for") },
  async ({ path }) => {
    const versions = await api(
      "GET",
      `/api/context/${encodeURIComponent(PROJECT)}/history/${encodeURIComponent(path)}`
    );

    if (versions.length === 0) {
      return { content: [{ type: "text", text: `No history for ${path}` }] };
    }

    const text = versions
      .map((v, i) => {
        const date = new Date(v.changed_at).toLocaleString();
        const preview = v.content.slice(0, 100).replace(/\n/g, " ");
        return `[${i + 1}] ${date} (${v.source})\n    ${preview}...`;
      })
      .join("\n\n");

    return { content: [{ type: "text", text: `${versions.length} versions of ${path}:\n\n${text}` }] };
  }
);

// --- tree: show full directory tree ---
server.tool(
  "tree",
  "Show the full directory tree. Like the `tree` command on a local filesystem.",
  {},
  async () => {
    const entries = await api("GET", `/api/context/${encodeURIComponent(PROJECT)}/list`);

    if (entries.length === 0) {
      return { content: [{ type: "text", text: "(empty workspace)" }] };
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

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
