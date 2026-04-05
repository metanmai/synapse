<script>
import ScrollReveal from "./ScrollReveal.svelte";

const steps = [
  {
    number: 1,
    title: "Capture",
    description: "A background daemon silently records your sessions from Claude Code, Cursor, Codex, and Gemini",
    illustration: "config",
  },
  {
    number: 2,
    title: "Distill",
    description: "An LLM extracts decisions, architecture, and learnings — the signal from the noise",
    illustration: "sync",
  },
  {
    number: 3,
    title: "Remember",
    description:
      "Next session, your AI tools search the workspace and already have context from every past conversation",
    illustration: "team",
  },
];
</script>

<section id="how-it-works" class="how-it-works">
  <div class="how-bg" aria-hidden="true">
    <div class="how-orb how-orb-1"></div>
    <div class="how-orb how-orb-2"></div>
  </div>
  <div class="how-inner">
    <ScrollReveal>
      <h2 class="how-headline">How it works</h2>
    </ScrollReveal>
    <div class="steps">
      {#each steps as step, i}
        <ScrollReveal delay={i * 200} direction="up">
          <div class="step">
            <div class="step-number">{step.number}</div>
            <div class="step-illustration step-{step.illustration}">
              {#if step.illustration === "config"}
                <!-- Stylized terminal with .mcp.json config -->
                <div class="illus-terminal">
                  <div class="terminal-bar">
                    <span class="terminal-dot"></span>
                    <span class="terminal-dot"></span>
                    <span class="terminal-dot"></span>
                    <span class="terminal-filename">.mcp.json</span>
                  </div>
                  <div class="terminal-body">
                    <div class="code-line"><span class="code-brace">&#123;</span></div>
                    <div class="code-line indent-1"><span class="code-key">"mcpServers"</span><span class="code-colon">:</span> <span class="code-brace">&#123;</span></div>
                    <div class="code-line indent-2"><span class="code-key">"synapse"</span><span class="code-colon">:</span> <span class="code-brace">&#123;</span></div>
                    <div class="code-line indent-3"><span class="code-key">"command"</span><span class="code-colon">:</span> <span class="code-string">"npx"</span></div>
                    <div class="code-line indent-2"><span class="code-brace">&#125;</span></div>
                    <div class="code-line indent-1"><span class="code-brace">&#125;</span></div>
                    <div class="code-line"><span class="code-brace">&#125;</span></div>
                  </div>
                </div>
              {:else if step.illustration === "sync"}
                <!-- Split view: Claude left, ChatGPT right, shared context center -->
                <div class="illus-splitview">
                  <div class="split-panel split-left">
                    <div class="split-label">Claude</div>
                    <div class="split-line"></div>
                    <div class="split-line short"></div>
                  </div>
                  <div class="split-center">
                    <div class="split-sync-icon">
                      <div class="sync-ring"></div>
                      <span class="sync-s">S</span>
                    </div>
                    <div class="sync-pulse"></div>
                  </div>
                  <div class="split-panel split-right">
                    <div class="split-label">ChatGPT</div>
                    <div class="split-line"></div>
                    <div class="split-line short"></div>
                  </div>
                </div>
              {:else}
                <!-- Two user avatars with shared project folder -->
                <div class="illus-share">
                  <div class="share-avatar share-avatar-a">
                    <span>A</span>
                  </div>
                  <div class="share-folder-group">
                    <div class="share-folder">
                      <div class="folder-tab"></div>
                      <div class="folder-body">
                        <div class="folder-file"></div>
                        <div class="folder-file"></div>
                        <div class="folder-file"></div>
                      </div>
                    </div>
                    <span class="share-folder-label">shared project</span>
                  </div>
                  <div class="share-avatar share-avatar-b">
                    <span>B</span>
                  </div>
                </div>
              {/if}
            </div>
            <h3 class="step-title">{step.title}</h3>
            <p class="step-desc">{step.description}</p>
          </div>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .how-it-works {
    position: relative;
    overflow: hidden;
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .how-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .how-orb-1 {
    position: absolute;
    width: 320px;
    height: 320px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.06) 0%, transparent 70%);
    top: -10%;
    left: 5%;
    filter: blur(70px);
    animation: float-orb 22s ease-in-out infinite;
  }

  .how-orb-2 {
    position: absolute;
    width: 260px;
    height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.15) 0%, transparent 70%);
    bottom: -5%;
    right: 10%;
    filter: blur(60px);
    animation: float-orb-reverse 18s ease-in-out infinite 3s;
  }

  .how-inner {
    position: relative;
    z-index: 1;
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .how-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 4rem;
  }

  .steps {
    display: flex;
    gap: 3rem;
    justify-content: center;
  }

  .step {
    flex: 1;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    padding: 1.5rem;
    border-radius: 16px;
  }

  .step:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 40px rgba(86, 28, 36, 0.08);
  }

  .step-number {
    width: 48px;
    height: 48px;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
  }

  .step-illustration {
    width: 100%;
    height: 160px;
    background-color: var(--color-white);
    border: 2px solid var(--color-tan);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  /* ── Terminal / Config illustration ── */
  .illus-terminal {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 10px;
    background: rgba(86, 28, 36, 0.08);
    border-bottom: 1px solid rgba(199, 183, 163, 0.25);
  }

  .terminal-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-tan);
    opacity: 0.5;
  }

  .terminal-filename {
    margin-left: auto;
    font-size: 0.5625rem;
    font-family: monospace;
    color: var(--color-burgundy);
    opacity: 0.4;
  }

  .terminal-body {
    flex: 1;
    padding: 8px 12px;
    font-family: monospace;
    font-size: 0.625rem;
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .code-line {
    white-space: nowrap;
  }

  .indent-1 { padding-left: 12px; }
  .indent-2 { padding-left: 24px; }
  .indent-3 { padding-left: 36px; }

  .code-key { color: var(--color-brown); font-weight: 600; }
  .code-colon { color: var(--color-burgundy); opacity: 0.4; }
  .code-string { color: #4a7c59; }
  .code-brace { color: var(--color-burgundy); opacity: 0.5; }

  /* ── Split view illustration ── */
  .illus-splitview {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.75rem;
    width: 100%;
  }

  .split-panel {
    flex: 1;
    background: rgba(232, 216, 196, 0.3);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 8px;
    padding: 10px;
  }

  .split-label {
    font-size: 0.5625rem;
    font-weight: 700;
    color: var(--color-burgundy);
    opacity: 0.6;
    margin-bottom: 6px;
  }

  .split-line {
    height: 4px;
    background: var(--color-tan);
    border-radius: 2px;
    opacity: 0.4;
    margin-bottom: 4px;
  }

  .split-line.short {
    width: 60%;
  }

  .split-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    position: relative;
  }

  .split-sync-icon {
    width: 36px;
    height: 36px;
    background: var(--color-burgundy);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    z-index: 1;
  }

  .sync-s {
    color: var(--color-cream);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .sync-ring {
    position: absolute;
    inset: -4px;
    border: 2px solid rgba(86, 28, 36, 0.15);
    border-radius: 50%;
    animation: pulse-ring 2s ease-out infinite;
  }

  .sync-pulse {
    position: absolute;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.08) 0%, transparent 70%);
    animation: pulse-ring 2s ease-out infinite 1s;
  }

  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 0.6; }
    100% { transform: scale(1.8); opacity: 0; }
  }

  /* ── Share illustration ── */
  .illus-share {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 0.75rem;
  }

  .share-avatar {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-cream);
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(86, 28, 36, 0.15);
  }

  .share-avatar-a {
    background: linear-gradient(135deg, var(--color-burgundy), var(--color-brown));
  }

  .share-avatar-b {
    background: linear-gradient(135deg, var(--color-brown), #9b4a56);
  }

  .share-folder-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .share-folder {
    width: 56px;
    position: relative;
  }

  .folder-tab {
    width: 24px;
    height: 8px;
    background: var(--color-tan);
    border-radius: 3px 3px 0 0;
  }

  .folder-body {
    width: 100%;
    height: 36px;
    background: var(--color-tan);
    border-radius: 0 6px 6px 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    padding: 6px 8px;
  }

  .folder-file {
    height: 3px;
    background: rgba(255, 253, 248, 0.6);
    border-radius: 1px;
  }

  .share-folder-label {
    font-size: 0.5rem;
    font-weight: 600;
    color: var(--color-burgundy);
    opacity: 0.4;
    white-space: nowrap;
  }

  .step-title {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 0.5rem;
  }

  .step-desc {
    font-size: 1rem;
    font-weight: 400;
    color: var(--color-burgundy);
    opacity: 0.65;
    margin: 0;
    line-height: 1.5;
  }

  @media (max-width: 768px) {
    .steps {
      flex-direction: column;
      align-items: center;
    }

    .how-it-works {
      padding: 4rem 1.5rem;
    }

    .step:hover {
      transform: none;
      box-shadow: none;
    }
  }
</style>
