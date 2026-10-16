<script lang="ts">
  import { api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { compactTime, monthYear, todayYmd, ymdInTz, ymdOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { CalendarEvent, CalendarSource } from '../lib/types';
  import Icon from './Icon.svelte';

  let { maxPerDay = 3, showLegend = true }: { maxPerDay?: number; showLegend?: boolean } = $props();

  const today = $derived(todayYmd(clock.now));
  let offset = $state(0);
  let events = $state<CalendarEvent[]>([]);
  let sources = $state<CalendarSource[]>([]);
  let loadError = $state(false);

  const base = $derived.by(() => {
    const [y, m] = today.split('-').map(Number) as [number, number];
    const first = new Date(y, m - 1 + offset, 1);
    return { y: first.getFullYear(), m: first.getMonth() };
  });

  const grid = $derived.by(() => {
    const first = new Date(base.y, base.m, 1);
    const startDow = first.getDay();
    const daysIn = new Date(base.y, base.m + 1, 0).getDate();
    const rows = Math.ceil((startDow + daysIn) / 7);
    const days: Array<{ ymd: string; day: number; inMonth: boolean }> = [];
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(base.y, base.m, 1 - startDow + i);
      days.push({ ymd: ymdOf(d), day: d.getDate(), inMonth: d.getMonth() === base.m });
    }
    return { rows, days, from: days[0]?.ymd ?? '', to: ymdOf(new Date(base.y, base.m, 1 - startDow + rows * 7)) };
  });

  $effect(() => {
    const { from, to } = grid;
    void hub.calendarVersion;
    let cancelled = false;
    api
      .get<{ events: CalendarEvent[]; sources: CalendarSource[] }>(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => {
        if (cancelled) return;
        events = r.events;
        sources = r.sources;
        loadError = false;
      })
      .catch(() => {
        if (!cancelled) loadError = true;
      });
    return () => {
      cancelled = true;
    };
  });

  const byDay = $derived.by(() => {
    // Rebuilt from scratch on each change; never mutated afterwards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, CalendarEvent[]>();
    for (const day of grid.days) map.set(day.ymd, []);
    for (const ev of events) {
      if (ev.allDay) {
        for (const day of grid.days) if (day.ymd >= ev.start && day.ymd < ev.end) map.get(day.ymd)?.push(ev);
      } else {
        map.get(ymdInTz(ev.start))?.push(ev);
      }
    }
    return map;
  });

  const perCell = $derived(grid.rows > 5 ? Math.max(1, maxPerDay - 1) : maxPerDay);
  const legend = $derived([
    ...sources.map((s) => ({ name: s.name, color: s.color, ok: s.ok })),
    ...(events.some((e) => e.sourceId === 'homebase-workouts') ? [{ name: 'Workouts', color: '#60A5FA', ok: true }] : []),
  ]);
</script>

<section class="cal card" aria-label="Calendar">
  <header>
    <span class="icon"><Icon name="calendar" size={26} /></span>
    <h2>{monthYear(base.y, base.m)}</h2>
    <div class="nav">
      <button class="btn square" aria-label="Previous month" onclick={() => (offset -= 1)}><Icon name="left" size={20} /></button>
      <button class="btn square" aria-label="Next month" onclick={() => (offset += 1)}><Icon name="right" size={20} /></button>
      <button class="btn today" class:active={offset !== 0} onclick={() => (offset = 0)}>Today</button>
    </div>
    {#if showLegend}
      <ul class="legend">
        {#each legend as l (l.name)}
          <li><span class="dot" style:background={l.color}></span>{l.name}{#if l.ok === false}<span class="warn" title="Couldn't refresh">!</span>{/if}</li>
        {/each}
      </ul>
    {/if}
  </header>

  <div class="weekdays" aria-hidden="true">
    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
  </div>

  <div class="grid" style:grid-template-rows={`repeat(${grid.rows}, minmax(0, 1fr))`}>
    {#each grid.days as day (day.ymd)}
      {@const list = byDay.get(day.ymd) ?? []}
      <div class="day" class:out={!day.inMonth} class:today={day.ymd === today}>
        <span class="num">{day.day}</span>
        {#each list.slice(0, perCell) as ev (ev.id)}
          {#if ev.allDay}
            <span class="allday" style:--c={ev.color}>{ev.title}</span>
          {:else}
            <span class="timed"><span class="dot" style:background={ev.color}></span><span class="t">{compactTime(new Date(ev.start))}</span><span class="title">{ev.title}</span></span>
          {/if}
        {/each}
        {#if list.length > perCell}
          <span class="more">+{list.length - perCell} more</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if loadError}<p class="err">Calendar unavailable right now.</p>{/if}
  {#if legend.length === 0 && !loadError}<p class="hint">Add Google calendars in Settings → Calendars.</p>{/if}
</section>

<style>
  .cal {
    min-height: 0;
    height: 100%;
    padding: 22px 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .icon {
    color: var(--cal);
    display: flex;
  }
  h2 {
    margin: 0;
    font-size: 34px;
    font-weight: 600;
    letter-spacing: -0.5px;
    min-width: 300px;
  }
  .nav {
    display: flex;
    gap: 8px;
  }
  .square {
    width: 48px;
    min-height: 48px;
    padding: 0;
  }
  .today {
    min-height: 48px;
    color: var(--muted);
  }
  .today.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .legend {
    margin: 0 0 0 auto;
    padding: 0;
    list-style: none;
    display: flex;
    gap: 18px;
    font-size: 15px;
    color: var(--muted);
    flex-wrap: wrap;
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .warn {
    color: var(--orange);
    font-weight: 700;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .weekdays {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
    padding: 0 4px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--faint);
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
  .day {
    min-height: 0;
    overflow: hidden;
    border-radius: 12px;
    padding: 8px 9px;
    background: var(--surface-2);
    border: 1.5px solid #182029;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .day.out {
    background: transparent;
    border-color: #141a21;
    opacity: 0.45;
  }
  .day.today {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .num {
    align-self: flex-start;
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    border-radius: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
  }
  .today .num {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .allday {
    display: block;
    padding: 2px 7px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .timed {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
  }
  .timed .dot {
    width: 7px;
    height: 7px;
  }
  .t {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--muted);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    color: #d5dce4;
  }
  .more {
    font-size: 13px;
    color: var(--muted);
  }
  .err,
  .hint {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
</style>
