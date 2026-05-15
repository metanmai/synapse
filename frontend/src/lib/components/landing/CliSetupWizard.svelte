<script>
import ScrollReveal from "./ScrollReveal.svelte";

const COMMAND = "npx synapsesync-mcp login";

let copied = $state(false);

async function copyCommand() {
  await navigator.clipboard.writeText(COMMAND);
  copied = true;
  setTimeout(() => (copied = false), 2000);
}
</script>

<section class="wizard-section" id="cli-wizard" aria-labelledby="wizard-heading">
  <div class="wizard-inner">
    <ScrollReveal>
      <h2 id="wizard-heading" class="wizard-headline">Guided setup (terminal)</h2>
      <p class="wizard-sub">
        Run <code class="inline-code">login</code>, <code class="inline-code">signup</code>,
        <code class="inline-code">init</code>, or <code class="inline-code">wizard</code> — keyboard-friendly prompts
        then write MCP config for editors you already use.
      </p>
    </ScrollReveal>

    <ScrollReveal delay={80} direction="up">
      <div class="wizard-card">
        <div class="command-row">
          <pre class="command-text"><code>{COMMAND}</code></pre>
          <button type="button" class="copy-btn" onclick={copyCommand}>
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p class="wizard-note">
          Run in a normal terminal from your <strong>project directory</strong> so <code>.mcp.json</code> lands next to
          your code. Your IDE starts the same package without this wizard when it connects MCP (non-interactive).
        </p>
        <ol class="wizard-steps">
          <li>Copy the command and run it in Terminal, iTerm, etc. (from your project folder).</li>
          <li>Use <code class="inline-code">npx synapsesync-mcp --help</code> to see all commands.</li>
          <li>Or run <code class="inline-code">npx synapsesync-mcp wizard</code> for a menu (sign up, log in, API key).</li>
          <li>When it finishes, restart Cursor, Claude Code, or your other MCP host.</li>
        </ol>
        <p class="wizard-alt">
          Other setup commands:
          <code class="inline-code">signup</code>,
          <code class="inline-code">init</code>
        </p>
      </div>
    </ScrollReveal>
  </div>
</section>

<style>
  .wizard-section {
    padding: 4rem 2rem 0;
    background: var(--color-burgundy);
  }

  .wizard-inner {
    max-width: 640px;
    margin: 0 auto;
    text-align: center;
  }

  .wizard-headline {
    font-size: clamp(1.5rem, 3vw, 1.875rem);
    font-weight: 700;
    color: var(--color-cream);
    margin: 0 0 0.5rem;
  }

  .wizard-sub {
    font-size: 1rem;
    color: var(--color-tan);
    margin: 0 0 2rem;
    line-height: 1.55;
    font-weight: 400;
  }

  .wizard-card {
    background: rgba(255, 253, 248, 0.08);
    border: 1px solid rgba(199, 183, 163, 0.2);
    border-radius: 16px;
    padding: 1.5rem 1.5rem 1.25rem;
    text-align: left;
  }

  .command-row {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .command-text {
    flex: 1;
    margin: 0;
    padding: 0.875rem 1rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-cream);
    overflow-x: auto;
  }

  .copy-btn {
    flex-shrink: 0;
    align-self: flex-start;
    padding: 0.5rem 1rem;
    background: rgba(199, 183, 163, 0.35);
    border: 1px solid rgba(199, 183, 163, 0.35);
    border-radius: 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-cream);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.2s;
  }

  .copy-btn:hover {
    background: rgba(199, 183, 163, 0.5);
  }

  .wizard-note {
    font-size: 0.8125rem;
    color: var(--color-tan);
    opacity: 0.88;
    line-height: 1.55;
    margin: 0 0 1rem;
  }

  .wizard-note strong {
    color: var(--color-cream);
    font-weight: 600;
  }

  .wizard-note code {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.78em;
    background: rgba(0, 0, 0, 0.25);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }

  .wizard-steps {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    font-size: 0.875rem;
    color: var(--color-cream);
    line-height: 1.65;
    opacity: 0.92;
  }

  .wizard-alt {
    font-size: 0.75rem;
    color: var(--color-tan);
    opacity: 0.75;
    margin: 0;
  }

  .inline-code {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 0.8em;
    background: rgba(0, 0, 0, 0.25);
    padding: 0.12em 0.4em;
    border-radius: 4px;
  }
</style>
