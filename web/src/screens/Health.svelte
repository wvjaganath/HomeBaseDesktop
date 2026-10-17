<script lang="ts">
  import BarChart from '../components/BarChart.svelte';
  import LineChart, { type LineSeries } from '../components/LineChart.svelte';
  import SyncGate from '../components/SyncGate.svelte';
  import { RANGES, rangeStart, ymd, ymdToTime, type Range } from '../lib/dates';
  import { sync, type MeasurementPayload } from '../lib/sync.svelte';

  /**
   * Read-only view of what the iPhones record: HealthKit daily metrics and
   * workouts (mirrored by the app) and manual body measurements.
   */
  type Gran = 'day' | 'month';
  type Unit = 'cm' | 'in';
  const UNIT_KEY = 'homebase.measureUnit';

  // Dark categorical palette (dataviz reference, validated on this surface), fixed order.
  const PARTS: Array<{ key: keyof MeasurementPayload; label: string; color: string }> = [
    { key: 'waistCm', label: 'Waist', color: '#3987e5' },
    { key: 'chestCm', label: 'Chest', color: '#d95926' },
    { key: 'neckCm', label: 'Neck', color: '#199e70' },
    { key: 'leftArmCm', label: 'Left arm', color: '#c98500' },
    { key: 'rightArmCm', label: 'Right arm', color: '#d55181' },
    { key: 'leftThighCm', label: 'Left thigh', color: '#008300' },
    { key: 'rightThighCm', label: 'Right thigh', color: '#9085e9' },
  ];

  let range = $state<Range>('3M');
  let gran = $state<Gran>('day');
  let unit = $state<Unit>(readUnit());
  let shown = $state<Record<string, boolean>>({ waistCm: true, chestCm: true, neckCm: true });
  // Body parts differ a lot in size (neck vs chest), so absolute lines look flat;
  // "Change" indexes every series to its first value in the range (one shared axis).
  let measureMode = $state<'change' | 'value'>('change');

  function readUnit(): Unit {
    try {
      return localStorage.getItem(UNIT_KEY) === 'in' ? 'in' : 'cm';
    } catch {
      return 'cm';
    }
  }
  function setUnit(u: Unit): void {
    unit = u;
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      // per-viewer convenience only
    }
  }

  const start = $derived(rangeStart(range));
  const days = $derived(
    sync
      .list('daily_fitness')
      .filter((d) => d.ownerId === sync.me && d.payload.date >= start)
      .map((d) => d.payload)
      .sort((a, b) => (a.date < b.date ? -1 : 1)),
  );
  const measurements = $derived(
    sync
      .list('measurements')
      .filter((m) => m.ownerId === sync.me && ymd(new Date(m.payload.recordedAt)) >= start)
      .map((m) => m.payload)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1)),
  );
  const workouts = $derived(
    sync
      .list('workouts')
      .filter((w) => w.ownerId === sync.me && ymd(new Date(w.payload.startedAt)) >= start)
      .map((w) => w.payload)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
  );

  /** Day values, or monthly averages (of days that have a value). */
  function bars(pick: (d: (typeof days)[number]) => number | null): Array<{ key: string; label: string; value: number }> {
    if (gran === 'day') {
      return days
        .map((d) => ({ d, v: pick(d) }))
        .filter((x): x is { d: (typeof days)[number]; v: number } => x.v !== null)
        .map(({ d, v }) => ({ key: d.date, label: new Date(ymdToTime(d.date)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), value: v }));
    }
    const byMonth: Record<string, number[]> = {};
    for (const d of days) {
      const v = pick(d);
      if (v === null) continue;
      (byMonth[d.date.slice(0, 7)] ??= []).push(v);
    }
    return Object.entries(byMonth).map(([k, vs]) => ({
      key: k,
      label: new Date(ymdToTime(`${k}-15`)).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      value: vs.reduce((a, b) => a + b, 0) / vs.length,
    }));
  }

  const stepBars = $derived(bars((d) => d.steps));
  const kcalBars = $derived(bars((d) => d.activeKcal));
  const exerciseBars = $derived(bars((d) => d.exerciseMin));
  const hrSeries = $derived<LineSeries[]>([
    { name: 'Resting heart rate', color: '#d95926', points: days.filter((d) => d.restingHr !== null).map((d) => ({ t: ymdToTime(d.date), v: d.restingHr ?? 0 })) },
  ]);
  const measureSeries = $derived<LineSeries[]>(
    PARTS.filter((p) => shown[p.key]).map((p) => {
      const pts = measurements
        .filter((m) => typeof m[p.key] === 'number')
        .map((m) => ({ t: new Date(m.recordedAt).getTime(), v: (m[p.key] as number) / (unit === 'in' ? 2.54 : 1) }));
      const base = pts[0]?.v ?? 0;
      return { name: p.label, color: p.color, points: measureMode === 'change' ? pts.map((x) => ({ t: x.t, v: x.v - base })) : pts };
    }),
  );

  const avg = (xs: Array<{ value: number }>): number | null => (xs.length ? xs.reduce((a, b) => a + b.value, 0) / xs.length : null);
  const latestM = $derived(measurements.at(-1));
  const fmtLen = (cm: number | null | undefined): string => (cm === null || cm === undefined ? '—' : `${(cm / (unit === 'in' ? 2.54 : 1)).toFixed(1)} ${unit}`);
  const fmtDur = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);
  const prettyActivity = (t: string): string => t.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
</script>

<SyncGate>
  <div class="page">
    <div class="page-head">
      <h1>Health</h1>
      <span class="muted">From the iPhone app · read-only</span>
      <div class="seg push" role="group" aria-label="Range">
        {#each RANGES as r (r)}<button class:on={range === r} onclick={() => (range = r)}>{r}</button>{/each}
      </div>
      <div class="seg" role="group" aria-label="Granularity">
        <button class:on={gran === 'day'} onclick={() => (gran = 'day')}>Daily</button>
        <button class:on={gran === 'month'} onclick={() => (gran = 'month')}>Monthly avg</button>
      </div>
    </div>

    {#if days.length === 0 && measurements.length === 0 && workouts.length === 0}
      <div class="card empty">No health data in this range yet. Open Health in the HomeBase iPhone app to sync it.</div>
    {/if}

    <div class="stat-grid">
      <div class="stat"><span class="k">Avg steps</span><span class="v">{avg(stepBars)?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}</span><span class="s">per day</span></div>
      <div class="stat"><span class="k">Resting HR</span><span class="v">{days.findLast((d) => d.restingHr !== null)?.restingHr?.toFixed(0) ?? '—'}</span><span class="s">bpm, latest</span></div>
      <div class="stat"><span class="k">Active energy</span><span class="v">{avg(kcalBars)?.toLocaleString('en-US', { maximumFractionDigits: 0 }) ?? '—'}</span><span class="s">kcal per day</span></div>
      <div class="stat"><span class="k">Workouts</span><span class="v">{workouts.length}</span><span class="s">in range</span></div>
    </div>

    <section class="card section">
      <h2>Steps</h2>
      <BarChart bars={stepBars} color="#3987e5" unit="steps" label="Steps per day" />
    </section>

    <div class="two">
      <section class="card section">
        <h2>Resting heart rate</h2>
        <LineChart series={hrSeries} unit="bpm" decimals={0} height={260} label="Resting heart rate" />
      </section>
      <section class="card section">
        <h2>Active energy</h2>
        <BarChart bars={kcalBars} color="#3987e5" unit="kcal" height={260} label="Active energy per day" />
      </section>
    </div>

    <section class="card section">
      <h2>Exercise minutes</h2>
      <BarChart bars={exerciseBars} color="#3987e5" unit="min" height={220} label="Exercise minutes per day" />
    </section>

    <section class="card section">
      <div class="row between">
        <h2>Body measurements</h2>
        <div class="seg push" role="group" aria-label="Show">
          <button class:on={measureMode === 'change'} onclick={() => (measureMode = 'change')}>Change</button>
          <button class:on={measureMode === 'value'} onclick={() => (measureMode = 'value')}>Size</button>
        </div>
        <div class="seg" role="group" aria-label="Units">
          <button class:on={unit === 'cm'} onclick={() => setUnit('cm')}>cm</button>
          <button class:on={unit === 'in'} onclick={() => setUnit('in')}>in</button>
        </div>
      </div>
      <fieldset class="parts">
        <legend class="sr-only">Body parts to show</legend>
        {#each PARTS as p (p.key)}
          <label class="part"><input type="checkbox" bind:checked={shown[p.key]} /><span class="key" style:background={p.color}></span>{p.label} <span class="muted">{fmtLen(latestM?.[p.key] as number | null | undefined)}</span></label>
        {/each}
      </fieldset>
      <LineChart series={measureSeries} {unit} showLegend={false} signed={measureMode === 'change'} label={measureMode === 'change' ? 'Change in body measurements since the start of the range' : 'Body measurements over time'} />
    </section>

    <section class="card section">
      <h2>Workouts (Apple Health)</h2>
      <ul class="list">
        {#each workouts.slice(0, 40) as w (w.hkUuid)}
          <li>
            <span class="date">{new Date(w.startedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            <span class="grow">{prettyActivity(w.activityType)}</span>
            <span class="muted">{fmtDur(w.durationS)}</span>
            {#if w.distanceM}<span class="muted">{(w.distanceM / 1609.344).toFixed(2)} mi</span>{/if}
            {#if w.kcal}<span class="muted">{Math.round(w.kcal)} kcal</span>{/if}
          </li>
        {:else}
          <li class="muted">No workouts in this range.</li>
        {/each}
      </ul>
    </section>
  </div>
</SyncGate>

<style>
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 18px;
  }
  .between {
    align-items: center;
  }
  .between h2 {
    margin-right: auto;
  }
  .between .push {
    margin-left: 0;
  }
  .parts {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
  }
  .part {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    font-size: 15px;
  }
  .key {
    width: 14px;
    height: 3px;
    border-radius: 2px;
  }
  .date {
    width: 150px;
  }
</style>
