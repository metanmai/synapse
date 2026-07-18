#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QUALIFIED_IDENTIFIER = String.raw`${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})?`;

const TABLE_PATTERNS = [
  {
    kind: "create",
    regex: new RegExp(
      String.raw`\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QUALIFIED_IDENTIFIER})`,
      "gi",
    ),
  },
  {
    kind: "enable",
    regex: new RegExp(
      String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED_IDENTIFIER})\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b`,
      "gi",
    ),
  },
  {
    kind: "disable",
    regex: new RegExp(
      String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QUALIFIED_IDENTIFIER})\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY\b`,
      "gi",
    ),
  },
  {
    kind: "drop",
    regex: new RegExp(
      String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(${QUALIFIED_IDENTIFIER})(?:\s+(?:CASCADE|RESTRICT))?`,
      "gi",
    ),
  },
];

function stripSqlNoise(sql) {
  let output = "";
  let index = 0;

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index + 2);
      if (newline === -1) break;
      output += "\n";
      index = newline + 1;
      continue;
    }

    if (sql.startsWith("/*", index)) {
      const end = sql.indexOf("*/", index + 2);
      index = end === -1 ? sql.length : end + 2;
      output += " ";
      continue;
    }

    if (sql[index] === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      output += " ";
      continue;
    }

    if (sql[index] === "$") {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        index = end === -1 ? sql.length : end + tag.length;
        output += " ";
        continue;
      }
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

function normalizeIdentifier(identifier) {
  const parts = identifier.match(new RegExp(IDENTIFIER, "g")) ?? [];
  const normalized = parts.map((part) => {
    if (!part.startsWith('"')) return part.toLowerCase();
    return part.slice(1, -1).replaceAll('""', '"');
  });
  if (normalized.length === 1) return { schema: "public", table: normalized[0] };
  return { schema: normalized[0].toLowerCase(), table: normalized[1] };
}

function tableEvents(file) {
  const sql = stripSqlNoise(file.sql);
  const events = [];
  for (const { kind, regex } of TABLE_PATTERNS) {
    regex.lastIndex = 0;
    for (const match of sql.matchAll(regex)) {
      const { schema, table } = normalizeIdentifier(match[1]);
      if (schema !== "public") continue;
      events.push({ kind, table, index: match.index ?? 0, file: file.name });
    }
  }
  return events.sort((a, b) => a.index - b.index);
}

export function auditMigrationSql(files) {
  const tables = new Map();

  for (const file of files) {
    for (const event of tableEvents(file)) {
      if (event.kind === "create") {
        tables.set(event.table, { table: event.table, createdIn: event.file, rlsEnabled: false });
      } else if (event.kind === "enable") {
        const existing = tables.get(event.table);
        if (existing) existing.rlsEnabled = true;
      } else if (event.kind === "disable") {
        const existing = tables.get(event.table);
        if (existing) existing.rlsEnabled = false;
      } else if (event.kind === "drop") {
        tables.delete(event.table);
      }
    }
  }

  return {
    publicTableCount: tables.size,
    missingRls: [...tables.values()].filter((table) => !table.rlsEnabled),
  };
}

export function auditMigrationDirectory(migrationsDir) {
  const files = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(migrationsDir, name), "utf8") }));
  return auditMigrationSql(files);
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsDir = path.join(repo, "supabase", "migrations");
  const result = auditMigrationDirectory(migrationsDir);

  if (result.missingRls.length > 0) {
    process.stderr.write("Migration RLS lint failed: public tables without Row-Level Security:\n");
    for (const table of result.missingRls) {
      process.stderr.write(`  - public.${table.table} (created in ${table.createdIn})\n`);
    }
    process.stderr.write(
      "Every public CREATE TABLE must have a matching ALTER TABLE ... ENABLE ROW LEVEL SECURITY in the migration chain.\n",
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Migration RLS lint passed: ${result.publicTableCount} public tables all end with RLS enabled.\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
