<script lang="ts">
import { browser } from "$app/environment";
import DOMPurify from "dompurify";
import { marked } from "marked";

let { text = "", inline = false }: { text?: string | null; inline?: boolean } = $props();

// marked configured once. `gfm` enables GitHub-flavored markdown (fenced
// code, tables, task lists, autolinks). `breaks: true` turns a single
// newline into a <br>, matching how LLMs and chat messages get written.
//
// Two renderer overrides keep XSS out of the SSR'd output (before
// DOMPurify can run on the client):
//   1. `html`: drops ALL raw HTML tokens from the markdown source. Raw
//      script/iframe tags someone pastes into a chat are dropped here.
//   2. `link`: scrubs dangerous protocols (javascript:, data: text/html,
//      vbscript:) from link hrefs. marked otherwise passes them through
//      verbatim — `[x](javascript:alert(1))` becomes a live attack vector
//      until hydration. With this override the href is replaced with `#`.
function safeHref(href: string): string {
  const trimmed = href.trim().toLowerCase();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("vbscript:") ||
    (trimmed.startsWith("data:") && trimmed.includes("text/html"))
  ) {
    return "#";
  }
  return href;
}

marked.use({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html: () => "",
    link({ href, title, tokens }) {
      const safe = safeHref(href ?? "");
      // biome-ignore lint/style/noNonNullAssertion: `this.parser` is wired by marked at call time
      const text = (this as { parser: { parseInline: (t: typeof tokens) => string } }).parser.parseInline(tokens);
      const titleAttr = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
      return `<a href="${safe}"${titleAttr}>${text}</a>`;
    },
  },
});

const renderMarked = (src: string): string => marked.parse(src) as string;

// Two-pass sanitization for defense in depth:
//   1. `renderMarked` already drops raw <html> tokens in the markdown source.
//   2. DOMPurify scrubs the rendered HTML for inline event handlers
//      (onclick=, onerror=, etc.) and `javascript:` URLs that snuck through
//      via a markdown construct like `[click](javascript:alert(1))`. Browser-
//      only — DOMPurify needs a real DOM; SSR ships the marked output
//      without this pass, and the next paint (post-hydration) re-renders
//      with sanitization applied.
//
//      Risk window: ~50-150ms between SSR paint and client hydration.
//      `renderer.html` already dropped raw `<script>` tags, so the only
//      attack vector left is a `javascript:` URL inside a link — which
//      browsers don't auto-execute without a user click. Acceptable.
const html = $derived.by(() => {
  const src = (text ?? "").trim();
  if (!src) return "";
  const raw = renderMarked(src);
  if (browser) {
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }
  return raw;
});
</script>

{#if inline}
  <span class="markdown markdown--inline">{@html html}</span>
{:else}
  <div class="markdown">{@html html}</div>
{/if}

<style>
  .markdown {
    /* Inherit type scale from the parent — the surface (chat bubble,
       insight card, context card) sets sizing context; we only style
       the prose elements themselves. */
    color: inherit;
    line-height: 1.55;
    overflow-wrap: break-word;
    word-wrap: break-word;
    max-width: 100%;
  }

  /* Headings — modest scale jumps so they read as structural, not shouted */
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    margin: 0.85em 0 0.35em;
    line-height: 1.25;
    font-weight: 600;
  }
  .markdown :global(h1) { font-size: 1.35em; }
  .markdown :global(h2) { font-size: 1.2em; }
  .markdown :global(h3) { font-size: 1.08em; }
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) { font-size: 1em; }

  .markdown :global(p) {
    margin: 0 0 0.65em;
  }
  .markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  /* Emphasis */
  .markdown :global(strong) { font-weight: 600; }
  .markdown :global(em) { font-style: italic; }
  .markdown :global(del),
  .markdown :global(s) { text-decoration: line-through; opacity: 0.7; }

  /* Lists — tight spacing, real bullets/numbers, indent matches body */
  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.35em 0 0.65em;
    padding-left: 1.4em;
  }
  .markdown :global(li) {
    margin: 0.15em 0;
  }
  .markdown :global(li > p) {
    margin: 0 0 0.35em;
  }
  .markdown :global(ul ul),
  .markdown :global(ol ol),
  .markdown :global(ul ol),
  .markdown :global(ol ul) {
    margin: 0.1em 0 0.25em;
  }

  /* Inline code + fenced code blocks */
  .markdown :global(code) {
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 4px;
    padding: 0.1em 0.35em;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
  }
  .markdown :global(pre) {
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid rgba(0, 0, 0, 0.06);
    border-radius: 6px;
    padding: 0.75em 0.9em;
    margin: 0.5em 0;
    overflow-x: auto;
    font-size: 0.85em;
    line-height: 1.5;
  }
  .markdown :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 1em;
  }

  /* Blockquote */
  .markdown :global(blockquote) {
    border-left: 3px solid rgba(0, 0, 0, 0.15);
    margin: 0.5em 0;
    padding: 0 0 0 0.9em;
    color: rgba(0, 0, 0, 0.7);
  }
  .markdown :global(blockquote > :first-child) { margin-top: 0; }
  .markdown :global(blockquote > :last-child) { margin-bottom: 0; }

  /* Links — underline only on hover to keep dense content readable */
  .markdown :global(a) {
    color: var(--color-link, #561c24);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    transition: opacity 120ms ease;
  }
  .markdown :global(a:hover) { opacity: 0.7; }

  /* Tables — compact, readable */
  .markdown :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  .markdown :global(th),
  .markdown :global(td) {
    border: 1px solid rgba(0, 0, 0, 0.12);
    padding: 0.3em 0.6em;
    text-align: left;
  }
  .markdown :global(th) {
    background: rgba(0, 0, 0, 0.04);
    font-weight: 600;
  }

  /* Horizontal rule — subtle */
  .markdown :global(hr) {
    border: none;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    margin: 1em 0;
  }

  /* Inline variant — strip block margins so the rendered content sits
     comfortably inside a single line of text (e.g., an insight summary). */
  .markdown--inline :global(p),
  .markdown--inline :global(ul),
  .markdown--inline :global(ol),
  .markdown--inline :global(pre),
  .markdown--inline :global(blockquote) {
    display: inline;
    margin: 0;
    padding: 0;
  }
  .markdown--inline :global(p) {
    display: inline;
  }
</style>
