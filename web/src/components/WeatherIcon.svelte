<script lang="ts">
  import { weatherKind, WEATHER_LABEL } from '../lib/format';
  let { code, size = 48 }: { code: number | null; size?: number } = $props();
  const kind = $derived(weatherKind(code));
</script>

<svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={WEATHER_LABEL[kind]}>
  {#if kind === 'clear'}
    <circle cx="24" cy="24" r="9" fill="#FCD34D" />
    <g stroke="#FCD34D" stroke-width="3" stroke-linecap="round">
      <path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.5 10.5l3.5 3.5M34 34l3.5 3.5M10.5 37.5l3.5-3.5M34 14l3.5-3.5" />
    </g>
  {:else if kind === 'partly'}
    <circle cx="19" cy="18" r="8" fill="#FCD34D" />
    <g stroke="#FCD34D" stroke-width="2.5" stroke-linecap="round"><path d="M19 4v3M7 18H4M9.5 8.5l2 2M28.5 8.5l-2 2" /></g>
    <path d="M16 38h20a7 7 0 0 0 0-14a10 10 0 0 0-19 3a5.5 5.5 0 0 0-1 11z" fill="#CBD5E1" />
  {:else if kind === 'fog'}
    <g stroke="#CBD5E1" stroke-width="3" stroke-linecap="round"><path d="M8 18h32M5 25h38M10 32h28M14 39h20" /></g>
  {:else}
    <path d="M13 32h22a8 8 0 0 0 0-16a11 11 0 0 0-21 3.5A6.3 6.3 0 0 0 13 32z" fill="#CBD5E1" />
    {#if kind === 'rain'}
      <g stroke="#60A5FA" stroke-width="2.5" stroke-linecap="round"><path d="M17 37l-2 5M25 37l-2 5M33 37l-2 5" /></g>
    {:else if kind === 'snow'}
      <g fill="#E2E8F0"><circle cx="17" cy="40" r="2" /><circle cx="25" cy="42" r="2" /><circle cx="33" cy="40" r="2" /></g>
    {:else if kind === 'sleet'}
      <g stroke="#93C5FD" stroke-width="2.5" stroke-linecap="round"><path d="M17 37l-2 5M33 37l-2 5" /></g>
      <circle cx="25" cy="41" r="2" fill="#E2E8F0" />
    {:else if kind === 'storm'}
      <path d="M26 33l-6 8h5l-3 6 8-9h-5l3-5z" fill="#FACC15" />
    {/if}
  {/if}
</svg>
