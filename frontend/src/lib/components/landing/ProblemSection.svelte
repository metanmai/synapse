<script>
import ScrollReveal from "./ScrollReveal.svelte";
</script>

<section class="problem">
  <div class="problem-bg" aria-hidden="true">
    <div class="problem-orb problem-orb-1"></div>
    <div class="problem-orb problem-orb-2"></div>
    <div class="problem-gradient"></div>
  </div>
  <div class="problem-inner">
    <ScrollReveal>
      <h2 class=”problem-headline”>Your best AI conversations disappear</h2>
    </ScrollReveal>
    <div class=”pain-points”>
      <ScrollReveal delay={150}>
        <p class=”pain-point”>Hundreds of sessions full of decisions, architecture, and debugging insights</p>
      </ScrollReveal>
      <ScrollReveal delay={300}>
        <p class=”pain-point”>Trapped in chat logs you’ll never scroll back to</p>
      </ScrollReveal>
      <ScrollReveal delay={450}>
        <p class=”pain-point”>Every morning, you re-explain your own project to your own tools</p>
      </ScrollReveal>
      <ScrollReveal delay={600}>
        <p class=”pain-point”>The knowledge is there — it just never gets extracted</p>
      </ScrollReveal>
    </div>
  </div>
</section>

<style>
  .problem {
    position: relative;
    overflow: hidden;
    background-color: var(--color-burgundy);
    padding: 6rem 2rem;
  }

  .problem-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .problem-gradient {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 70% 60% at 20% 30%, rgba(109, 41, 50, 0.5) 0%, transparent 60%),
      radial-gradient(ellipse 60% 70% at 80% 70%, rgba(109, 41, 50, 0.3) 0%, transparent 50%);
  }

  .problem-orb-1 {
    position: absolute;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.08) 0%, transparent 70%);
    top: -10%;
    right: -5%;
    filter: blur(70px);
    animation: float-orb 20s ease-in-out infinite;
  }

  .problem-orb-2 {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 216, 196, 0.06) 0%, transparent 70%);
    bottom: -15%;
    left: 10%;
    filter: blur(60px);
    animation: float-orb-reverse 18s ease-in-out infinite 2s;
  }

  .problem-inner {
    position: relative;
    z-index: 1;
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
