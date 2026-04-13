<script lang="ts">
import ApiKeysCard from "$lib/components/account/ApiKeysCard.svelte";
import BillingCard from "$lib/components/account/BillingCard.svelte";
import ConnectedAccounts from "$lib/components/account/ConnectedAccounts.svelte";
import DangerZone from "$lib/components/account/DangerZone.svelte";

let { data, form } = $props();

// Action results are a discriminated union — cast to access fields from different actions safely
const f = $derived(form as Record<string, unknown> | null);
</script>

<div class="max-w-2xl mx-auto p-10">
  <h1 class="text-2xl font-bold mb-6" style="color: var(--color-accent); letter-spacing: -0.02em;">Account</h1>
  <div class="mb-4 text-sm" style="color: var(--color-text-muted);">
    Signed in as {data.user.email}
  </div>
  <div class="space-y-6">
    <BillingCard billing={data.billing} />
    <ApiKeysCard keys={data.keys} newKey={form?.newKey} keyError={form?.keyError} />
    <ConnectedAccounts providers={data.user.providers} />
    <DangerZone
      email={data.user.email}
      resetSuccess={f?.resetSuccess as boolean | undefined}
      resetError={f?.resetError as string | undefined}
      deleteError={f?.deleteError as string | undefined}
    />
  </div>
</div>
