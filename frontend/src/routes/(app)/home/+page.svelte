<script lang="ts">
import { enhance } from "$app/forms";
import type { Project } from "$lib/types";

let { data, form } = $props();

let showForm = $state(false);
let creating = $state(false);

function projectSlug(p: Project): string {
  return p.role === "owner" ? p.name : `${p.owner_email}~${p.name}`;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const toolColors: Record<string, string> = {
  "claude-code": "#561c24",
  cursor: "#2563eb",
  gemini: "#16a34a",
  chatgpt: "#0d9488",
  "claude.ai": "#8b4550",
};

function toolColor(tool: string): string {
  return toolColors[tool] ?? "#8a7565";
}

// Phase 03-02: both tiers cap at 50 projects. Differentiation moved to
// per-project capacity and auto-sync, not project count.
const projectLimit = 50;

const countTooltip = $derived(
  `${data.tier === "free" ? "Free" : "Plus"} tier supports up to ${projectLimit} projects.`,
);

function handleSubmit() {
  creating = true;
  return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
    creating = false;
    if (result.type === "success") {
      showForm = false;
    }
    await update();
  };
}
</script>

<svelte:head>
  <title>Home - Synapse</title>
</svelte:head>

<div class="home-page">
  <div class="header">
    <div class="title-row">
      <h1 class="title">Your Projects</h1>
      {#if data.projects.length > 0}
        {#if data.tier === "free"}
          <a href="/account" class="count-pill count-pill-link" title={countTooltip} aria-label={countTooltip}>
            <span class="count-text">{data.projects.length} / {projectLimit}</span>
            <span class="info-icon" aria-hidden="true">ⓘ</span>
          </a>
        {:else}
          <span class="count-pill" title={countTooltip}>
            <span class="count-text">{data.projects.length} / {projectLimit}</span>
            <span class="info-icon" aria-hidden="true">ⓘ</span>
          </span>
        {/if}
      {/if}
    </div>
    <button class="new-project-btn cursor-pointer" onclick={() => (showForm = !showForm)}>
      {showForm ? "Cancel" : "+ New Project"}
    </button>
  </div>

  {#if showForm}
    <div class="form-card">
      <form method="POST" action="?/createProject" use:enhance={handleSubmit}>
        <div class="form-row">
          <input
            name="name"
            type="text"
            class="form-input"
            placeholder="Project name"
            required
            autofocus
          />
          <button type="submit" class="create-btn cursor-pointer" disabled={creating}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if form?.error}
    <div class="error-msg" role="alert">{form.error}</div>
  {/if}

  {#if form?.created}
    <div class="success-msg" role="status">Project created.</div>
  {/if}

  {#if data.projects.length === 0}
    <div class="empty-state">
      <p class="empty-title">No projects yet</p>
      <p class="empty-desc">
        Create your first project to start capturing AI sessions and building your knowledge base.
      </p>
    </div>
  {:else}
    <div class="project-grid">
      {#each data.projects as project}
        <a
          href="/projects/{encodeURIComponent(projectSlug(project))}"
          class="project-card"
        >
          <div class="card-header">
            <span class="project-name">{project.name}</span>
            <span class="project-time">{relativeTime(project.created_at)}</span>
          </div>
          <div class="card-stats">
            {project.conversation_count ?? 0} conversations &middot; {project.insight_count ?? 0} insights
          </div>
          {#if project.tools && project.tools.length > 0}
            <div class="card-tools">
              {#each project.tools as tool}
                <span class="tool-badge" style="background: {toolColor(tool)};">
                  {tool}
                </span>
              {/each}
            </div>
          {/if}
        </a>
      {/each}
    </div>
  {/if}

</div>

<style>
  .home-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
    gap: 1rem;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--color-accent);
  }

  .count-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 2px 10px;
    border-radius: 9999px;
    background: rgba(86, 28, 36, 0.06);
    color: var(--color-text-muted);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.6;
    text-decoration: none;
    transition: var(--transition-base);
  }

  .count-pill-link {
    cursor: pointer;
  }

  .count-pill-link:hover {
    background: rgba(86, 28, 36, 0.12);
    color: var(--color-accent);
  }

  .count-text {
    font-variant-numeric: tabular-nums;
  }

  .info-icon {
    font-size: 0.8rem;
    opacity: 0.6;
    line-height: 1;
  }

  .count-pill-link:hover .info-icon {
    opacity: 1;
  }

  .new-project-btn {
    font-size: 0.8125rem;
    font-weight: 600;
    color: white;
    padding: 8px 20px;
    border-radius: 9999px;
    border: none;
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    transition: var(--transition-base);
  }

  .new-project-btn:hover {
    transform: scale(1.03);
    box-shadow: 0 8px 32px rgba(109, 41, 50, 0.35);
  }

  .form-card {
    background: rgba(255, 253, 248, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    box-shadow: var(--shadow-sm);
    padding: 1.25rem;
    margin-bottom: 1.5rem;
  }

  .form-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .form-input {
    flex: 1;
    font-size: 0.875rem;
    padding: 10px 14px;
    border-radius: 10px;
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

  .create-btn {
    font-size: 0.8125rem;
    font-weight: 600;
    color: white;
    padding: 10px 24px;
    border-radius: 9999px;
    border: none;
    background: linear-gradient(135deg, var(--color-pink-dark), var(--color-pink));
    transition: var(--transition-base);
    white-space: nowrap;
  }

  .create-btn:hover {
    transform: scale(1.03);
    box-shadow: 0 8px 32px rgba(109, 41, 50, 0.35);
  }

  .create-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none !important;
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

  .success-msg {
    font-size: 0.8125rem;
    color: var(--color-success);
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--color-success-bg);
    margin-bottom: 1rem;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
  }

  .empty-title {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .empty-desc {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    max-width: 400px;
    margin: 0 auto;
    line-height: 1.6;
  }

  .project-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .project-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.25rem;
    background: rgba(255, 253, 248, 0.7);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    box-shadow: var(--shadow-sm);
    text-decoration: none;
    color: inherit;
    transition: var(--transition-base);
  }

  .project-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
    border-color: var(--color-pink);
  }

  .card-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .project-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-accent);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .project-time {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .card-stats {
    font-size: 0.8125rem;
    color: var(--color-text-muted);
  }

  .card-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    margin-top: 0.25rem;
  }

  .tool-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    color: white;
    padding: 2px 8px;
    border-radius: 9999px;
    white-space: nowrap;
  }

</style>
