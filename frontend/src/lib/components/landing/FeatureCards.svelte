<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const features = [
    {
      title: "Context that persists",
      description: "Decisions, architecture notes, and session summaries \u2014 saved automatically, loaded on demand.",
      illustrationType: "timeline",
    },
    {
      title: "Every tool, one brain",
      description: "Switch between AI tools without losing a beat. They all share the same context.",
      illustrationType: "hub",
    },
    {
      title: "Version history",
      description: "Track every change. Restore any version. Know what changed and why.",
      illustrationType: "versions",
    },
    {
      title: "Team sharing",
      description: "Share projects with your team. Everyone\u2019s AI tools stay in sync.",
      illustrationType: "sharing",
    },
    {
      title: "Export & import",
      description: "Your data is yours. Export as markdown, import anytime.",
      illustrationType: "export",
    },
  ];
</script>

<section id="features" class="features-section">
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
                <div class="illus-timeline">
                  <div class="tl-dot"></div>
                  <div class="tl-line"></div>
                  <div class="tl-dot"></div>
                  <div class="tl-line"></div>
                  <div class="tl-dot"></div>
                </div>
              {:else if feature.illustrationType === "hub"}
                <div class="illus-hub-mini">
                  <div class="hub-mini-spoke">AI</div>
                  <div class="hub-mini-center">S</div>
                  <div class="hub-mini-spoke">AI</div>
                </div>
              {:else if feature.illustrationType === "versions"}
                <div class="illus-versions">
                  <div class="ver-bar ver-1"></div>
                  <div class="ver-bar ver-2"></div>
                  <div class="ver-bar ver-3"></div>
                  <div class="ver-label">v1 &rarr; v2 &rarr; v3</div>
                </div>
              {:else if feature.illustrationType === "sharing"}
                <div class="illus-sharing">
                  <div class="share-circle">A</div>
                  <div class="share-line"></div>
                  <div class="share-circle">B</div>
                </div>
              {:else}
                <div class="illus-export">
                  <div class="export-file">.md</div>
                  <div class="export-file">.md</div>
                  <div class="export-arrow">&darr;</div>
                  <div class="export-zip">.zip</div>
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
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .features-inner {
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
    box-shadow: 0 16px 48px rgba(86, 28, 36, 0.15);
  }

  .card-illustration {
    width: 100%;
    height: 100px;
    background-color: var(--color-cream);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  /* Timeline illustration */
  .illus-timeline {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .tl-dot {
    width: 16px;
    height: 16px;
    background-color: var(--color-burgundy);
    border-radius: 50%;
  }

  .tl-line {
    width: 40px;
    height: 3px;
    background-color: var(--color-tan);
  }

  /* Hub mini illustration */
  .illus-hub-mini {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .hub-mini-spoke {
    width: 36px;
    height: 36px;
    background-color: var(--color-cream);
    border: 2px solid var(--color-tan);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    font-weight: 700;
    color: var(--color-burgundy);
  }

  .hub-mini-center {
    width: 44px;
    height: 44px;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 700;
  }

  /* Versions illustration */
  .illus-versions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .ver-bar {
    height: 6px;
    border-radius: 3px;
    background-color: var(--color-tan);
  }

  .ver-1 { width: 60px; }
  .ver-2 { width: 80px; background-color: var(--color-brown); }
  .ver-3 { width: 100px; background-color: var(--color-burgundy); }

  .ver-label {
    font-size: 0.625rem;
    color: var(--color-tan);
    margin-top: 0.25rem;
  }

  /* Sharing illustration */
  .illus-sharing {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .share-circle {
    width: 36px;
    height: 36px;
    background-color: var(--color-brown);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .share-line {
    width: 40px;
    height: 2px;
    background-color: var(--color-tan);
    position: relative;
  }

  /* Export illustration */
  .illus-export {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-burgundy);
  }

  .export-file {
    padding: 0.25rem 0.5rem;
    background-color: var(--color-white);
    border: 1px solid var(--color-tan);
    border-radius: 4px;
  }

  .export-arrow {
    font-size: 1rem;
    color: var(--color-tan);
  }

  .export-zip {
    padding: 0.25rem 0.75rem;
    background-color: var(--color-burgundy);
    color: var(--color-cream);
    border-radius: 6px;
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
