#!/usr/bin/env node
// scripts/tail-log.mjs — `tail -f` cross-platform using Node.js
import { openSync, readSync, statSync, watchFile } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/tail-log.mjs <file>");
  process.exit(1);
}

let fd;
try {
  fd = openSync(file, "r");
} catch {
  console.error(`Cannot open: ${file}`);
  process.exit(1);
}

let pos = statSync(file).size;

function readNew() {
  const stat = statSync(file);
  if (stat.size < pos) pos = 0;
  if (stat.size > pos) {
    const buf = Buffer.alloc(stat.size - pos);
    readSync(fd, buf, 0, buf.length, pos);
    process.stdout.write(buf);
    pos = stat.size;
  }
}

readNew();
console.error(`[watching ${file} — Ctrl+C to stop]`);

watchFile(file, { interval: 200 }, () => readNew());
