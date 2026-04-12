<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const tools = [
    "Claude",
    "ChatGPT",
    "Cursor",
    "Windsurf",
    "Copilot",
  ];

  // Duplicate for seamless infinite scroll
  const scrollTools = [...tools, ...tools, ...tools];
</script>

<section class="toolbar">
  <div class="toolbar-bg" aria-hidden="true">
    <div class="toolbar-orb toolbar-orb-1"></div>
  </div>
  <div class="toolbar-inner">
    <ScrollReveal>
      <p class="toolbar-label">Works with your favorite AI tools</p>
    </ScrollReveal>
    <div class="scroll-track">
      <div class="scroll-belt">
        {#each scrollTools as tool}
          <span class="tool-pill">{tool}</span>
        {/each}
      </div>
    </div>
  </div>
</section>

<style>
  .toolbar {
    position: relative;
    overflow: hidden;
    padding: 3rem 2rem;
    background: radial-gradient(ellipse 80% 100% at 50% 0%, rgba(232, 216, 196, 0.5) 0%, var(--color-cream) 70%);
  }

  .toolbar-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .toolbar-orb-1 {
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.06) 0%, transparent 70%);
    top: -40%;
    right: 10%;
    filter: blur(60px);
    animation: float-orb 18s ease-in-out infinite;
  }

  .toolbar-inner {
    position: relative;
    z-index: 1;
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .toolbar-label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-burgundy);
    opacity: 0.5;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 1.5rem;
  }

  .scroll-track {
    overflow: hidden;
    -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  }

  .scroll-belt {
    display: flex;
    gap: 1.25rem;
    width: max-content;
    animation: scroll-left 25s linear infinite;
  }

  .tool-pill {
    flex-shrink: 0;
    padding: 0.625rem 1.75rem;
    background: rgba(255, 253, 248, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 9999px;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-burgundy);
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(86, 28, 36, 0.06);
  }

  @keyframes scroll-left {
    0% { transform: translateX(0); }
    100% { transform: translateX(calc(-100% / 3)); }
  }

  @media (max-width: 768px) {
    .toolbar {
      padding: 2rem 1rem;
    }

    .tool-pill {
      padding: 0.5rem 1.25rem;
      font-size: 0.8125rem;
    }
  }
</style>
