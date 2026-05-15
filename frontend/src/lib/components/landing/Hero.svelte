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
      <!-- Pipeline visualization: Capture → Distill → Knowledge -->
      <div class="pipeline-mockup">
        <div class="mockup-glow" aria-hidden="true"></div>

        <!-- Stage 1: Raw session -->
        <div class="pipeline-stage stage-capture">
          <div class="stage-label">Captured session</div>
          <div class="stage-card">
            <div class="session-line"><span class="role-user">you</span> Should we use Redis or Memcached?</div>
            <div class="session-line"><span class="role-assistant">claude</span> Redis — pub/sub support for cache invalidation</div>
            <div class="session-line"><span class="role-user">you</span> What about the auth middleware?</div>
            <div class="session-line"><span class="role-assistant">claude</span> Switch to session cookies. JWT refresh was unreliable...</div>
            <div class="session-fade">+146 more messages</div>
          </div>
        </div>

        <!-- Arrow -->
        <div class="pipeline-arrow">
          <div class="arrow-line"></div>
          <div class="arrow-label">distill</div>
        </div>

        <!-- Stage 2: Extracted knowledge -->
        <div class="pipeline-stage stage-output">
          <div class="stage-label">Extracted knowledge</div>
          <div class="output-files">
            <div class="output-file">
              <span class="file-icon">&#9670;</span>
              <span class="file-path">decisions/chose-redis.md</span>
              <span class="file-tag">decision</span>
            </div>
            <div class="output-file">
              <span class="file-icon">&#9670;</span>
              <span class="file-path">decisions/session-cookies.md</span>
              <span class="file-tag">decision</span>
            </div>
            <div class="output-file">
              <span class="file-icon">&#9670;</span>
              <span class="file-path">learnings/jwt-refresh-gotcha.md</span>
              <span class="file-tag">learning</span>
            </div>
          </div>
        </div>

        <!-- Floating tool badges -->
        <div class="connected-tools">
          <div class="tool-badge tool-badge-1">Claude Code</div>
          <div class="tool-badge tool-badge-2">Cursor</div>
          <div class="tool-badge tool-badge-3">Codex</div>
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

  /* ── Pipeline mockup ── */
  .hero-visual {
    flex: 1;
    max-width: 520px;
    position: relative;
  }

  .pipeline-mockup {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0;
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

  .pipeline-stage {
    position: relative;
  }

  .stage-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-tan);
    margin-bottom: 0.5rem;
  }

  .stage-card {
    background: rgba(255, 253, 248, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 12px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow:
      0 12px 40px rgba(86, 28, 36, 0.08),
      0 2px 8px rgba(86, 28, 36, 0.04);
  }

  .session-line {
    font-size: 0.6875rem;
    line-height: 1.5;
    color: var(--color-burgundy);
    opacity: 0.7;
  }

  .role-user {
    display: inline-block;
    font-weight: 700;
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-brown);
    background: rgba(200, 160, 106, 0.15);
    padding: 0.0625rem 0.375rem;
    border-radius: 4px;
    margin-right: 0.375rem;
  }

  .role-assistant {
    display: inline-block;
    font-weight: 700;
    font-size: 0.5625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-burgundy);
    background: rgba(86, 28, 36, 0.08);
    padding: 0.0625rem 0.375rem;
    border-radius: 4px;
    margin-right: 0.375rem;
  }

  .session-fade {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--color-tan);
    text-align: center;
    padding-top: 0.25rem;
  }

  /* Arrow between stages */
  .pipeline-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.75rem 0;
    position: relative;
  }

  .arrow-line {
    width: 2px;
    height: 24px;
    background: linear-gradient(to bottom, var(--color-tan), var(--color-brown));
    border-radius: 1px;
  }

  .arrow-label {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--color-brown);
    background: var(--color-cream);
    padding: 0.125rem 0.625rem;
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 9999px;
    margin-top: 0.25rem;
  }

  /* Output files */
  .output-files {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .output-file {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba(255, 253, 248, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.4);
    border-radius: 10px;
    padding: 0.625rem 0.875rem;
    box-shadow: 0 4px 16px rgba(86, 28, 36, 0.06);
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .output-file:hover {
    transform: translateX(4px);
    box-shadow: 0 6px 24px rgba(86, 28, 36, 0.1);
  }

  .file-icon {
    color: var(--color-brown);
    font-size: 0.5rem;
  }

  .file-path {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-burgundy);
    font-family: monospace;
    flex: 1;
  }

  .file-tag {
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-brown);
    background: rgba(86, 28, 36, 0.08);
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
  }

  /* Tool badges floating */
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
    top: 50%;
    right: -24px;
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
