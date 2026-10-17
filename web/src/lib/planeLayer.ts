import L from 'leaflet';
import type { RadarAircraft } from './types';

const PLANE = new Path2D(
  'M12 2.5c.8 0 1.3.7 1.3 1.6v5.2l7.2 4.3v1.9l-7.2-2.2v4.4l2.2 1.7v1.5L12 20l-3.5 1v-1.5l2.2-1.7v-4.4l-7.2 2.2v-1.9l7.2-4.3V4.1c0-.9.5-1.6 1.3-1.6z',
);

export function altitudeColor(ft: number | null): string {
  if (ft === null) return '#6b7787';
  if (ft < 5000) return '#fb923c';
  if (ft < 15000) return '#facc15';
  if (ft < 30000) return '#22d3ee';
  return '#a78bfa';
}

/**
 * All aircraft drawn on a single canvas (cheap on a Pi 3 B: no DOM node per
 * plane, no WebGL). Redrawn on map moves and when new data arrives.
 */
export class PlaneLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private data: RadarAircraft[] = [];
  private highlight = new Set<string>();
  private selected: string | null = null;
  private labelCount = 8;
  private hits: Array<{ hex: string; x: number; y: number }> = [];
  private dataTime = 0;
  private extrapolate = false;

  override onAdd(map: L.Map): this {
    this.canvas = L.DomUtil.create('canvas', 'plane-layer leaflet-zoom-hide');
    map.getPanes().overlayPane.appendChild(this.canvas);
    map.on('move zoom resize viewreset', this.redraw, this);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off('move zoom resize viewreset', this.redraw, this);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  /**
   * Desktop only: between polls, move each plane along its track at its
   * ground speed (dead reckoning from `dataTime`, capped at 15 s so a stalled
   * feed doesn't send planes wandering). The Pi keeps the cheaper static draw.
   */
  setExtrapolation(on: boolean): void {
    this.extrapolate = on;
  }

  setData(data: RadarAircraft[], highlightCallsigns: Set<string>, selectedHex: string | null, dataTime = Date.now()): void {
    this.data = data;
    this.dataTime = dataTime;
    this.highlight = highlightCallsigns;
    this.selected = selectedHex;
    this.redraw();
  }

  /** Nearest plane within `radius` px of a container point, if any. */
  hitTest(point: L.Point, radius = 24): string | null {
    let best: string | null = null;
    let bestD = radius;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - point.x, h.y - point.y);
      if (d < bestD) {
        bestD = d;
        best = h.hex;
      }
    }
    return best;
  }

  private position(a: RadarAircraft, now: number): [number, number] {
    if (!this.extrapolate || a.altitudeFt === null || !a.groundSpeedKt || a.trackDeg === null) return [a.lat, a.lon];
    const dt = Math.min(Math.max(now - this.dataTime, 0), 15_000) / 1000;
    const nm = (a.groundSpeedKt * dt) / 3600;
    const rad = (a.trackDeg * Math.PI) / 180;
    const lat = a.lat + (nm / 60) * Math.cos(rad);
    const lon = a.lon + ((nm / 60) * Math.sin(rad)) / Math.max(Math.cos((a.lat * Math.PI) / 180), 0.01);
    return [lat, lon];
  }

  redraw(): void {
    const map = this._map as L.Map | undefined;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = size.x * dpr;
    canvas.height = size.y * dpr;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    this.hits = [];

    const now = Date.now();
    // Trails first, under the planes (ending at the drawn position).
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 6]);
    ctx.lineCap = 'round';
    for (const a of this.data) {
      if (a.trail.length < 2) continue;
      const hot = this.highlight.has(a.callsign) || a.hex === this.selected;
      ctx.strokeStyle = hot ? 'rgba(45, 212, 191, 0.75)' : 'rgba(143, 155, 170, 0.35)';
      ctx.beginPath();
      a.trail.forEach(([lat, lon], i) => {
        const p = map.latLngToContainerPoint([lat, lon]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      if (this.extrapolate) {
        const end = map.latLngToContainerPoint(this.position(a, now));
        ctx.lineTo(end.x, end.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.font = '500 13px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    this.data.forEach((a, i) => {
      const p = map.latLngToContainerPoint(this.position(a, now));
      if (p.x < -30 || p.y < -30 || p.x > size.x + 30 || p.y > size.y + 30) return;
      this.hits.push({ hex: a.hex, x: p.x, y: p.y });
      const hot = this.highlight.has(a.callsign);
      const sel = a.hex === this.selected;
      const color = hot ? '#2dd4bf' : altitudeColor(a.altitudeFt);
      const scale = hot || sel ? 1.5 : 1.1;

      if (hot || sel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
        ctx.strokeStyle = sel ? '#e9eef3' : '#2dd4bf';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((a.trackDeg ?? 0) * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.translate(-12, -12);
      ctx.fillStyle = color;
      ctx.fill(PLANE);
      ctx.restore();

      // Labels only for the closest few (sorted by distance server-side) to stay readable.
      if ((i < this.labelCount || hot || sel) && a.callsign) {
        const alt = a.altitudeFt === null ? 'GND' : `${Math.round(a.altitudeFt / 100) / 10}k`;
        const text = `${a.callsign} ${alt}`;
        const x = p.x + 18;
        if (hot) {
          const w = ctx.measureText(text).width + 16;
          ctx.fillStyle = '#2dd4bf';
          ctx.beginPath();
          ctx.roundRect(x - 2, p.y - 12, w, 24, 7);
          ctx.fill();
          ctx.fillStyle = '#0a0d12';
          ctx.fillText(text, x + 6, p.y);
        } else {
          ctx.fillStyle = '#8f9baa';
          ctx.fillText(text, x, p.y);
        }
      }
    });
  }
}
