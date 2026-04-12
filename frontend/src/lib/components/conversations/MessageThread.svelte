<script lang="ts">
import type { ConversationMessage } from "$lib/types";

let { messages, showTools = false } = $props<{
  messages: ConversationMessage[];
  showTools?: boolean;
}>();

const agentColors: Record<string, string> = {
  "claude-code": "#ea580c",
  claude: "#ea580c",
  chatgpt: "#16a34a",
  gpt: "#16a34a",
  gemini: "#2563eb",
};

function getAgentColor(agent: string): string {
  const lower = agent.toLowerCase();
  for (const [key, color] of Object.entries(agentColors)) {
    if (lower.includes(key)) return color;
  }
  return "#6b7280";
}

const roleLabels: Record<string, { label: string; color: string }> = {
  user: { label: "User", color: "var(--color-accent)" },
  assistant: { label: "Assistant", color: "#ea580c" },
  system: { label: "System", color: "#6b7280" },
  tool: { label: "Tool", color: "#9333ea" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function toolSummary(msg: ConversationMessage): string {
  if (!msg.tool_interaction) return "";
  return msg.tool_interaction.summary || `Called ${msg.tool_interaction.name}`;
}
</script>

<div class="thread">
  {#each messages as msg (msg.id)}
    {@const roleInfo = roleLabels[msg.role] ?? { label: msg.role, color: "#6b7280" }}
    {@const borderColor = getAgentColor(msg.source_agent)}
    <div class="message" style="border-left-color: {borderColor};">
      <div class="message-header">
        <span class="role-label" style="color: {roleInfo.color};">{roleInfo.label}</span>
        {#if msg.source_agent && msg.source_agent !== "claude-code"}
          <span class="agent-badge">{msg.source_agent}</span>
        {/if}
        {#if msg.source_model}
          <span class="model-tag">{msg.source_model}</span>
        {/if}
        <span class="timestamp">{formatTime(msg.created_at)}</span>
      </div>

      {#if msg.content}
        <pre class="message-content">{msg.content}</pre>
      {/if}

      {#if msg.tool_interaction}
        {#if showTools}
          <div class="tool-detail">
            <div class="tool-header">Tool: {msg.tool_interaction.name}</div>
            {#if msg.tool_interaction.input}
              <div class="tool-section">
                <span class="tool-section-label">Input</span>
                <pre class="tool-json">{JSON.stringify(msg.tool_interaction.input, null, 2)}</pre>
              </div>
            {/if}
            {#if msg.tool_interaction.output}
              <div class="tool-section">
                <span class="tool-section-label">Output</span>
                <pre class="tool-json">{msg.tool_interaction.output}</pre>
              </div>
            {/if}
          </div>
        {:else}
          <div class="tool-summary">{toolSummary(msg)}</div>
        {/if}
      {/if}

      {#if msg.attachments_summary}
        <div class="attachments-note">{msg.attachments_summary}</div>
      {/if}
    </div>
  {/each}

  {#if messages.length === 0}
    <div class="empty-state">No messages in this conversation.</div>
  {/if}
</div>

<style>
  .thread {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .message {
    padding: 0.875rem 1rem;
    border-radius: var(--radius-sm);
    background-color: var(--color-bg-raised);
    border: 1px solid var(--color-border);
    border-left: 4px solid #6b7280;
    transition: var(--transition-base);
  }

  .message:hover {
    box-shadow: var(--shadow-sm);
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .role-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .agent-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--color-text-muted);
    background: var(--color-bg-muted);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--color-border);
  }

  .model-tag {
    font-size: 0.625rem;
    color: var(--color-text-muted);
    font-family: monospace;
  }

  .timestamp {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .message-content {
    font-size: 0.875rem;
    line-height: 1.65;
    color: var(--color-text);
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: inherit;
    margin: 0;
    background: none;
    border: none;
    padding: 0;
  }

  .tool-summary {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    background: var(--color-bg-muted);
    padding: 4px 10px;
    border-radius: 8px;
    margin-top: 0.5rem;
    font-style: italic;
  }

  .tool-detail {
    margin-top: 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .tool-header {
    font-size: 0.75rem;
    font-weight: 700;
    color: #9333ea;
    padding: 6px 10px;
    background: rgba(147, 51, 234, 0.06);
    border-bottom: 1px solid var(--color-border);
  }

  .tool-section {
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
  }

  .tool-section:last-child {
    border-bottom: none;
  }

  .tool-section-label {
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-muted);
    display: block;
    margin-bottom: 4px;
  }

  .tool-json {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-text);
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: "SF Mono", "Fira Code", "Fira Mono", monospace;
    margin: 0;
    background: rgba(86, 28, 36, 0.03);
    padding: 6px 8px;
    border-radius: 6px;
    max-height: 300px;
    overflow-y: auto;
  }

  .attachments-note {
    font-size: 0.6875rem;
    color: var(--color-text-muted);
    margin-top: 0.375rem;
    font-style: italic;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }
</style>
