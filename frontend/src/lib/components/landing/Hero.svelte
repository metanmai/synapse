<section class="hero">
  <div class="hero-content">
    <h1 class="hero-headline">Your AI tools finally remember</h1>
    <p class="hero-sub">
      Synapse is a shared context layer that gives Claude, ChatGPT, Cursor,
      and every AI tool persistent memory across sessions.
    </p>
    <a href="/signup" class="hero-cta">Get Started Free</a>
  </div>

  <div class="hero-visual">
    <!-- Animated context-flow illustration -->
    <div class="hub">
      <div class="hub-core">
        <img src="/logo.svg" alt="" class="hub-logo" />
      </div>
      <div class="orbit-ring"></div>
    </div>

    <div class="tool tool-1">
      <span class="tool-label">Claude</span>
    </div>
    <div class="tool tool-2">
      <span class="tool-label">ChatGPT</span>
    </div>
    <div class="tool tool-3">
      <span class="tool-label">Cursor</span>
    </div>

    <!-- Animated connection lines -->
    <svg class="connections" viewBox="0 0 400 300" fill="none">
      <line x1="200" y1="150" x2="80" y2="60" class="conn-line conn-1" />
      <line x1="200" y1="150" x2="320" y2="60" class="conn-line conn-2" />
      <line x1="200" y1="150" x2="200" y2="270" class="conn-line conn-3" />
    </svg>
  </div>
</section>

<style>
  .hero {
    min-height: 100vh;
    padding-top: 64px; /* nav height */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4rem;
    max-width: 1200px;
    margin: 0 auto;
    padding-left: 2rem;
    padding-right: 2rem;
  }

  .hero-content {
    flex: 1;
    max-width: 560px;
  }

  .hero-headline {
    font-size: clamp(2.5rem, 5vw, 4.5rem);
    font-weight: 900;
    line-height: 1.1;
    color: var(--color-burgundy);
    margin: 0 0 1.25rem;
  }

  .hero-sub {
    font-size: 1.25rem;
    font-weight: 400;
    line-height: 1.6;
    color: var(--color-burgundy);
    opacity: 0.7;
    margin: 0 0 2rem;
  }

  .hero-cta {
    display: inline-block;
    background-color: var(--color-brown);
    color: var(--color-cream);
    padding: 1rem 2.5rem;
    border-radius: 9999px;
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, background-color 0.2s;
  }

  .hero-cta:hover {
    transform: scale(1.05);
    background-color: #7d3340;
  }

  .hero-visual {
    flex: 1;
    max-width: 400px;
    height: 300px;
    position: relative;
  }

  /* Central hub */
  .hub {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  .hub-core {
    width: 64px;
    height: 64px;
    background-color: var(--color-burgundy);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: pulse 3s ease-in-out infinite;
    position: relative;
    z-index: 2;
  }

  .hub-logo {
    width: 32px;
    height: 32px;
    filter: brightness(0) invert(0.9);
  }

  .orbit-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100px;
    height: 100px;
    transform: translate(-50%, -50%);
    border: 2px solid var(--color-tan);
    border-radius: 50%;
    opacity: 0.4;
    animation: orbit-pulse 3s ease-in-out infinite 0.5s;
  }

  /* Tool nodes */
  .tool {
    position: absolute;
    width: 56px;
    height: 56px;
    background-color: var(--color-white);
    border: 2px solid var(--color-brown);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
  }

  .tool-label {
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-brown);
    text-align: center;
  }

  .tool-1 {
    top: 2%;
    left: 8%;
    animation: float 4s ease-in-out infinite;
  }

  .tool-2 {
    top: 2%;
    right: 8%;
    animation: float 4s ease-in-out infinite 1s;
  }

  .tool-3 {
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    animation: float3 4s ease-in-out infinite 2s;
  }

  /* SVG connection lines */
  .connections {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .conn-line {
    stroke: var(--color-tan);
    stroke-width: 2;
    stroke-dasharray: 8 4;
  }

  .conn-1 { animation: dash 2s linear infinite; }
  .conn-2 { animation: dash 2s linear infinite 0.6s; }
  .conn-3 { animation: dash 2s linear infinite 1.2s; }

  @keyframes pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.08); }
  }

  @keyframes orbit-pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.4; }
    50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.15; }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }

  @keyframes float3 {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50% { transform: translateX(-50%) translateY(-8px); }
  }

  @keyframes dash {
    to { stroke-dashoffset: -24; }
  }

  @media (max-width: 768px) {
    .hero {
      flex-direction: column;
      text-align: center;
      gap: 2rem;
      padding-top: calc(64px + 2rem);
    }

    .hero-visual {
      max-width: 300px;
      height: 240px;
    }
  }
</style>
