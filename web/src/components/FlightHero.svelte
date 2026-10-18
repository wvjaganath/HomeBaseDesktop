<script lang="ts">
  import { DELAY_COLORS, distUnit, fmtInt, shortTime } from '../lib/format';
  import type { Flight } from '../lib/types';
  import AircraftPhoto from './AircraftPhoto.svelte';
  import Logo from './Logo.svelte';

  let {
    flight,
    units = 'imperial',
    theme = 'clean',
    scale = 'home',
  }: { flight: Flight; units?: 'imperial' | 'metric'; theme?: 'clean' | 'led'; scale?: 'home' | 'board' } = $props();

  const u = $derived(distUnit(units));
  const progressPct = $derived(flight.progress === null ? null : Math.round(Math.min(1, Math.max(0, flight.progress)) * 100));
  // Arrow colour moves from red (just departed) to green (arriving), as on the LED.
  const progressColor = $derived(
    progressPct === null ? 'var(--unknown)' : `color-mix(in oklab, var(--ok) ${progressPct}%, var(--bad))`,
  );
  const climbing = $derived((flight.position.verticalFpm ?? 0) > 200);
  const descending = $derived((flight.position.verticalFpm ?? 0) < -200);
  const eta = $derived(flight.times.estimatedArrival ?? flight.times.scheduledArrival);
  const dep = $derived(flight.times.actualDeparture);
  const depText = $derived.by(() => {
    if (!flight.origin.code && !flight.destination.code) return 'Route not found (the flight lookup had no answer)';
    if (dep === null) return 'Departure time unavailable';
    const late = flight.times.scheduledDeparture ? Math.round((dep - flight.times.scheduledDeparture) / 60) : null;
    const when = `Departed ${shortTime(new Date(dep * 1000))}`;
    if (late === null) return when;
    return late <= 5 ? `${when} · on time` : `${when} · ${late} min late`;
  });
</script>

<div class="hero" class:led={theme === 'led'} class:board={scale === 'board'}>
  <div class="head">
    <Logo icao={flight.logoIcao} size={scale === 'board' ? 180 : 140} alt={flight.airline} />
    <div class="who">
      <span class="airline">{flight.airline || flight.callsign}</span>
      <span class="ident">{flight.callsign}{flight.flightNumber ? ` · ${flight.flightNumber}` : ''}{flight.aircraftName || flight.aircraftCode ? ` · ${flight.aircraftName || flight.aircraftCode}` : ''}</span>
    </div>
    <AircraftPhoto hex={flight.icao24} />
  </div>

  <div class="route">
    <div class="end">
      <span class="code" style:color={DELAY_COLORS[flight.origin.delay]}>{flight.origin.code || '—'}</span>
      <span class="city">{flight.origin.name}</span>
      {#if flight.origin.distance !== null}<span class="dist">{fmtInt(flight.origin.distance)} {u}</span>{/if}
    </div>
    <div class="track">
      <div class="bar" role="progressbar" aria-label="Route progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct ?? undefined}>
        <span class="rail"></span>
        <span class="fill" style:width={`${progressPct ?? 0}%`} style:background={progressColor}></span>
        <span class="plane" style:left={`${progressPct ?? 0}%`} style:color={progressColor}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(90 12 12)"><path d="M12 2.5c.8 0 1.3.7 1.3 1.6v5.2l7.2 4.3v1.9l-7.2-2.2v4.4l2.2 1.7v1.5L12 20l-3.5 1v-1.5l2.2-1.7v-4.4l-7.2 2.2v-1.9l7.2-4.3V4.1c0-.9.5-1.6 1.3-1.6z" fill="currentColor" /></g></svg>
        </span>
        <span class="tip"></span>
      </div>
      <div class="meta">
        <span>{depText}</span>
        {#if eta !== null}<span>ETA <strong>{shortTime(new Date(eta * 1000))}</strong></span>{/if}
      </div>
    </div>
    <div class="end right">
      <span class="code" style:color={DELAY_COLORS[flight.destination.delay]}>{flight.destination.code || '—'}</span>
      <span class="city">{flight.destination.name}</span>
      {#if flight.destination.distance !== null}<span class="dist">{fmtInt(flight.destination.distance)} {u}</span>{/if}
    </div>
  </div>

  <div class="stats">
    <div class="stat">
      <span class="k">From home</span>
      <span class="v pink">{flight.fromHome.distance === null ? '—' : flight.fromHome.distance.toFixed(1)} {u} {flight.fromHome.direction}</span>
    </div>
    <div class="stat">
      <span class="k">Altitude</span>
      <span class="v pink">{fmtInt(flight.position.altitudeFt)} ft {#if climbing}<span class="up">↑</span>{:else if descending}<span class="down">↓</span>{/if}</span>
    </div>
    <div class="stat">
      <span class="k">Speed</span>
      <span class="v pink">{fmtInt(flight.position.groundSpeedKt)} kt</span>
    </div>
    <div class="stat">
      <span class="k">Vertical</span>
      <span class="v">{flight.position.verticalFpm === null ? '—' : `${flight.position.verticalFpm > 0 ? '+' : ''}${fmtInt(flight.position.verticalFpm)} fpm`}</span>
    </div>
    <div class="stat">
      <span class="k">Heading</span>
      <span class="v">{flight.position.headingDeg === null ? '—' : `${Math.round(flight.position.headingDeg)}°`}</span>
    </div>
  </div>
</div>

<style>
  .hero {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
    gap: 30px;
    min-height: 0;
  }
  .head {
    display: flex;
    gap: 28px;
    align-items: center;
  }
  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .airline {
    font-size: 50px;
    font-weight: 600;
    letter-spacing: -1px;
    line-height: 1;
  }
  .board .airline {
    font-size: 68px;
  }
  .ident {
    font-family: var(--mono);
    font-size: 24px;
    color: var(--muted);
  }
  .route {
    display: grid;
    grid-template-columns: auto minmax(300px, 1fr) auto;
    gap: 32px;
    align-items: center;
  }
  .end {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .end.right {
    align-items: flex-end;
    text-align: right;
  }
  .code {
    font-size: 144px;
    font-weight: 700;
    letter-spacing: -5px;
    line-height: 0.82;
  }
  .board .code {
    font-size: 230px;
    letter-spacing: -8px;
  }
  .city {
    font-size: 28px;
    font-weight: 500;
    margin-top: 10px;
  }
  .dist {
    font-family: var(--mono);
    font-size: 22px;
    color: #22d3ee;
  }
  .track {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .bar {
    position: relative;
    height: 60px;
  }
  .rail,
  .fill {
    position: absolute;
    left: 0;
    top: 25px;
    height: 10px;
    border-radius: 5px;
  }
  .rail {
    right: 14px;
    background: #1f2a36;
  }
  .plane {
    position: absolute;
    top: 6px;
    width: 48px;
    height: 48px;
    transform: translateX(-50%);
  }
  .plane svg {
    width: 100%;
    height: 100%;
  }
  .tip {
    position: absolute;
    right: -4px;
    top: 18px;
    width: 0;
    height: 0;
    border-top: 12px solid transparent;
    border-bottom: 12px solid transparent;
    border-left: 18px solid #1f2a36;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 21px;
    color: var(--muted);
  }
  .meta strong {
    color: var(--text);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 16px;
  }
  .stat {
    background: var(--surface-2);
    border-radius: 18px;
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .k {
    font-size: 15px;
    color: var(--muted);
    letter-spacing: 1.5px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .v {
    font-size: 30px;
    font-weight: 600;
    white-space: nowrap;
  }
  .up {
    color: var(--ok);
  }
  .down {
    color: var(--orange);
  }

  /* Classic LED theme: dot-matrix type with a soft glow, still vector-sharp. */
  .led .code,
  .led .dist,
  .led .v,
  .led .ident {
    font-family: var(--led);
    letter-spacing: 2px;
    text-shadow: 0 0 18px currentColor;
  }
  .led .airline {
    color: var(--purple);
    text-shadow: 0 0 18px currentColor;
  }
  .led .ident {
    color: var(--warn);
  }
  .led .pink {
    color: #f472b6;
  }
  .led .stat {
    background: #0b0d10;
  }
</style>
