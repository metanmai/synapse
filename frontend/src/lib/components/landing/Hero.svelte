<script lang="ts">
import { onMount } from "svelte";

let scrollY = $state(0);

onMount(() => {
  const handleScroll = () => {
    scrollY = window.scrollY;
  };
  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
});
</script>

<section class="hero">
  <!-- Gradient mesh background -->
  <div class="hero-bg" aria-hidden="true">
    <div class="mesh-gradient"></div>
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>
    <div class="orb orb-4"></div>
    <div class="hero-grain"></div>
    <div class="hero-vignette"></div>
  </div>

  <div class="hero-container">
    <div class="hero-content" style="transform: translateY({scrollY * 0.08}px);">
      <div class="hero-badge">Capture sessions — distill knowledge — feed it back</div>
      <h1 class="hero-headline">
        Your AI sessions,
        <span class="gradient-text">remembered and distilled</span>
      </h1>
      <p class="hero-sub">
        Synapse automatically captures your AI coding sessions from Claude, Cursor, Codex, and
        Gemini. When you go idle, it distills the valuable parts — decisions, architecture,
        learnings — into a searchable workspace your tools can read next time.
      </p>
      <div class="hero-actions">
        <a href="#how-it-works" class="hero-secondary">See how it works</a>
      </div>
    </div>

    <div class="hero-visual" style="transform: translateY({scrollY * -0.04}px);">
      <!-- Stylized workspace mockup -->
      <div class="workspace-mockup">
        <div class="mockup-glow" aria-hidden="true"></div>
        <!-- Title bar -->
        <div class="mockup-titlebar">
          <div class="titlebar-dots">
            <span class="dot dot-red"></span>
            <span class="dot dot-yellow"></span>
            <span class="dot dot-green"></span>
          </div>
          <span class="titlebar-text">Synapse Workspace</span>
        </div>
        <!-- Sidebar + content -->
        <div class="mockup-body">
          <div class="mockup-sidebar">
            <div class="sidebar-section">
              <div class="sidebar-heading">Projects</div>
              <div class="sidebar-item active">
                <span class="item-icon">&#128193;</span>
                <span class="item-text">my-app</span>
              </div>
              <div class="sidebar-item">
                <span class="item-icon">&#128193;</span>
                <span class="item-text">design-system</span>
              </div>
            </div>
            <div class="sidebar-section">
              <div class="sidebar-heading">Recent</div>
              <div class="sidebar-item">
                <span class="item-icon">&#128196;</span>
                <span class="item-text">api-design.md</span>
              </div>
              <div class="sidebar-item">
                <span class="item-icon">&#128196;</span>
                <span class="item-text">chose-redis.md</span>
              </div>
              <div class="sidebar-item">
                <span class="item-icon">&#128196;</span>
                <span class="item-text">auth-flow.md</span>
              </div>
            </div>
          </div>
          <div class="mockup-content">
            <div class="content-header">decisions/chose-session-cookies.md</div>
            <div class="content-lines">
              <div class="content-line line-heading"># Chose Session Cookies</div>
              <div class="content-line line-text">Switched from JWT to session cookies...</div>
              <div class="content-line line-text short">Refresh token rotation was unreliable</div>
              <div class="content-line line-heading small">## Extracted from</div>
              <div class="content-line line-text">Claude Code session, Apr 2 2026</div>
              <div class="content-line line-tag-row">
                <span class="content-tag">decision</span>
                <span class="content-tag">auto-distilled</span>
              </div>
            </div>
            <!-- Tool badges floating -->
            <div class="connected-tools">
              <div class="tool-badge tool-badge-1">Claude</div>
              <div class="tool-badge tool-badge-2">Cursor</div>
              <div class="tool-badge tool-badge-3">ChatGPT</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Scroll indicator -->
  <div class="scroll-indicator" aria-hidden="true">
    <div class="scroll-mouse">
      <div class="scroll-wheel"></div>
    </div>
  </div>
</section>

<style>
  .hero {
    min-height: 100vh;
    padding-top: 64px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }

  /* Gradient mesh background */
  .hero-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .mesh-gradient {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 20% 40%, rgba(232, 216, 196, 0.8) 0%, transparent 60%),
      radial-gradient(ellipse 60% 80% at 80% 30%, rgba(199, 183, 163, 0.5) 0%, transparent 50%),
      radial-gradient(ellipse 70% 50% at 50% 80%, rgba(232, 216, 196, 0.6) 0%, transparent 50%),
      linear-gradient(180deg, var(--color-cream) 0%, var(--color-white) 40%, var(--color-cream) 100%);
  }

  .hero-grain {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 256px 256px;
    pointer-events: none;
  }

  .hero-vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 70% 60% at 50% 45%, transparent 0%, transparent 40%, rgba(86, 28, 36, 0.04) 70%, rgba(86, 28, 36, 0.1) 100%);
    pointer-events: none;
  }

  .orb {
    position: absolute;
    border-radius: 50%;
    filter: blur(80px);
    will-change: transform;
  }

  .orb-1 {
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.16) 0%, transparent 70%);
    top: 5%;
    left: -5%;
    animation: float-orb 20s ease-in-out infinite;
  }

  .orb-2 {
    width: 350px;
    height: 350px;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.3) 0%, transparent 70%);
    top: 15%;
    right: -3%;
    animation: float-orb-reverse 18s ease-in-out infinite;
  }

  .orb-3 {
    width: 300px;
    height: 300px;
    background: radial-gradient(circle, rgba(109, 41, 50, 0.12) 0%, transparent 70%);
    bottom: 10%;
    left: 30%;
    animation: float-orb 22s ease-in-out infinite 3s;
  }

  .orb-4 {
    width: 250px;
    height: 250px;
    background: radial-gradient(circle, rgba(232, 216, 196, 0.3) 0%, transparent 70%);
    bottom: 20%;
    right: 15%;
    animation: float-orb-reverse 16s ease-in-out infinite 2s;
  }

  .hero-container {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4rem;
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
    width: 100%;
  }

  .hero-content {
    flex: 1;
    max-width: 560px;
  }

  .hero-badge {
    display: inline-block;
    padding: 0.375rem 1rem;
    background: rgba(86, 28, 36, 0.08);
    border: 1px solid rgba(86, 28, 36, 0.15);
    border-radius: 9999px;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-brown);
    letter-spacing: 0.02em;
    margin-bottom: 1.5rem;
  }

  .hero-headline {
    font-size: clamp(3rem, 6vw, 5.5rem);
    font-weight: 900;
    line-height: 1.05;
    color: var(--color-burgundy);
    margin: 0 0 1.5rem;
    letter-spacing: -0.02em;
  }

  .gradient-text {
    background: linear-gradient(135deg, var(--color-burgundy) 0%, var(--color-brown) 40%, #9b4a56 60%, var(--color-burgundy) 100%);
    background-size: 200% 200%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: gradient-shift 6s ease-in-out infinite;
  }

  .hero-sub {
    font-size: 1.25rem;
    font-weight: 400;
    line-height: 1.7;
    color: var(--color-burgundy);
    opacity: 0.7;
    margin: 0 0 2.5rem;
  }

  .hero-actions {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .hero-cta {
    display: inline-block;
    background: linear-gradient(135deg, var(--color-brown), #7d3340);
    color: var(--color-cream);
    padding: 1.125rem 2.75rem;
    border-radius: 9999px;
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.25s, box-shadow 0.25s;
    box-shadow: 0 4px 20px rgba(109, 41, 50, 0.3);
  }

  .hero-cta:hover {
    transform: scale(1.05) translateY(-2px);
    box-shadow: 0 8px 32px rgba(109, 41, 50, 0.45);
  }

  .hero-secondary {
    color: var(--color-brown);
    font-size: 1rem;
    font-weight: 600;
    text-decoration: none;
    border-bottom: 2px solid rgba(109, 41, 50, 0.3);
    padding-bottom: 2px;
    transition: border-color 0.2s, color 0.2s;
  }

  .hero-secondary:hover {
    color: var(--color-burgundy);
    border-bottom-color: var(--color-burgundy);
  }

  /* ── Workspace mockup ── */
  .hero-visual {
    flex: 1;
    max-width: 520px;
    position: relative;
  }

  .workspace-mockup {
    position: relative;
    background: rgba(255, 253, 248, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 16px;
    overflow: hidden;
    box-shadow:
      0 20px 60px rgba(86, 28, 36, 0.12),
      0 4px 16px rgba(86, 28, 36, 0.06);
  }

  .mockup-glow {
    position: absolute;
    top: -40%;
    left: -20%;
    width: 140%;
    height: 140%;
    background: radial-gradient(ellipse at center, rgba(86, 28, 36, 0.04) 0%, transparent 60%);
    pointer-events: none;
  }

  .mockup-titlebar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(86, 28, 36, 0.06);
    border-bottom: 1px solid rgba(199, 183, 163, 0.25);
  }

  .titlebar-dots {
    display: flex;
    gap: 6px;
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .dot-red { background: #ff6059; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #28c840; }

  .titlebar-text {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-burgundy);
    opacity: 0.5;
  }

  .mockup-body {
    display: flex;
    min-height: 260px;
  }

  .mockup-sidebar {
    width: 140px;
    padding: 0.75rem;
    border-right: 1px solid rgba(199, 183, 163, 0.2);
    background: rgba(232, 216, 196, 0.15);
    flex-shrink: 0;
  }

  .sidebar-section {
    margin-bottom: 1rem;
  }

  .sidebar-heading {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-tan);
    margin-bottom: 0.375rem;
  }

  .sidebar-item {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.375rem;
    border-radius: 6px;
    font-size: 0.625rem;
    color: var(--color-burgundy);
    opacity: 0.6;
    transition: background 0.15s, opacity 0.15s;
  }

  .sidebar-item.active {
    background: rgba(86, 28, 36, 0.08);
    opacity: 1;
    font-weight: 600;
  }

  .item-icon {
    font-size: 0.6875rem;
    line-height: 1;
  }

  .item-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mockup-content {
    flex: 1;
    padding: 1rem;
    position: relative;
  }

  .content-header {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-burgundy);
    opacity: 0.4;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid rgba(199, 183, 163, 0.2);
  }

  .content-lines {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .content-line {
    font-size: 0.6875rem;
    line-height: 1.5;
    color: var(--color-burgundy);
  }

  .line-heading {
    font-weight: 700;
    font-size: 0.75rem;
    color: var(--color-burgundy);
  }

  .line-heading.small {
    font-size: 0.6875rem;
    margin-top: 0.25rem;
  }

  .line-text {
    opacity: 0.55;
  }

  .line-text.short {
    width: 60%;
  }

  .line-tag-row {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.375rem;
  }

  .content-tag {
    display: inline-block;
    padding: 0.125rem 0.5rem;
    background: rgba(86, 28, 36, 0.08);
    border-radius: 9999px;
    font-size: 0.5625rem;
    font-weight: 600;
    color: var(--color-brown);
  }

  /* Tool badges floating around the mockup */
  .connected-tools {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .tool-badge {
    position: absolute;
    padding: 0.25rem 0.625rem;
    background: rgba(255, 253, 248, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 9999px;
    font-size: 0.5625rem;
    font-weight: 700;
    color: var(--color-burgundy);
    box-shadow: 0 2px 8px rgba(86, 28, 36, 0.1);
  }

  .tool-badge-1 {
    top: -8px;
    right: -16px;
    animation: float-orb 6s ease-in-out infinite;
  }

  .tool-badge-2 {
    bottom: 30px;
    right: -20px;
    animation: float-orb-reverse 5s ease-in-out infinite 1s;
  }

  .tool-badge-3 {
    bottom: -8px;
    left: 20px;
    animation: float-orb 7s ease-in-out infinite 2s;
  }

  /* Scroll indicator */
  .scroll-indicator {
    position: absolute;
    bottom: 2rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    opacity: 0.4;
    animation: scroll-bob 2s ease-in-out infinite;
  }

  .scroll-mouse {
    width: 24px;
    height: 38px;
    border: 2px solid var(--color-burgundy);
    border-radius: 12px;
    position: relative;
  }

  .scroll-wheel {
    width: 4px;
    height: 8px;
    background: var(--color-burgundy);
    border-radius: 2px;
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    animation: scroll-wheel 2s ease-in-out infinite;
  }

  @keyframes scroll-bob {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50% { transform: translateX(-50%) translateY(6px); }
  }

  @keyframes scroll-wheel {
    0%, 100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(10px); }
  }

  @media (max-width: 768px) {
    .hero {
      padding-top: calc(64px + 1rem);
      min-height: auto;
      padding-bottom: 4rem;
    }

    .hero-container {
      flex-direction: column;
      text-align: center;
      gap: 3rem;
    }

    .hero-actions {
      justify-content: center;
    }

    .hero-visual {
      max-width: 100%;
    }

    .mockup-sidebar {
      display: none;
    }

    .scroll-indicator {
      display: none;
    }

    .orb-1, .orb-2 { width: 200px; height: 200px; }
    .orb-3, .orb-4 { display: none; }

    .hero-badge {
      margin-bottom: 1rem;
    }
  }
</style>
