<script lang="ts">
import { onMount } from "svelte";

let { loggedIn = false } = $props<{ loggedIn?: boolean }>();
let mobileOpen = $state(false);
let scrolled = $state(false);

onMount(() => {
  const handleScroll = () => {
    scrolled = window.scrollY > 20;
  };
  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
});
</script>

<nav class="landing-nav" class:scrolled>
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="/logo.svg" alt="" class="nav-logo-img" />
      Synapse
    </a>

    <div class="nav-links">
      <a href="#features" class="nav-link">Features</a>
      <a href="#how-it-works" class="nav-link">How It Works</a>
    </div>

    {#if loggedIn}
      <a href="/dashboard" class="nav-cta">Go to Dashboard</a>
    {:else}
      <a href="/signup" class="nav-cta">Get Started Free</a>
    {/if}

    <button class="nav-hamburger" onclick={() => mobileOpen = !mobileOpen} aria-label="Toggle menu">
      <span class="hamburger-bar" class:open={mobileOpen}></span>
      <span class="hamburger-bar" class:open={mobileOpen}></span>
      <span class="hamburger-bar" class:open={mobileOpen}></span>
    </button>
  </div>

  {#if mobileOpen}
    <div class="mobile-menu">
      <a href="#features" class="mobile-link" onclick={() => mobileOpen = false}>Features</a>
      <a href="#how-it-works" class="mobile-link" onclick={() => mobileOpen = false}>How It Works</a>
      {#if loggedIn}
        <a href="/dashboard" class="mobile-cta" onclick={() => mobileOpen = false}>Go to Dashboard</a>
      {:else}
        <a href="/signup" class="mobile-cta" onclick={() => mobileOpen = false}>Get Started Free</a>
      {/if}
    </div>
  {/if}
</nav>

<style>
  .landing-nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    background: rgba(86, 28, 36, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(109, 41, 50, 0.3);
    transition: background 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
  }

  .landing-nav.scrolled {
    background: rgba(86, 28, 36, 0.92);
    box-shadow: 0 4px 24px rgba(86, 28, 36, 0.3);
    border-bottom-color: rgba(109, 41, 50, 0.5);
  }

  .nav-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 2rem;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .nav-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--color-cream);
    text-decoration: none;
    transition: opacity 0.2s;
  }

  .nav-logo:hover {
    opacity: 0.85;
  }

  .nav-logo-img {
    width: 28px;
    height: 28px;
    filter: brightness(0) invert(0.9);
  }

  .nav-links {
    display: flex;
    gap: 2rem;
  }

  .nav-link {
    color: var(--color-tan);
    text-decoration: none;
    font-size: 0.9375rem;
    font-weight: 400;
    transition: color 0.2s;
    position: relative;
  }

  .nav-link::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 0;
    width: 0;
    height: 2px;
    background: var(--color-cream);
    border-radius: 1px;
    transition: width 0.3s ease;
  }

  .nav-link:hover {
    color: var(--color-cream);
  }

  .nav-link:hover::after {
    width: 100%;
  }

  .nav-cta {
    background: linear-gradient(135deg, var(--color-brown), #7d3340);
    color: var(--color-cream);
    padding: 0.625rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 12px rgba(109, 41, 50, 0.3);
  }

  .nav-cta:hover {
    transform: scale(1.05);
    box-shadow: 0 4px 20px rgba(109, 41, 50, 0.5);
  }

  .nav-hamburger {
    display: none;
    flex-direction: column;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
  }

  .hamburger-bar {
    display: block;
    width: 24px;
    height: 2px;
    background-color: var(--color-cream);
    transition: transform 0.3s, opacity 0.3s;
  }

  .hamburger-bar.open:nth-child(1) {
    transform: translateY(7px) rotate(45deg);
  }

  .hamburger-bar.open:nth-child(2) {
    opacity: 0;
  }

  .hamburger-bar.open:nth-child(3) {
    transform: translateY(-7px) rotate(-45deg);
  }

  .mobile-menu {
    display: none;
    flex-direction: column;
    padding: 1rem 2rem 1.5rem;
    background: rgba(86, 28, 36, 0.95);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-top: 1px solid rgba(109, 41, 50, 0.4);
  }

  .mobile-link {
    color: var(--color-tan);
    text-decoration: none;
    padding: 0.75rem 0;
    font-size: 1rem;
    border-bottom: 1px solid rgba(109, 41, 50, 0.3);
    transition: color 0.2s;
  }

  .mobile-link:hover {
    color: var(--color-cream);
  }

  .mobile-cta {
    display: inline-block;
    margin-top: 1rem;
    background: linear-gradient(135deg, var(--color-brown), #7d3340);
    color: var(--color-cream);
    padding: 0.75rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.9375rem;
    font-weight: 700;
    text-decoration: none;
    text-align: center;
  }

  @media (max-width: 768px) {
    .nav-links,
    .nav-cta {
      display: none;
    }

    .nav-hamburger {
      display: flex;
    }

    .mobile-menu {
      display: flex;
    }
  }
</style>
