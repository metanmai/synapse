<script lang="ts">
import { onMount } from "svelte";

let {
  children,
  threshold = 0.15,
  delay = 0,
  direction = "up",
} = $props<{
  children: import("svelte").Snippet;
  threshold?: number;
  delay?: number;
  direction?: "up" | "down" | "left" | "right" | "none";
}>();

let element: HTMLDivElement;
let visible = $state(false);

onMount(() => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        visible = true;
        observer.unobserve(element);
      }
    },
    { threshold },
  );
  observer.observe(element);
  return () => observer.disconnect();
});

const transforms: Record<string, string> = {
  up: "translateY(40px)",
  down: "translateY(-40px)",
  left: "translateX(40px)",
  right: "translateX(-40px)",
  none: "none",
};
</script>

<div
  bind:this={element}
  class="scroll-reveal"
  class:visible
  style="--sr-delay: {delay}ms; --sr-transform: {transforms[direction]};"
>
  {@render children()}
</div>

<style>
  .scroll-reveal {
    opacity: 0;
    transform: var(--sr-transform, translateY(40px));
    transition: opacity 0.7s ease-out, transform 0.7s ease-out;
    transition-delay: var(--sr-delay, 0ms);
  }

  .scroll-reveal.visible {
    opacity: 1;
    transform: none;
  }
</style>
