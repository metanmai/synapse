<script>
import ScrollReveal from "./ScrollReveal.svelte";

let copied = $state(false);
const command = "npx synapsesync-mcp && npx synapsesync-mcp capture start";

async function copyCommand() {
  await navigator.clipboard.writeText(command);
  copied = true;
  setTimeout(() => (copied = false), 2000);
}
</script>

<section class="setup" id="setup">
  <div class="setup-bg" aria-hidden="true">
    <div class="setup-orb setup-orb-1"></div>
    <div class="setup-orb setup-orb-2"></div>
  </div>
  <div class="setup-inner">
    <ScrollReveal>
      <h2 class="setup-headline">Two commands. That's it.</h2>
      <p class="setup-sub">Sign up, start capturing. Your sessions become knowledge automatically.</p>
    </ScrollReveal>

    <ScrollReveal delay={100} direction="up">
      <div class="setup-card">
        <div class="code-block">
          <button class="copy-btn" onclick={copyCommand}>
            {copied ? "Copied!" : "Copy"}
          </button>
          <pre><code>$ {command}</code></pre>
        </div>
        <p class="card-hint">Works with Claude Code, Cursor, VS Code, Windsurf, and any MCP client.</p>
      </div>
    </ScrollReveal>

    <ScrollReveal delay={200}>
      <div class="setup-steps">
        <div class="mini-step">
          <span class="mini-num">1</span>
          <span class="mini-text">Run the command above</span>
        </div>
        <div class="mini-arrow">&rarr;</div>
        <div class="mini-step">
          <span class="mini-num">2</span>
          <span class="mini-text">Sign in and start capturing</span>
        </div>
        <div class="mini-arrow">&rarr;</div>
        <div class="mini-step">
          <span class="mini-num">3</span>
          <span class="mini-text">Sessions become knowledge</span>
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

  .code-block {
    position: relative;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    margin-bottom: 0.75rem;
    overflow: hidden;
  }

  .code-block pre {
    margin: 0;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 1rem;
    line-height: 1.6;
    color: var(--color-cream);
    white-space: pre;
    overflow-x: auto;
    padding: 1.25rem 1.5rem;
    padding-right: 5rem;
  }

  .copy-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: rgba(199, 183, 163, 0.3);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 6px;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-cream);
    cursor: pointer;
    transition: background 0.2s;
    z-index: 2;
  }

  .copy-btn:hover {
    background: rgba(199, 183, 163, 0.5);
  }

  .card-hint {
    font-size: 0.8125rem;
    color: var(--color-tan);
    opacity: 0.7;
    margin: 0;
    line-height: 1.5;
  }

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
