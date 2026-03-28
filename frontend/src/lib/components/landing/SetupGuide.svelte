<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  let copied = $state(false);

  const mcpConfig = `{
  "mcpServers": {
    "synapse": {
      "command": "npx",
      "args": ["synapse-mcp"],
      "env": {
        "SYNAPSE_API_KEY": "your-api-key"
      }
    }
  }
}`;

  const cliCommand = `claude mcp add synapse npx synapse-mcp --env SYNAPSE_API_KEY=your-key`;

  async function copyConfig() {
    await navigator.clipboard.writeText(mcpConfig);
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
      <p class="setup-sub">Add Synapse to any MCP-compatible AI tool with one config file.</p>
    </ScrollReveal>

    <div class="setup-cards">
      <ScrollReveal delay={100} direction="up">
        <div class="setup-card">
          <div class="card-header">
            <span class="card-badge">Option 1</span>
            <h3 class="card-title">.mcp.json</h3>
          </div>
          <div class="code-block">
            <button class="copy-btn" onclick={copyConfig}>
              {copied ? "Copied!" : "Copy"}
            </button>
            <pre><code>{mcpConfig}</code></pre>
          </div>
          <p class="card-hint">Add this to your project root. Works with Claude Code, Cursor, and any MCP client.</p>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={200} direction="up">
        <div class="setup-card">
          <div class="card-header">
            <span class="card-badge">Option 2</span>
            <h3 class="card-title">Claude Code CLI</h3>
          </div>
          <div class="code-block code-block-single">
            <pre><code>{cliCommand}</code></pre>
          </div>
          <p class="card-hint">One command. That's it.</p>
        </div>
      </ScrollReveal>
    </div>

    <ScrollReveal delay={300}>
      <div class="setup-steps">
        <div class="mini-step">
          <span class="mini-num">1</span>
          <span class="mini-text">Sign up and grab your API key</span>
        </div>
        <div class="mini-arrow">→</div>
        <div class="mini-step">
          <span class="mini-num">2</span>
          <span class="mini-text">Add the config above</span>
        </div>
        <div class="mini-arrow">→</div>
        <div class="mini-step">
          <span class="mini-num">3</span>
          <span class="mini-text">Your AI tools now share context</span>
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
    max-width: 900px;
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

  .setup-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 3rem;
  }

  .setup-card {
    background: rgba(255, 253, 248, 0.08);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(199, 183, 163, 0.15);
    border-radius: 16px;
    padding: 1.5rem;
    text-align: left;
    transition: transform 0.3s ease, border-color 0.3s ease;
  }

  .setup-card:hover {
    transform: translateY(-2px);
    border-color: rgba(199, 183, 163, 0.3);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 1rem;
  }

  .card-badge {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-tan);
    padding: 0.25rem 0.625rem;
    background: rgba(199, 183, 163, 0.15);
    border-radius: 9999px;
  }

  .card-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-cream);
    margin: 0;
  }

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

  .code-block-single {
    display: flex;
    align-items: center;
  }

  .code-block-single pre {
    font-size: 0.8125rem;
    white-space: nowrap;
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

  @media (max-width: 768px) {
    .setup-cards {
      grid-template-columns: 1fr;
    }

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
  }
</style>
