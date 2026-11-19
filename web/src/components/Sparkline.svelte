<script lang="ts">
  /** A tiny line chart: no axes, gaps where values are missing. */
  let { values, color, height = 26, label = '' }: { values: Array<number | null>; color: string; height?: number; label?: string } = $props();
  const W = 200;
  const path = $derived.by(() => {
    const nums = values.filter((v): v is number => v !== null);
    if (nums.length < 2) return '';
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const step = values.length > 1 ? W / (values.length - 1) : W;
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const x = (i * step).toFixed(1);
      const y = (height - 2 - ((v - min) / span) * (height - 4)).toFixed(1);
      d += `${pen ? 'L' : 'M'}${x} ${y}`;
      pen = true;
    });
    return d;
  });
</script>

<svg viewBox={`0 0 ${W} ${height}`} width="100%" {height} preserveAspectRatio="none" role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
  {#if path}<path d={path} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />{/if}
</svg>
