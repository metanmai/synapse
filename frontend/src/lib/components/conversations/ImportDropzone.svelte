<script lang="ts">
interface Props {
  onfile: (content: string) => void;
}

let { onfile }: Props = $props();

let dragging = $state(false);
let fileInput: HTMLInputElement | undefined = $state();

function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragging = false;
  const file = e.dataTransfer?.files[0];
  if (file) readFile(file);
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  dragging = true;
}

function handleDragLeave() {
  dragging = false;
}

function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) readFile(file);
}

function readFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") {
      onfile(reader.result);
    }
  };
  reader.readAsText(file);
}

function openFilePicker() {
  fileInput?.click();
}
</script>

<div
  class="dropzone"
  class:dragging
  role="button"
  tabindex="0"
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  onclick={openFilePicker}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") openFilePicker(); }}
>
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,.txt"
    class="hidden-input"
    onchange={handleFileSelect}
  />
  <div class="dropzone-content">
    <svg class="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
    <p class="dropzone-text">
      {#if dragging}
        Drop file here
      {:else}
        Drag & drop a <strong>.json</strong> or <strong>.txt</strong> file, or click to browse
      {/if}
    </p>
  </div>
</div>

<style>
  .dropzone {
    border: 2px dashed var(--color-border);
    border-radius: var(--radius-sm);
    padding: 2rem;
    text-align: center;
    cursor: pointer;
    transition: var(--transition-base);
    background: transparent;
  }

  .dropzone:hover {
    border-color: var(--color-pink);
    background: rgba(86, 28, 36, 0.03);
  }

  .dropzone.dragging {
    border-color: var(--color-accent);
    background: rgba(86, 28, 36, 0.06);
    box-shadow: 0 0 0 3px rgba(86, 28, 36, 0.08);
  }

  .dropzone-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    pointer-events: none;
  }

  .dropzone-icon {
    width: 2rem;
    height: 2rem;
    color: var(--color-text-muted);
  }

  .dragging .dropzone-icon {
    color: var(--color-accent);
  }

  .dropzone-text {
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .dragging .dropzone-text {
    color: var(--color-accent);
    font-weight: 500;
  }

  .hidden-input {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    opacity: 0;
  }
</style>
