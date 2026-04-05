<script>
import ScrollReveal from "./ScrollReveal.svelte";

const features = [
  {
    title: "Zero-effort capture",
    description:
      "A background daemon watches Claude Code, Cursor, Codex, and Gemini. No plugins, no prompts, no manual saving.",
    illustrationType: "timeline",
  },
  {
    title: "LLM distillation",
    description:
      "An LLM reads your sessions and extracts decisions, architecture notes, and learnings. Signal from noise, automatically.",
    illustrationType: "hub",
  },
  {
    title: "Cross-tool memory",
    description:
      "Knowledge captured from Claude is available in Cursor. From your laptop to your desktop. Across your whole team.",
    illustrationType: "versions",
  },
  {
    title: "Semantic search",
    description:
      "Search by meaning, not keywords. \u201CAuth flow\u201D finds documents about login, session tokens, and OAuth.",
    illustrationType: "sharing",
  },
  {
    title: "End-to-end encryption",
    description:
      "Set a passphrase and content is encrypted before it leaves your machine. The server never sees plaintext.",
    illustrationType: "export",
  },
];
</script>

<section id="features" class="features-section">
  <div class="features-bg" aria-hidden="true">
    <div class="features-orb features-orb-1"></div>
    <div class="features-orb features-orb-2"></div>
  </div>
  <div class="features-inner">
    <ScrollReveal>
      <h2 class="features-headline">Everything you need</h2>
    </ScrollReveal>
    <div class="cards-track">
      {#each features as feature, i}
        <ScrollReveal delay={i * 100}>
          <div
            class="feature-card"
            style="--tilt: {i % 2 === 0 ? '-2deg' : '2deg'}; --offset: {i * 20}px;"
          >
            <div class="card-illustration card-illus-{feature.illustrationType}">
              {#if feature.illustrationType === "timeline"}
                <!-- File tree mockup -->
                <div class="illus-filetree">
                  <div class="ft-header">Workspace</div>
                  <div class="ft-row"><span class="ft-folder"></span><span class="ft-name">decisions/</span></div>
                  <div class="ft-row ft-indent"><span class="ft-file"></span><span class="ft-name">chose-redis.md</span></div>
                  <div class="ft-row ft-indent"><span class="ft-file"></span><span class="ft-name">api-design.md</span></div>
                  <div class="ft-row"><span class="ft-folder"></span><span class="ft-name">architecture/</span></div>
                  <div class="ft-row ft-indent"><span class="ft-file"></span><span class="ft-name">gateway.md</span></div>
                  <div class="ft-row"><span class="ft-folder"></span><span class="ft-name">notes/</span></div>
                </div>
              {:else if feature.illustrationType === "hub"}
                <!-- Hub with multiple tools connecting -->
                <div class="illus-hub">
                  <div class="hub-spoke hub-tl">Claude</div>
                  <div class="hub-spoke hub-tr">Cursor</div>
                  <div class="hub-center-wrap">
                    <div class="hub-glow"></div>
                    <div class="hub-center">S</div>
                  </div>
                  <div class="hub-spoke hub-bl">GPT</div>
                  <div class="hub-spoke hub-br">Copilot</div>
                  <svg class="hub-lines" aria-hidden="true">
                    <line x1="30%" y1="25%" x2="50%" y2="50%" />
                    <line x1="70%" y1="25%" x2="50%" y2="50%" />
                    <line x1="30%" y1="75%" x2="50%" y2="50%" />
                    <line x1="70%" y1="75%" x2="50%" y2="50%" />
                  </svg>
                </div>
              {:else if feature.illustrationType === "versions"}
                <!-- Version timeline -->
                <div class="illus-ver-timeline">
                  <div class="vt-track">
                    <div class="vt-node vt-old">
                      <div class="vt-dot"></div>
                      <span class="vt-label">v1</span>
                      <span class="vt-time">Mar 20</span>
                    </div>
                    <div class="vt-connector"></div>
                    <div class="vt-node vt-mid">
                      <div class="vt-dot"></div>
                      <span class="vt-label">v2</span>
                      <span class="vt-time">Mar 21</span>
                    </div>
                    <div class="vt-connector"></div>
                    <div class="vt-node vt-current">
                      <div class="vt-dot vt-dot-active"></div>
                      <span class="vt-label">v3</span>
                      <span class="vt-time">Today</span>
                    </div>
                  </div>
                  <div class="vt-restore">Restore any version</div>
                </div>
              {:else if feature.illustrationType === "sharing"}
                <!-- Team members list -->
                <div class="illus-team-list">
                  <div class="tl-header">Team members</div>
                  <div class="tl-member">
                    <div class="tl-avatar" style="background: var(--color-burgundy);">A</div>
                    <div class="tl-info">
                      <span class="tl-name">Alice</span>
                      <span class="tl-role">Admin</span>
                    </div>
                    <span class="tl-status tl-active"></span>
                  </div>
                  <div class="tl-member">
                    <div class="tl-avatar" style="background: var(--color-brown);">B</div>
                    <div class="tl-info">
                      <span class="tl-name">Bob</span>
                      <span class="tl-role">Editor</span>
                    </div>
                    <span class="tl-status tl-active"></span>
                  </div>
                  <div class="tl-member">
                    <div class="tl-avatar" style="background: var(--color-tan);">C</div>
                    <div class="tl-info">
                      <span class="tl-name">Carol</span>
                      <span class="tl-role">Viewer</span>
                    </div>
                    <span class="tl-status"></span>
                  </div>
                </div>
              {:else}
                <!-- Zip export mockup -->
                <div class="illus-zip">
                  <div class="zip-files">
                    <div class="zip-file">
                      <span class="zip-icon">&#128196;</span>
                      <span class="zip-fname">decisions/</span>
                    </div>
                    <div class="zip-file">
                      <span class="zip-icon">&#128196;</span>
                      <span class="zip-fname">notes/</span>
                    </div>
                    <div class="zip-file">
                      <span class="zip-icon">&#128196;</span>
                      <span class="zip-fname">architecture/</span>
                    </div>
                  </div>
                  <div class="zip-arrow-area">
                    <div class="zip-arrow-line"></div>
                    <div class="zip-arrow-head"></div>
                  </div>
                  <div class="zip-output">
                    <div class="zip-box">
                      <span class="zip-box-label">.zip</span>
                    </div>
                    <span class="zip-size">2.4 MB</span>
                  </div>
                </div>
              {/if}
            </div>
            <h3 class="card-title">{feature.title}</h3>
            <p class="card-desc">{feature.description}</p>
          </div>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .features-section {
    position: relative;
    overflow: hidden;
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .features-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .features-orb-1 {
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.05) 0%, transparent 70%);
    top: 5%;
    right: -3%;
    filter: blur(60px);
    animation: float-orb 20s ease-in-out infinite;
  }

  .features-orb-2 {
    position: absolute;
    width: 250px;
    height: 250px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.15) 0%, transparent 70%);
    bottom: 10%;
    left: 5%;
    filter: blur(60px);
    animation: float-orb-reverse 18s ease-in-out infinite 2s;
  }

  .features-inner {
    position: relative;
    z-index: 1;
    max-width: 900px;
    margin: 0 auto;
    text-align: center;
  }

  .features-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 4rem;
  }

  .cards-track {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    align-items: center;
  }

  .feature-card {
    position: sticky;
    top: calc(100px + var(--offset, 0px));
    width: 100%;
    max-width: 640px;
    background-color: var(--color-white);
    border: 2px solid var(--color-brown);
    border-radius: 16px;
    padding: 2.5rem;
    transform: rotate(var(--tilt, 0deg));
    box-shadow: 0 8px 32px rgba(86, 28, 36, 0.1);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    text-align: left;
  }

  .feature-card:hover {
    transform: rotate(0deg) translateY(-4px);
    box-shadow:
      0 16px 48px rgba(86, 28, 36, 0.15),
      0 0 40px rgba(86, 28, 36, 0.04);
  }

  .card-illustration {
    width: 100%;
    height: 160px;
    background-color: var(--color-cream);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
    overflow: hidden;
  }

  /* ── File Tree illustration ── */
  .illus-filetree {
    width: 100%;
    height: 100%;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ft-header {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-burgundy);
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(199, 183, 163, 0.3);
  }

  .ft-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .ft-indent {
    padding-left: 16px;
  }

  .ft-folder {
    width: 12px;
    height: 10px;
    background: var(--color-tan);
    border-radius: 1px 3px 3px 3px;
    position: relative;
    flex-shrink: 0;
  }

  .ft-folder::before {
    content: '';
    position: absolute;
    top: -3px;
    left: 0;
    width: 6px;
    height: 3px;
    background: var(--color-tan);
    border-radius: 1px 1px 0 0;
  }

  .ft-file {
    width: 10px;
    height: 12px;
    background: var(--color-white);
    border: 1px solid var(--color-tan);
    border-radius: 1px;
    flex-shrink: 0;
  }

  .ft-name {
    font-size: 0.625rem;
    font-family: monospace;
    color: var(--color-burgundy);
    opacity: 0.7;
  }

  /* ── Hub illustration ── */
  .illus-hub {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .hub-lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .hub-lines line {
    stroke: var(--color-tan);
    stroke-width: 1.5;
    stroke-dasharray: 4 4;
    opacity: 0.5;
  }

  .hub-center-wrap {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .hub-glow {
    position: absolute;
    inset: -12px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.1) 0%, transparent 70%);
    animation: pulse-ring 2.5s ease-out infinite;
  }

  .hub-center {
    width: 40px;
    height: 40px;
    background: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
    position: relative;
    z-index: 1;
  }

  .hub-spoke {
    position: absolute;
    padding: 4px 8px;
    background: var(--color-white);
    border: 1px solid var(--color-tan);
    border-radius: 6px;
    font-size: 0.5625rem;
    font-weight: 700;
    color: var(--color-burgundy);
    z-index: 1;
  }

  .hub-tl { top: 12%; left: 12%; }
  .hub-tr { top: 12%; right: 12%; }
  .hub-bl { bottom: 12%; left: 12%; }
  .hub-br { bottom: 12%; right: 12%; }

  @keyframes pulse-ring {
    0% { transform: scale(1); opacity: 0.6; }
    100% { transform: scale(2); opacity: 0; }
  }

  /* ── Version timeline illustration ── */
  .illus-ver-timeline {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .vt-track {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .vt-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .vt-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-tan);
  }

  .vt-dot-active {
    background: var(--color-burgundy);
    box-shadow: 0 0 0 4px rgba(86, 28, 36, 0.15);
  }

  .vt-label {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-burgundy);
  }

  .vt-time {
    font-size: 0.5rem;
    color: var(--color-burgundy);
    opacity: 0.4;
  }

  .vt-connector {
    width: 32px;
    height: 2px;
    background: var(--color-tan);
    margin: 0 4px;
    margin-bottom: 22px;
  }

  .vt-restore {
    font-size: 0.5625rem;
    font-weight: 600;
    color: var(--color-brown);
    opacity: 0.6;
    padding: 3px 10px;
    background: rgba(86, 28, 36, 0.06);
    border-radius: 9999px;
  }

  /* ── Team list illustration ── */
  .illus-team-list {
    width: 100%;
    height: 100%;
    padding: 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .tl-header {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-burgundy);
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(199, 183, 163, 0.3);
    margin-bottom: 6px;
  }

  .tl-member {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
  }

  .tl-avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: var(--color-cream);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.5rem;
    font-weight: 700;
    flex-shrink: 0;
  }

  .tl-info {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .tl-name {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--color-burgundy);
  }

  .tl-role {
    font-size: 0.5rem;
    color: var(--color-burgundy);
    opacity: 0.4;
  }

  .tl-status {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-tan);
    opacity: 0.3;
    flex-shrink: 0;
  }

  .tl-status.tl-active {
    background: #28c840;
    opacity: 1;
  }

  /* ── Zip export illustration ── */
  .illus-zip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
  }

  .zip-files {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .zip-file {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--color-white);
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 4px;
  }

  .zip-icon {
    font-size: 0.625rem;
    line-height: 1;
  }

  .zip-fname {
    font-size: 0.5625rem;
    font-family: monospace;
    color: var(--color-burgundy);
    opacity: 0.6;
  }

  .zip-arrow-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
  }

  .zip-arrow-line {
    width: 24px;
    height: 2px;
    background: var(--color-tan);
  }

  .zip-arrow-head {
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 0;
    border-bottom: 0;
    margin-top: -1px;
  }

  .zip-output {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .zip-box {
    width: 48px;
    height: 48px;
    background: var(--color-burgundy);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zip-box-label {
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-cream);
  }

  .zip-size {
    font-size: 0.5rem;
    color: var(--color-burgundy);
    opacity: 0.4;
  }

  .card-title {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 0.5rem;
  }

  .card-desc {
    font-size: 1rem;
    font-weight: 400;
    color: var(--color-burgundy);
    opacity: 0.65;
    margin: 0;
    line-height: 1.6;
  }

  @media (max-width: 768px) {
    .features-section {
      padding: 4rem 1.5rem;
    }

    .feature-card {
      position: relative;
      top: 0;
      transform: none;
      padding: 2rem;
    }

    .feature-card:hover {
      transform: translateY(-4px);
    }
  }
</style>
