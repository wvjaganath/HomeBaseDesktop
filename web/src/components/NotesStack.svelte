<script lang="ts">
  import { hub } from '../lib/hub.svelte';
  import Icon from './Icon.svelte';

  /** Pinned notes stacked in one narrow column (Home). */
  let { max = 2, maxItems = 4 }: { max?: number; maxItems?: number } = $props();
  const notes = $derived(hub.lists?.notes);
  const shown = $derived((notes?.items ?? []).slice(0, max));
  const extra = $derived((notes?.totalPinned ?? 0) - shown.length);
</script>

<section class="card notes" aria-label="Pinned notes">
  <span class="label"><Icon name="note" size={20} />Notes</span>
  {#each shown as note (note.id)}
    <div class="note">
      <b>{note.title || 'Untitled'}</b>
      {#if note.isChecklist}
        {#each note.items.slice(0, maxItems) as item (item.id)}
          <span class="item" class:done={item.done}><span class="box"></span>{item.text}</span>
        {/each}
        {#if note.items.length > maxItems}<span class="more">+{note.items.length - maxItems} more</span>{/if}
      {:else}
        <p>{note.body}</p>
      {/if}
    </div>
  {:else}
    <p class="muted empty">Pin a note in HomeBase to show it here.</p>
  {/each}
  {#if extra > 0}<span class="more">+{extra} more pinned</span>{/if}
</section>

<style>
  .notes {
    min-height: 0;
    overflow: hidden;
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .label {
    color: var(--note);
  }
  .note {
    flex: 1 1 0;
    min-height: 0;
    overflow: hidden;
    background: #211c0c;
    border: 1px solid #3a3013;
    border-radius: 16px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  b {
    font-size: 18px;
    font-weight: 650;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 16px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .box {
    width: 15px;
    height: 15px;
    flex: none;
    border-radius: 4px;
    border: 1.6px solid var(--muted);
  }
  .item.done {
    color: var(--faint);
    text-decoration: line-through;
  }
  .item.done .box {
    background: var(--note);
    border-color: var(--note);
  }
  p {
    margin: 0;
    font-size: 16px;
    line-height: 1.4;
    color: var(--text-2);
    overflow: hidden;
  }
  .more {
    font-size: 14px;
    color: var(--faint);
  }
  .empty {
    font-size: 16px;
  }
</style>
