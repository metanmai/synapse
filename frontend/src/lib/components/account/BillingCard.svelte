<script lang="ts">
import { enhance } from "$app/forms";
import { page } from "$app/stores";

let { billing } = $props<{
  billing: {
    tier: "free" | "plus";
    subscription: {
      status: string;
      current_period_end: string | null;
      cancel_at_period_end: boolean;
    } | null;
  };
}>();

let showUpgradeSuccess = $state($page.url.searchParams.has("upgraded"));
let checkoutLoading = $state(false);
let portalLoading = $state(false);

const renewalDate = $derived(
  billing.subscription?.current_period_end
    ? new Date(billing.subscription.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null,
);
</script>

<div class="glass rounded-xl" style="padding: 2rem;">
  <div class="flex items-center gap-2 mb-2">
    <h3 style="font-size: 18px; font-weight: 700; color: var(--color-accent);">Billing</h3>
    {#if billing.tier === "free"}
      <span style="border-radius: 9999px; padding: 4px 14px; font-size: 12px; font-weight: 600; background-color: var(--color-bg-muted); color: var(--color-text-muted);">
        FREE
      </span>
    {:else}
      <span style="border-radius: 9999px; padding: 4px 14px; font-size: 12px; font-weight: 600; background-color: var(--color-pink); color: white;">
        PLUS
      </span>
    {/if}
  </div>

  {#if showUpgradeSuccess}
    <div
      class="rounded-lg p-3 text-sm mb-3"
      style="background-color: var(--color-success-bg); color: var(--color-success);"
    >
      Welcome to Plus! Your upgrade is active.
    </div>
  {/if}

  {#if billing.tier === "free"}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      You're on the <strong>Free</strong> plan. Upgrade to Plus for 500 files, unlimited
      connections, and version history.
    </p>
    <form method="POST" action="?/checkout" use:enhance={() => {
      checkoutLoading = true;
      return async ({ update }) => {
        checkoutLoading = false;
        await update();
      };
    }}>
      <button type="submit" disabled={checkoutLoading} class="btn-primary cursor-pointer">
        {#if checkoutLoading}
          <span class="flex items-center justify-center gap-2">
            <span class="spinner spinner-sm spinner-white"></span>
            Redirecting...
          </span>
        {:else}
          Upgrade to Plus — $5.99/mo
        {/if}
      </button>
    </form>
  {:else if billing.subscription?.cancel_at_period_end}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Your Plus subscription is active until <strong>{renewalDate}</strong>. It will not renew.
    </p>
    <form method="POST" action="?/portal" use:enhance={() => {
      portalLoading = true;
      return async ({ update }) => {
        portalLoading = false;
        await update();
      };
    }}>
      <button type="submit" disabled={portalLoading} class="btn-secondary cursor-pointer">
        {#if portalLoading}
          <span class="flex items-center justify-center gap-2">
            <span class="spinner spinner-sm"></span>
            Redirecting...
          </span>
        {:else}
          Manage Subscription
        {/if}
      </button>
    </form>
  {:else}
    <p class="text-sm mb-3" style="color: var(--color-text-muted);">
      Plus plan — renews <strong>{renewalDate}</strong>.
    </p>
    <form method="POST" action="?/portal" use:enhance={() => {
      portalLoading = true;
      return async ({ update }) => {
        portalLoading = false;
        await update();
      };
    }}>
      <button type="submit" disabled={portalLoading} class="btn-secondary cursor-pointer">
        {#if portalLoading}
          <span class="flex items-center justify-center gap-2">
            <span class="spinner spinner-sm"></span>
            Redirecting...
          </span>
        {:else}
          Manage Subscription
        {/if}
      </button>
    </form>
  {/if}
</div>
