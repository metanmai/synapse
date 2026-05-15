<script lang="ts">
import { enhance } from "$app/forms";

let { email, resetSuccess, resetError, deleteError } = $props<{
  email: string;
  resetSuccess?: boolean;
  resetError?: string;
  deleteError?: string;
}>();

let showResetConfirm = $state(false);
let showDeleteConfirm = $state(false);
let deleteInput = $state("");
let resetLoading = $state(false);
let deleteLoading = $state(false);

const deleteConfirmed = $derived(deleteInput === "DELETE");
</script>

<div class="glass rounded-xl" style="padding: 2rem; border: 1px solid var(--color-danger);">
  <h3 style="font-size: 18px; font-weight: 700; color: var(--color-danger); margin-bottom: 0.5rem;">Danger Zone</h3>

  {#if resetSuccess}
    <div
      class="rounded-lg p-3 text-sm mb-4"
      style="background-color: var(--color-success-bg); color: var(--color-success);"
    >
      Account data has been reset. A new API key has been generated.
    </div>
  {/if}
  {#if resetError}
    <div class="rounded-lg p-3 text-sm mb-4" style="background-color: #fde8e8; color: var(--color-danger);">
      {resetError}
    </div>
  {/if}
  {#if deleteError}
    <div class="rounded-lg p-3 text-sm mb-4" style="background-color: #fde8e8; color: var(--color-danger);">
      {deleteError}
    </div>
  {/if}

  <!-- Reset Account -->
  <div class="mb-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-sm font-semibold" style="color: var(--color-text);">Reset account data</p>
        <p class="text-xs" style="color: var(--color-text-muted);">
          Deletes all projects, files, conversations, and insights. Your account and subscription stay intact. A fresh API key will be generated.
        </p>
      </div>
      {#if !showResetConfirm}
        <button
          type="button"
          class="btn-secondary cursor-pointer shrink-0"
          style="border-color: var(--color-danger); color: var(--color-danger);"
          onclick={() => { showResetConfirm = true; }}
        >
          Reset data
        </button>
      {/if}
    </div>

    {#if showResetConfirm}
      <div class="rounded-lg p-4 mt-3" style="background-color: #fde8e8;">
        <p class="text-sm mb-3" style="color: var(--color-danger); font-weight: 600;">
          Are you sure? This will permanently delete all your workspace data.
        </p>
        <div class="flex gap-2">
          <form method="POST" action="?/resetAccount" use:enhance={() => {
            resetLoading = true;
            return async ({ update }) => {
              resetLoading = false;
              showResetConfirm = false;
              await update();
            };
          }}>
            <button
              type="submit"
              disabled={resetLoading}
              class="cursor-pointer"
              style="padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; background-color: var(--color-danger); color: white;"
            >
              {#if resetLoading}
                Resetting...
              {:else}
                Yes, reset all data
              {/if}
            </button>
          </form>
          <button
            type="button"
            class="btn-secondary cursor-pointer"
            onclick={() => { showResetConfirm = false; }}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Delete Account -->
  <div style="border-top: 1px solid var(--color-border); padding-top: 1.25rem;">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-sm font-semibold" style="color: var(--color-text);">Delete account</p>
        <p class="text-xs" style="color: var(--color-text-muted);">
          Permanently deletes your account, all data, and cancels any subscription. This cannot be undone.
        </p>
      </div>
      {#if !showDeleteConfirm}
        <button
          type="button"
          class="cursor-pointer shrink-0"
          style="padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; background-color: var(--color-danger); color: white;"
          onclick={() => { showDeleteConfirm = true; }}
        >
          Delete account
        </button>
      {/if}
    </div>

    {#if showDeleteConfirm}
      <div class="rounded-lg p-4 mt-3" style="background-color: #fde8e8;">
        <p class="text-sm mb-2" style="color: var(--color-danger); font-weight: 600;">
          This is irreversible. Type <strong>DELETE</strong> to confirm.
        </p>
        <p class="text-xs mb-3" style="color: var(--color-text-muted);">
          Signed in as <strong>{email}</strong>
        </p>
        <input
          type="text"
          bind:value={deleteInput}
          placeholder="Type DELETE to confirm"
          class="w-full rounded-lg px-3 py-2 text-sm mb-3"
          style="border: 1px solid var(--color-danger); background: white; outline: none;"
        />
        <div class="flex gap-2">
          <form method="POST" action="?/deleteAccount" use:enhance={() => {
            deleteLoading = true;
            return async ({ update }) => {
              deleteLoading = false;
              await update();
            };
          }}>
            <button
              type="submit"
              disabled={!deleteConfirmed || deleteLoading}
              class="cursor-pointer"
              style="padding: 8px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; border: none; background-color: {deleteConfirmed ? 'var(--color-danger)' : 'var(--color-border)'}; color: {deleteConfirmed ? 'white' : 'var(--color-text-muted)'};"
            >
              {#if deleteLoading}
                Deleting...
              {:else}
                Permanently delete account
              {/if}
            </button>
          </form>
          <button
            type="button"
            class="btn-secondary cursor-pointer"
            onclick={() => { showDeleteConfirm = false; deleteInput = ""; }}
          >
            Cancel
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>
