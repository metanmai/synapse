<script lang="ts">
import { navigating } from "$app/stores";

$effect(() => {
  if ($navigating) {
    document.body.classList.add("navigating");
  } else {
    document.body.classList.remove("navigating");
  }
});
</script>

{#if $navigating}
  <div class="nav-progress">
    <div class="nav-progress-bar"></div>
  </div>
{/if}

<style>
  :global(body.navigating) {
    cursor: progress !important;
  }

  :global(body.navigating *) {
    cursor: progress !important;
  }

  .nav-progress {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    z-index: 9999;
    overflow: hidden;
  }

  .nav-progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #e8a04e, #d4782f, #e8a04e);
    background-size: 200% 100%;
    animation: progress-slide 1.5s ease-in-out infinite, progress-grow 0.8s ease-out forwards;
    border-radius: 0 2px 2px 0;
    box-shadow: 0 0 8px rgba(212, 120, 47, 0.4);
  }

  @keyframes progress-slide {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @keyframes progress-grow {
    0% { width: 0%; }
    20% { width: 30%; }
    50% { width: 60%; }
    80% { width: 85%; }
    100% { width: 92%; }
  }
</style>
