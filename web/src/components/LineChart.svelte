<script lang="ts" module>
  export interface LineSeries {
    name: string;
    color: string;
    points: Array<{ t: number; v: number }>;
  }
</script>

<script lang="ts">
  /**
   * Time-series line chart (dataviz skill specs): 2px lines, hairline grid,
   * one y-axis, crosshair + tooltip listing every series, legend for 2+
   * series, end label on a single series, optional reference line, table view.
   */
  let {
    series,
    height = 300,
    unit = '',
    reference = null,
    label,
    decimals = 1,
    showLegend = true,
    signed = false,
  }: {
    series: LineSeries[];
    height?: number;
    unit?: string;
    reference?: { value: number; label: string } | null;
    label: string;
    decimals?: number;
    /** Set false when the page already shows a legend for these series. */
    showLegend?: boolean;
    /** Show a + sign on positive values (for "change since" views). */
    signed?: boolean;
  } = $props();

  let width = $state(800);
  let hoverT = $state<number | null>(null);
  let showTable = $state(false);

  const PAD = { top: 16, right: 64, bottom: 30, left: 52 };
  const plotW = $derived(Math.max(100, width - PAD.left - PAD.right));
  const plotH = $derived(height - PAD.top - PAD.bottom);
  const live = $derived(series.filter((s) => s.points.length > 0));
  const allPts = $derived(live.flatMap((s) => s.points));

  const xDomain = $derived.by(() => {
    if (allPts.length === 0) return [0, 1] as const;
    const ts = allPts.map((p) => p.t);
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    return lo === hi ? ([lo - 86_400_000, hi + 86_400_000] as const) : ([lo, hi] as const);
  });

  function niceStep(span: number, count: number): number {
    const raw = span / Math.max(1, count);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }

  const yAxis = $derived.by(() => {
    const vs = allPts.map((p) => p.v);
    if (reference) vs.push(reference.value);
    if (vs.length === 0) return { lo: 0, hi: 1, ticks: [0, 1] };
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
    return { lo, hi, ticks };
  });

  const x = (t: number): number => PAD.left + ((t - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW;
  const y = (v: number): number => PAD.top + (1 - (v - yAxis.lo) / (yAxis.hi - yAxis.lo)) * plotH;

  const xTicks = $derived.by(() => {
    const [lo, hi] = xDomain;
    const days = (hi - lo) / 86_400_000;
    const count = Math.max(2, Math.min(7, Math.floor(plotW / 110)));
    const out: Array<{ t: number; label: string }> = [];
    for (let i = 0; i < count; i++) {
      const t = lo + ((hi - lo) * i) / (count - 1);
      const d = new Date(t);
      out.push({ t, label: d.toLocaleDateString('en-US', days > 400 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' }) });
    }
    return out;
  });

  const paths = $derived(
    live.map((s) => {
      const pts = [...s.points].sort((a, b) => a.t - b.t);
      return { s, pts, d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('') };
    }),
  );

  const times = $derived([...new Set(allPts.map((p) => p.t))].sort((a, b) => a - b));
  const fmt = (v: number): string => `${signed && v > 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}${unit ? ` ${unit}` : ''}`;
  const fmtDate = (t: number): string => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  function onMove(e: PointerEvent): void {
    const svg = e.currentTarget as SVGSVGElement;
    const px = e.clientX - svg.getBoundingClientRect().left;
    if (times.length === 0) return;
    let best = times[0] ?? 0;
    for (const t of times) if (Math.abs(x(t) - px) < Math.abs(x(best) - px)) best = t;
    hoverT = best;
  }

  const hoverRows = $derived(
    hoverT === null
      ? []
      : paths
          .map(({ s, pts }) => {
            const p = pts.find((q) => q.t === hoverT);
            return p ? { name: s.name, color: s.color, v: p.v } : null;
          })
          .filter((r): r is { name: string; color: string; v: number } => r !== null),
  );
  const tipLeft = $derived(hoverT === null ? 0 : Math.min(x(hoverT) + 14, width - 220));
</script>

<figure class="chart" bind:clientWidth={width}>
  {#if live.length > 1 && showLegend}
    <ul class="legend" aria-label="Series">
      {#each live as s (s.name)}<li><span class="key" style:background={s.color}></span>{s.name}</li>{/each}
    </ul>
  {/if}
  {#if allPts.length === 0}
    <p class="empty">No data in this range yet.</p>
  {:else if showTable}
    <div class="tablewrap">
      <table>
        <caption class="sr-only">{label}</caption>
        <thead><tr><th scope="col">Date</th>{#each live as s (s.name)}<th scope="col">{s.name}</th>{/each}</tr></thead>
        <tbody>
          {#each [...times].reverse() as t (t)}
            <tr>
              <th scope="row">{fmtDate(t)}</th>
              {#each live as s (s.name)}<td>{#if s.points.find((p) => p.t === t)}{fmt(s.points.find((p) => p.t === t)?.v ?? 0)}{:else}—{/if}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="plot">
      <svg {width} {height} role="img" aria-label={label} onpointermove={onMove} onpointerleave={() => (hoverT = null)}>
        {#each yAxis.ticks as v (v)}
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} class="grid" />
          <text x={PAD.left - 10} y={y(v)} class="tick" text-anchor="end" dominant-baseline="middle">{v.toLocaleString('en-US')}</text>
        {/each}
        {#each xTicks as tk, i (i)}
          <text x={x(tk.t)} y={height - 8} class="tick" text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>{tk.label}</text>
        {/each}
        {#if reference}
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(reference.value)} y2={y(reference.value)} class="ref" />
          <text x={PAD.left + plotW + 6} y={y(reference.value)} class="reflabel" dominant-baseline="middle">{reference.label}</text>
        {/if}
        {#each paths as p (p.s.name)}
          <path d={p.d} fill="none" stroke={p.s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          {#if p.pts.length <= 40}
            {#each p.pts as pt (pt.t)}<circle cx={x(pt.t)} cy={y(pt.v)} r="4" fill={p.s.color} class="dot" />{/each}
          {/if}
        {/each}
        {#if live.length === 1 && paths[0]}
          {@const last = paths[0].pts.at(-1)}
          {#if last}<text x={x(last.t) + 10} y={y(last.v)} class="endlabel" dominant-baseline="middle">{fmt(last.v)}</text>{/if}
        {/if}
        {#if hoverT !== null}
          <line x1={x(hoverT)} x2={x(hoverT)} y1={PAD.top} y2={PAD.top + plotH} class="cross" />
          {#each hoverRows as r (r.name)}<circle cx={x(hoverT)} cy={y(r.v)} r="5" fill={r.color} class="dot" />{/each}
        {/if}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" />
      </svg>
      {#if hoverT !== null && hoverRows.length > 0}
        <div class="tip" style:left={`${tipLeft}px`}>
          <span class="tipdate">{fmtDate(hoverT)}</span>
          {#each hoverRows as r (r.name)}
            <span class="tiprow"><span class="lkey" style:background={r.color}></span><strong>{fmt(r.v)}</strong><span class="muted">{r.name}</span></span>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  {#if allPts.length > 0}
    <button class="tabletoggle" onclick={() => (showTable = !showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
  {/if}
</figure>

<style>
  .chart {
    margin: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
    touch-action: none;
  }
  .grid {
    stroke: #1f2833;
    stroke-width: 1;
  }
  .tick {
    fill: var(--faint);
    font-size: 12px;
    font-family: var(--mono);
  }
  .ref {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 5 5;
  }
  .reflabel,
  .endlabel {
    fill: var(--text-2);
    font-size: 13px;
    font-weight: 600;
  }
  .dot {
    stroke: var(--surface);
    stroke-width: 2;
  }
  .cross {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .legend {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 14px;
    color: var(--text-2);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .key {
    width: 14px;
    height: 3px;
    border-radius: 2px;
  }
  .tip {
    position: absolute;
    top: 8px;
    min-width: 170px;
    padding: 10px 12px;
    border-radius: 12px;
    background: #0a0d12;
    border: 1px solid var(--line-2);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 14px;
  }
  .tipdate {
    color: var(--muted);
    font-size: 13px;
  }
  .tiprow {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lkey {
    width: 12px;
    height: 3px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .tabletoggle {
    align-self: flex-end;
    border: none;
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    text-decoration: underline;
    cursor: pointer;
    min-height: 32px;
  }
  .tablewrap {
    max-height: 320px;
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    font-variant-numeric: tabular-nums;
  }
  thead th {
    color: var(--muted);
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  .empty {
    margin: 0;
    padding: 40px 0;
    text-align: center;
    color: var(--muted);
  }
</style>
