<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import L from 'leaflet';
  import { onDestroy, onMount } from 'svelte';
  import AircraftPhoto from '../components/AircraftPhoto.svelte';
  import Icon from '../components/Icon.svelte';
  import Logo from '../components/Logo.svelte';
  import { api } from '../lib/api';
  import { DELAY_COLORS, distUnit, fmtInt, MAP_CREDIT, shortTime, tileUrl } from '../lib/format';
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
    /** false = adsbdb's usual route for the flight number can't be this plane's (it's elsewhere). */
    routeFits?: boolean | null;
  }

  const MI_TO_M = 1609.344;
  let mapEl = $state<HTMLDivElement>();
  let map = $state.raw<L.Map | null>(null);
  let layer = $state.raw<PlaneLayer | null>(null);
  let selectedHex = $state<string | null>(null);
  let follow = $state(true);
  let details = $state<Details | null>(null);
  let rainLayer = $state.raw<L.TileLayer | null>(null);
  let baseTiles = $state.raw<L.TileLayer | null>(null);
  let baseUrl = '';
  let rainTime = $state<number | null>(null);
  let rainError = $state(false);
  let showRain = $state(readRainPref());

  // Desktop extras; the Pi 3 B kiosk skips both to save CPU.
  const desktop = $derived(!hub.isKiosk);

  function readRainPref(): boolean {
    try {
      return localStorage.getItem('homebase.radarRain') === '1';
    } catch {
      return false;
    }
  }
  function toggleRain(): void {
    showRain = !showRain;
    try {
      localStorage.setItem('homebase.radarRain', showRain ? '1' : '0');
    } catch {
      // Private mode or blocked storage: the toggle still works for this visit.
    }
  }

  const units = $derived(hub.config?.units ?? 'imperial');
  const overhead = $derived(hub.tracker?.flights ?? []);
  const overheadCallsigns = $derived(new Set(overhead.map((f) => f.callsign)));
  const aircraft = $derived(hub.radar?.aircraft ?? []);
  const selected = $derived<RadarAircraft | undefined>(
    aircraft.find((a) => a.hex === selectedHex) ?? aircraft.find((a) => overheadCallsigns.has(a.callsign)) ?? aircraft[0],
  );
  const trackerFlight = $derived(selected ? overhead.find((f) => f.callsign === selected.callsign) : undefined);
  // The tracker's flight only counts for the route when it actually has one.
  const trackerRoute = $derived(trackerFlight && (trackerFlight.origin.code || trackerFlight.destination.code) ? trackerFlight : undefined);
  // adsbdb's usual route, only when the plane can be on it.
  // Not for a plane in the box: there the overhead screen's rule applies (FR24's route or none).
  const scheduleRoute = $derived(!trackerFlight && details?.route && details.routeFits !== false ? details.route : null);

  // Home comes from the plane tracker's Location settings (or Settings → Hub), possibly later.
  const known = (h: { lat: number; lon: number } | undefined | null): h is { lat: number; lon: number } => !!h && !(h.lat === 0 && h.lon === 0);
  const home = $derived(known(hub.radar?.home) ? hub.radar.home : known(hub.config?.home) ? hub.config.home : null);
  const offReason = $derived(hub.radar?.off ?? hub.config?.radarOff ?? null);
  const mapKey = $derived(hub.config?.mapKey !== false);

  onMount(() => {
    hub.setRadarInterest(true);
    if (!mapEl) return;
    const start = home ?? { lat: 0, lon: 0 };
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([start.lat, start.lon], home ? 10 : 6);
    map.attributionControl.setPrefix(false);
    // Tiles load straight from CARTO with the key from Settings → Hub (CARTO's terms).
    baseUrl = tileUrl(hub.config?.mapTileUrl);
    baseTiles = L.tileLayer(baseUrl, {
      maxZoom: 14,
      minZoom: 6,
      // adsb.fi's terms ask for a link to their site; adsb.lol's data is ODbL.
      attribution: `${MAP_CREDIT} · Aircraft: <a href="https://adsb.lol" target="_blank" rel="noopener">adsb.lol</a> / <a href="https://adsb.fi" target="_blank" rel="noopener">adsb.fi</a>`,
    }).addTo(map);
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

  // Range rings and the home dot; re-centre when home becomes known.
  let homeGroup: L.LayerGroup | null = null;
  let centred = '';
  $effect(() => {
    const m = map;
    const h = home;
    if (!m || !h) return;
    const key = `${h.lat},${h.lon}`;
    if (key === centred) return;
    centred = key;
    homeGroup?.remove();
    const g = L.layerGroup();
    for (const mi of [5, 10, 25]) {
      L.circle([h.lat, h.lon], { radius: mi * MI_TO_M, color: '#223040', weight: 1.5, fill: false, interactive: false }).addTo(g);
    }
    L.circleMarker([h.lat, h.lon], { radius: 8, color: '#2dd4bf', fillColor: '#2dd4bf', fillOpacity: 1, weight: 0, interactive: false }).addTo(g);
    g.addTo(m);
    homeGroup = g;
    m.setView([h.lat, h.lon], 10);
  });

  // A new map key (Settings → Hub): load fresh tiles, not the browser's old ones.
  $effect(() => {
    const url = tileUrl(hub.config?.mapTileUrl);
    if (baseTiles && url !== baseUrl) {
      baseUrl = url;
      baseTiles.setUrl(url);
    }
  });

  onDestroy(() => {
    hub.setRadarInterest(false);
    map?.remove();
    map = null;
  });

  // Redraw planes when data or selection changes.
  $effect(() => {
    const t = hub.radar?.updatedAt ? Date.parse(hub.radar.updatedAt) : Date.now();
    layer?.setData(aircraft, overheadCallsigns, selected?.hex ?? null, t);
  });

  // Desktop: glide planes between 5 s polls (~20 fps, paused in background tabs).
  $effect(() => {
    const l = layer;
    if (!l || !desktop) return;
    l.setExtrapolation(true);
    let raf = 0;
    let last = 0;
    const tick = (t: number): void => {
      if (t - last > 50) {
        last = t;
        l.redraw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      l.setExtrapolation(false);
    };
  });

  // Desktop: RainViewer precipitation radar (latest frame, refreshed every 10 min).
  const RAIN_HOST = 'https://tilecache.rainviewer.com';
  $effect(() => {
    const m = map;
    if (!m || !desktop || !showRain) return;
    let alive = true;
    let tiles: L.TileLayer | null = null;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as { host?: unknown; radar?: { past?: Array<{ time?: unknown; path?: unknown }> } };
        const frame = j.radar?.past?.at(-1);
        // Only ever build tile URLs on the expected host from a well-formed path.
        if (j.host !== RAIN_HOST || typeof frame?.path !== 'string' || !/^\/v2\/radar\/[\w-]+$/.test(frame.path) || typeof frame.time !== 'number') {
          throw new Error('unexpected RainViewer response');
        }
        if (!alive) return;
        const url = `${RAIN_HOST}${frame.path}/256/{z}/{x}/{y}/2/1_0.png`;
        if (tiles) tiles.setUrl(url);
        else {
          tiles = L.tileLayer(url, { opacity: 0.6, maxNativeZoom: 7, maxZoom: 14, zIndex: 250, attribution: 'Rain: RainViewer', crossOrigin: false });
          tiles.addTo(m);
          rainLayer = tiles;
        }
        rainTime = frame.time * 1000;
        rainError = false;
      } catch {
        if (alive) rainError = true;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
      tiles?.remove();
      rainLayer = null;
      rainTime = null;
    };
  });

  // Follow the highlighted plane (kiosk default), else stay put.
  $effect(() => {
    if (!map || !follow) return;
    const hot = aircraft.find((a) => overheadCallsigns.has(a.callsign));
    const h = home;
    if (hot) map.panTo([hot.lat, hot.lon], { animate: !hub.isKiosk, duration: 1 });
    else if (h) map.panTo([h.lat, h.lon], { animate: !hub.isKiosk, duration: 1 });
  });

  // Look up route + airframe for the selected plane (cached server-side).
  $effect(() => {
    const a = selected;
    details = null;
    if (!a || trackerRoute) return;
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
      {#if desktop && showRain}
        <div class="row small muted">
          {#if rainError}Rain radar unavailable right now{:else if rainLayer && rainTime}Rain radar · {new Date(rainTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{:else}Loading rain radar…{/if}
        </div>
      {/if}
    </div>

    <div class="overlay controls">
      <button class="btn sq" aria-label="Zoom in" onclick={() => map?.zoomIn()}><Icon name="plus" /></button>
      <button class="btn sq" aria-label="Zoom out" onclick={() => map?.zoomOut()}><Icon name="minus" /></button>
      <button class="btn sq" aria-label="Recenter on home" onclick={recenter}><Icon name="crosshair" /></button>
      {#if desktop}
        <button class="btn sq" class:on={showRain} aria-pressed={showRain} aria-label="Rain radar" title="Rain radar (RainViewer)" onclick={toggleRain}><Icon name="rain" /></button>
      {/if}
    </div>
    <button class="overlay followbtn btn" class:on={follow} onclick={() => (follow = !follow)}>Follow highlighted plane</button>
  </div>

  <aside class="panel">
    {#if !mapKey && !hub.isKiosk}
      <p class="keynote" role="note">The map background needs a free CARTO key (it says “API KEY REQUIRED” without one). Get one at <a href="https://carto.com/basemaps/apikey/" target="_blank" rel="noopener noreferrer">carto.com/basemaps/apikey</a> and paste it in <a href="#/settings">Settings → Hub → Radar &amp; maps</a>.</p>
    {/if}
    {#if selected}
      <div class="who">
        <Logo icao={logoIcao} size={84} />
        <div class="whotext">
          {#if trackerFlight}<span class="badge">Overhead now</span>{/if}
          <span class="name">{trackerFlight?.airline || details?.route?.airline?.name || selected.registration || 'Unknown operator'}</span>
          <span class="mono muted">{selected.callsign || selected.hex.toUpperCase()}</span>
        </div>
      </div>

      {#if trackerRoute || scheduleRoute}
        {@const o = trackerRoute ? { code: trackerRoute.origin.code, name: trackerRoute.origin.name } : { code: scheduleRoute?.origin.code ?? '', name: scheduleRoute?.origin.city ?? '' }}
        {@const d = trackerRoute ? { code: trackerRoute.destination.code, name: trackerRoute.destination.name } : { code: scheduleRoute?.destination.code ?? '', name: scheduleRoute?.destination.city ?? '' }}
        <div class="route">
          <div><span class="code" style:color={trackerRoute ? DELAY_COLORS[trackerRoute.origin.delay] : 'var(--text)'}>{o.code || '—'}</span><span class="muted">{o.name}</span></div>
          <Icon name="right" size={28} />
          <div class="r"><span class="code" style:color={trackerRoute ? DELAY_COLORS[trackerRoute.destination.delay] : 'var(--text)'}>{d.code || '—'}</span><span class="muted">{d.name}</span></div>
        </div>
        {#if !trackerRoute || trackerRoute.routeSource === 'schedule'}<p class="muted small">Usual route for this flight (adsbdb schedule data)</p>{/if}
        {#if trackerRoute?.extra?.diverted}<p class="diverted">Diverted: planned to land at {trackerRoute.extra.plannedDestination}</p>{/if}
      {:else if trackerFlight}
        <p class="muted">Route not found: the tracker’s FR24 lookup had no answer for this flight.</p>
      {:else if details?.route && details.routeFits === false}
        <p class="muted">Route unknown today: this flight number’s usual route ({details.route.origin.code} → {details.route.destination.code}) doesn’t match where the plane is.</p>
      {:else}
        <p class="muted">Route unknown for this flight.</p>
      {/if}

      <div class="grid">
        <div class="tile"><span class="k">Altitude</span><span class="v">{selected.altitudeFt === null ? 'Ground' : `${fmtInt(selected.altitudeFt)} ft`}</span></div>
        <div class="tile"><span class="k">Speed</span><span class="v">{fmtInt(selected.groundSpeedKt)} kt</span></div>
        <div class="tile"><span class="k">Vertical</span><span class="v">{selected.verticalFpm === null ? '—' : `${selected.verticalFpm > 0 ? '+' : ''}${fmtInt(selected.verticalFpm)} fpm`}</span></div>
        <div class="tile"><span class="k">From home</span><span class="v">{selected.distance.toFixed(1)} {distUnit(units)} {selected.direction}</span></div>
        {#if trackerRoute?.flightNumber}<div class="tile"><span class="k">Flight</span><span class="v">{trackerRoute.flightNumber}</span></div>{/if}
        {#if trackerRoute?.times.actualDeparture}
          <div class="tile"><span class="k">Took off</span><span class="v">{shortTime(new Date(trackerRoute.times.actualDeparture * 1000))}</span>{#if trackerRoute.extra?.runwayTakeoff}<span class="muted small">Runway {trackerRoute.extra.runwayTakeoff}</span>{/if}</div>
        {/if}
        {#if trackerRoute?.extra?.tripKm}<div class="tile"><span class="k">Trip</span><span class="v">{units === 'metric' ? `${fmtInt(trackerRoute.extra.tripKm)} km` : `${fmtInt(Math.round(trackerRoute.extra.tripKm / 1.609344))} mi`}</span><span class="muted small">{trackerRoute.origin.code} → {trackerRoute.destination.code}, great-circle</span></div>{/if}
        <div class="tile wide">
          <span class="k">Aircraft</span>
          <span class="v">{trackerFlight?.aircraftName || [details?.airframe?.manufacturer, details?.airframe?.type].filter(Boolean).join(' ') || selected.type || 'Unknown'}</span>
          {#if selected.registration}<span class="muted small">{selected.registration}{selected.type ? ` · ${selected.type}` : ''}</span>{/if}
        </div>
      </div>
      <AircraftPhoto hex={selected.hex} width={440} />
    {:else}
      {#if offReason === 'disabled'}
        <p class="muted">Radar is turned off. Turn it on in <a href="#/settings">Settings → Hub → Radar &amp; maps</a>.</p>
      {:else if offReason === 'no_home' || !home}
        <p class="muted">Radar is waiting for your home location. Set it in <a href="#/tracker-settings">Settings → Plane tracker → Location</a> (Home lat, lon).</p>
      {:else}
        <p class="muted">Waiting for aircraft data…</p>
      {/if}
    {/if}

    {#if aircraft.length > 0}
      <h3 class="label">Nearby · tap to select</h3>
      <ul class="near">
        {#each aircraft.slice(0, 6) as a (a.hex)}
          <li>
            <button class="nearbtn" class:sel={a.hex === selected?.hex} onclick={() => { selectedHex = a.hex; follow = false; }}>
              <span class="mono">{a.callsign || a.hex.toUpperCase()}</span>
              <span class="muted">{a.route ? `${a.route.from} → ${a.route.to}` : a.type}</span>
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
  .keynote {
    margin: 0 0 16px;
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.45;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }
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
  .sq.on {
    color: var(--accent);
    border-color: var(--accent);
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
  .diverted {
    margin: 0;
    color: var(--orange);
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
</style>
