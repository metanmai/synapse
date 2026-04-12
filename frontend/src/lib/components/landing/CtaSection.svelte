<script>
  import ScrollReveal from "./ScrollReveal.svelte";
</script>

<section class="cta">
  <div class="cta-inner">
    <ScrollReveal>
      <h2 class="cta-headline">Start building with context</h2>
      <p class="cta-sub">Free to start. Pro at $5.99/mo for teams and power users.</p>
      <a href="/signup" class="cta-button">Get Started Free</a>
    </ScrollReveal>
  </div>
</section>

<style>
  .cta {
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
    text-align: center;
  }

  .cta-inner {
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

  .cta-button {
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
