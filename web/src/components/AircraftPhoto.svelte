<script lang="ts" module>
  interface Photo {
    src: string;
    width: number;
    height: number;
    link: string;
    photographer: string;
  }
  // In-memory only (Planespotters allows caching the JSON, never the images).
  // Deliberately non-reactive: it's a request cache, not UI state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const cache = new Map<string, Promise<Photo | null>>();

  function isHttps(u: unknown): u is string {
    return typeof u === 'string' && u.startsWith('https://');
  }

  function loadPhoto(hex: string): Promise<Photo | null> {
    let p = cache.get(hex);
    if (!p) {
      p = fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`, { credentials: 'omit' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: unknown) => {
          const photo = (data as { photos?: Array<Record<string, unknown>> } | null)?.photos?.[0];
          const thumb = photo?.['thumbnail_large'] as { src?: unknown; size?: { width?: number; height?: number } } | undefined;
          if (!photo || !thumb || !isHttps(thumb.src) || !isHttps(photo['link'])) return null;
          return {
            src: thumb.src,
            width: thumb.size?.width ?? 420,
            height: thumb.size?.height ?? 280,
            link: photo['link'],
            photographer: typeof photo['photographer'] === 'string' ? photo['photographer'] : 'Unknown',
          };
        })
        .catch(() => null);
      cache.set(hex, p);
    }
    return p;
  }
</script>

<script lang="ts">
  /** Aircraft photo from Planespotters.net, loaded by the browser with credit + link (their terms). */
  let { hex, width = 340 }: { hex: string; width?: number } = $props();
  let photo = $state<Photo | null>(null);

  $effect(() => {
    photo = null;
    if (!/^[0-9a-f]{6}$/.test(hex)) return;
    let alive = true;
    void loadPhoto(hex).then((p) => {
      if (alive) photo = p;
    });
    return () => {
      alive = false;
    };
  });
</script>

{#if photo}
  <figure class="photo" style:width={`${width}px`}>
    <a href={photo.link} target="_blank" rel="noopener">
      <img src={photo.src} alt="Aircraft" width={photo.width} height={photo.height} referrerpolicy="strict-origin-when-cross-origin" />
    </a>
    <figcaption>© {photo.photographer} · <a href={photo.link} target="_blank" rel="noopener">Planespotters.net</a></figcaption>
  </figure>
{/if}

<style>
  .photo {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  img {
    width: 100%;
    height: auto;
    aspect-ratio: 3 / 2;
    object-fit: cover;
    border-radius: 18px;
    display: block;
  }
  figcaption {
    font-size: 14px;
    color: var(--faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  figcaption a {
    color: var(--muted);
  }
</style>
