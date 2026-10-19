<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import L from 'leaflet';
  import { onDestroy, onMount } from 'svelte';
  import { tileUrl } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import { PlaneLayer } from '../lib/planeLayer';

  /**
   * The Home page's live radar: the same map and plane layer as the Radar tab,
   * small, round and hands-off (tap to open the Radar tab). Planes glide
   * between the 5-second updates: 20 frames a second on a computer, 5 on the
   * Pi 3 B kiosk to keep it light.
   */
  let { size = 220, radiusMi = 25 }: { size?: number; radiusMi?: number } = $props();

  const MI_TO_M = 1609.344;
  let el = $state<HTMLDivElement>();
  let map = $state.raw<L.Map | null>(null);
  let layer = $state.raw<PlaneLayer | null>(null);
  let tiles: L.TileLayer | null = null;
  let tilesUrl = '';

  const known = (h: { lat: number; lon: number } | undefined | null): h is { lat: number; lon: number } => !!h && !(h.lat === 0 && h.lon === 0);
  const home = $derived(known(hub.radar?.home) ? hub.radar.home : known(hub.config?.home) ? hub.config.home : null);
  const overheadCallsigns = $derived(new Set((hub.tracker?.flights ?? []).map((f) => f.callsign)));
  // Only what's inside the circle (distances come in the screen's units): less to draw on the Pi.
  const reach = $derived((hub.config?.units ?? 'imperial') === 'metric' ? radiusMi * 1.609344 : radiusMi);
  const aircraft = $derived((hub.radar?.aircraft ?? []).filter((a) => a.distance <= reach * 1.05));
  const count = $derived(aircraft.length);

  onMount(() => {
    if (!el) return;
    map = L.map(el, {
      zoomControl: false,
      attributionControl: false, // credited under the map (see Home)
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      preferCanvas: true,
      zoomSnap: 0.25,
      fadeAnimation: false,
    }).setView([home?.lat ?? 0, home?.lon ?? 0], 9);
    tilesUrl = tileUrl(hub.config?.mapTileUrl);
    tiles = L.tileLayer(tilesUrl, { maxZoom: 14, minZoom: 5 }).addTo(map);
    const planes = new PlaneLayer({ iconScale: 0.8, labels: false });
    planes.addTo(map);
    layer = planes;
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // A new map key: new tile address.
  $effect(() => {
    const url = tileUrl(hub.config?.mapTileUrl);
    if (tiles && url !== tilesUrl) {
      tilesUrl = url;
      tiles.setUrl(url);
    }
  });

  // Rings and home dot; frame the chosen radius around home.
  let ringGroup: L.LayerGroup | null = null;
  let framed = '';
  $effect(() => {
    const m = map;
    const h = home;
    if (!m || !h) return;
    const key = `${h.lat},${h.lon},${radiusMi}`;
    if (key === framed) return;
    framed = key;
    ringGroup?.remove();
    const g = L.layerGroup();
    for (const f of [0.33, 0.66, 1]) {
      L.circle([h.lat, h.lon], { radius: radiusMi * f * MI_TO_M, color: '#2a3441', weight: 1.5, fill: false, interactive: false }).addTo(g);
    }
    L.circleMarker([h.lat, h.lon], { radius: 6, color: '#2dd4bf', fillColor: '#2dd4bf', fillOpacity: 1, weight: 0, interactive: false }).addTo(g);
    g.addTo(m);
    ringGroup = g;
    m.invalidateSize();
    m.fitBounds(L.latLng(h.lat, h.lon).toBounds(radiusMi * 2 * MI_TO_M), { animate: false });
  });

  // New positions every update…
  $effect(() => {
    const t = hub.radar?.updatedAt ? Date.parse(hub.radar.updatedAt) : Date.now();
    layer?.setData(aircraft, overheadCallsigns, null, t);
  });

  // …and smooth movement in between.
  $effect(() => {
    const l = layer;
    if (!l) return;
    l.setExtrapolation(true);
    const every = hub.isKiosk ? 200 : 50;
    let raf = 0;
    let last = 0;
    const tick = (t: number): void => {
      if (t - last >= every) {
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
</script>

<a class="mini" href="#/radar" style:width={`${size}px`} style:height={`${size}px`} aria-label={`Live radar: ${count} aircraft nearby. Open the Radar tab`}>
  <div class="map" bind:this={el}></div>
</a>

<style>
  .mini {
    display: block;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid #1f2a36;
    background: #0d1218;
    /* Keeps Leaflet's panes inside the circle in every browser. */
    clip-path: circle(50%);
  }
  .map {
    width: 100%;
    height: 100%;
    background: #0d1218;
    cursor: pointer;
  }
  .map :global(.leaflet-container) {
    background: #0d1218;
  }
</style>
