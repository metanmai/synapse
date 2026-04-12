<script lang="ts">
  let mobileOpen = $state(false);
</script>

<nav class="landing-nav">
  <div class="nav-inner">
    <a href="/" class="nav-logo">
      <img src="/logo.svg" alt="" class="nav-logo-img" />
      Synapse
    </a>

    <div class="nav-links">
      <a href="#features" class="nav-link">Features</a>
      <a href="#how-it-works" class="nav-link">How It Works</a>
    </div>

    <a href="/signup" class="nav-cta">Get Started Free</a>

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
      <a href="/signup" class="mobile-cta" onclick={() => mobileOpen = false}>Get Started Free</a>
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
    background-color: var(--color-burgundy);
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
  }

  .nav-link:hover {
    color: var(--color-cream);
  }

  .nav-cta {
    background-color: var(--color-brown);
    color: var(--color-cream);
    padding: 0.625rem 1.5rem;
    border-radius: 9999px;
    font-size: 0.875rem;
    font-weight: 700;
    text-decoration: none;
    transition: transform 0.2s, background-color 0.2s;
  }

  .nav-cta:hover {
    transform: scale(1.05);
    background-color: #7d3340;
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
    background-color: var(--color-burgundy);
    border-top: 1px solid var(--color-brown);
  }

  .mobile-link {
    color: var(--color-tan);
    text-decoration: none;
    padding: 0.75rem 0;
    font-size: 1rem;
    border-bottom: 1px solid var(--color-brown);
  }

  .mobile-cta {
    display: inline-block;
    margin-top: 1rem;
    background-color: var(--color-brown);
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
