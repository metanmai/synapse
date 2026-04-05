<script lang="ts">
import { enhance } from "$app/forms";
import InsightList from "$lib/components/insights/InsightList.svelte";
import { getBadgeColor, groupInsightsByType } from "$lib/components/insights/insight-helpers";
import type { InsightType } from "$lib/types";

let { data, form } = $props();

let showForm = $state(false);
let saving = $state(false);

const groups = $derived(groupInsightsByType(data.insights));
let collapsedSections = $state<Set<string>>(new Set());

function toggleSection(type: string) {
  const next = new Set(collapsedSections);
  if (next.has(type)) next.delete(type);
  else next.add(type);
  collapsedSections = next;
}

const insightTypes: { value: InsightType; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "learning", label: "Learning" },
  { value: "preference", label: "Preference" },
  { value: "architecture", label: "Architecture" },
  { value: "action_item", label: "Action Item" },
];

function handleSubmit() {
  saving = true;
  return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
    saving = false;
    if (result.type === "success") {
      showForm = false;
    }
    await update();
  };
}
</script>

<div class="max-w-4xl p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-xl font-semibold" style="color: var(--color-accent);">
      Key Insights
    </h1>
    <button
      onclick={() => (showForm = !showForm)}
      class="add-btn cursor-pointer"
    >
      {showForm ? "Cancel" : "+ Add Insight"}
    </button>
  </div>

  {#if showForm}
    <div class="form-card mb-6">
      <form method="POST" action="?/create" use:enhance={handleSubmit}>
        <input type="hidden" name="projectId" value={data.project.id} />
        <div class="form-grid">
          <div class="form-group">
            <label for="type" class="form-label">Type</label>
            <select id="type" name="type" class="form-input" required>
              {#each insightTypes as t}
                <option value={t.value}>{t.label}</option>
              {/each}
            </select>
          </div>

          <div class="form-group">
            <label for="summary" class="form-label">Summary</label>
            <input
              id="summary"
              name="summary"
              type="text"
              class="form-input"
              placeholder="Brief description of the insight"
              required
            />
          </div>
        </div>

        <div class="form-group mt-3">
          <label for="detail" class="form-label">Detail (optional)</label>
          <textarea
            id="detail"
            name="detail"
            class="form-input"
            rows="3"
            placeholder="Additional context, reasoning, or notes"
          ></textarea>
        </div>

        <div class="flex justify-end mt-4">
          <button type="submit" class="submit-btn cursor-pointer" disabled={saving}>
            {saving ? "Creating..." : "Create Insight"}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if form?.error}
    <div class="error-msg mb-4" role="alert">{form.error}</div>
  {/if}

  {#if form?.created}
    <div class="success-msg mb-4" role="status">Insight created.</div>
  {/if}

  {#if form?.deleted}
    <div class="success-msg mb-4" role="status">Insight deleted.</div>
  {/if}

  {#if data.insights.length === 0}
    <div class="empty-state">
      <p class="empty-title">No insights yet</p>
      <p class="empty-desc">
        Insights are decisions, learnings, and architecture notes extracted from your sessions.
        Run <code>npx synapsesync-mcp distill --latest</code> or add one manually above.
      </p>
    </div>
  {:else}
    {#each groups as group}
      <div class="insight-section">
        <button
          class="section-header cursor-pointer"
          onclick={() => toggleSection(group.type)}
        >
          <div class="section-header-left">
            <span
              class="section-badge"
              style="background: {getBadgeColor(group.type).bg}; color: {getBadgeColor(group.type).text};"
            >
              {group.label}
            </span>
            <span class="section-count">{group.items.length}</span>
          </div>
          <span class="section-chevron">
            {collapsedSections.has(group.type) ? "▶" : "▼"}
          </span>
        </button>
        {#if !collapsedSections.has(group.type)}
          <div class="section-items">
            <InsightList insights={group.items} />
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .add-btn {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-pink-dark);
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-pink);
    background: transparent;
    transition: var(--transition-base);
  }

  .add-btn:hover {
    background: rgba(86, 28, 36, 0.06);
  }

  .form-card {
    padding: 1.25rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
  }

  .form-grid {
    display: grid;
    grid-template-columns: 180px 1fr;
    gap: 0.75rem;
  }

  @media (max-width: 640px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .form-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .form-input {
    font-size: 0.875rem;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--color-border);
    background: var(--color-bg-muted);
    color: var(--color-text);
    outline: none;
    transition: var(--transition-base);
  }

  .form-input:focus {
    border-color: var(--color-pink);
    box-shadow: 0 0 0 2px rgba(86, 28, 36, 0.08);
  }

  textarea.form-input {
    resize: vertical;
    min-height: 60px;
  }

  .submit-btn {
    font-size: 0.8125rem;
    font-weight: 600;
    color: white;
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: var(--color-accent);
    transition: var(--transition-base);
  }

  .submit-btn:hover {
    background: var(--color-accent-hover);
  }

  .error-msg {
    font-size: 0.8125rem;
    color: var(--color-danger);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(139, 0, 0, 0.2);
    background: rgba(139, 0, 0, 0.06);
  }

  .success-msg {
    font-size: 0.8125rem;
    color: var(--color-success);
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--color-success-bg);
  }

  .insight-section {
    margin-bottom: 1.5rem;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0;
    border: none;
    background: none;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  .section-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .section-badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.25rem 0.75rem;
    border-radius: 6px;
  }

  .section-count {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }

  .section-chevron {
    font-size: 0.625rem;
    color: var(--color-text-muted);
  }

  .section-items {
    padding-left: 0;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
  }

  .empty-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .empty-desc {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
    max-width: 400px;
    margin: 0 auto;
    line-height: 1.6;
  }

  .empty-desc code {
    font-size: 0.75rem;
    background: rgba(86, 28, 36, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
  }
</style>
