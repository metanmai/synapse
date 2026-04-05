<script>
let { children } = $props();
</script>

<svelte:head>
  <title>Synapse — Shared AI context across tools, devices & teams</title>
  <meta name="description" content="Synapse saves AI context in one cloud workspace so you can use it across Claude, ChatGPT, Cursor, and other tools, on any device, with teammates — same memory everywhere." />
  {@html `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Synapse",
  "url": "https://synapsesync.app",
  "description": "Shared AI context in one cloud workspace: use it across tools (Claude, ChatGPT, Cursor, MCP clients), devices, and teammates.",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Web",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD",
    "description": "Free tier with 50 files, 3 connections"
  }
}
</script>`}
</svelte:head>

<div class="landing">
  <!-- Grain texture overlay -->
  <div class="grain-overlay" aria-hidden="true"></div>
  {@render children()}
</div>

<style>
  .landing {
    /* Tiramisu palette — scoped to the landing page */
    --color-burgundy: #561C24;
    --color-brown: #6D2932;
    --color-tan: #C7B7A3;
    --color-cream: #E8D8C4;
    --color-white: #FFFDF8;

    /* Glassmorphism tokens */
    --glass-bg: rgba(255, 253, 248, 0.6);
    --glass-border: rgba(199, 183, 163, 0.3);
    --glass-blur: 20px;
    --glass-shadow: 0 8px 32px rgba(86, 28, 36, 0.08);

    font-family: 'Lato', sans-serif;
    color: var(--color-burgundy);
    background-color: var(--color-cream);
    overflow-x: hidden;
    position: relative;
  }

  /* Grain noise overlay */
  .grain-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    opacity: 0.035;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 256px 256px;
  }

  /* Override Tailwind/global body font within this layout */
  :global(.landing *) {
    font-family: 'Lato', sans-serif;
  }

  /* Smooth scrolling for anchor links */
  :global(html) {
    scroll-behavior: smooth;
  }

  /* Ensure images don't overflow on mobile */
  .landing :global(img) {
    max-width: 100%;
    height: auto;
  }

  /* Floating orb keyframes available to all children */
  @keyframes -global-float-orb {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(30px, -20px) scale(1.05); }
    50% { transform: translate(-20px, 15px) scale(0.95); }
    75% { transform: translate(15px, 25px) scale(1.02); }
  }

  @keyframes -global-float-orb-reverse {
    0%, 100% { transform: translate(0, 0) scale(1); }
    25% { transform: translate(-25px, 20px) scale(0.97); }
    50% { transform: translate(20px, -15px) scale(1.04); }
    75% { transform: translate(-15px, -20px) scale(0.98); }
  }

  @keyframes -global-gradient-shift {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
</style>
