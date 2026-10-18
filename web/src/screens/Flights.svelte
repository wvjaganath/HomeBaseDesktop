<script lang="ts">
  import AlertsBar from '../components/AlertsBar.svelte';
  import FlightHero from '../components/FlightHero.svelte';
  import Icon from '../components/Icon.svelte';
  import TopBar from '../components/TopBar.svelte';
  import { DELAY_COLORS, distUnit, fmtInt } from '../lib/format';
  import { hub } from '../lib/hub.svelte';

  let { theme = 'led' }: { theme?: 'clean' | 'led' } = $props();
  let index = $state(0);

  $effect(() => {
    hub.setRadarInterest(true);
    return () => hub.setRadarInterest(false);
  });

  const flights = $derived(hub.tracker?.flights ?? []);
  const units = $derived(hub.config?.units ?? 'imperial');
  // Cycle through several overhead flights every 10 s.
  $effect(() => {
    if (flights.length < 2) {
      index = 0;
      return;
    }
    const t = setInterval(() => (index = (index + 1) % flights.length), 10_000);
    return () => clearInterval(t);
  });
  const current = $derived(flights[Math.min(index, flights.length - 1)]);
  const others = $derived(flights.filter((f) => f !== current));
  const nearby = $derived((hub.radar?.aircraft ?? []).filter((a) => a.callsign).slice(0, 6));
  const tracked = $derived(hub.tracker?.tracked ?? null);
</script>

<div class="flights" class:led={theme === 'led'}>
  <TopBar compact />
  {#if !hub.isKiosk}
    <div class="corner">
      <a class="btn icon" href="#/tracker/stats" aria-label="Flight stats, records and tracking" title="Stats, closest & farthest, track a flight"><Icon name="chart" /></a>
      <a class="btn icon" href="#/tracker-settings" aria-label="Plane tracker settings" title="Plane tracker settings"><Icon name="settings" /></a>
    </div>
  {/if}
  {#if current}
    <section class="board">
      <FlightHero flight={current} {units} {theme} scale="board" />
    </section>
    {#if others.length > 0}
      <ul class="others">
        {#each others as f (f.callsign)}
          <li>
            <span class="tag">Also overhead</span>
            <span class="mono">{f.callsign}</span>
            <span style:color={DELAY_COLORS[f.origin.delay]}>{f.origin.code}</span>→<span style:color={DELAY_COLORS[f.destination.delay]}>{f.destination.code}</span>
            <span class="muted push">{fmtInt(f.position.altitudeFt)} ft · {f.fromHome.distance?.toFixed(1) ?? '—'} {distUnit(units)} {f.fromHome.direction}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <section class="idle card">
      <h2>Clear skies over home</h2>
      <p class="muted">The board lights up as soon as the tracker spots a plane in your box.</p>
      {#if nearby.length > 0}
        <h3 class="label">Nearest aircraft</h3>
        <ul class="near">
          {#each nearby as a (a.hex)}
            <li>
              <span class="mono cs">{a.callsign}</span>
              <span class="muted">{a.type || 'Unknown type'}</span>
              <span>{a.altitudeFt === null ? 'on ground' : `${fmtInt(a.altitudeFt)} ft`}</span>
              <span class="muted">{a.distance.toFixed(1)} {distUnit(units)} {a.direction}</span>
            </li>
          {/each}
        </ul>
        <p class="credit">Aircraft data: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a></p>
      {/if}
    </section>
  {/if}
  {#if tracked}
    <div class="tracked"><span class="tag">Tracking</span><span class="mono">{tracked.callsign}</span><span class="muted">Details appear here when it’s airborne.</span>{#if !hub.isKiosk}<a class="push" href="#/tracker/track">Tracking details</a>{/if}</div>
  {/if}
  <AlertsBar />
</div>

<style>
  .credit {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .corner {
    position: fixed;
    right: 28px;
    bottom: 24px;
    z-index: 5;
    display: flex;
    gap: 10px;
  }
  .corner .btn {
    background: color-mix(in srgb, var(--bg) 85%, transparent);
  }
  .flights {
    height: 100%;
    padding: 36px 56px 30px;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .led {
    background: #000;
  }
  .board {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .others,
  .near {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .others li,
  .tracked .push {
    margin-left: auto;
  }
  .tracked {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 22px;
    border-radius: 16px;
    background: var(--surface);
    font-size: 22px;
  }
  .led .others li,
  .led .tracked {
    background: #0b0d10;
  }
  .tag {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .push {
    margin-left: auto;
  }
  .idle {
    flex: 1;
    padding: 48px 56px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .idle h2 {
    margin: 0;
    font-size: 54px;
    font-weight: 600;
  }
  .idle p {
    margin: 0;
    font-size: 24px;
  }
  .idle h3 {
    margin: 24px 0 4px;
    color: var(--muted);
  }
  .near li {
    display: grid;
    grid-template-columns: 200px 1fr 180px 200px;
    gap: 16px;
    font-size: 24px;
    padding: 12px 0;
    border-top: 1px solid var(--line);
  }
  .cs {
    font-weight: 600;
  }
</style>
