<script lang="ts">
  import { hub } from '../lib/hub.svelte';

  let { note = '' }: { note?: string } = $props();
  const alerts = $derived(hub.tracker?.alerts ?? []);
  const trackerOk = $derived(hub.tracker?.reachable ?? false);
  const radarOk = $derived(!!hub.radar?.updatedAt && Date.now() - Date.parse(hub.radar.updatedAt) < 60_000);
</script>

<footer class="bar">
  <ul class="alerts" aria-label="Alerts">
    {#each alerts as a (a.text)}
      <li class={`alert ${a.level}`}>{a.text}</li>
    {:else}
      <li class="alert none">No active alerts</li>
    {/each}
  </ul>
  <div class="status">
    {#if note}<span>{note}</span>{/if}
    <span><span class="dot" class:ok={trackerOk}></span>Tracker</span>
    <span><span class="dot" class:ok={radarOk}></span>ADS-B</span>
    <span><span class="dot" class:ok={hub.connected}></span>Live</span>
  </div>
</footer>

<style>
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 24px;
  }
  .alerts {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    gap: 12px;
    overflow: hidden;
    min-width: 0;
  }
  .alert {
    padding: 9px 15px;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 600;
    white-space: nowrap;
    background: var(--surface);
    color: var(--muted);
  }
  .alert.red {
    background: #2a1414;
    color: #fca5a5;
  }
  .alert.orange {
    background: #2a1b0c;
    color: #fdba74;
  }
  .alert.yellow {
    background: #2a240c;
    color: #fde68a;
  }
  .alert.white {
    background: #13202e;
    color: #93c5fd;
  }
  .status {
    display: flex;
    gap: 20px;
    color: var(--faint);
    font-size: 15px;
    flex-shrink: 0;
  }
  .status span {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bad);
  }
  .dot.ok {
    background: var(--ok);
  }
</style>
