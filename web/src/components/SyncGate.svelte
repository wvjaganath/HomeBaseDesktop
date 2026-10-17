<script lang="ts">
  import type { Snippet } from 'svelte';
  import { hub } from '../lib/hub.svelte';
  import { sync } from '../lib/sync.svelte';

  /** Loads the user's synced data once, then renders the page. */
  let { children }: { children: Snippet } = $props();
  let failed = $state(false);

  $effect(() => {
    const me = hub.me?.kind === 'user' ? hub.me.user?.id : undefined;
    if (!me) return;
    failed = false;
    sync.ensure(me).catch(() => (failed = true));
  });
</script>

{#if sync.loaded}
  {#if sync.error}
    <div class="banner" role="alert">
      <span>{sync.error}</span>
      <button class="btn small" onclick={() => (sync.error = '')}>Dismiss</button>
    </div>
  {/if}
  {@render children()}
{:else if failed}
  <div class="state">
    <p>Couldn’t load your data from the hub.</p>
    <button class="btn" onclick={() => { failed = false; void sync.pull().catch(() => (failed = true)); }}>Try again</button>
  </div>
{:else}
  <div class="state muted">Loading…</div>
{/if}

<style>
  .banner {
    position: fixed;
    right: 24px;
    bottom: 24px;
    z-index: 1500;
    max-width: 520px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    border-radius: 14px;
    background: #2a1b0c;
    color: #fdba74;
    border: 1px solid #5a3a14;
  }
  .small {
    min-height: 36px;
    padding: 0 12px;
  }
  .state {
    height: 100%;
    display: grid;
    place-content: center;
    gap: 12px;
    text-align: center;
  }
</style>
