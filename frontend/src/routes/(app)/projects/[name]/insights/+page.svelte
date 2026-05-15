<script lang="ts">
import { enhance } from "$app/forms";
import InsightList from "$lib/components/insights/InsightList.svelte";
import type { InsightType } from "$lib/types";

let { data, form } = $props();

let showForm = $state(false);

const insightTypes: { value: InsightType; label: string }[] = [
  { value: "decision", label: "Decision" },
  { value: "learning", label: "Learning" },
  { value: "preference", label: "Preference" },
  { value: "architecture", label: "Architecture" },
  { value: "action_item", label: "Action Item" },
];

function handleSubmit() {
  return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
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
          <button type="submit" class="submit-btn cursor-pointer">Create Insight</button>
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

  <InsightList insights={data.insights} />
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
</style>
