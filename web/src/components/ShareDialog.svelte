<script lang="ts">
  import { ApiError } from '../lib/api';
  import { sync, type Shareable } from '../lib/sync.svelte';
  import Dialog from './Dialog.svelte';

  /** Share a note or reminder with the other account (same flow as the iOS share sheet). */
  let {
    open = $bindable(false),
    itemType,
    itemId,
    itemName,
  }: { open?: boolean; itemType: Shareable; itemId: string; itemName: string } = $props();

  let permission = $state<'read' | 'write'>('write');
  let busy = $state(false);
  let error = $state('');
  const partner = $derived(sync.partner());
  const existing = $derived(sync.shareFor(itemType, itemId));

  async function run(fn: () => Promise<void>): Promise<void> {
    busy = true;
    error = '';
    try {
      await fn();
    } catch (err) {
      error = err instanceof ApiError && err.code === 'item_not_found' ? 'Save the item first, then share it.' : 'Couldn’t update sharing. Is the hub reachable?';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open title="Sharing" width={480}>
  {#if !partner}
    <p class="muted">No one to share with yet. The other account appears here after it signs in once.</p>
  {:else if existing}
    <p>Shared with <strong>{partner.displayName}</strong> · {existing.permission === 'write' ? 'can edit' : 'can view'}</p>
    <button class="btn danger" disabled={busy} onclick={() => run(() => sync.unshare(existing.id))}>Stop sharing</button>
  {:else}
    <fieldset class="perm">
      <legend class="muted">Permission</legend>
      <label><input type="radio" bind:group={permission} value="write" /> Can edit</label>
      <label><input type="radio" bind:group={permission} value="read" /> Can view</label>
    </fieldset>
    <button class="btn primary" disabled={busy} onclick={() => run(() => sync.share(itemType, itemId, partner.id, permission))}>
      Share with {partner.displayName}
    </button>
    <p class="muted small">They’ll get “{itemName || 'Untitled'}” on their next sync.</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</Dialog>

<style>
  .perm {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    gap: 20px;
  }
  .perm label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .small {
    font-size: 14px;
    margin: 0;
  }
  p {
    margin: 0;
  }
  .error {
    color: var(--bad);
  }
</style>
