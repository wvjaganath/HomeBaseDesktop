<script lang="ts">
  import AlertsBar from '../components/AlertsBar.svelte';
  import FlightHero from '../components/FlightHero.svelte';
  import Icon from '../components/Icon.svelte';
  import CalendarMini from '../components/CalendarMini.svelte';
  import MachinesCard from '../components/MachinesCard.svelte';
  import NextDays from '../components/NextDays.svelte';
  import NotesStack from '../components/NotesStack.svelte';
  import RoomsCard from '../components/RoomsCard.svelte';
  import TopBar from '../components/TopBar.svelte';
  import { distUnit } from '../lib/format';
  import { hub } from '../lib/hub.svelte';

  let { autoFocus = true, theme = 'clean' }: { autoFocus?: boolean; theme?: 'clean' | 'led' } = $props();

  $effect(() => {
    hub.setRadarInterest(true);
    return () => hub.setRadarInterest(false);
  });

  const flights = $derived(hub.tracker?.flights ?? []);
  const focus = $derived(autoFocus && flights.length > 0 ? flights[0] : undefined);
  const units = $derived(hub.config?.units ?? 'imperial');
  const radarCount = $derived(hub.radar?.aircraft.filter((a) => a.distance <= (units === 'metric' ? 40 : 25)).length ?? 0);

  const radarSize = 220;

  // Home is drawn for the 1920×1080 kiosk. On a smaller screen (a 720p
  // monitor, a laptop window) everything shrinks evenly instead of crowding;
  // the layout still fills the width. Never scaled up.
  let cw = $state(1920);
  let ch = $state(1080);
  const k = $derived(Math.min(1, ch / 1080, cw / 1824));
</script>

<div class="fit" bind:clientWidth={cw} bind:clientHeight={ch}>
<div class="home" style:zoom={k === 1 ? undefined : k} style:width={`${cw / k}px`} style:height={`${ch / k}px`}>
  <TopBar compact={!!focus} />

  {#if focus}
    <div class="body focus">
      <div class="side">
        <NextDays days={2} title="Today & tomorrow" />
        <RoomsCard compact max={4} />
      </div>
      <section class="card flightcard">
        <span class="badge"><Icon name="plane" size={18} />Overhead now{flights.length > 1 ? ` · 1 of ${flights.length}` : ''}</span>
        <FlightHero flight={focus} {units} {theme} />
      </section>
    </div>
  {:else}
    <div class="body idle">
      <CalendarMini />
      <section class="card sky">
        <!-- The live map pulls in Leaflet, so it loads after the rest of Home. -->
        {#await import('../components/MiniRadar.svelte')}
          <div class="radar-wait" style:width={`${radarSize}px`} style:height={`${radarSize}px`}></div>
        {:then { default: MiniRadar }}
          <MiniRadar size={radarSize} radiusMi={25} />
        {/await}
        <div class="skytext">
          <span class="label accent"><Icon name="plane" size={20} />Sky</span>
          {#if hub.config?.trackerEnabled === false && hub.config?.radarEnabled === false}
            <span class="big">Flight data is off</span>
            <span class="muted">Set the home location in Settings → Plane tracker → Location.</span>
          {:else}
            <span class="big">No plane in your box</span>
            <span class="muted">{radarCount} aircraft within {units === 'metric' ? 40 : 25} {distUnit(units)}</span>
          {/if}
          <span class="credit">Map © OpenStreetMap contributors © CARTO · Aircraft: adsb.lol / adsb.fi</span>
        </div>
      </section>
      <RoomsCard />
      <div class="bottom">
        <NextDays days={7} columns={2} />
        <NotesStack />
        <MachinesCard />
      </div>
    </div>
  {/if}

  <AlertsBar />
</div>
</div>

<style>
  .radar-wait {
    flex: none;
    border-radius: 50%;
    border: 2px solid #1f2a36;
    background: #0d1218;
  }
  .credit {
    font-size: 12px;
    color: var(--muted);
  }
  .fit {
    height: 100%;
    overflow: hidden;
  }
  .home {
    padding: 36px 52px 30px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 26px;
  }
  /* Layout B: month · sky · rooms on top; the week (wide), notes (narrow)
     and machines (under rooms) below. */
  .idle {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: minmax(0, 41fr) minmax(0, 59fr);
  }
  .bottom {
    grid-column: 1 / -1;
    min-height: 0;
    display: grid;
    /* Machines lines up with the rooms column above (one third of the row). */
    grid-template-columns: minmax(0, 1fr) clamp(240px, 18%, 340px) calc((100% - 52px) / 3);
    gap: 26px;
  }
  .bottom > :global(*),
  .idle > :global(*) {
    min-height: 0;
  }
  .focus {
    grid-template-columns: 0.82fr 2.18fr;
  }
  .side {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .side > :global(:first-child) {
    flex: 1.4;
  }
  .side > :global(:last-child) {
    flex: 1;
  }
  .sky {
    min-height: 0;
    overflow: hidden;
    padding: 20px 24px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .skytext {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 18px;
  }
  .accent {
    color: var(--accent);
  }
  .big {
    font-size: 26px;
    font-weight: 600;
    line-height: 1.15;
  }
  .flightcard {
    border: 1.5px solid color-mix(in srgb, var(--accent) 40%, transparent);
    border-radius: 26px;
    padding: 30px 40px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-height: 0;
    overflow: hidden;
  }
  .badge {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: var(--accent);
    padding: 6px 14px;
    border-radius: 10px;
  }
</style>
