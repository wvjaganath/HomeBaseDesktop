<script lang="ts">
  import { clock } from '../lib/clock.svelte';
  import { relativeDue } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import Icon from './Icon.svelte';

  let { limit = 4 }: { limit?: number } = $props();
  const data = $derived(hub.lists?.reminders);
  const items = $derived((data?.items ?? []).slice(0, limit));
  const dueToday = $derived(
    (data?.items ?? []).filter((r) => r.overdue || new Date(r.dueAt).toDateString() === clock.now.toDateString()).length,
  );
</script>

<section class="card rem">
  <header>
    <span class="label"><Icon name="bell" size={20} />Reminders</span>
    {#if dueToday > 0}<span class="muted count">{dueToday} due</span>{/if}
  </header>
  {#each items as r (r.id)}
    <div class="row">
      <span class="ring" class:overdue={r.overdue}></span>
      <span class="text">
        <span class="title">{r.title}</span>
        <span class="sub" class:overdue={r.overdue}>{r.overdue ? `Overdue · ${relativeDue(r.dueAt, clock.now)}` : relativeDue(r.dueAt, clock.now)}{r.shared ? ' · Shared' : ''}</span>
      </span>
    </div>
  {:else}
    <p class="muted">All caught up.</p>
  {/each}
  {#if (data?.total ?? 0) > items.length}
    <span class="more muted">+{(data?.total ?? 0) - items.length} more</span>
  {/if}
</section>

<style>
  .rem {
    min-height: 0;
    overflow: hidden;
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .label {
    color: var(--rem);
  }
  .count {
    font-size: 15px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .ring {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    margin-top: 2px;
    border-radius: 50%;
    border: 2.5px solid var(--rem);
  }
  .ring.overdue {
    border-color: var(--orange);
  }
  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .title {
    font-size: 21px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 15px;
    color: var(--muted);
  }
  .sub.overdue {
    color: var(--orange);
    font-weight: 600;
  }
  .more {
    margin-top: auto;
    font-size: 15px;
  }
  p {
    margin: 0;
    font-size: 18px;
  }
</style>
