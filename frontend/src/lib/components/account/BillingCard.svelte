<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/stores";

  let { billing } = $props<{
    billing: {
      tier: "free" | "pro";
      subscription: {
        status: string;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
      } | null;
    };
  }>();

  let showUpgradeSuccess = $state($page.url.searchParams.has("upgraded"));

  const renewalDate = $derived(
    billing.subscription?.current_period_end
      ? new Date(billing.subscription.current_period_end).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : null
  );
</script>

<div
  class="p-4 rounded-xl"
  style="background-color: var(--color-bg-raised); border: 1px solid var(--color-border);"
>
  <div class="flex items-center gap-2 mb-2">
    <h3 class="font-medium" style="color: var(--color-accent);">Subscription</h3>
    {#if billing.tier === "pro"}
      <span
        class="text-xs font-semibold px-2 py-0.5 rounded-full"
        style="background-color: var(--color-pink); color: white;"
      >
        PRO
      </span>
    {/if}
  </div>

  {#if showUpgradeSuccess}
    <div
      class="rounded-lg p-3 text-sm mb-3"
      style="background-color: var(--color-success-bg); color: var(--color-success);"
    >
      Welcome to Pro! Your upgrade is active.
    </div>
  {/if}

  {#if billing.tier === "free"}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      You're on the <strong>Free</strong> plan. Upgrade to Pro for 500 files, unlimited
      connections, and version history.
    </p>
    <form method="POST" action="?/checkout" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-4 py-2 text-sm font-medium cursor-pointer"
        style="background-color: var(--color-pink); color: white; border: none;"
      >
        Upgrade to Pro — $5.99/mo
      </button>
    </form>
  {:else if billing.subscription?.cancel_at_period_end}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Your Pro subscription is active until <strong>{renewalDate}</strong>. It will not renew.
    </p>
    <form method="POST" action="?/portal" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      >
        Manage Subscription
      </button>
    </form>
  {:else}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Pro plan — renews <strong>{renewalDate}</strong>.
    </p>
    <form method="POST" action="?/portal" use:enhance>
      <button
        type="submit"
        class="rounded-lg px-3 py-2 text-sm cursor-pointer"
        style="border: 1px solid var(--color-pink); color: var(--color-pink-dark);"
      >
        Manage Subscription
      </button>
    </form>
  {/if}
</div>
