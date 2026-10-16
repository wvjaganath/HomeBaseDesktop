<script lang="ts">
  import { api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { shortTime, todayYmd, ymdInTz, ymdOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { CalendarEvent } from '../lib/types';
  import Icon from './Icon.svelte';

  let { limit = 3 }: { limit?: number } = $props();
  let events = $state<CalendarEvent[]>([]);
  const today = $derived(todayYmd(clock.now));

  $effect(() => {
    void hub.calendarVersion;
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const to = ymdOf(new Date(y, m - 1, d + 7));
    let alive = true;
    api
      .get<{ events: CalendarEvent[] }>(`/api/calendar?from=${today}&to=${to}`)
      .then((r) => {
        if (alive) events = r.events;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  const upcoming = $derived(
    events.filter((e) => (e.allDay ? e.end > today : new Date(e.end).getTime() > clock.now.getTime())).slice(0, limit),
  );

  function when(e: CalendarEvent): string {
    const day = e.allDay ? e.start : ymdInTz(e.start);
    const label = day <= today ? 'Today' : new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    return e.allDay ? `${label} · all day` : `${label} ${shortTime(new Date(e.start))}`;
  }
</script>

<section class="card upnext">
  <span class="label cal"><Icon name="calendar" size={20} />Up next</span>
  {#each upcoming as e (e.id)}
    <div class="ev">
      <span class="when mono" style:color={e.color}>{when(e)}</span>
      <span class="title">{e.title}</span>
    </div>
  {:else}
    <p class="muted">Nothing in the next 7 days.</p>
  {/each}
</section>

<style>
  .upnext {
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    min-height: 0;
  }
  .cal {
    color: var(--cal);
  }
  .ev {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .when {
    font-size: 18px;
  }
  .title {
    font-size: 24px;
    font-weight: 500;
  }
  p {
    margin: 0;
    font-size: 18px;
  }
</style>
