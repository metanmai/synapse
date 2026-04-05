import { beforeEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../../src/capture/adapter-registry.js";
import type { ToolAdapter } from "../../../src/capture/types.js";

function makeAdapter(tool: string, paths: string[]): ToolAdapter {
  return {
    tool,
    watchPaths: () => paths,
    parse: () => null,
  };
}

describe("AdapterRegistry", () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it("registers and retrieves an adapter by tool name", () => {
    const adapter = makeAdapter("claude-code", ["/home/.claude"]);
    registry.register(adapter);
    expect(registry.get("claude-code")).toBe(adapter);
  });

  it("returns undefined for unregistered tool", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("finds the adapter whose watchPath matches a file path", () => {
    registry.register(makeAdapter("claude-code", ["/home/.claude/projects"]));
    registry.register(makeAdapter("cursor", ["/home/Library/Cursor"]));
    const found = registry.findByPath("/home/.claude/projects/abc/session.jsonl");
    expect(found?.tool).toBe("claude-code");
  });

  it("returns undefined when no adapter matches the path", () => {
    registry.register(makeAdapter("claude-code", ["/home/.claude/projects"]));
    expect(registry.findByPath("/completely/different/path")).toBeUndefined();
  });

  it("returns all watch paths from all adapters", () => {
    registry.register(makeAdapter("claude-code", ["/a"]));
    registry.register(makeAdapter("cursor", ["/b", "/c"]));
    expect(registry.allWatchPaths()).toEqual(["/a", "/b", "/c"]);
  });

  it("lists all registered adapter tool names", () => {
    registry.register(makeAdapter("claude-code", ["/a"]));
    registry.register(makeAdapter("cursor", ["/b"]));
    expect(registry.tools()).toEqual(["claude-code", "cursor"]);
  });
});
