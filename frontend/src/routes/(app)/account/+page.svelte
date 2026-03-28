<script>
  import ApiKeysCard from "$lib/components/account/ApiKeysCard.svelte";
  import ConnectedAccounts from "$lib/components/account/ConnectedAccounts.svelte";
  import BillingCard from "$lib/components/account/BillingCard.svelte";

  let { data, form } = $props();
</script>

<div class="max-w-2xl mx-auto p-8">
  <h1 class="text-2xl font-semibold mb-6" style="color: var(--color-accent);">Account</h1>
  <div class="mb-4 text-sm" style="color: var(--color-text-muted);">
    Signed in as {data.user.email}
  </div>
  <div class="space-y-6">
    <BillingCard billing={data.billing} />
    <ApiKeysCard keys={data.keys} newKey={form?.newKey} keyError={form?.keyError} />
    <ConnectedAccounts />
  </div>
</div>
