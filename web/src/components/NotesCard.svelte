<script lang="ts">
  import { hub } from '../lib/hub.svelte';
  import Icon from './Icon.svelte';

  let { maxItems = 5 }: { maxItems?: number } = $props();
  const notes = $derived(hub.lists?.notes);
  const note = $derived(notes?.items[0]);
  const done = $derived(note ? note.items.filter((i) => i.done).length : 0);
</script>

<section class="card notes">
  <span class="label"><Icon name="note" size={20} />Pinned note</span>
  {#if note}
    <div class="titlerow">
      <span class="title">{note.title || 'Untitled'}</span>
      {#if note.isChecklist}<span class="muted small">{done} / {note.items.length}</span>{/if}
    </div>
    {#if note.isChecklist}
      {#each note.items.slice(0, maxItems) as item (item.id)}
        <span class="item" class:done={item.done}><span class="box"></span>{item.text}</span>
      {/each}
    {:else}
      <p class="body">{note.body}</p>
    {/if}
    {#if (notes?.totalPinned ?? 0) > 1}
      <span class="more muted small">+{(notes?.totalPinned ?? 0) - 1} more pinned</span>
    {/if}
  {:else}
    <p class="muted">Pin a note in HomeBase to show it here.</p>
  {/if}
</section>

<style>
  .notes {
    min-height: 0;
    overflow: hidden;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .label {
    color: var(--note);
  }
  .titlerow {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .title {
    font-size: 23px;
    font-weight: 600;
  }
  .small {
    font-size: 15px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 19px;
  }
  .box {
    width: 19px;
    height: 19px;
    flex-shrink: 0;
    border-radius: 5px;
    border: 2px solid var(--muted);
  }
  .item.done {
    color: var(--faint);
    text-decoration: line-through;
  }
  .item.done .box {
    background: var(--note);
    border-color: var(--note);
  }
  .body {
    margin: 0;
    font-size: 19px;
    color: var(--muted);
    line-height: 1.4;
    overflow: hidden;
  }
  .more {
    margin-top: auto;
  }
  p {
    margin: 0;
    font-size: 18px;
  }
</style>
