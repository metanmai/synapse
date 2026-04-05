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

    <div class="nav-actions">
      <a
        href="https://github.com/metanmai/synapse"
        target="_blank"
        rel="noopener noreferrer"
        class="nav-github"
        aria-label="Synapse on GitHub"
      >
        <svg class="nav-github-svg" viewBox="0 0 98 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path
            fill="currentColor"
            fill-rule="evenodd"
            clip-rule="evenodd"
            d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.245-22.239-5.468-22.239-24.28 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
          />
        </svg>
      </a>
      {#if loggedIn}
        <a href="/dashboard" class="nav-cta">Go to Dashboard</a>
      {:else}
        <a href="/signup" class="nav-cta">Get Started Free</a>
      {/if}
    </div>

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

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  /* Icon-only link: same color / motion language as .nav-link (tan → cream), no extra chrome */
  .nav-github {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    margin: -0.375rem;
    border-radius: 8px;
    color: var(--color-tan);
    text-decoration: none;
    transition: color 0.2s, opacity 0.2s;
  }

  .nav-github:hover {
    color: var(--color-cream);
  }

  .nav-github:focus-visible {
    outline: 2px solid var(--color-cream);
    outline-offset: 2px;
  }

  .nav-github-svg {
    width: 1.375rem;
    height: 1.375rem;
    display: block;
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
    .nav-links {
      display: none;
    }

    .nav-actions .nav-cta {
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
