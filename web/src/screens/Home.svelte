<script lang="ts">
  import AlertsBar from '../components/AlertsBar.svelte';
  import FlightHero from '../components/FlightHero.svelte';
  import Icon from '../components/Icon.svelte';
  import MiniRadar from '../components/MiniRadar.svelte';
  import MonthCalendar from '../components/MonthCalendar.svelte';
  import NotesCard from '../components/NotesCard.svelte';
  import RemindersCard from '../components/RemindersCard.svelte';
  import TopBar from '../components/TopBar.svelte';
  import UpNext from '../components/UpNext.svelte';
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
</script>

<div class="home">
  <TopBar compact={!!focus} />

  {#if focus}
    <div class="body focus">
      <div class="side">
        <UpNext limit={3} />
        <RemindersCard limit={2} />
      </div>
      <section class="card flightcard">
        <span class="badge"><Icon name="plane" size={18} />Overhead now{flights.length > 1 ? ` · 1 of ${flights.length}` : ''}</span>
        <FlightHero flight={focus} {units} {theme} />
      </section>
    </div>
  {:else}
    <div class="body idle">
      <MonthCalendar maxPerDay={3} />
      <div class="right">
        <section class="card sky">
          <MiniRadar size={220} radiusMi={25} />
          <div class="skytext">
            <span class="label accent"><Icon name="plane" size={20} />Sky</span>
            {#if hub.config?.trackerEnabled === false && hub.config?.radarEnabled === false}
              <span class="big">Flight data is off</span>
              <span class="muted">Set the home location in Settings → Plane tracker → Location.</span>
            {:else}
              <span class="big">No plane in your box</span>
              <span class="muted">{radarCount} aircraft within {units === 'metric' ? 40 : 25} {distUnit(units)}</span>
            {/if}
          </div>
        </section>
        <div class="lists">
          <RemindersCard limit={4} />
          <NotesCard maxItems={5} />
        </div>
      </div>
    </div>
  {/if}

  <AlertsBar />
</div>

<style>
  .home {
    height: 100%;
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
  .idle {
    grid-template-columns: 1.62fr 1fr;
  }
  .focus {
    grid-template-columns: 0.82fr 2.18fr;
  }
  .right,
  .side {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .side > :global(*) {
    flex: 1;
  }
  .lists {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 22px;
  }
  .sky {
    padding: 22px 26px;
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
