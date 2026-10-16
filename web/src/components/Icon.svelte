<script lang="ts">
  type Name =
    | 'home'
    | 'plane'
    | 'radar'
    | 'calendar'
    | 'settings'
    | 'bell'
    | 'note'
    | 'left'
    | 'right'
    | 'crosshair'
    | 'plus'
    | 'minus'
    | 'logout'
    | 'reload'
    | 'trash'
    | 'check'
    | 'monitor'
    | 'legacy';
  let { name, size = 22, label = '' }: { name: Name; size?: number; label?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#if name === 'home'}
    <path d="M4 11l8-6.5L20 11v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1z" />
  {:else if name === 'plane'}
    <path
      d="M12 2.5c.8 0 1.3.7 1.3 1.6v5.2l7.2 4.3v1.9l-7.2-2.2v4.4l2.2 1.7v1.5L12 20l-3.5 1v-1.5l2.2-1.7v-4.4l-7.2 2.2v-1.9l7.2-4.3V4.1c0-.9.5-1.6 1.3-1.6z"
      fill="currentColor"
      stroke="none"
    />
  {:else if name === 'radar'}
    <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><path d="M12 12l5-5" />
  {:else if name === 'calendar'}
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" />
  {:else if name === 'settings'}
    <circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  {:else if name === 'bell'}
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2 2 0 0 0 4 0" />
  {:else if name === 'note'}
    <path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5z" /><path d="M14 3v5.5h5.5M8.5 13h7M8.5 17h5" />
  {:else if name === 'left'}
    <path d="M15 5l-7 7 7 7" />
  {:else if name === 'right'}
    <path d="M9 5l7 7-7 7" />
  {:else if name === 'crosshair'}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'minus'}
    <path d="M5 12h14" />
  {:else if name === 'logout'}
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
  {:else if name === 'reload'}
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />
  {:else if name === 'trash'}
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'monitor'}
    <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
  {:else if name === 'legacy'}
    <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
  {/if}
</svg>
