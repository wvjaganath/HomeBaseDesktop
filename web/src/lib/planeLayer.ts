import L from 'leaflet';
import { SHAPE_SIZE, shapeFor, shapePath, type ShapeClass } from './aircraftShapes';
import type { RadarAircraft } from './types';

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
  /** Icon size multiplier (the small Home map draws them a bit smaller). */
  private iconScale = 1;
  private labels = true;
  private shapes = new Map<string, ShapeClass>();
  private canvasSize = { w: 0, h: 0, dpr: 0 };

  constructor(opts: { iconScale?: number; labels?: boolean } = {}) {
    super();
    this.iconScale = opts.iconScale ?? 1;
    this.labels = opts.labels ?? true;
  }

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
    // Silhouette per aircraft, worked out once per hex/type/category.
    for (const a of data) {
      const k = `${a.hex}|${a.type}|${a.category}`;
      if (!this.shapes.has(k)) this.shapes.set(k, shapeFor(a.type, a.category));
    }
    if (this.shapes.size > 2000) this.shapes.clear();
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
    // Resize only when needed: reallocating the canvas every frame is costly on a Pi.
    if (this.canvasSize.w !== size.x || this.canvasSize.h !== size.y || this.canvasSize.dpr !== dpr) {
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      this.canvasSize = { w: size.x, h: size.y, dpr };
    }
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
      const shape = this.shapes.get(`${a.hex}|${a.type}|${a.category}`) ?? 'narrow';
      const px = SHAPE_SIZE[shape] * this.iconScale * (hot || sel ? 1.35 : 1);

      if (hot || sel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, px * 0.78, 0, Math.PI * 2);
        ctx.strokeStyle = sel ? '#e9eef3' : '#2dd4bf';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      const k = px / 64;
      const path = shapePath(shape);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(((a.trackDeg ?? 0) * Math.PI) / 180);
      ctx.scale(k, k);
      ctx.translate(-32, -32);
      // A thin dark edge keeps the silhouette readable over the map and other planes.
      ctx.lineWidth = 1.6 / k;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(10, 13, 18, 0.85)';
      ctx.stroke(path);
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.restore();

      // Labels only for the closest few (sorted by distance server-side) to stay readable.
      if (this.labels && (i < this.labelCount || hot || sel) && a.callsign) {
        const alt = a.altitudeFt === null ? 'GND' : `${Math.round(a.altitudeFt / 100) / 10}k`;
        const text = a.route ? `${a.callsign} ${a.route.from}→${a.route.to} ${alt}` : `${a.callsign} ${alt}`;
        const x = p.x + px * 0.6 + 4;
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
