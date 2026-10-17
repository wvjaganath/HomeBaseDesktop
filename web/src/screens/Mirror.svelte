<script lang="ts">
  import { hub } from '../lib/hub.svelte';

  /**
   * MagicMirror², proxied by the hub at /mirror/. The frame exists only while
   * this tab is open, so the Pi frees its memory as soon as you leave.
   */
  let loaded = $state(false);
  const enabled = $derived(hub.config?.mirrorEnabled ?? false);
</script>

{#if enabled}
  <div class="mirror">
    {#if !loaded}<p class="loading muted">Loading MagicMirror…</p>{/if}
    <iframe
      src="/mirror/"
      title="MagicMirror"
      class:ready={loaded}
      referrerpolicy="same-origin"
      onload={() => (loaded = true)}
    ></iframe>
  </div>
{:else}
  <div class="off">
    <div class="card msg">
      <h1>Mirror isn’t set up</h1>
      <p class="muted">Start the <code>magicmirror</code> service in <code>deploy/docker-compose.yml</code> and set <code>MIRROR_URL</code> in <code>hub.env</code> (see deploy/README.md).</p>
    </div>
  </div>
{/if}

<style>
  .mirror {
    position: relative;
    height: 100%;
    background: #000;
  }
  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    opacity: 0;
    transition: opacity 0.3s;
  }
  iframe.ready {
    opacity: 1;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
  }
  .off {
    height: 100%;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .msg {
    padding: 36px;
    max-width: 600px;
  }
  .msg h1 {
    margin: 0 0 8px;
  }
  code {
    font-family: var(--mono);
  }
</style>
