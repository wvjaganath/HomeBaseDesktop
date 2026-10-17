<script lang="ts" module>
  /** One colour per rank, in fixed order (none is the home marker's teal). */
  export const RANK_COLORS = ['#3987e5', '#e5a03a', '#c86bd9', '#e55b5b', '#8bc34a', '#f0d04a', '#5bc0eb', '#ff8a65', '#a1887f', '#9aa5b1'];
</script>

<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import L from 'leaflet';
  import { onDestroy, onMount } from 'svelte';
  import type { FlightRecord } from '../lib/types';

  /**
   * Closest flights: where each plane was when it passed nearest to home.
   * Farthest flights: the far-away airport, the route and (when OpenSky had it)
   * the path flown. Labels are DOM text, never HTML.
   */
  let { records, mode, home, selected = null }: { records: FlightRecord[]; mode: 'closest' | 'farthest'; home: { lat: number; lon: number }; selected?: string | null } = $props();

  const COLORS = RANK_COLORS;
  let el = $state<HTMLDivElement>();
  let map: L.Map | null = null;
  let group: L.FeatureGroup | null = null;

  const label = (text: string): HTMLElement => {
    const s = document.createElement('span');
    s.textContent = text;
    return s;
  };
  /** The copy of a longitude within 180° of home, so everything sits around home on one map. */
  const near = (lon: number): number => lon + 360 * Math.round((home.lon - lon) / 360);
  const pt = (lat: number | null, lon: number | null): [number, number] | null =>
    lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, near(lon)] : null;


  /**
   * Keep a path continuous across the date line (140°E → 170°W draws east, not
   * across the world), then move it next to home by the end nearest home.
   */
  function unwrap(points: Array<[number, number]>): Array<[number, number]> {
    let prev: number | null = null;
    const path = points.map(([lat, lon]): [number, number] => {
      let l = lon;
      if (prev !== null) {
        while (l - prev > 180) l -= 360;
        while (l - prev < -180) l += 360;
      }
      prev = l;
      return [lat, l];
    });
    const first = path[0];
    const last = path.at(-1);
    if (!first || !last) return path;
    const gap = (l: number): number => Math.abs(near(l) - home.lon);
    const anchor = gap(first[1]) <= gap(last[1]) ? first[1] : last[1];
    const shift = near(anchor) - anchor;
    return path.map(([lat, l]) => [lat, l + shift]);
  }

  function draw(): void {
    if (!map) return;
    group?.remove();
    group = L.featureGroup().addTo(map);
    records.forEach((r, i) => {
      if (!group) return;
      const color = COLORS[i % COLORS.length] ?? '#3987e5';
      const dim = selected !== null && selected !== r.callsign;
      const opacity = dim ? 0.25 : 1;
      const name = `${r.callsign}${r.origin.code && r.destination.code ? ` · ${r.origin.code}→${r.destination.code}` : ''}`;
      if (mode === 'closest') {
        const at = pt(r.plane.lat, r.plane.lon);
        if (at) {
          L.polyline([[home.lat, home.lon], at], { color, weight: 1.5, dashArray: '4 4', opacity }).addTo(group);
          L.circleMarker(at, { radius: 8, color: '#0b0f14', weight: 2, fillColor: color, fillOpacity: opacity, opacity })
            .bindTooltip(label(`#${i + 1} ${name}`))
            .addTo(group);
        }
        return;
      }
      const o = pt(r.origin.lat, r.origin.lon);
      const d = pt(r.destination.lat, r.destination.lon);
      if (r.trail.length > 1) L.polyline(unwrap(r.trail), { color, weight: 2, opacity }).addTo(group);
      else if (o && d) L.polyline(unwrap([o, d]), { color, weight: 2, dashArray: '6 6', opacity }).addTo(group);
      const toDest = r.farthest?.from === 'destination';
      const far = toDest ? d : o;
      const code = toDest ? r.destination.code : r.origin.code;
      if (far) {
        L.circleMarker(far, { radius: 8, color: '#0b0f14', weight: 2, fillColor: color, fillOpacity: opacity, opacity })
          .bindTooltip(label(`#${i + 1} ${code} · ${r.callsign}`))
          .addTo(group);
      }
    });
    // Home last, so it stays visible over a plane that passed right above it.
    L.circleMarker([home.lat, home.lon], { radius: 6, color: '#2dd4bf', weight: 3, fillColor: '#0b0f14', fillOpacity: 1 })
      .bindTooltip(label('Home'))
      .addTo(group);
    const b = group.getBounds();
    if (b.isValid()) map.fitBounds(b.pad(0.15), { maxZoom: mode === 'closest' ? 13 : 6 });
  }

  onMount(() => {
    if (!el) return;
    map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true, worldCopyJump: true }).setView([home.lat, home.lon], 9);
    map.attributionControl.setPrefix(false);
    // Tiles come through the hub, which adds the CARTO key (CARTO_API_KEY).
    L.tileLayer('/api/tiles/{z}/{x}/{y}{r}.png', {
      maxZoom: 14,
      minZoom: 1,
      attribution: '© OpenStreetMap contributors © CARTO',
    }).addTo(map);
    draw();
  });
  $effect(() => {
    void records;
    void selected;
    draw();
  });
  onDestroy(() => {
    map?.remove();
    map = null;
  });
</script>

<div class="map" bind:this={el} role="img" aria-label={mode === 'closest' ? 'Map of the closest flights to home' : 'Map of the farthest flights'}></div>

<style>
  .map {
    height: 340px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: #0b0f14;
  }
</style>
