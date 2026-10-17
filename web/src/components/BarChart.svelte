<script lang="ts">
  /**
   * Single-series column chart: columns capped at 24px with a 4px rounded top,
   * hairline grid, per-column hover tooltip, table view.
   */
  let {
    bars,
    color = '#3987e5',
    height = 260,
    unit = '',
    label,
  }: {
    bars: Array<{ key: string; label: string; value: number }>;
    color?: string;
    height?: number;
    unit?: string;
    label: string;
  } = $props();

  let width = $state(800);
  let hover = $state<number | null>(null);
  let showTable = $state(false);
  const PAD = { top: 14, right: 12, bottom: 30, left: 56 };
  const plotW = $derived(Math.max(100, width - PAD.left - PAD.right));
  const plotH = $derived(height - PAD.top - PAD.bottom);

  const axis = $derived.by(() => {
    const max = Math.max(0, ...bars.map((b) => b.value));
    if (max === 0) return { hi: 1, ticks: [0, 1] };
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const hi = Math.ceil(max / step) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= hi + step / 2; v += step) ticks.push(v);
    return { hi, ticks };
  });
  const band = $derived(plotW / Math.max(1, bars.length));
  const barW = $derived(Math.max(2, Math.min(24, band - 2)));
  const y = (v: number): number => PAD.top + (1 - v / axis.hi) * plotH;
  const compact = (v: number): string => (v >= 1000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : v.toLocaleString('en-US'));
  const fmt = (v: number): string => `${Math.round(v).toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`;
  const labelEvery = $derived(Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(plotW / 70)))));

  /** Column path: square at the baseline, 4px rounded data end. */
  function col(cx: number, v: number): string {
    const x0 = cx - barW / 2;
    const top = y(v);
    const base = y(0);
    const r = Math.min(4, barW / 2, Math.max(0, base - top));
    return `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${base}Z`;
  }
</script>

<figure class="chart" bind:clientWidth={width}>
  {#if bars.length === 0}
    <p class="empty">No data in this range yet.</p>
  {:else if showTable}
    <div class="tablewrap">
      <table>
        <caption class="sr-only">{label}</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Value</th></tr></thead>
        <tbody>{#each [...bars].reverse() as b (b.key)}<tr><th scope="row">{b.label}</th><td>{fmt(b.value)}</td></tr>{/each}</tbody>
      </table>
    </div>
  {:else}
    <div class="plot">
      <svg {width} {height} role="img" aria-label={label} onpointerleave={() => (hover = null)}>
        {#each axis.ticks as v (v)}
          <line x1={PAD.left} x2={PAD.left + plotW} y1={y(v)} y2={y(v)} class="grid" />
          <text x={PAD.left - 10} y={y(v)} class="tick" text-anchor="end" dominant-baseline="middle">{compact(v)}</text>
        {/each}
        {#each bars as b, i (b.key)}
          {@const cx = PAD.left + band * (i + 0.5)}
          {#if b.value > 0}<path d={col(cx, b.value)} fill={color} opacity={hover === null || hover === i ? 1 : 0.55} />{/if}
          <!-- Hit target: the whole band, taller than the mark. -->
          <rect x={cx - band / 2} y={PAD.top} width={band} height={plotH} fill="transparent" role="presentation" onpointerenter={() => (hover = i)} />
          {#if i % labelEvery === 0}<text x={cx} y={height - 8} class="tick" text-anchor={cx > width - 36 ? 'end' : 'middle'}>{b.label}</text>{/if}
        {/each}
      </svg>
      {#if hover !== null}
        {@const b = bars[hover]}
        {#if b}
          <div class="tip" style:left={`${Math.min(PAD.left + band * (hover + 0.5) + 12, width - 180)}px`}>
            <span class="muted">{b.label}</span><strong>{fmt(b.value)}</strong>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
  {#if bars.length > 0}
    <button class="tabletoggle" onclick={() => (showTable = !showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
  {/if}
</figure>

<style>
  .chart {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .plot {
    position: relative;
  }
  svg {
    display: block;
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
  .tip {
    position: absolute;
    top: 8px;
    padding: 8px 12px;
    border-radius: 12px;
    background: #0a0d12;
    border: 1px solid var(--line-2);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 14px;
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
    max-height: 300px;
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
