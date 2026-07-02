<script lang="ts">
import { enhance } from "$app/forms";
import { tick } from "svelte";

interface Candidate {
  id: string;
  name: string;
  conversation_count: number;
  last_activity?: string;
  matched_by_remote: boolean;
}

let { sourceProjectId, sourceProjectName, candidates, allOtherProjects, linkError } = $props<{
  sourceProjectId: string;
  sourceProjectName: string;
  candidates: Candidate[];
  allOtherProjects: Candidate[];
  linkError?: string;
}>();

let showPicker = $state(false);
let selectedTargetId = $state("");
let showConfirm = $state(false);
let confirmInput = $state("");
let linking = $state(false);

const confirmed = $derived(confirmInput === sourceProjectName);
const hasAnyTargets = $derived(allOtherProjects.length > 0 || candidates.length > 0);

let firstRadio: HTMLInputElement | null = $state(null);
let confirmInputEl: HTMLInputElement | null = $state(null);
let triggerBtn: HTMLButtonElement | null = $state(null);

async function openPicker() {
  showPicker = true;
  await tick();
  firstRadio?.focus();
}

async function gotoConfirm() {
  showConfirm = true;
  await tick();
  confirmInputEl?.focus();
}

async function collapseToA() {
  showPicker = false;
  showConfirm = false;
  selectedTargetId = "";
  confirmInput = "";
  await tick();
  triggerBtn?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !linking) {
    collapseToA();
  }
}

function formatLastActivity(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Last activity: just now";
  if (min < 60) return `Last activity: ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Last activity: ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `Last activity: ${day}d ago`;
}

function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
</script>

<svelte:window onkeydown={(event) => { if (showPicker) onKeydown(event); }} />

<section
  class="glass rounded-xl"
  style="padding: 2rem;"
  aria-labelledby="linked-projects-heading"
>
  <h2
    id="linked-projects-heading"
    style="font-size: 18px; font-weight: 700; color: var(--color-accent); margin-bottom: 0.5rem;"
  >
    Linked Projects
  </h2>

  {#if linkError}
    <div
      role="alert"
      style="background: rgba(139,0,0,0.06); border: 1px solid rgba(139,0,0,0.2); color: var(--color-danger); padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 0.75rem;"
    >
      {linkError}
    </div>
  {/if}

  {#if !showPicker}
    <p style="font-size: 14px; color: var(--color-text-muted); margin-bottom: 0.75rem;">
      Link this project to another one of your projects to merge their events and history. Useful
      when the same repo got captured twice from different machines.
    </p>
    <button
      type="button"
      class="btn-primary cursor-pointer"
      bind:this={triggerBtn}
      onclick={openPicker}
      disabled={!hasAnyTargets}
    >
      + Link to existing project
    </button>
    {#if !hasAnyTargets}
      <p style="font-size: 12px; color: var(--color-text-muted); margin-top: 0.5rem;">
        (You need at least 2 projects to link.)
      </p>
    {/if}
  {:else if !showConfirm}
    <!-- State B: picker open -->
    {#if !hasAnyTargets}
      <div style="padding: 1rem 0;">
        <p style="font-size: 14px; font-weight: 600; color: var(--color-text); margin-bottom: 0.25rem;">
          No other projects to link to
        </p>
        <p style="font-size: 13px; color: var(--color-text-muted); margin-bottom: 1rem;">
          Create another project from the home page first, then return here to link them.
        </p>
        <a
          href="/home"
          style="font-size: 13px; color: var(--color-accent); text-decoration: underline;"
        >
          ← Back to Home
        </a>
      </div>
    {:else}
      <p style="font-size: 14px; color: var(--color-text-muted); margin-bottom: 1rem;">
        Select a project to link this one into. Events from this project will be moved to the
        target, and this project will be deleted.
      </p>

      <fieldset style="border: none; padding: 0; margin: 0;">
        <legend class="sr-only">Select target project</legend>

        {#if candidates.length > 0}
          <div
            style="background: rgba(86, 28, 36, 0.04); border: 1px solid rgba(86, 28, 36, 0.15); border-radius: 12px; padding: 12px 16px; margin-bottom: 1rem;"
          >
            <p
              style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin-bottom: 0.25rem;"
            >
              Suggested matches
            </p>
            <p style="font-size: 12px; color: var(--color-text-muted); margin-bottom: 0.75rem;">
              Same git remote
            </p>
            {#each candidates as candidate (candidate.id)}
              <label
                style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(199, 183, 163, 0.25); margin-bottom: 0.5rem; cursor: pointer; transition: var(--transition-base);"
              >
                <input
                  type="radio"
                  name="targetProjectId"
                  value={candidate.id}
                  bind:group={selectedTargetId}
                  bind:this={firstRadio}
                />
                <span style="flex: 1;">
                  <span style="display: block; font-size: 13px; font-weight: 600; color: var(--color-text);">
                    {candidate.name}
                  </span>
                  <span style="display: block; font-size: 12px; color: var(--color-text-muted);">
                    {pluralize(candidate.conversation_count, "conversation", "conversations")}
                    {#if candidate.last_activity}
                      · {formatLastActivity(candidate.last_activity)}
                    {/if}
                  </span>
                </span>
                <span
                  aria-label="Matched: same git remote URL"
                  style="background: rgba(86, 28, 36, 0.08); color: var(--color-pink-dark); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px;"
                >
                  Matched
                </span>
              </label>
            {/each}
          </div>
        {/if}

        <p
          style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); margin-bottom: 0.5rem;"
        >
          Your other projects
        </p>
        <div style="margin-bottom: 1rem;">
          {#each allOtherProjects as project (project.id)}
            <label
              style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(199, 183, 163, 0.25); margin-bottom: 0.5rem; cursor: pointer; transition: var(--transition-base);"
            >
              <input
                type="radio"
                name="targetProjectId"
                value={project.id}
                bind:group={selectedTargetId}
              />
              <span style="flex: 1;">
                <span style="display: block; font-size: 13px; font-weight: 600; color: var(--color-text);">
                  {project.name}
                </span>
                <span style="display: block; font-size: 12px; color: var(--color-text-muted);">
                  {pluralize(project.conversation_count, "conversation", "conversations")}
                </span>
              </span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="flex gap-2">
        <button type="button" class="btn-secondary cursor-pointer" onclick={collapseToA}>
          Cancel
        </button>
        <button
          type="button"
          class="btn-primary cursor-pointer"
          onclick={gotoConfirm}
          disabled={!selectedTargetId}
        >
          Continue
        </button>
      </div>
    {/if}
  {:else}
    <!-- State C: type-to-confirm -->
    <div
      class="rounded-lg p-4 mt-2"
      style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);"
    >
      <p class="text-sm mb-2" style="color: var(--color-danger); font-weight: 600;">
        This is irreversible. Type the source project name to confirm.
      </p>
      <p class="text-xs mb-3" style="color: var(--color-text-muted);" id="link-confirm-subtext">
        This will move all events from
        <strong>"{sourceProjectName}"</strong>
        into
        <strong
          >"{allOtherProjects.find((p: Candidate) => p.id === selectedTargetId)?.name ??
            candidates.find((c: Candidate) => c.id === selectedTargetId)?.name ??
            "target"}"</strong
        >
        and permanently delete
        <strong>"{sourceProjectName}"</strong>.
      </p>
      <input
        type="text"
        bind:value={confirmInput}
        bind:this={confirmInputEl}
        placeholder={`Type "${sourceProjectName}" to confirm`}
        aria-describedby="link-confirm-subtext"
        readonly={linking}
        class="w-full text-sm mb-3"
        style="border-radius: var(--radius-sm); padding: 12px 16px; transition: var(--transition-base); background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text); outline: none;"
      />
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-secondary cursor-pointer"
          onclick={collapseToA}
          disabled={linking}
        >
          Cancel
        </button>
        <form
          method="POST"
          action="?/linkProject"
          use:enhance={() => {
            linking = true;
            return async ({ update }) => {
              linking = false;
              await update();
            };
          }}
        >
          <input type="hidden" name="sourceProjectId" value={sourceProjectId} />
          <input type="hidden" name="targetProjectId" value={selectedTargetId} />
          <button
            type="submit"
            disabled={!confirmed || linking}
            class="btn-danger cursor-pointer"
          >
            {#if linking}
              <span class="flex items-center justify-center gap-2">
                <span class="spinner spinner-sm spinner-white"></span>
                Linking…
              </span>
            {:else}
              Link projects & delete source
            {/if}
          </button>
        </form>
      </div>
    </div>
  {/if}
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  label:hover {
    border-color: var(--color-pink) !important;
    transform: translateY(-1px);
  }

  .btn-danger {
    background: var(--color-danger);
    color: white;
    border: none;
    border-radius: var(--radius-pill);
    padding: 10px 24px;
    font-weight: 600;
    font-size: 14px;
    transition: var(--transition-base);
  }
  .btn-danger:hover {
    opacity: 0.9;
    box-shadow: 0 8px 32px rgba(139, 0, 0, 0.25);
  }
  .btn-danger:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
