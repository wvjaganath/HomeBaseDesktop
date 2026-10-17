<script lang="ts" module>
  export type IconName =
    | 'home'
    | 'plane'
    | 'radar'
    | 'calendar'
    | 'settings'
    | 'bell'
    | 'note'
    | 'left'
    | 'right'
    | 'up'
    | 'down'
    | 'crosshair'
    | 'plus'
    | 'minus'
    | 'logout'
    | 'reload'
    | 'trash'
    | 'check'
    | 'monitor'
    | 'dumbbell'
    | 'food'
    | 'pulse'
    | 'mirror'
    | 'pin'
    | 'share'
    | 'edit'
    | 'search'
    | 'close'
    | 'repeat'
    | 'rain'
    | 'shield';
</script>

<script lang="ts">
  let { name, size = 22, label = '' }: { name: IconName; size?: number; label?: string } = $props();
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
  {:else if name === 'up'}
    <path d="M5 15l7-7 7 7" />
  {:else if name === 'down'}
    <path d="M5 9l7 7 7-7" />
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
  {:else if name === 'dumbbell'}
    <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
  {:else if name === 'food'}
    <path d="M4 12h16a8 8 0 0 1-16 0z" /><path d="M9 8c0-1.5 1-2 1-3.5M13 8c0-1.5 1-2 1-3.5" />
  {:else if name === 'pulse'}
    <path d="M3 12h4l2-5 4 10 2-5h6" />
  {:else if name === 'mirror'}
    <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 11h4" />
  {:else if name === 'pin'}
    <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" />
  {:else if name === 'share'}
    <circle cx="8" cy="9" r="3" /><circle cx="17" cy="8" r="2.5" /><path d="M3 20c.5-3 2.5-5 5-5s4.5 2 5 5M14 15.5c.8-.3 1.8-.5 3-.5 2.3 0 3.8 1.6 4 4" />
  {:else if name === 'edit'}
    <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === 'repeat'}
    <path d="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />
  {:else if name === 'rain'}
    <path d="M7 15h10a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 15z" /><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3" />
  {:else if name === 'shield'}
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" />
  {/if}
</svg>
