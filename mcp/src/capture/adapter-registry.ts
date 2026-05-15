import type { ToolAdapter } from "./types.js";

export class AdapterRegistry {
  private adapters = new Map<string, ToolAdapter>();

  register(adapter: ToolAdapter): void {
    this.adapters.set(adapter.tool, adapter);
  }

  get(tool: string): ToolAdapter | undefined {
    return this.adapters.get(tool);
  }

  findByPath(filePath: string): ToolAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.watchPaths().some((wp) => filePath.startsWith(wp))) {
        return adapter;
      }
    }
    return undefined;
  }

  allWatchPaths(): string[] {
    return Array.from(this.adapters.values()).flatMap((a) => a.watchPaths());
  }

  tools(): string[] {
    return Array.from(this.adapters.keys());
  }
}
