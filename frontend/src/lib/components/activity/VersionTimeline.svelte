<script lang="ts">
import { enhance } from "$app/forms";
import { computeDiff, type DiffLine } from "$lib/diff";
import type { EntryHistory } from "$lib/types";

let { versions, currentContent } = $props<{
  versions: EntryHistory[];
  currentContent?: string;
}>();

let expandedId = $state<string | null>(null);

function toggle(id: string) {
  expandedId = expandedId === id ? null : id;
}

function getDiff(index: number): DiffLine[] {
  // Compare this version against what came after it.
  // Index 0 is the most recent version, so:
  // - version[0] diff = version[0].content vs currentContent (the live entry)
  // - version[N] diff = version[N].content vs version[N-1].content
  const olderContent = versions[index].content;
  const newerContent =
    index === 0
      ? (currentContent ?? versions[index].content)
      : versions[index - 1].content;
  return computeDiff(olderContent, newerContent);
}

function countChanges(diff: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.type === "add") added++;
    if (line.type === "remove") removed++;
  }
  return { added, removed };
}
</script>

<div class="timeline">
  {#each versions as version, index}
    {@const diff = getDiff(index)}
    {@const changes = countChanges(diff)}
    <div class="version-card glass">
      <!-- Header row -->
      <button class="version-header" onclick={() => toggle(version.id)}>
        <div class="version-meta">
          <span class="version-date">{new Date(version.changed_at).toLocaleString()}</span>
          <span class="version-source">{version.source}</span>
          <span class="version-stats">
            {#if changes.added > 0}
              <span class="stat-add">+{changes.added}</span>
            {/if}
            {#if changes.removed > 0}
              <span class="stat-remove">-{changes.removed}</span>
            {/if}
            {#if changes.added === 0 && changes.removed === 0}
              <span class="stat-none">no changes</span>
            {/if}
          </span>
        </div>
        <div class="version-actions">
          <span class="expand-icon" class:expanded={expandedId === version.id}>&#9656;</span>
        </div>
      </button>

      <!-- Expanded diff view -->
      {#if expandedId === version.id}
        <div class="diff-container">
          <div class="diff-toolbar">
            <span class="diff-label">
              Changes from this version → {index === 0 ? "current" : "next version"}
            </span>
            <form method="POST" action="?/restore" use:enhance>
              <input type="hidden" name="historyId" value={version.id} />
              <button type="submit" class="restore-btn">Restore this version</button>
            </form>
          </div>
          <div class="diff-view">
            {#each diff as line, lineNum}
              <div class="diff-line" class:diff-add={line.type === "add"}
                class:diff-remove={line.type === "remove"}
                class:diff-same={line.type === "same"}>
                <span class="line-num">{lineNum + 1}</span>
                <span class="line-sign">
                  {#if line.type === "add"}+{:else if line.type === "remove"}-{:else}&nbsp;{/if}
                </span>
                <span class="line-text">{line.text || " "}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/each}
  {#if versions.length === 0}
    <p class="empty">No version history yet</p>
  {/if}
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .version-card {
    overflow: hidden;
  }

  .version-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 1rem 1.25rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }

  .version-header:hover {
    background: rgba(86, 28, 36, 0.03);
  }

  .version-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .version-date {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text);
  }

  .version-source {
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 0.125rem 0.625rem;
    border-radius: 9999px;
    background: var(--color-pink);
    color: white;
  }

  .version-stats {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-weight: 600;
  }

  .stat-add {
    color: #2d6b22;
  }

  .stat-remove {
    color: #b91c1c;
  }

  .stat-none {
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .expand-icon {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    transition: transform 0.2s;
    display: inline-block;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  /* Diff container */
  .diff-container {
    border-top: 1px solid var(--color-border);
  }

  .diff-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.625rem 1.25rem;
    background: rgba(86, 28, 36, 0.03);
    border-bottom: 1px solid var(--color-border);
  }

  .diff-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .restore-btn {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-link);
    background: none;
    border: 1px solid var(--color-pink);
    border-radius: 9999px;
    padding: 0.25rem 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .restore-btn:hover {
    background: rgba(86, 28, 36, 0.06);
  }

  /* Diff lines */
  .diff-view {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.75rem;
    line-height: 1.7;
    overflow-x: auto;
    max-height: 500px;
    overflow-y: auto;
  }

  .diff-line {
    display: flex;
    padding: 0 1.25rem 0 0;
    min-height: 1.7em;
  }

  .diff-add {
    background: rgba(45, 107, 34, 0.08);
  }

  .diff-remove {
    background: rgba(185, 28, 28, 0.08);
  }

  .diff-same {
    background: transparent;
  }

  .line-num {
    width: 3.5rem;
    text-align: right;
    padding-right: 0.75rem;
    color: var(--color-text-muted);
    opacity: 0.5;
    user-select: none;
    flex-shrink: 0;
  }

  .line-sign {
    width: 1.5rem;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    font-weight: 700;
  }

  .diff-add .line-sign {
    color: #2d6b22;
  }

  .diff-remove .line-sign {
    color: #b91c1c;
  }

  .diff-same .line-sign {
    color: transparent;
  }

  .line-text {
    white-space: pre;
    flex: 1;
    min-width: 0;
  }

  .empty {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    text-align: center;
    padding: 2rem;
  }
</style>
