<script>
  let { children } = $props();
</script>

<svelte:head>
  <title>Synapse — Your AI tools finally remember</title>
  <meta name="description" content="Synapse is a shared context layer that gives Claude, ChatGPT, Cursor, and every AI tool persistent memory across sessions." />
</svelte:head>

<div class="landing">
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

    font-family: 'Lato', sans-serif;
    color: var(--color-burgundy);
    background-color: var(--color-cream);
    overflow-x: hidden;
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
</style>
