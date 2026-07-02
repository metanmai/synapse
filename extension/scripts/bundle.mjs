// Bundles the extension into dist/ for load-unpacked / store packaging.
// NOT run in CI (the merge gate is the workspace's vitest + typecheck) — it is
// a manual/release step, documented in extension/README.md. Uses the repo's
// existing vite (no new install on the proxy-restricted dev machine).

import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const entries = [
  { entry: "src/content/main.ts", name: "SynapseMain", file: "content-main.js" },
  { entry: "src/content/relay.ts", name: "SynapseRelay", file: "content-relay.js" },
  { entry: "src/worker/index.ts", name: "SynapseWorker", file: "worker.js" },
  { entry: "src/options.ts", name: "SynapseOptions", file: "options.js" },
];

for (const e of entries) {
  await build({
    configFile: false,
    root,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      minify: false,
      lib: { entry: e.entry, name: e.name, formats: ["iife"], fileName: () => e.file },
    },
  });
}

copyFileSync(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));
copyFileSync(resolve(root, "options.html"), resolve(root, "dist/options.html"));
console.log("Built extension → extension/dist/");
