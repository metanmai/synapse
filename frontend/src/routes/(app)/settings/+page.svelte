<script lang="ts">
import { enhance } from "$app/forms";
import { page } from "$app/stores";

let { data, form } = $props();

let showCreateForm = $state(false);
let createLoading = $state(false);
let checkoutLoading = $state(false);
let portalLoading = $state(false);

const projectLimit = $derived(data.tier === "free" ? 5 : 50);
const usagePercent = $derived(Math.min(100, Math.round((data.projectCount / projectLimit) * 100)));
const showUpgradeSuccess = $state($page.url.searchParams.has("upgraded"));

const renewalDate = $derived(
  data.subscription?.current_period_end
    ? new Date(data.subscription.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null,
);

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
</script>

<svelte:head>
  <title>Settings - Synapse</title>
</svelte:head>

<div class="settings-page">
  <h1 class="page-title">Settings</h1>

  <!-- Plan Section -->
  <section class="glass section">
    <div class="section-header">
      <h2 class="section-title">Plan</h2>
      {#if data.tier === "free"}
        <span class="tier-badge tier-free">FREE</span>
      {:else}
        <span class="tier-badge tier-plus">PLUS</span>
      {/if}
    </div>

    {#if showUpgradeSuccess}
      <div class="success-banner">
        Welcome to Plus! Your upgrade is active.
      </div>
    {/if}

    <div class="usage-section">
      <div class="usage-label">
        <span>Projects</span>
        <span class="usage-count">{data.projectCount} / {projectLimit}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: {usagePercent}%;"></div>
      </div>
    </div>

    {#if data.tier === "free" && !showUpgradeSuccess}
      <p class="plan-desc">
        You're on the <strong>Free</strong> plan. Upgrade to Plus for AI-generated project
        context, unlimited team members per project, link-based sharing, and version history.
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
            <span class="btn-loading">
              <span class="spinner spinner-sm spinner-white"></span>
              Redirecting...
            </span>
          {:else}
            Upgrade to Plus — $5.99/mo
          {/if}
        </button>
      </form>
    {:else if data.subscription?.cancel_at_period_end}
      <p class="plan-desc">
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
            <span class="btn-loading">
              <span class="spinner spinner-sm"></span>
              Redirecting...
            </span>
          {:else}
            Manage Subscription
          {/if}
        </button>
      </form>
    {:else if data.tier === "plus"}
      <p class="plan-desc">
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
            <span class="btn-loading">
              <span class="spinner spinner-sm"></span>
              Redirecting...
            </span>
          {:else}
            Manage Subscription
          {/if}
        </button>
      </form>
    {/if}
  </section>

  <!-- API Keys Section -->
  <section class="glass section">
    <div class="section-header">
      <h2 class="section-title">API Keys</h2>
      <button
        type="button"
        class="btn-primary cursor-pointer"
        style="font-size: 13px; padding: 8px 20px;"
        onclick={() => (showCreateForm = !showCreateForm)}
      >
        {showCreateForm ? "Cancel" : "New Key"}
      </button>
    </div>

    <p class="section-desc">
      Use API keys to connect Claude Code, Cursor, or other AI tools to Synapse.
    </p>

    {#if form?.error}
      <div class="error-msg" role="alert">{form.error}</div>
    {/if}

    {#if form?.newKey}
      <div class="new-key-banner">
        <p class="new-key-title">Key created: {form.label}</p>
        <code class="new-key-value">{form.newKey}</code>
        <p class="new-key-warning">
          Copy this key now — it won't be shown again.
        </p>
      </div>
    {/if}

    {#if showCreateForm}
      <form
        method="POST"
        action="?/createKey"
        use:enhance={() => {
          createLoading = true;
          return async ({ update }) => {
            createLoading = false;
            showCreateForm = false;
            await update();
          };
        }}
        class="create-form"
      >
        <label for="key-label" class="form-label">Label</label>
        <input
          id="key-label"
          name="label"
          type="text"
          required
          autofocus
          placeholder="e.g. MacBook Pro, CI server"
          class="form-input"
        />
        <button type="submit" disabled={createLoading} class="btn-primary cursor-pointer" style="margin-top: 0.75rem;">
          {#if createLoading}
            <span class="btn-loading">
              <span class="spinner spinner-sm spinner-white"></span>
              Creating...
            </span>
          {:else}
            Create Key
          {/if}
        </button>
      </form>
    {/if}

    {#if data.apiKeys.length === 0}
      <p class="empty-text">No API keys yet. Create one to connect your tools.</p>
    {:else}
      <div class="key-list">
        {#each data.apiKeys as key, i (key.id)}
          <div class="key-row" class:key-row-alt={i % 2 === 0}>
            <div class="key-info">
              <div class="key-label">{key.label}</div>
              <div class="key-meta">
                <span class="key-status">Active</span>
                &middot; Created {formatDate(key.created_at)}
                {#if key.last_used_at}
                  &middot; Last used {formatDate(key.last_used_at)}
                {/if}
              </div>
            </div>
            <form method="POST" action="?/revokeKey" use:enhance>
              <input type="hidden" name="keyId" value={key.id} />
              <button type="submit" class="revoke-btn cursor-pointer">
                Revoke
              </button>
            </form>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .settings-page {
    max-width: 640px;
    margin: 0 auto;
    padding: 2rem;
  }

  .page-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-accent);
    margin-bottom: 1.5rem;
  }

  .section {
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .section-title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--color-accent);
  }

  .tier-badge {
    border-radius: 9999px;
    padding: 4px 14px;
    font-size: 12px;
    font-weight: 600;
  }

  .tier-free {
    background-color: var(--color-bg-muted);
    color: var(--color-text-muted);
  }

  .tier-plus {
    background-color: var(--color-pink);
    color: white;
  }

  .usage-section {
    margin-bottom: 1rem;
  }

  .usage-label {
    display: flex;
    justify-content: space-between;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    margin-bottom: 0.375rem;
  }

  .usage-count {
    font-weight: 600;
    color: var(--color-accent);
  }

  .progress-track {
    height: 6px;
    border-radius: 3px;
    background: var(--color-bg-muted);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--color-pink-dark), var(--color-pink));
    transition: width 300ms ease;
  }

  .plan-desc {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    margin-bottom: 1rem;
    line-height: 1.5;
  }

  .success-banner {
    font-size: 0.875rem;
    padding: 10px 14px;
    border-radius: 10px;
    background-color: var(--color-success-bg);
    color: var(--color-success);
    margin-bottom: 1rem;
  }

  .section-desc {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    margin-bottom: 1rem;
  }

  .error-msg {
    font-size: 0.8125rem;
    color: var(--color-danger);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(139, 0, 0, 0.2);
    background: rgba(139, 0, 0, 0.06);
    margin-bottom: 1rem;
  }

  .new-key-banner {
    padding: 1rem;
    border-radius: 12px;
    background-color: var(--color-bg-muted);
    border: 1px solid var(--color-border);
    margin-bottom: 1rem;
  }

  .new-key-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 0.5rem;
  }

  .new-key-value {
    display: block;
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--color-pink);
    word-break: break-all;
    margin-bottom: 0.5rem;
  }

  .new-key-warning {
    font-size: 0.75rem;
    color: var(--color-link);
  }

  .create-form {
    padding: 1rem;
    border-radius: 12px;
    background-color: var(--color-bg-muted);
    border: 1px solid var(--color-border);
    margin-bottom: 1rem;
  }

  .form-label {
    display: block;
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    margin-bottom: 0.375rem;
  }

  .form-input {
    width: 100%;
    font-size: 0.875rem;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
    color: var(--color-text);
    outline: none;
    transition: var(--transition-base);
    box-sizing: border-box;
  }

  .form-input:focus {
    border-color: var(--color-pink);
    box-shadow: 0 0 0 2px rgba(86, 28, 36, 0.08);
  }

  .empty-text {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .key-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
  }

  .key-row-alt {
    background: rgba(86, 28, 36, 0.02);
  }

  .key-info {
    flex: 1;
    min-width: 0;
  }

  .key-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .key-meta {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 2px;
  }

  .key-status {
    color: var(--color-success);
    font-weight: 500;
  }

  .revoke-btn {
    margin-left: 0.75rem;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-danger);
    background: transparent;
    border: 1px solid var(--color-danger);
    border-radius: 9999px;
    padding: 4px 12px;
    transition: var(--transition-base);
    white-space: nowrap;
  }

  .revoke-btn:hover {
    background: rgba(139, 0, 0, 0.06);
  }

  .btn-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
</style>
