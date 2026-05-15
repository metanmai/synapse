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

<div class="glass rounded-xl" style="padding: 2rem;">
  <h3 style="font-size: 18px; font-weight: 700; color: var(--color-danger); margin-bottom: 0.5rem;">Danger Zone</h3>

  {#if resetSuccess}
    <div
      class="rounded-lg p-3 text-sm mb-3"
      style="background-color: var(--color-success-bg); color: var(--color-success);"
    >
      Account data has been reset. A new API key has been generated.
    </div>
  {/if}
  {#if resetError}
    <div class="rounded-lg p-3 text-sm mb-3" style="color: var(--color-danger);">
      {resetError}
    </div>
  {/if}
  {#if deleteError}
    <div class="rounded-lg p-3 text-sm mb-3" style="color: var(--color-danger);">
      {deleteError}
    </div>
  {/if}

  <!-- Reset Account -->
  <div class="mb-5">
    <p class="text-sm mb-1" style="color: var(--color-text-muted);">
      Deletes all projects, files, conversations, and insights. Your account and subscription stay intact.
    </p>

    {#if !showResetConfirm}
      <button
        type="button"
        class="btn-danger cursor-pointer"
        onclick={() => { showResetConfirm = true; }}
      >
        Reset data
      </button>
    {:else}
      <div class="rounded-lg p-4 mt-2" style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);">
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
            <button type="submit" disabled={resetLoading} class="btn-danger cursor-pointer">
              {#if resetLoading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span>
                  Resetting...
                </span>
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
    <p class="text-sm mb-1" style="color: var(--color-text-muted);">
      Permanently deletes your account, all data, and cancels any subscription. This cannot be undone.
    </p>

    {#if !showDeleteConfirm}
      <button
        type="button"
        class="btn-danger cursor-pointer"
        onclick={() => { showDeleteConfirm = true; }}
      >
        Delete account
      </button>
    {:else}
      <div class="rounded-lg p-4 mt-2" style="background-color: var(--color-bg-muted); border: 1px solid var(--color-border);">
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
          class="w-full text-sm mb-3"
          style="border-radius: var(--radius-sm); padding: 12px 16px; transition: var(--transition-base); background-color: var(--color-bg); border: 1px solid var(--color-border); color: var(--color-text); outline: none;"
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
              class="btn-danger cursor-pointer"
            >
              {#if deleteLoading}
                <span class="flex items-center justify-center gap-2">
                  <span class="spinner spinner-sm spinner-white"></span>
                  Deleting...
                </span>
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

<style>
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
