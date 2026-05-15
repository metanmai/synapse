<script>
  import ScrollReveal from "./ScrollReveal.svelte";

  const quotes = [
    {
      text: "I use Synapse to keep Claude and Cursor in sync across my monorepo",
      role: "Indie developer",
      initial: "J",
      color: "var(--color-burgundy)",
    },
    {
      text: "My team shares architecture decisions through Synapse \u2014 everyone\u2019s AI knows the context",
      role: "Startup CTO",
      initial: "S",
      color: "var(--color-brown)",
    },
    {
      text: "I exported 6 months of AI conversations as a knowledge base",
      role: "Researcher",
      initial: "R",
      color: "#9b4a56",
    },
  ];
</script>

<section class="builders">
  <div class="builders-bg" aria-hidden="true">
    <div class="builders-orb builders-orb-1"></div>
    <div class="builders-orb builders-orb-2"></div>
    <div class="builders-gradient"></div>
  </div>
  <div class="builders-inner">
    <ScrollReveal>
      <h2 class="builders-headline">Built for builders</h2>
    </ScrollReveal>
    <div class="quotes-grid">
      {#each quotes as quote, i}
        <ScrollReveal delay={i * 150} direction="up">
          <blockquote class="quote-card">
            <div class="quote-avatar" style="background: {quote.color};">
              {quote.initial}
            </div>
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
    position: relative;
    overflow: hidden;
    background-color: var(--color-tan);
    padding: 6rem 2rem;
  }

  .builders-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .builders-gradient {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 60% 60% at 30% 20%, rgba(232, 216, 196, 0.4) 0%, transparent 60%),
      radial-gradient(ellipse 50% 60% at 80% 80%, rgba(199, 183, 163, 0.3) 0%, transparent 50%);
  }

  .builders-orb-1 {
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(86, 28, 36, 0.06) 0%, transparent 70%);
    top: -10%;
    left: 10%;
    filter: blur(60px);
    animation: float-orb 20s ease-in-out infinite;
  }

  .builders-orb-2 {
    position: absolute;
    width: 250px;
    height: 250px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 216, 196, 0.2) 0%, transparent 70%);
    bottom: -10%;
    right: 15%;
    filter: blur(50px);
    animation: float-orb-reverse 16s ease-in-out infinite 2s;
  }

  .builders-inner {
    position: relative;
    z-index: 1;
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
    background: rgba(255, 253, 248, 0.6);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(199, 183, 163, 0.3);
    border-radius: 16px;
    padding: 2rem;
    margin: 0;
    text-align: left;
    box-shadow: 0 8px 32px rgba(86, 28, 36, 0.08);
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }

  .quote-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 16px 48px rgba(86, 28, 36, 0.12);
  }

  .quote-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    color: var(--color-cream);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.125rem;
    font-weight: 700;
    margin-bottom: 1rem;
    box-shadow: 0 4px 12px rgba(86, 28, 36, 0.15);
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

    .quote-card:hover {
      transform: none;
    }
  }
</style>
