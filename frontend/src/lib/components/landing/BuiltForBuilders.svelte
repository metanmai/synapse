<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const quotes = [
    {
      text: "I use Synapse to keep Claude and Cursor in sync across my monorepo",
      role: "Indie developer",
    },
    {
      text: "My team shares architecture decisions through Synapse \u2014 everyone\u2019s AI knows the context",
      role: "Startup CTO",
    },
    {
      text: "I exported 6 months of AI conversations as a knowledge base",
      role: "Researcher",
    },
  ];
</script>

<section class="builders">
  <div class="builders-inner">
    <ScrollReveal>
      <h2 class="builders-headline">Built for builders</h2>
    </ScrollReveal>
    <div class="quotes-grid">
      {#each quotes as quote, i}
        <ScrollReveal delay={i * 150} direction="up">
          <blockquote class="quote-card">
            <p class="quote-text">"{quote.text}"</p>
            <footer class="quote-role">&mdash; {quote.role}</footer>
          </blockquote>
        </ScrollReveal>
      {/each}
    </div>
  </div>
</section>

<style>
  .builders {
    background-color: var(--color-tan);
    padding: 6rem 2rem;
  }

  .builders-inner {
    max-width: 1000px;
    margin: 0 auto;
    text-align: center;
  }

  .builders-headline {
    font-size: clamp(2rem, 4vw, 2.5rem);
    font-weight: 700;
    color: var(--color-burgundy);
    margin: 0 0 3rem;
  }

  .quotes-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 2rem;
  }

  .quote-card {
    background-color: var(--color-white);
    border-radius: 12px;
    padding: 2rem;
    margin: 0;
    text-align: left;
    box-shadow: 0 4px 16px rgba(86, 28, 36, 0.08);
  }

  .quote-text {
    font-size: 1.0625rem;
    font-weight: 400;
    color: var(--color-burgundy);
    line-height: 1.6;
    margin: 0 0 1rem;
    font-style: italic;
  }

  .quote-role {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--color-brown);
  }

  @media (max-width: 768px) {
    .builders {
      padding: 4rem 1.5rem;
    }

    .quotes-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
