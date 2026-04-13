<script>
import ScrollReveal from "./ScrollReveal.svelte";

let { loggedIn = false } = $props();
</script>

<section class="cta">
  <div class="cta-bg" aria-hidden="true">
    <div class="cta-orb cta-orb-1"></div>
    <div class="cta-orb cta-orb-2"></div>
    <div class="cta-gradient"></div>
  </div>
  <div class="cta-inner">
    <ScrollReveal>
      <h2 class="cta-headline">Stop losing your best AI conversations</h2>
      <p class="cta-sub">Capture sessions, distill knowledge, remember everything. Free to start.</p>
      <div class="cta-button-wrap">
        <div class="cta-glow" aria-hidden="true"></div>
        {#if loggedIn}
          <a href="/dashboard" class="cta-button">Go to Dashboard</a>
        {:else}
          <a href="/signup" class="cta-button">Get Started Free</a>
        {/if}
      </div>
    </ScrollReveal>
  </div>
</section>

<style>
  .cta {
    position: relative;
    overflow: hidden;
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
    text-align: center;
  }

  .cta-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .cta-gradient {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 70% 80% at 50% 50%, rgba(109, 41, 50, 0.5) 0%, transparent 60%);
  }

  .cta-orb-1 {
    position: absolute;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.07) 0%, transparent 70%);
    top: -20%;
    left: -5%;
    filter: blur(70px);
    animation: float-orb 18s ease-in-out infinite;
  }

  .cta-orb-2 {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 216, 196, 0.06) 0%, transparent 70%);
    bottom: -15%;
    right: 5%;
    filter: blur(60px);
    animation: float-orb-reverse 16s ease-in-out infinite 3s;
  }

  .cta-inner {
    position: relative;
    z-index: 1;
    max-width: 600px;
    margin: 0 auto;
  }

  .cta-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 1rem;
  }

  .cta-sub {
    font-size: 1.125rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0 0 2.5rem;
    line-height: 1.6;
  }

  .cta-button-wrap {
    position: relative;
    display: inline-block;
  }

  .cta-glow {
    position: absolute;
    inset: -12px;
    border-radius: 9999px;
    background: radial-gradient(ellipse at center, rgba(232, 216, 196, 0.25) 0%, transparent 70%);
    animation: cta-pulse 2.5s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes cta-pulse {
    0%, 100% { transform: scale(1); opacity: 0.6; }
    50% { transform: scale(1.15); opacity: 1; }
  }

  .cta-button {
    position: relative;
    z-index: 1;
    display: inline-block;
    background-color: var(--color-cream);
    color: var(--color-burgundy);
    padding: 1rem 2.5rem;
    border-radius: 9999px;
    font-size: 1.125rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
  }

  .cta-button:hover {
    transform: scale(1.05);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  @media (max-width: 768px) {
    .cta {
      padding: 4rem 1.5rem;
    }
  }
</style>
