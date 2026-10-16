<script lang="ts">
  import { clock } from '../lib/clock.svelte';
  import { clockParts, longDate, moonName, todayYmd, weatherKind, WEATHER_LABEL } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import WeatherIcon from './WeatherIcon.svelte';

  let { compact = false }: { compact?: boolean } = $props();
  const t = $derived(clockParts(clock.now));
  const w = $derived(hub.tracker?.weather ?? null);
  const forecast = $derived.by(() => {
    const today = todayYmd(clock.now);
    return (w?.forecast ?? []).filter((f) => f.date > today).slice(0, 3);
  });
  const dayName = (ymd: string): string => new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
</script>

<header class="top" class:compact>
  <div class="left">
    <span class="clock">{t.time}<span class="period">{t.period}</span></span>
    <div class="date">
      <span class="day">{longDate(clock.now)}</span>
      {#if !compact && w?.moonPhase !== null && w?.moonPhase !== undefined}
        <span class="moon">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="#2A2440" /><path d="M12 3a9 9 0 0 1 0 18a6 9 0 0 0 0-18z" fill="#D9CFFB" /></svg>
          {moonName(w.moonPhase)}
        </span>
      {/if}
    </div>
  </div>

  {#if w}
    <div class="right">
      <div class="now">
        <WeatherIcon code={w.code} size={compact ? 44 : 72} />
        <div class="nowtext">
          <span class="temp">{w.temperature === null ? '—' : `${Math.round(w.temperature)}°`}</span>
          {#if !compact}<span class="cond">{WEATHER_LABEL[weatherKind(w.code)]}{w.humidity !== null ? ` · ${Math.round(w.humidity)}%` : ''}</span>{/if}
        </div>
      </div>
      {#if compact}
        <span class="inline-fc">{forecast.map((f) => `${dayName(f.date).slice(0, 1)}${dayName(f.date).slice(1, 3).toLowerCase()} ${f.max === null ? '—' : Math.round(f.max)}°`).join(' · ')}</span>
      {:else}
        <div class="fc">
          {#each forecast as f (f.date)}
            <div class="fcday">
              <span class="dn">{dayName(f.date)}</span>
              <WeatherIcon code={f.code} size={28} />
              <span class="hl">{f.max === null ? '—' : Math.round(f.max)}° <span class="lo">{f.min === null ? '' : `${Math.round(f.min)}°`}</span></span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</header>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
  }
  .compact {
    align-items: center;
  }
  .left {
    display: flex;
    align-items: baseline;
    gap: 26px;
  }
  .clock {
    font-size: 112px;
    font-weight: 600;
    letter-spacing: -4px;
    line-height: 0.85;
    font-variant-numeric: tabular-nums;
  }
  .compact .clock {
    font-size: 84px;
    letter-spacing: -3px;
  }
  .period {
    font-size: 36px;
    font-weight: 500;
    color: var(--muted);
    letter-spacing: 0;
    margin-left: 12px;
  }
  .compact .period {
    font-size: 30px;
  }
  .date {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .day {
    font-size: 30px;
    color: var(--text-2);
  }
  .compact .day {
    font-size: 28px;
  }
  .moon {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 20px;
    color: #b7a6f5;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 36px;
  }
  .compact .right {
    gap: 28px;
  }
  .now {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .nowtext {
    display: flex;
    flex-direction: column;
  }
  .temp {
    font-size: 64px;
    font-weight: 600;
    line-height: 0.9;
  }
  .compact .temp {
    font-size: 44px;
  }
  .cond {
    font-size: 18px;
    color: var(--muted);
  }
  .inline-fc {
    font-size: 24px;
    color: var(--muted);
  }
  .fc {
    display: flex;
    gap: 10px;
  }
  .fcday {
    width: 104px;
    padding: 10px 0;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .dn {
    font-size: 16px;
    color: var(--muted);
    font-weight: 600;
    letter-spacing: 1px;
  }
  .hl {
    font-size: 20px;
    font-weight: 600;
  }
  .lo {
    color: var(--faint);
    font-weight: 500;
  }
</style>
