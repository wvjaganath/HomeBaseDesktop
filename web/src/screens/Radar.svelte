<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import L from 'leaflet';
  import { onDestroy, onMount } from 'svelte';
  import AircraftPhoto from '../components/AircraftPhoto.svelte';
  import Icon from '../components/Icon.svelte';
  import Logo from '../components/Logo.svelte';
  import { api } from '../lib/api';
  import { DELAY_COLORS, distUnit, fmtInt } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import { altitudeColor, PlaneLayer } from '../lib/planeLayer';
  import type { RadarAircraft } from '../lib/types';

  interface Details {
    route: {
      airline: { name: string; icao: string; iata: string } | null;
      origin: { code: string; name: string; city: string };
      destination: { code: string; name: string; city: string };
    } | null;
    airframe: { type: string; manufacturer: string; registration: string; owner: string } | null;
  }

  const MI_TO_M = 1609.344;
  let mapEl = $state<HTMLDivElement>();
  let map = $state.raw<L.Map | null>(null);
  let layer = $state.raw<PlaneLayer | null>(null);
  let selectedHex = $state<string | null>(null);
  let follow = $state(true);
  let details = $state<Details | null>(null);

  const units = $derived(hub.config?.units ?? 'imperial');
  const overhead = $derived(hub.tracker?.flights ?? []);
  const overheadCallsigns = $derived(new Set(overhead.map((f) => f.callsign)));
  const aircraft = $derived(hub.radar?.aircraft ?? []);
  const selected = $derived<RadarAircraft | undefined>(
    aircraft.find((a) => a.hex === selectedHex) ?? aircraft.find((a) => overheadCallsigns.has(a.callsign)) ?? aircraft[0],
  );
  const trackerFlight = $derived(selected ? overhead.find((f) => f.callsign === selected.callsign) : undefined);

  onMount(() => {
    hub.setRadarInterest(true);
    const home = hub.config?.home ?? { lat: 0, lon: 0 };
    if (!mapEl) return;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([home.lat, home.lon], 10);
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 14,
      minZoom: 6,
      attribution: '© OpenStreetMap contributors © CARTO · Aircraft: adsb.lol / adsb.fi',
    }).addTo(map);
    for (const mi of [5, 10, 25]) {
      L.circle([home.lat, home.lon], { radius: mi * MI_TO_M, color: '#223040', weight: 1.5, fill: false, interactive: false }).addTo(map);
    }
    L.circleMarker([home.lat, home.lon], { radius: 8, color: '#2dd4bf', fillColor: '#2dd4bf', fillOpacity: 1, weight: 0, interactive: false }).addTo(map);
    const planes = new PlaneLayer();
    planes.addTo(map);
    layer = planes;
    map.on('click', (e: L.LeafletMouseEvent) => {
      const hex = planes.hitTest(e.containerPoint);
      if (hex) {
        selectedHex = hex;
        follow = false;
      }
    });
    map.on('dragstart', () => (follow = false));
  });

  onDestroy(() => {
    hub.setRadarInterest(false);
    map?.remove();
    map = null;
  });

  // Redraw planes when data or selection changes.
  $effect(() => {
    layer?.setData(aircraft, overheadCallsigns, selected?.hex ?? null);
  });

  // Follow the highlighted plane (kiosk default), else stay put.
  $effect(() => {
    if (!map || !follow) return;
    const hot = aircraft.find((a) => overheadCallsigns.has(a.callsign));
    const home = hub.config?.home;
    if (hot) map.panTo([hot.lat, hot.lon], { animate: !hub.isKiosk, duration: 1 });
    else if (home) map.panTo([home.lat, home.lon], { animate: !hub.isKiosk, duration: 1 });
  });

  // Look up route + airframe for the selected plane (cached server-side).
  $effect(() => {
    const a = selected;
    details = null;
    if (!a || trackerFlight) return;
    let alive = true;
    const qs = a.callsign ? `?callsign=${encodeURIComponent(a.callsign)}` : '';
    api
      .get<Details>(`/api/radar/details/${a.hex}${qs}`)
      .then((d) => {
        if (alive) details = d;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  function recenter(): void {
    follow = true;
    selectedHex = null;
    const home = hub.config?.home;
    if (map && home) map.setView([home.lat, home.lon], 10);
  }

  const logoIcao = $derived(
    trackerFlight?.logoIcao ?? details?.route?.airline?.icao ?? (selected && /^[A-Z]{3}\d/.test(selected.callsign) ? selected.callsign.slice(0, 3) : ''),
  );
</script>

<div class="radar">
  <div class="mapwrap">
    <div class="map" bind:this={mapEl} role="application" aria-label="Radar map"></div>

    <div class="overlay legend">
      <div class="row">
        <span class="label accent">Radar</span>
        <span class="muted">{aircraft.length} aircraft{hub.radar?.source ? ` · ${hub.radar.source}` : ''}</span>
      </div>
      <div class="row small">
        <span><i class="sw" style:background={altitudeColor(1000)}></i>&lt; 5k ft</span>
        <span><i class="sw" style:background={altitudeColor(10000)}></i>5–15k</span>
        <span><i class="sw" style:background={altitudeColor(20000)}></i>15–30k</span>
        <span><i class="sw" style:background={altitudeColor(35000)}></i>30k+</span>
      </div>
    </div>

    <div class="overlay controls">
      <button class="btn sq" aria-label="Zoom in" onclick={() => map?.zoomIn()}><Icon name="plus" /></button>
      <button class="btn sq" aria-label="Zoom out" onclick={() => map?.zoomOut()}><Icon name="minus" /></button>
      <button class="btn sq" aria-label="Recenter on home" onclick={recenter}><Icon name="crosshair" /></button>
    </div>
    <button class="overlay followbtn btn" class:on={follow} onclick={() => (follow = !follow)}>Follow highlighted plane</button>
  </div>

  <aside class="panel">
    {#if selected}
      <div class="who">
        <Logo icao={logoIcao} size={84} />
        <div class="whotext">
          {#if trackerFlight}<span class="badge">Overhead now</span>{/if}
          <span class="name">{trackerFlight?.airline || details?.route?.airline?.name || selected.registration || 'Unknown operator'}</span>
          <span class="mono muted">{selected.callsign || selected.hex.toUpperCase()}</span>
        </div>
      </div>

      {#if trackerFlight || details?.route}
        {@const o = trackerFlight ? { code: trackerFlight.origin.code, name: trackerFlight.origin.name } : { code: details?.route?.origin.code ?? '', name: details?.route?.origin.city ?? '' }}
        {@const d = trackerFlight ? { code: trackerFlight.destination.code, name: trackerFlight.destination.name } : { code: details?.route?.destination.code ?? '', name: details?.route?.destination.city ?? '' }}
        <div class="route">
          <div><span class="code" style:color={trackerFlight ? DELAY_COLORS[trackerFlight.origin.delay] : 'var(--text)'}>{o.code || '—'}</span><span class="muted">{o.name}</span></div>
          <Icon name="right" size={28} />
          <div class="r"><span class="code" style:color={trackerFlight ? DELAY_COLORS[trackerFlight.destination.delay] : 'var(--text)'}>{d.code || '—'}</span><span class="muted">{d.name}</span></div>
        </div>
      {:else}
        <p class="muted">Route unknown for this flight.</p>
      {/if}

      <div class="grid">
        <div class="tile"><span class="k">Altitude</span><span class="v">{selected.altitudeFt === null ? 'Ground' : `${fmtInt(selected.altitudeFt)} ft`}</span></div>
        <div class="tile"><span class="k">Speed</span><span class="v">{fmtInt(selected.groundSpeedKt)} kt</span></div>
        <div class="tile"><span class="k">Vertical</span><span class="v">{selected.verticalFpm === null ? '—' : `${selected.verticalFpm > 0 ? '+' : ''}${fmtInt(selected.verticalFpm)} fpm`}</span></div>
        <div class="tile"><span class="k">From home</span><span class="v">{selected.distance.toFixed(1)} {distUnit(units)} {selected.direction}</span></div>
        <div class="tile wide">
          <span class="k">Aircraft</span>
          <span class="v">{trackerFlight?.aircraftName || [details?.airframe?.manufacturer, details?.airframe?.type].filter(Boolean).join(' ') || selected.type || 'Unknown'}</span>
          {#if selected.registration}<span class="muted small">{selected.registration}{selected.type ? ` · ${selected.type}` : ''}</span>{/if}
        </div>
      </div>
      <AircraftPhoto hex={selected.hex} width={440} />
    {:else}
      <p class="muted">{hub.config?.radarEnabled === false ? 'Radar is off. Set HOME_LAT / HOME_LON in the hub config.' : 'Waiting for aircraft data…'}</p>
    {/if}

    {#if aircraft.length > 0}
      <h3 class="label">Nearby · tap to select</h3>
      <ul class="near">
        {#each aircraft.slice(0, 6) as a (a.hex)}
          <li>
            <button class="nearbtn" class:sel={a.hex === selected?.hex} onclick={() => { selectedHex = a.hex; follow = false; }}>
              <span class="mono">{a.callsign || a.hex.toUpperCase()}</span>
              <span class="muted">{a.type}</span>
              <span style:color={altitudeColor(a.altitudeFt)}>{a.altitudeFt === null ? 'GND' : `${Math.round(a.altitudeFt / 1000)}k`}</span>
              <span class="muted">{a.distance.toFixed(1)} {distUnit(units)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
</div>

<style>
  .radar {
    height: 100%;
    display: flex;
  }
  .mapwrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .map {
    position: absolute;
    inset: 0;
    background: #0d1218;
  }
  .overlay {
    position: absolute;
    z-index: 500;
  }
  .legend {
    left: 28px;
    top: 28px;
    padding: 18px 20px;
    border-radius: 18px;
    background: rgba(10, 13, 18, 0.9);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: flex;
    gap: 14px;
    align-items: baseline;
  }
  .small {
    font-size: 15px;
    color: var(--text-2);
  }
  .small span {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
  }
  .accent {
    color: var(--accent);
  }
  .controls {
    right: 28px;
    top: 28px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sq {
    width: 52px;
    min-height: 52px;
    padding: 0;
    background: rgba(10, 13, 18, 0.9);
  }
  .followbtn {
    left: 28px;
    bottom: 34px;
    background: rgba(10, 13, 18, 0.9);
    color: var(--muted);
  }
  .followbtn.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .panel {
    width: 520px;
    flex-shrink: 0;
    padding: 32px;
    border-left: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 22px;
    overflow-y: auto;
  }
  .who {
    display: flex;
    gap: 18px;
    align-items: center;
  }
  .whotext {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .badge {
    align-self: flex-start;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: var(--accent);
    padding: 3px 9px;
    border-radius: 7px;
  }
  .name {
    font-size: 28px;
    font-weight: 600;
  }
  .route {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: var(--faint);
  }
  .route > div {
    display: flex;
    flex-direction: column;
  }
  .route .r {
    align-items: flex-end;
    text-align: right;
  }
  .code {
    font-size: 64px;
    font-weight: 700;
    letter-spacing: -2px;
    line-height: 0.95;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .tile {
    background: var(--surface);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tile.wide {
    grid-column: span 2;
  }
  .k {
    font-size: 13px;
    color: var(--muted);
    letter-spacing: 1.5px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .v {
    font-size: 24px;
    font-weight: 600;
  }
  h3 {
    margin: 8px 0 0;
    font-size: 14px;
    color: var(--muted);
  }
  .near {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .nearbtn {
    width: 100%;
    display: grid;
    grid-template-columns: 1.3fr 1fr 0.6fr 0.8fr;
    gap: 8px;
    padding: 12px 6px;
    border: none;
    border-top: 1px solid var(--line);
    background: transparent;
    text-align: left;
    font-size: 18px;
    cursor: pointer;
  }
  .nearbtn.sel {
    background: var(--surface);
  }
  p {
    margin: 0;
  }
  :global(.leaflet-container) {
    font-family: var(--font);
    background: #0d1218;
  }
  :global(.leaflet-control-attribution) {
    background: rgba(10, 13, 18, 0.8) !important;
    color: var(--faint) !important;
    font-size: 12px;
  }
  :global(.leaflet-control-attribution a) {
    color: var(--muted) !important;
  }
</style>
