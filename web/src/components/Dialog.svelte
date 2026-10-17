<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  /** Native modal <dialog>: focus trapping and Escape handling come from the browser. */
  let {
    open = $bindable(false),
    title,
    children,
    width = 560,
  }: { open?: boolean; title: string; children: Snippet; width?: number } = $props();
  let el = $state<HTMLDialogElement>();

  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} onclose={() => (open = false)} aria-label={title} style:--w={`${width}px`}>
  {#if open}
    <header>
      <h2>{title}</h2>
      <button class="btn icon" aria-label="Close" onclick={() => (open = false)}><Icon name="close" size={20} /></button>
    </header>
    <div class="body">{@render children()}</div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(var(--w), calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    padding: 0;
    border-radius: 20px;
    border: 1px solid var(--line-2);
    background: var(--surface);
    color: var(--text);
    overflow: auto;
  }
  dialog::backdrop {
    background: rgba(0, 0, 0, 0.6);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 20px 0 24px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
  }
  .icon {
    width: 44px;
    padding: 0;
  }
  .body {
    padding: 16px 24px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
</style>
