<script lang="ts">
  import { api } from '../lib/api';
  import { clock } from '../lib/clock.svelte';
  import { shortTime, todayYmd, ymdInTz, ymdOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { CalendarEvent, DashboardReminder } from '../lib/types';
  import Icon from './Icon.svelte';

  /**
   * Home's "Next 7 days": reminders and calendar events together, grouped by
   * day, overdue reminders first. Two columns when the card is wide.
   */
  let { days = 7, columns = 1, title = '' }: { days?: number; columns?: 1 | 2; title?: string } = $props();

  const PER_DAY = 6;
  const today = $derived(todayYmd(clock.now));
  let events = $state<CalendarEvent[]>([]);

  $effect(() => {
    void hub.calendarVersion;
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const to = ymdOf(new Date(y, m - 1, d + days));
    let alive = true;
    api
      .get<{ events: CalendarEvent[] }>(`/api/calendar?from=${today}&to=${to}`)
      .then((r) => {
        if (alive) events = r.events.filter((e) => e.sourceId !== 'homebase-workouts');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  type Row =
    | { kind: 'rem'; id: string; title: string; time: string; overdue: boolean; repeat: boolean; shared: boolean; sort: string }
    | { kind: 'ev'; id: string; title: string; time: string; color: string; sort: string };
  interface Section {
    key: string;
    label: string;
    date: string;
    tone: 'over' | 'today' | '';
    rows: Row[];
    more: number;
  }

  const remRow = (r: DashboardReminder, overdue: boolean): Row => ({
    kind: 'rem',
    id: r.id,
    title: r.title || 'Untitled',
    time: overdue ? new Date(r.dueAt).toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + shortTime(new Date(r.dueAt)) : shortTime(new Date(r.dueAt)),
    overdue,
    repeat: r.repeatRule !== 'none',
    shared: r.shared,
    sort: r.dueAt,
  });

  const sections = $derived.by((): Section[] => {
    const reminders = hub.lists?.week?.items ?? [];
    const out: Section[] = [];
    const overdue = reminders.filter((r) => r.overdue && ymdInTz(r.dueAt) < today);
    if (overdue.length > 0) {
      out.push({ key: 'overdue', label: 'Overdue', date: '', tone: 'over', rows: overdue.slice(0, PER_DAY).map((r) => remRow(r, true)), more: Math.max(0, overdue.length - PER_DAY) });
    }
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    for (let i = 0; i < days; i++) {
      const date = new Date(y, m - 1, d + i);
      const ymd = ymdOf(date);
      const rows: Row[] = [];
      for (const r of reminders) if (ymdInTz(r.dueAt) === ymd && !(r.overdue && ymd < today)) rows.push(remRow(r, false));
      for (const e of events) {
        const on = e.allDay ? e.start <= ymd && ymd < e.end : ymdInTz(e.start) === ymd;
        if (on) rows.push({ kind: 'ev', id: `${e.id}:${ymd}`, title: e.title, time: e.allDay ? 'All day' : shortTime(new Date(e.start)), color: e.color, sort: e.allDay ? `${ymd}T00` : e.start });
      }
      rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
      out.push({
        key: ymd,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-US', { weekday: 'long' }),
        date: i < 2 ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        tone: i === 0 ? 'today' : '',
        rows: rows.slice(0, PER_DAY),
        more: Math.max(0, rows.length - PER_DAY),
      });
    }
    return out;
  });

  /** Split into columns at a day boundary, balancing the number of lines. */
  const cols = $derived.by((): Section[][] => {
    if (columns === 1) return [sections];
    const weight = (s: Section): number => 1 + Math.max(1, s.rows.length) * 1.2;
    const total = sections.reduce((n, s) => n + weight(s), 0);
    let acc = 0;
    let cut = sections.length;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s) continue;
      if (acc + weight(s) / 2 > total / 2) {
        cut = Math.max(1, i);
        break;
      }
      acc += weight(s);
    }
    return [sections.slice(0, cut), sections.slice(cut)];
  });

  const counts = $derived.by(() => {
    let r = 0;
    let e = 0;
    for (const s of sections) {
      for (const row of s.rows) {
        if (row.kind === 'rem') r += 1;
        else e += 1;
      }
    }
    return { r, e };
  });
</script>

<section class="card days" class:two={columns === 2} aria-label={title || `Next ${days} days`}>
  <header>
    <span class="label"><Icon name="bell" size={20} />{title || `Next ${days} days`}</span>
    <span class="muted count">{counts.r} reminder{counts.r === 1 ? '' : 's'}{counts.e ? ` · ${counts.e} event${counts.e === 1 ? '' : 's'}` : ''}</span>
  </header>
  <div class="cols">
    {#each cols as col, ci (ci)}
      <div class="col">
        {#each col as s (s.key)}
          <div class="dayh {s.tone}">
            {s.label}{#if s.date}<span class="dt">{s.date}</span>{/if}
            {#if s.rows.length === 0}<span class="empty">Nothing planned</span>{/if}
          </div>
          {#each s.rows as row (row.id)}
            {#if row.kind === 'rem'}
              <div class="row">
                <span class="ring" class:over={row.overdue}></span>
                <span class="title">{row.title}{#if row.repeat}<span class="tag" title="Repeats"><Icon name="repeat" size={14} label="Repeats" /></span>{/if}{#if row.shared}<span class="tag sh" title="Shared"><Icon name="share" size={14} label="Shared" /></span>{/if}</span>
                <span class="time" class:over={row.overdue}>{row.time}</span>
              </div>
            {:else}
              <div class="row ev">
                <span class="bar" style:background={row.color}></span>
                <span class="title">{row.title}</span>
                <span class="time">{row.time}</span>
              </div>
            {/if}
          {/each}
          {#if s.more > 0}<div class="more">+{s.more} more</div>{/if}
        {/each}
      </div>
    {/each}
  </div>
</section>

<style>
  .days {
    min-height: 0;
    overflow: hidden;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .label {
    color: var(--rem);
  }
  .count {
    font-size: 15px;
  }
  .cols {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
  }
  .two .cols {
    grid-template-columns: 1fr 1fr;
  }
  .col {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .two .col + .col {
    border-left: 1px solid var(--line);
    padding-left: 30px;
    margin-left: 30px;
  }
  .dayh {
    display: flex;
    align-items: baseline;
    gap: 10px;
    white-space: nowrap;
    overflow: hidden;
    margin: 8px 0 1px;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1.6px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .dayh.over {
    color: var(--orange);
  }
  .dayh.today {
    color: var(--accent);
  }
  .dt,
  .empty {
    letter-spacing: 0;
    text-transform: none;
    font-weight: 500;
    color: var(--faint);
  }
  .empty {
    margin-left: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0;
    font-size: 19px;
    line-height: 1.2;
  }
  .ring {
    width: 21px;
    height: 21px;
    flex: none;
    border-radius: 50%;
    border: 2.5px solid var(--rem);
  }
  .ring.over {
    border-color: var(--orange);
  }
  .bar {
    width: 5px;
    height: 22px;
    flex: none;
    border-radius: 3px;
    margin: 0 8px;
  }
  .title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ev .title {
    color: var(--text-2);
  }
  .tag {
    display: inline-flex;
    vertical-align: -1px;
    margin-left: 8px;
    color: var(--rem);
  }
  .tag.sh {
    color: var(--blue);
  }
  .time {
    font-size: 16px;
    color: var(--muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .time.over {
    color: var(--orange);
    font-weight: 600;
  }
  .more {
    font-size: 14px;
    color: var(--faint);
    padding: 2px 0 2px 35px;
  }
</style>
