<script>
import ScrollReveal from "./ScrollReveal.svelte";

const steps = [
  {
    number: 1,
    title: "Capture",
    description: "A background daemon silently records your AI coding sessions across every tool you use",
    illustration: "capture",
  },
  {
    number: 2,
    title: "Distill",
    description: "An LLM extracts decisions, architecture, and learnings — the signal from the noise",
    illustration: "distill",
  },
  {
    number: 3,
    title: "Remember",
    description:
      "Next session opens with a brief from the workspace — your AI tools have context from every past conversation, no re-briefing needed",
    illustration: "remember",
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
              {#if step.illustration === "capture"}
                <!-- Live capture feed: events streaming in from 4 tools -->
                <div class="illus-capture">
                  <div class="capture-header">
                    <span class="capture-dot"></span>
                    <span class="capture-status">capturing</span>
                  </div>
                  <div class="capture-feed">
                    <!-- Tool order is intentional: Claude Code is not first.
                         Each badge maps to a CSS color via .tool-{name}; the
                         animation rotates through 4 of many supported tools. -->
                    <div class="capture-row">
                      <span class="capture-tool tool-cursor">cursor</span>
                      <span class="capture-event">session-start</span>
                    </div>
                    <div class="capture-row">
                      <span class="capture-tool tool-codex">codex</span>
                      <span class="capture-event">user-prompt</span>
                    </div>
                    <div class="capture-row">
                      <span class="capture-tool tool-claude">claude</span>
                      <span class="capture-event">tool-use</span>
                    </div>
                    <div class="capture-row capture-row-fade">
                      <span class="capture-tool tool-gemini">gemini</span>
                      <span class="capture-event">session-end</span>
                    </div>
                  </div>
                </div>
              {:else if step.illustration === "distill"}
                <!-- Transcript on left → distilled insight cards on right -->
                <div class="illus-distill">
                  <div class="distill-transcript">
                    <div class="transcript-line transcript-user"></div>
                    <div class="transcript-line transcript-assistant"></div>
                    <div class="transcript-line transcript-user short"></div>
                    <div class="transcript-line transcript-assistant"></div>
                    <div class="transcript-line transcript-user"></div>
                    <div class="transcript-line transcript-assistant short"></div>
                  </div>
                  <div class="distill-arrow" aria-hidden="true">→</div>
                  <div class="distill-insights">
                    <div class="insight-pill insight-decision">Decision</div>
                    <div class="insight-pill insight-arch">Architecture</div>
                    <div class="insight-pill insight-learning">Learning</div>
                  </div>
                </div>
              {:else}
                <!-- Brief / context card the AI sees at session start -->
                <div class="illus-remember">
                  <div class="brief-card">
                    <div class="brief-header">
                      <span class="brief-badge">CONTEXT LOADED</span>
                    </div>
                    <div class="brief-body">
                      <div class="brief-section">
                        <span class="brief-label">Last session</span>
                        <div class="brief-line"></div>
                        <div class="brief-line short"></div>
                      </div>
                      <div class="brief-section">
                        <span class="brief-label">Next step</span>
                        <div class="brief-line"></div>
                      </div>
                    </div>
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

  /* ── Capture illustration: live event feed ── */
  .illus-capture {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .capture-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(86, 28, 36, 0.06);
    border-bottom: 1px solid rgba(199, 183, 163, 0.25);
  }

  .capture-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4a7c59;
    box-shadow: 0 0 0 0 rgba(74, 124, 89, 0.6);
    animation: capture-pulse 1.8s ease-out infinite;
  }

  @keyframes capture-pulse {
    0% { box-shadow: 0 0 0 0 rgba(74, 124, 89, 0.6); }
    70% { box-shadow: 0 0 0 8px rgba(74, 124, 89, 0); }
    100% { box-shadow: 0 0 0 0 rgba(74, 124, 89, 0); }
  }

  .capture-status {
    font-family: monospace;
    font-size: 0.5625rem;
    color: var(--color-burgundy);
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .capture-feed {
    flex: 1;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    overflow: hidden;
  }

  .capture-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: monospace;
    font-size: 0.5625rem;
  }

  .capture-row-fade {
    opacity: 0.45;
  }

  .capture-tool {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 600;
    color: var(--color-cream);
    font-size: 0.5rem;
    letter-spacing: 0.02em;
  }

  .tool-claude { background: #561c24; }
  .tool-cursor { background: #2563eb; }
  .tool-codex { background: #6b7280; }
  .tool-gemini { background: #16a34a; }

  .capture-event {
    color: var(--color-burgundy);
    opacity: 0.6;
  }

  /* ── Distill illustration: transcript → insight pills ── */
  .illus-distill {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
  }

  .distill-transcript {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px;
    background: rgba(232, 216, 196, 0.25);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 6px;
  }

  .transcript-line {
    height: 4px;
    border-radius: 2px;
    opacity: 0.5;
  }

  .transcript-line.transcript-user { background: var(--color-tan); }
  .transcript-line.transcript-assistant { background: var(--color-burgundy); opacity: 0.35; }
  .transcript-line.short { width: 60%; }

  .distill-arrow {
    color: var(--color-burgundy);
    font-size: 1rem;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .distill-insights {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }

  .insight-pill {
    padding: 3px 8px;
    border-radius: 9999px;
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: center;
    color: var(--color-cream);
    white-space: nowrap;
  }

  .insight-decision { background: #561c24; }
  .insight-arch { background: #6d2932; }
  .insight-learning { background: #4a7c59; }

  /* ── Remember illustration: brief / context card ── */
  .illus-remember {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 14px;
  }

  .brief-card {
    width: 100%;
    background: rgba(86, 28, 36, 0.04);
    border: 1px solid rgba(86, 28, 36, 0.15);
    border-radius: 8px;
    overflow: hidden;
  }

  .brief-header {
    padding: 4px 8px;
    border-bottom: 1px solid rgba(86, 28, 36, 0.1);
    background: rgba(86, 28, 36, 0.06);
  }

  .brief-badge {
    font-family: monospace;
    font-size: 0.5rem;
    font-weight: 700;
    color: var(--color-burgundy);
    letter-spacing: 0.08em;
  }

  .brief-body {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .brief-section {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .brief-label {
    font-size: 0.5rem;
    font-weight: 700;
    color: var(--color-burgundy);
    opacity: 0.55;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .brief-line {
    height: 4px;
    background: var(--color-tan);
    border-radius: 2px;
    opacity: 0.5;
  }

  .brief-line.short {
    width: 70%;
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
