<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const steps = [
    {
      number: 1,
      title: "Connect",
      description: "Add Synapse to any AI tool in one line",
      illustration: "config",
    },
    {
      number: 2,
      title: "Work",
      description: "Your AI tools save and share context automatically",
      illustration: "sync",
    },
    {
      number: 3,
      title: "Share",
      description: "Invite your team, export your knowledge",
      illustration: "team",
    },
  ];
</script>

<section id="how-it-works" class="how-it-works">
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
                <!-- MCP config illustration -->
                <div class="illus-config">
                  <div class="config-line"><span class="config-key">"mcpServers"</span>: &#123;</div>
                  <div class="config-line indent"><span class="config-key">"synapse"</span>: &#123; ... &#125;</div>
                  <div class="config-line">&#125;</div>
                </div>
              {:else if step.illustration === "sync"}
                <!-- Multiple tools syncing -->
                <div class="illus-sync">
                  <div class="sync-node sync-left">AI</div>
                  <div class="sync-arrows">
                    <span class="sync-arrow">&larr;</span>
                    <span class="sync-arrow">&rarr;</span>
                  </div>
                  <div class="sync-node sync-center">S</div>
                  <div class="sync-arrows">
                    <span class="sync-arrow">&larr;</span>
                    <span class="sync-arrow">&rarr;</span>
                  </div>
                  <div class="sync-node sync-right">AI</div>
                </div>
              {:else}
                <!-- Team sharing illustration -->
                <div class="illus-team">
                  <div class="team-avatar">A</div>
                  <div class="team-folder">
                    <span class="folder-icon">&#128193;</span>
                  </div>
                  <div class="team-avatar">B</div>
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
    background-color: var(--color-cream);
    padding: 6rem 2rem;
  }

  .how-inner {
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
    height: 120px;
    background-color: var(--color-white);
    border: 2px solid var(--color-tan);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  /* Config illustration */
  .illus-config {
    text-align: left;
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--color-burgundy);
    line-height: 1.6;
  }

  .config-key {
    color: var(--color-brown);
    font-weight: 700;
  }

  .config-line.indent {
    padding-left: 1rem;
  }

  /* Sync illustration */
  .illus-sync {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .sync-node {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
  }

  .sync-left,
  .sync-right {
    background-color: var(--color-cream);
    border: 2px solid var(--color-tan);
    color: var(--color-burgundy);
  }

  .sync-center {
    background-color: var(--color-burgundy);
    color: var(--color-cream);
  }

  .sync-arrows {
    display: flex;
    flex-direction: column;
    font-size: 0.875rem;
    color: var(--color-tan);
    line-height: 1;
  }

  /* Team illustration */
  .illus-team {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .team-avatar {
    width: 40px;
    height: 40px;
    background-color: var(--color-brown);
    color: var(--color-cream);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 700;
  }

  .folder-icon {
    font-size: 2rem;
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
  }
</style>
