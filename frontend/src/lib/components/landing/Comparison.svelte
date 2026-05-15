<script>
import ScrollReveal from "./ScrollReveal.svelte";

const rows = [
  {
    without: "Re-explain your project every morning",
    with: "Your AI already knows what you decided yesterday",
  },
  {
    without: "Knowledge trapped in closed chat tabs",
    with: "Sessions captured and distilled automatically",
  },
  {
    without: "Claude doesn't know what Cursor knows",
    with: "All tools share the same knowledge base",
  },
  {
    without: "Teammates re-discover the same things",
    with: "Team sessions build shared understanding",
  },
];
</script>

<section class="comparison">
  <div class="comparison-bg" aria-hidden="true">
    <div class="comparison-orb comparison-orb-1"></div>
    <div class="comparison-orb comparison-orb-2"></div>
  </div>
  <div class="comparison-inner">
    <ScrollReveal>
      <h2 class="comparison-headline">The difference is night and day</h2>
    </ScrollReveal>

    <div class="comparison-grid">
      <ScrollReveal delay={100}>
        <div class="comparison-col col-without">
          <div class="col-header col-header-without">Without Synapse</div>
          {#each rows as row}
            <div class="comparison-row row-without">
              <span class="row-icon">&#10005;</span>
              <span class="row-text">{row.without}</span>
            </div>
          {/each}
        </div>
      </ScrollReveal>

      <ScrollReveal delay={250}>
        <div class="comparison-col col-with">
          <div class="col-header col-header-with">With Synapse</div>
          {#each rows as row}
            <div class="comparison-row row-with">
              <span class="row-icon">&#10003;</span>
              <span class="row-text">{row.with}</span>
            </div>
          {/each}
        </div>
      </ScrollReveal>
    </div>
  </div>
</section>

<style>
  .comparison {
    position: relative;
    overflow: hidden;
    padding: 6rem 2rem;
    background: radial-gradient(ellipse 70% 80% at 30% 50%, rgba(232, 216, 196, 0.5) 0%, var(--color-cream) 70%);
  }

  .comparison-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .comparison-orb-1 {
    position: absolute;
    width: 320px;
    height: 320px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.06) 0%, transparent 70%);
    top: 10%;
    left: -5%;
    filter: blur(70px);
    animation: float-orb 22s ease-in-out infinite;
  }

  .comparison-orb-2 {
    position: absolute;
    width: 260px;
    height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.18) 0%, transparent 70%);
    bottom: 5%;
    right: 5%;
    filter: blur(60px);
    animation: float-orb-reverse 18s ease-in-out infinite 3s;
  }

  .comparison-inner {
    position: relative;
    z-index: 1;
    max-width: 900px;
    margin: 0 auto;
    text-align: center;
  }

  .comparison-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 3rem;
  }

  .comparison-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }

  .comparison-col {
    background: rgba(255, 253, 248, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(86, 28, 36, 0.08);
  }

  .col-header {
    padding: 1.25rem 1.5rem;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .col-header-without {
    background: rgba(109, 41, 50, 0.1);
    color: var(--color-brown);
    border-bottom: 1px solid rgba(109, 41, 50, 0.15);
  }

  .col-header-with {
    background: rgba(40, 120, 60, 0.08);
    color: #2d6a3e;
    border-bottom: 1px solid rgba(40, 120, 60, 0.12);
  }

  .comparison-row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    text-align: left;
    border-bottom: 1px solid rgba(199, 183, 163, 0.15);
  }

  .comparison-row:last-child {
    border-bottom: none;
  }

  .row-icon {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    margin-top: 1px;
  }

  .row-without .row-icon {
    background: rgba(109, 41, 50, 0.12);
    color: var(--color-brown);
  }

  .row-with .row-icon {
    background: rgba(40, 120, 60, 0.12);
    color: #2d6a3e;
  }

  .row-text {
    font-size: 1rem;
    line-height: 1.5;
    color: var(--color-burgundy);
    opacity: 0.75;
  }

  .row-with .row-text {
    opacity: 0.85;
    font-weight: 500;
  }

  @media (max-width: 768px) {
    .comparison {
      padding: 4rem 1.5rem;
    }

    .comparison-grid {
      grid-template-columns: 1fr;
      gap: 1.5rem;
    }
  }
</style>
