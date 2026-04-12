<script>
  import ScrollReveal from "./ScrollReveal.svelte";
</script>

<section class="problem">
  <div class="problem-inner">
    <ScrollReveal>
      <h2 class="problem-headline">Your AI tools forget everything</h2>
    </ScrollReveal>
    <div class="pain-points">
      <ScrollReveal delay={150}>
        <p class="pain-point">Every session starts from scratch</p>
      </ScrollReveal>
      <ScrollReveal delay={300}>
        <p class="pain-point">Decisions made yesterday are lost today</p>
      </ScrollReveal>
      <ScrollReveal delay={450}>
        <p class="pain-point">Switching tools means losing context</p>
      </ScrollReveal>
    </div>
  </div>
</section>

<style>
  .problem {
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
  }

  .problem-inner {
    max-width: 800px;
    margin: 0 auto;
    text-align: center;
  }

  .problem-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 3rem;
  }

  .pain-points {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .pain-point {
    font-size: 1.25rem;
    font-weight: 300;
    color: var(--color-tan);
    margin: 0;
    line-height: 1.6;
  }

  @media (max-width: 768px) {
    .problem {
      padding: 4rem 1.5rem;
    }

    .pain-point {
      font-size: 1.125rem;
    }
  }
</style>
