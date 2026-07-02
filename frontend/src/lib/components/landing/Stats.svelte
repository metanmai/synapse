<script lang="ts">
import { onMount } from "svelte";
import ScrollReveal from "./ScrollReveal.svelte";

interface StatItem {
  label: string;
  target: number;
  suffix: string;
}

const stats: StatItem[] = [
  { label: "Files synced", target: 12400, suffix: "+" },
  { label: "Decisions captured", target: 3200, suffix: "+" },
  { label: "Teams connected", target: 580, suffix: "+" },
];

let values = $state<number[]>([0, 0, 0]);
let sectionEl: HTMLElement;
let hasAnimated = false;

function animateCounters() {
  if (hasAnimated) return;
  hasAnimated = true;

  const duration = 2000;
  const startTime = performance.now();

  function tick(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);

    values = stats.map((s) => Math.round(eased * s.target));

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  }

  requestAnimationFrame(tick);
}

onMount(() => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        animateCounters();
        observer.unobserve(sectionEl);
      }
    },
    { threshold: 0.3 },
  );
  observer.observe(sectionEl);
  return () => observer.disconnect();
});

function formatNumber(n: number): string {
  return n.toLocaleString();
}
</script>

<section class="stats" bind:this={sectionEl}>
  <div class="stats-bg" aria-hidden="true">
    <div class="stats-orb stats-orb-1"></div>
    <div class="stats-orb stats-orb-2"></div>
  </div>
  <div class="stats-inner">
    {#each stats as stat, i}
      <ScrollReveal delay={i * 150}>
        <div class="stat-item">
          <span class="stat-number">{formatNumber(values[i])}{stat.suffix}</span>
          <span class="stat-label">{stat.label}</span>
        </div>
      </ScrollReveal>
    {/each}
  </div>
</section>

<style>
  .stats {
    position: relative;
    overflow: hidden;
    padding: 5rem 2rem;
    background: radial-gradient(ellipse 90% 80% at 50% 50%, rgba(232, 216, 196, 0.6) 0%, var(--color-cream) 70%);
  }

  .stats-bg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .stats-orb-1 {
    position: absolute;
    width: 350px;
    height: 350px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(109, 41, 50, 0.07) 0%, transparent 70%);
    top: -20%;
    left: 5%;
    filter: blur(70px);
    animation: float-orb 20s ease-in-out infinite;
  }

  .stats-orb-2 {
    position: absolute;
    width: 280px;
    height: 280px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(199, 183, 163, 0.2) 0%, transparent 70%);
    bottom: -15%;
    right: 10%;
    filter: blur(60px);
    animation: float-orb-reverse 16s ease-in-out infinite 2s;
  }

  .stats-inner {
    position: relative;
    z-index: 1;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    justify-content: center;
    gap: 4rem;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-number {
    font-size: clamp(2.5rem, 5vw, 3.5rem);
    font-weight: 900;
    color: var(--color-burgundy);
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .stat-label {
    font-size: 1rem;
    font-weight: 500;
    color: var(--color-burgundy);
    opacity: 0.55;
  }

  @media (max-width: 768px) {
    .stats {
      padding: 3.5rem 1.5rem;
    }

    .stats-inner {
      flex-direction: column;
      gap: 2.5rem;
      align-items: center;
    }
  }
</style>
