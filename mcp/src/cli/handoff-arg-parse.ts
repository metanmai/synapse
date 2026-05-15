/**
 * Argument parsers for the v1.1 handoff-layer CLI subcommands.
 *
 * Each parser accepts the argv tail (already sliced past the subcommand name)
 * and returns a typed result object. On invalid input each parser throws an
 * Error with a usage string; the dispatcher in `mcp/src/index.ts` is
 * responsible for surfacing those messages on stderr.
 */

export interface ParsedHandoff {
  text: string;
}

export function parseHandoffArgs(argv: string[]): ParsedHandoff {
  const text = argv.join(" ").trim();
  if (!text) throw new Error('usage: synapse handoff "<text>"');
  return { text };
}

export interface ParsedSetFocus {
  text: string;
}

export function parseSetFocusArgs(argv: string[]): ParsedSetFocus {
  const text = argv.join(" ").trim();
  if (!text) throw new Error('usage: synapse set-focus "<text>"');
  return { text };
}

export interface ParsedNote {
  target: string;
  text: string;
}

export function parseNoteArgs(argv: string[]): ParsedNote {
  const idx = argv.indexOf("--target");
  if (idx < 0 || idx + 1 >= argv.length) {
    throw new Error('usage: synapse note --target <ref> "<text>"');
  }
  const target = argv[idx + 1];
  const text = argv
    .filter((_, i) => i !== idx && i !== idx + 1)
    .join(" ")
    .trim();
  if (!text) throw new Error('usage: synapse note --target <ref> "<text>"');
  return { target, text };
}

export interface ParsedIssueCreate {
  kind: "decision" | "question";
  title: string;
  body: string;
}

export function parseIssueCreateArgs(argv: string[]): ParsedIssueCreate {
  const kindIdx = argv.indexOf("--kind");
  const titleIdx = argv.indexOf("--title");
  const bodyIdx = argv.indexOf("--body");
  if (kindIdx < 0 || kindIdx + 1 >= argv.length || titleIdx < 0 || titleIdx + 1 >= argv.length) {
    throw new Error('usage: synapse issue create --kind <decision|question> --title "<t>" [--body "<b>"]');
  }
  const kind = argv[kindIdx + 1];
  if (kind !== "decision" && kind !== "question") {
    throw new Error("--kind must be 'decision' or 'question'");
  }
  const title = argv[titleIdx + 1];
  const body = bodyIdx >= 0 && bodyIdx + 1 < argv.length ? argv[bodyIdx + 1] : "";
  return { kind, title, body };
}

export interface ParsedIssueResolve {
  issue_id: string;
  resolution: string;
}

export function parseIssueResolveArgs(argv: string[]): ParsedIssueResolve {
  if (argv.length < 2) {
    throw new Error('usage: synapse issue resolve <id> "<resolution>"');
  }
  return { issue_id: argv[0], resolution: argv.slice(1).join(" ") };
}

export interface ParsedIssueSupersede {
  issue_id: string;
  superseded_by: string;
}

export function parseIssueSupersedeArgs(argv: string[]): ParsedIssueSupersede {
  const byIdx = argv.indexOf("--by");
  if (argv.length < 1 || byIdx < 0 || byIdx + 1 >= argv.length) {
    throw new Error("usage: synapse issue supersede <id> --by <new_id>");
  }
  return { issue_id: argv[0], superseded_by: argv[byIdx + 1] };
}
