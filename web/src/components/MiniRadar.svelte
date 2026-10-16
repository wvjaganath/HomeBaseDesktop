<script lang="ts">
  import { offsetMiles } from '../lib/format';
  import { hub } from '../lib/hub.svelte';

  let { size = 220, radiusMi = 25 }: { size?: number; radiusMi?: number } = $props();

  const ALT = (ft: number | null): string =>
    ft === null ? 'var(--faint)' : ft < 5000 ? 'var(--alt-low)' : ft < 15000 ? 'var(--alt-mid)' : ft < 30000 ? 'var(--alt-high)' : 'var(--alt-top)';

  const overheadCallsigns = $derived(new Set((hub.tracker?.flights ?? []).map((f) => f.callsign)));

  const dots = $derived.by(() => {
    const r = hub.radar;
    if (!r) return [];
    const scale = 200 / radiusMi;
    return r.aircraft
      .map((a) => {
        const o = offsetMiles(r.home, a.lat, a.lon);
        return {
          key: a.hex,
          x: 220 + o.x * scale,
          y: 220 - o.y * scale,
          color: overheadCallsigns.has(a.callsign) ? 'var(--accent)' : ALT(a.altitudeFt),
          hot: overheadCallsigns.has(a.callsign),
        };
      })
      .filter((d) => Math.hypot(d.x - 220, d.y - 220) <= 205);
  });
</script>

<svg width={size} height={size} viewBox="0 0 440 440" role="img" aria-label={`Mini radar: ${dots.length} aircraft within ${radiusMi} miles`}>
  <circle cx="220" cy="220" r="208" fill="var(--surface-2)" stroke="#1f2a36" stroke-width="2" />
  <circle cx="220" cy="220" r="140" fill="none" stroke="#1f2a36" stroke-width="2" />
  <circle cx="220" cy="220" r="70" fill="none" stroke="#1f2a36" stroke-width="2" />
  <path d="M220 12v416M12 220h416" stroke="#18212b" stroke-width="1.5" />
  {#each dots as d (d.key)}
    {#if d.hot}<circle cx={d.x} cy={d.y} r="20" fill="none" stroke="var(--accent)" stroke-width="3" />{/if}
    <circle cx={d.x} cy={d.y} r="9" fill={d.color} />
  {/each}
  <circle cx="220" cy="220" r="9" fill="var(--accent)" />
</svg>
