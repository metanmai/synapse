import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(dir, "..", "dist", "index.js");

if (!fs.existsSync(dist)) {
  console.error("add-shebang: dist/index.js not found — run tsc first");
  process.exit(1);
}

let body = fs.readFileSync(dist, "utf8");
if (!body.startsWith("#!")) {
  body = `#!/usr/bin/env node\n${body}`;
  fs.writeFileSync(dist, body);
}

try {
  fs.chmodSync(dist, 0o755);
} catch {
  // Windows: chmod may be unsupported; npx still invokes via node
}
