<script>
import ScrollReveal from "./ScrollReveal.svelte";

let copied = $state(false);
let selectedTool = $state("claude-code");

const tools = [
  {
    id: "claude-code",
    name: "Claude Code",
    method: "cli",
    command: `claude mcp add synapse npx synapsesync-mcp --env SYNAPSE_API_KEY=your-key`,
    hint: "Run this in your terminal. Done in one command.",
  },
  {
    id: "cursor",
    name: "Cursor",
    method: "json",
    config: `{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "your-api-key"
      }
    }
  }
}`,
    file: ".cursor/mcp.json",
    hint: "Create this file in your project root.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    method: "json",
    config: `{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "your-api-key"
      }
    }
  }
}`,
    file: "~/.codeium/windsurf/mcp_config.json",
    hint: "Add to your Windsurf MCP config.",
  },
  {
    id: "vscode",
    name: "VS Code",
    method: "json",
    config: `{
  "mcp": {
    "servers": {
      "synapse": {
        "command": "npx",
        "args": ["synapsesync-mcp"],
        "env": {
          "SYNAPSE_API_KEY": "your-api-key"
        }
      }
    }
  }
}`,
    file: ".vscode/settings.json",
    hint: "Add to your VS Code settings. Requires the MCP extension.",
  },
  {
    id: "generic",
    name: "Other MCP Client",
    method: "json",
    config: `{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapsesync-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "your-api-key"
      }
    }
  }
}`,
    file: ".mcp.json",
    hint: "Standard MCP config. Works with any MCP-compatible tool.",
  },
];

const currentTool = $derived(tools.find((t) => t.id === selectedTool) ?? tools[0]);

async function copySnippet() {
  const text = currentTool.method === "cli" ? currentTool.command : currentTool.config;
  await navigator.clipboard.writeText(text);
  copied = true;
  setTimeout(() => (copied = false), 2000);
}
</script>

<section class="setup">
  <div class="setup-bg" aria-hidden="true">
    <div class="setup-orb setup-orb-1"></div>
    <div class="setup-orb setup-orb-2"></div>
  </div>
  <div class="setup-inner">
    <ScrollReveal>
      <h2 class="setup-headline">Set up in 30 seconds</h2>
      <p class="setup-sub">Pick your tool, copy the config, and you're connected.</p>
    </ScrollReveal>

    <ScrollReveal delay={100} direction="up">
      <div class="setup-card">
        <div class="card-top">
          <label for="tool-select" class="select-label">I'm using</label>
          <div class="select-wrap">
            <select id="tool-select" class="tool-select" bind:value={selectedTool}>
              {#each tools as tool}
                <option value={tool.id}>{tool.name}</option>
              {/each}
            </select>
            <span class="select-arrow">&#9662;</span>
          </div>
        </div>

        {#if currentTool.method === "cli"}
          <div class="code-block">
            <button class="copy-btn" onclick={copySnippet}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <pre><code>{currentTool.command}</code></pre>
          </div>
        {:else}
          <div class="file-label">
            <span class="file-icon">&#128196;</span>
            <span class="file-path">{currentTool.file}</span>
          </div>
          <div class="code-block">
            <button class="copy-btn" onclick={copySnippet}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <pre><code>{currentTool.config}</code></pre>
          </div>
        {/if}

        <p class="card-hint">{currentTool.hint}</p>
      </div>
    </ScrollReveal>

    <ScrollReveal delay={200}>
      <div class="setup-steps">
        <div class="mini-step">
          <span class="mini-num">1</span>
          <span class="mini-text">Sign up and grab your API key</span>
        </div>
        <div class="mini-arrow">→</div>
        <div class="mini-step">
          <span class="mini-num">2</span>
          <span class="mini-text">Pick your tool above and paste</span>
        </div>
        <div class="mini-arrow">→</div>
        <div class="mini-step">
          <span class="mini-num">3</span>
          <span class="mini-text">Your AI tools now share context</span>
        </div>
      </div>
    </ScrollReveal>

    <ScrollReveal delay={300} direction="up">
      <div class="commands-section">
        <h3 class="commands-title">Available commands</h3>
        <p class="commands-sub">Once connected, use these slash commands in Claude Code:</p>
        <div class="commands-grid">
          <div class="cmd">
            <code class="cmd-name">/synapse:init</code>
            <span class="cmd-desc">Set up Synapse in your project</span>
          </div>
          <div class="cmd">
            <code class="cmd-name">/synapse:search</code>
            <span class="cmd-desc">Search across your workspace</span>
          </div>
          <div class="cmd">
            <code class="cmd-name">/synapse:tree</code>
            <span class="cmd-desc">View your workspace file tree</span>
          </div>
          <div class="cmd">
            <code class="cmd-name">/synapse:sync</code>
            <span class="cmd-desc">Sync settings across devices</span>
          </div>
          <div class="cmd">
            <code class="cmd-name">/synapse:clean</code>
            <span class="cmd-desc">Remove duplicates and stale files</span>
          </div>
          <div class="cmd">
            <code class="cmd-name">/synapse:whoami</code>
            <span class="cmd-desc">Show your account info</span>
          </div>
        </div>
      </div>
    </ScrollReveal>
  </div>
</section>

<style>
  .setup {
    position: relative;
    overflow: hidden;
    padding: 6rem 2rem;
    background: var(--color-burgundy);
  }

  .setup-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .setup-orb-1 {
    position: absolute;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(109, 41, 50, 0.4) 0%, transparent 70%);
    top: -10%;
    left: -5%;
    filter: blur(80px);
    animation: float-orb 20s ease-in-out infinite;
  }

  .setup-orb-2 {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.15) 0%, transparent 70%);
    bottom: -10%;
    right: 5%;
    filter: blur(60px);
    animation: float-orb-reverse 18s ease-in-out infinite 2s;
  }

  .setup-inner {
    position: relative;
    z-index: 1;
    max-width: 640px;
    margin: 0 auto;
    text-align: center;
  }

  .setup-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 0.75rem;
  }

  .setup-sub {
    font-size: 1.125rem;
    color: var(--color-tan);
    margin: 0 0 3rem;
    font-weight: 400;
  }

  .setup-card {
    background: rgba(255, 253, 248, 0.08);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(199, 183, 163, 0.15);
    border-radius: 16px;
    padding: 2rem;
    text-align: left;
    margin-bottom: 3rem;
    transition: border-color 0.3s ease;
  }

  .setup-card:hover {
    border-color: rgba(199, 183, 163, 0.3);
  }

  /* Tool selector */
  .card-top {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .select-label {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-cream);
    white-space: nowrap;
  }

  .select-wrap {
    position: relative;
    flex: 1;
    max-width: 240px;
  }

  .tool-select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    padding: 0.75rem 2.5rem 0.75rem 1rem;
    background: rgba(199, 183, 163, 0.15);
    border: 2px solid rgba(199, 183, 163, 0.4);
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 700;
    font-family: inherit;
    color: var(--color-cream);
    cursor: pointer;
    transition: border-color 0.2s, background 0.2s;
  }

  .tool-select:hover {
    background: rgba(199, 183, 163, 0.25);
    border-color: rgba(199, 183, 163, 0.6);
  }

  .tool-select:focus {
    outline: none;
    border-color: var(--color-tan);
    background: rgba(199, 183, 163, 0.25);
  }

  .tool-select option {
    background: #3d1018;
    color: var(--color-cream);
    padding: 0.5rem;
  }

  .select-arrow {
    position: absolute;
    right: 0.875rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.875rem;
    color: var(--color-cream);
    pointer-events: none;
  }

  /* File label */
  .file-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .file-icon {
    font-size: 0.875rem;
    line-height: 1;
  }

  .file-path {
    font-size: 0.8125rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    color: var(--color-tan);
    opacity: 0.8;
  }

  /* Code block */
  .code-block {
    position: relative;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    padding: 1rem;
    margin-bottom: 0.75rem;
    overflow-x: auto;
  }

  .code-block pre {
    margin: 0;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.75rem;
    line-height: 1.6;
    color: var(--color-cream);
    white-space: pre;
  }

  .copy-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: rgba(199, 183, 163, 0.2);
    border: 1px solid rgba(199, 183, 163, 0.2);
    border-radius: 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-tan);
    cursor: pointer;
    transition: background 0.2s;
  }

  .copy-btn:hover {
    background: rgba(199, 183, 163, 0.35);
  }

  .card-hint {
    font-size: 0.8125rem;
    color: var(--color-tan);
    opacity: 0.7;
    margin: 0;
    line-height: 1.5;
  }

  /* Mini steps */
  .setup-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .mini-step {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mini-num {
    width: 28px;
    height: 28px;
    background: rgba(199, 183, 163, 0.2);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-cream);
    flex-shrink: 0;
  }

  .mini-text {
    font-size: 0.875rem;
    color: var(--color-cream);
    opacity: 0.8;
    white-space: nowrap;
  }

  .mini-arrow {
    font-size: 1.25rem;
    color: var(--color-tan);
    opacity: 0.4;
  }

  /* Commands section */
  .commands-section {
    margin-top: 3rem;
    padding-top: 3rem;
    border-top: 1px solid rgba(199, 183, 163, 0.15);
  }

  .commands-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 0.5rem;
  }

  .commands-sub {
    font-size: 0.9375rem;
    color: var(--color-tan);
    opacity: 0.7;
    margin: 0 0 1.5rem;
  }

  .commands-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    text-align: left;
  }

  .cmd {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.875rem 1rem;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(199, 183, 163, 0.1);
    border-radius: 10px;
    transition: border-color 0.2s, background 0.2s;
  }

  .cmd:hover {
    background: rgba(0, 0, 0, 0.3);
    border-color: rgba(199, 183, 163, 0.25);
  }

  .cmd-name {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--color-cream);
  }

  .cmd-desc {
    font-size: 0.75rem;
    color: var(--color-tan);
    opacity: 0.7;
  }

  @media (max-width: 768px) {
    .setup-steps {
      flex-direction: column;
      gap: 0.5rem;
    }

    .mini-arrow {
      transform: rotate(90deg);
    }

    .setup {
      padding: 4rem 1.5rem;
    }

    .card-top {
      flex-direction: column;
      align-items: flex-start;
    }

    .select-wrap {
      max-width: 100%;
    }

    .commands-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
