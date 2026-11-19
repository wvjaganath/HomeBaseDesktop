<script lang="ts">
  import { api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { monthYear, todayYmd, ymdInTz, ymdOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { CalendarEvent, CalendarSource } from '../lib/types';
  import Icon from './Icon.svelte';

  /**
   * Home's month: every day of the month, readable from across the room, with
   * up to three coloured dots for what's on (calendar events, workouts,
   * reminders). Event titles are in "Next 7 days" and on the Calendar tab.
   */
  const REMINDER = '#c4b5fd';
  const WORKOUT = '#60A5FA';

  const today = $derived(todayYmd(clock.now));
  let offset = $state(0);
  let events = $state<CalendarEvent[]>([]);
  let sources = $state<CalendarSource[]>([]);

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
    const days: Array<{ ymd: string; day: number; inMonth: boolean; weekend: boolean }> = [];
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(base.y, base.m, 1 - startDow + i);
      days.push({ ymd: ymdOf(d), day: d.getDate(), inMonth: d.getMonth() === base.m, weekend: i % 7 === 0 || i % 7 === 6 });
    }
    return { rows, days, from: days[0]?.ymd ?? '', to: ymdOf(new Date(base.y, base.m, 1 - startDow + rows * 7)) };
  });

  $effect(() => {
    const { from, to } = grid;
    void hub.calendarVersion;
    let alive = true;
    api
      .get<{ events: CalendarEvent[]; sources: CalendarSource[] }>(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => {
        if (!alive) return;
        events = r.events;
        sources = r.sources;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  /** Colours per day: events first (one dot per colour), then reminders. */
  const dots = $derived.by(() => {
    // Rebuilt from scratch on each change; never mutated afterwards.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const map = new Map<string, string[]>();
    const add = (ymd: string, color: string): void => {
      const list = map.get(ymd) ?? [];
      if (!list.includes(color)) list.push(color);
      map.set(ymd, list);
    };
    for (const ev of events) {
      if (ev.allDay) {
        for (const day of grid.days) if (day.ymd >= ev.start && day.ymd < ev.end) add(day.ymd, ev.color);
      } else {
        add(ymdInTz(ev.start), ev.color);
      }
    }
    const reminders = [...(hub.lists?.week?.items ?? []), ...(hub.lists?.reminders.items ?? [])];
    for (const r of reminders) add(ymdInTz(r.dueAt), REMINDER);
    return map;
  });

  const legend = $derived([
    ...sources.map((s) => ({ name: s.name, color: s.color })),
    ...(events.some((e) => e.sourceId === 'homebase-workouts') ? [{ name: 'Workouts', color: WORKOUT }] : []),
    { name: 'Reminders', color: REMINDER },
  ]);
</script>

<section class="card cal" aria-label="Calendar">
  <header>
    <span class="label"><Icon name="calendar" size={20} />{monthYear(base.y, base.m)}</span>
    <div class="nav">
      <button class="nb" aria-label="Previous month" onclick={() => (offset -= 1)}><Icon name="left" size={18} /></button>
      {#if offset !== 0}<button class="nb today" onclick={() => (offset = 0)}>Today</button>{/if}
      <button class="nb" aria-label="Next month" onclick={() => (offset += 1)}><Icon name="right" size={18} /></button>
    </div>
  </header>

  <div class="wk" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>

  <div class="grid" style:grid-template-rows={`repeat(${grid.rows}, minmax(0, 1fr))`}>
    {#each grid.days as day (day.ymd)}
      {@const list = dots.get(day.ymd) ?? []}
      <div class="day" class:out={!day.inMonth} class:past={day.inMonth && day.ymd < today} class:weekend={day.weekend} class:today={day.ymd === today} aria-label={`${day.ymd}${list.length ? `, ${list.length} kinds of plans` : ''}`}>
        <span class="num">{day.day}</span>
        <span class="dots">{#each list.slice(0, 3) as c (c)}<i style:background={c}></i>{/each}</span>
      </div>
    {/each}
  </div>

  <ul class="legend">
    {#each legend as l (l.name)}<li><i style:background={l.color}></i>{l.name}</li>{/each}
  </ul>
</section>

<style>
  .cal {
    min-height: 0;
    overflow: hidden;
    padding: 18px 22px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .label {
    color: var(--cal);
  }
  .nav {
    display: flex;
    gap: 8px;
  }
  .nb {
    min-width: 34px;
    height: 34px;
    padding: 0 8px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: transparent;
    color: var(--muted);
    display: grid;
    place-items: center;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .nb.today {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line-2));
  }
  .wk {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--faint);
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .day {
    min-height: 0;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }
  .num {
    font-size: 19px;
    font-weight: 550;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .weekend .num {
    color: var(--text-2);
  }
  .past .num {
    color: var(--muted);
  }
  .out .num {
    color: #3a4553;
  }
  .today {
    background: var(--accent);
  }
  .today .num {
    color: var(--accent-ink);
    font-weight: 750;
  }
  .dots {
    display: flex;
    gap: 4px;
    height: 7px;
  }
  .dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .today .dots i {
    outline: 1.5px solid var(--accent-ink);
  }
  .legend {
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 13px;
    color: var(--muted);
  }
  .legend i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
  }
</style>
