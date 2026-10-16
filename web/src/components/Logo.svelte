<script lang="ts">
  /** Airline logo from the hub (resized server-side). Falls back to a text tile. */
  let {
    icao,
    size = 96,
    kind = 'square',
    alt = '',
  }: { icao: string; size?: number; kind?: 'square' | 'banner'; alt?: string } = $props();
  let failed = $state(false);
  let pixelated = $state(false);
  const src = $derived(icao ? `/api/logo/${encodeURIComponent(icao)}?kind=${kind}&h=${Math.round(size * (window.devicePixelRatio || 1))}` : '');

  $effect(() => {
    void src;
    failed = false;
    pixelated = false;
  });

  function onLoad(e: Event): void {
    const img = e.currentTarget as HTMLImageElement;
    // The tracker's fallback logos are 16 px: keep them crisp, not blurry.
    pixelated = img.naturalWidth > 0 && img.naturalWidth <= 32;
  }
</script>

{#if src && !failed}
  <img
    class="logo"
    class:banner={kind === 'banner'}
    class:pixelated
    {src}
    alt={alt || `${icao} logo`}
    width={kind === 'banner' ? undefined : size}
    height={size}
    style:--size={`${size}px`}
    onload={onLoad}
    onerror={() => (failed = true)}
  />
{:else}
  <span class="fallback" style:--size={`${size}px`} aria-label={alt || icao}>{icao || '—'}</span>
{/if}

<style>
  .logo {
    height: var(--size);
    width: var(--size);
    object-fit: contain;
  }
  .logo.banner {
    width: auto;
    max-width: calc(var(--size) * 6);
  }
  .pixelated {
    image-rendering: pixelated;
  }
  .fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size);
    height: var(--size);
    border-radius: 22%;
    background: var(--surface-2);
    border: 1px solid var(--line-2);
    color: var(--text-2);
    font-family: var(--mono);
    font-weight: 600;
    font-size: calc(var(--size) * 0.24);
  }
</style>
