<script lang="ts">
import { enhance } from "$app/forms";
import ImportDropzone from "$lib/components/conversations/ImportDropzone.svelte";

let { data, form } = $props();

let messages = $state("");
let format = $state("auto");
let title = $state("");

const formats: { value: string; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "raw", label: "Raw" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
];

function handleFile(content: string) {
  messages = content;
  detectFormat(content);
}

function detectFormat(content: string) {
  try {
    const parsed = JSON.parse(content);

    // If it's an array, check the first element
    const sample = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!sample || typeof sample !== "object") return;

    // Anthropic format: has "role" and "content" where content can be array of blocks
    if (sample.role && Array.isArray(sample.content)) {
      format = "anthropic";
      return;
    }

    // OpenAI format: has "role" and "content" as string, may have "name" or "function_call"
    if (
      sample.role &&
      typeof sample.content === "string" &&
      ("name" in sample || "function_call" in sample || "tool_calls" in sample)
    ) {
      format = "openai";
      return;
    }

    // Both Anthropic and OpenAI have role+content(string), so check for OpenAI-specific "model" wrapper
    if (parsed.model && parsed.messages) {
      format = "openai";
      return;
    }

    // Default: keep auto
    format = "auto";
  } catch {
    // Not valid JSON — keep auto
    format = "auto";
  }
}

function handleTextareaInput(e: Event) {
  const value = (e.target as HTMLTextAreaElement).value;
  messages = value;
  if (value.trim()) detectFormat(value);
}

let hasMessages = $derived(messages.trim().length > 0);
</script>

<div class="max-w-4xl p-6">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-xl font-semibold" style="color: var(--color-accent);">
      Import Conversation
    </h1>
    <a
      href="/projects/{data.project.name}/conversations"
      class="back-link"
    >
      Back to Conversations
    </a>
  </div>

  <div class="mb-6">
    <ImportDropzone onfile={handleFile} />
  </div>

  {#if form?.error}
    <div class="error-msg mb-4">{form.error}</div>
  {/if}

  <div class="form-card">
    <form method="POST" action="?/import" use:enhance>
      <input type="hidden" name="projectId" value={data.project.id} />

      <div class="form-grid">
        <div class="form-group">
          <label for="title" class="form-label">Title (optional)</label>
          <input
            id="title"
            name="title"
            type="text"
            class="form-input"
            placeholder="Give this conversation a name"
            bind:value={title}
          />
        </div>

        <div class="form-group">
          <label for="format" class="form-label">Format</label>
          <select id="format" name="format" class="form-input" bind:value={format}>
            {#each formats as f}
              <option value={f.value}>{f.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="form-group mt-4">
        <label for="messages" class="form-label">Messages (JSON)</label>
        <textarea
          id="messages"
          name="messages"
          class="form-input messages-textarea"
          rows="12"
          placeholder={'[{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi!"}]'}
          value={messages}
          oninput={handleTextareaInput}
        ></textarea>
      </div>

      <div class="flex justify-end mt-4">
        <button type="submit" class="submit-btn cursor-pointer" disabled={!hasMessages}>
          Import Conversation
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .back-link {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-pink-dark);
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid var(--color-pink);
    background: transparent;
    transition: var(--transition-base);
    text-decoration: none;
  }

  .back-link:hover {
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
    grid-template-columns: 1fr 180px;
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

  .messages-textarea {
    resize: vertical;
    min-height: 120px;
    font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
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

  .submit-btn:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .submit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .error-msg {
    font-size: 0.8125rem;
    color: var(--color-danger);
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(139, 0, 0, 0.2);
    background: rgba(139, 0, 0, 0.06);
  }
</style>
