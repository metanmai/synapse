import type { CapturedSession } from "../capture/types.js";
import { type ExtractedFile, parseResponse } from "./parser.js";
import { buildPrompt } from "./prompt.js";
import { getProvider } from "./providers/registry.js";
import { DistillWriter } from "./writer.js";

export interface DistillOptions {
  provider: string;
  apiKey: string;
  model: string;
  synapseApiKey: string;
  project: string;
  existingFiles?: string[];
  log?: (msg: string) => void;
}

export interface DistillResult {
  files: ExtractedFile[];
  filesWritten: number;
}

export async function distillSession(session: CapturedSession, opts: DistillOptions): Promise<DistillResult> {
  const log = opts.log ?? (() => {});

  // 1. Build prompt
  const prompt = buildPrompt(session, opts.existingFiles);
  log(`Built prompt (${prompt.length} chars) for session ${session.id}`);

  // 2. Call LLM
  const provider = getProvider(opts.provider, opts.apiKey, opts.model);
  const rawResponse = await provider.complete(prompt);
  log(`LLM responded (${rawResponse.length} chars)`);

  // 3. Parse response
  const files = parseResponse(rawResponse);
  log(`Extracted ${files.length} file(s)`);

  if (files.length === 0) {
    return { files: [], filesWritten: 0 };
  }

  // 4. Write to Synapse
  const writer = new DistillWriter(opts.synapseApiKey, opts.project, log);
  const filesWritten = await writer.writeAll(files);
  log(`Wrote ${filesWritten}/${files.length} file(s) to Synapse`);

  return { files, filesWritten };
}
