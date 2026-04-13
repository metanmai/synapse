<script lang="ts">
import { buildFeedEvent, groupByDay } from "$lib/components/activity/activity-helpers";

let { data } = $props();

const feed = $derived(data.activity.map(buildFeedEvent));
const dayGroups = $derived(groupByDay(feed));
</script>

<div class="feed-container">
  <h1 class="feed-title">Activity — {data.project.name}</h1>

  {#if dayGroups.length === 0}
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <p class="empty-title">No activity yet</p>
      <p class="empty-desc">
        Run <code>npx synapsesync-mcp capture start</code> to begin capturing sessions.
        Activity will appear here as sessions are captured and knowledge is extracted.
      </p>
    </div>
  {:else}
    {#each dayGroups as group}
      <div class="day-group">
        <div class="day-header">{group.label}</div>
        {#each group.events as event}
          <div class="event-card">
            <div class="event-header">
              <div class="event-header-left">
                <span class="event-badge {event.badgeClass}">{event.badge}</span>
                <span class="event-time">
                  {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
            <div class="event-title">{event.title}</div>
            <div class="event-metadata">{event.metadata}</div>
            {#if event.files && event.files.length > 0}
              <div class="event-files">
                {#each event.files as file}
                  <div class="event-file">
                    <span class="file-path">{file.path}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>

<style>
  .feed-container {
    max-width: 680px;
    padding: 1.5rem;
  }

  .feed-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 1.5rem;
  }

  .day-group {
    margin-bottom: 1.5rem;
  }

  .day-header {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    padding-bottom: 0.75rem;
  }

  .event-card {
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 0.875rem;
    margin-bottom: 0.625rem;
    transition: box-shadow 0.15s ease;
  }

  .event-card:hover {
    box-shadow: 0 4px 16px rgba(86, 28, 36, 0.06);
  }

  .event-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .event-header-left {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .event-badge {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.04em;
  }

  .badge-captured {
    background: rgba(200, 160, 106, 0.3);
    color: #8b6914;
  }

  .badge-distilled {
    background: #561c24;
    color: white;
  }

  .badge-updated {
    background: rgba(199, 183, 163, 0.3);
    color: var(--color-text-muted);
  }

  .event-time {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .event-title {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text);
    margin-bottom: 0.25rem;
  }

  .event-metadata {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .event-files {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin-top: 0.625rem;
  }

  .event-file {
    font-size: 0.6875rem;
    padding: 0.375rem 0.625rem;
    background: rgba(86, 28, 36, 0.04);
    border: 1px solid rgba(199, 183, 163, 0.25);
    border-radius: 6px;
  }

  .file-path {
    font-weight: 600;
    color: var(--color-accent);
    font-family: monospace;
  }

  .empty-state {
    text-align: center;
    padding: 4rem 1rem;
  }

  .empty-icon {
    font-size: 2.5rem;
    margin-bottom: 1rem;
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
