<script lang="ts">
  import { router } from '../lib/router.svelte';
  import type { Tab } from '../lib/types';
  import Icon, { type IconName } from './Icon.svelte';

  let { kiosk = false, visible = true }: { kiosk?: boolean; visible?: boolean } = $props();

  interface Item {
    tab: Tab;
    label: string;
    icon: IconName;
  }
  const screens: Item[] = [
    { tab: 'home', label: 'Home', icon: 'home' },
    { tab: 'flights', label: 'Flights', icon: 'plane' },
    { tab: 'radar', label: 'Radar', icon: 'radar' },
    { tab: 'calendar', label: 'Calendar', icon: 'calendar' },
  ];
  // Editing sections need a signed-in person; kiosk screens are read-only.
  const modules: Item[] = [
    { tab: 'notes', label: 'Notes', icon: 'note' },
    { tab: 'reminders', label: 'Reminders', icon: 'bell' },
    { tab: 'fitness', label: 'Weight loss', icon: 'dumbbell' },
    { tab: 'nutrition', label: 'Nutrition', icon: 'food' },
    { tab: 'health', label: 'Health', icon: 'pulse' },
  ];
  const kioskExtra: Item[] = [{ tab: 'mirror', label: 'Mirror', icon: 'mirror' }];
  const items = $derived(kiosk ? [...screens, ...kioskExtra] : [...screens, ...modules, ...kioskExtra]);
</script>

<nav class="rail" class:kiosk class:hidden={!visible} aria-label="Sections">
  <img class="logo" src="/icons/icon.svg" alt="HomeBase" width="40" height="40" />
  {#each items as item, i (item.tab)}
    {#if !kiosk && (i === screens.length || i === screens.length + modules.length)}<span class="sep" aria-hidden="true"></span>{/if}
    <a href={`#/${item.tab}`} class={`t-${item.tab}`} class:active={router.route === item.tab} aria-current={router.route === item.tab ? 'page' : undefined}>
      <Icon name={item.icon} size={22} />
      <span>{item.label}</span>
    </a>
  {/each}
  {#if !kiosk}
    <a class="bottom" href="#/settings" class:active={router.route === 'settings'} aria-current={router.route === 'settings' ? 'page' : undefined}>
      <Icon name="settings" size={22} />
      <span>Settings</span>
    </a>
  {/if}
</nav>

<style>
  .rail {
    width: 96px;
    flex-shrink: 0;
    padding: 16px 10px;
    background: #0c1016;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .kiosk {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 1000;
    transition: transform 0.2s ease-out;
  }
  .kiosk.hidden {
    transform: translateX(-100%);
  }
  .logo {
    margin-bottom: 12px;
    flex-shrink: 0;
  }
  .sep {
    width: 44px;
    height: 1px;
    margin: 6px 0;
    background: var(--line-2);
    flex-shrink: 0;
  }
  a {
    width: 76px;
    padding: 8px 0;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    color: var(--text-2);
    text-decoration: none;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    flex-shrink: 0;
  }
  a:hover {
    background: var(--surface);
  }
  a.active {
    background: color-mix(in srgb, var(--tab, var(--accent)) 14%, transparent);
    color: var(--tab, var(--accent));
  }
  /* Module accents, same as the iOS drawer. */
  .t-notes {
    --tab: var(--note);
  }
  .t-reminders {
    --tab: var(--rem);
  }
  .t-fitness {
    --tab: var(--blue);
  }
  .t-nutrition {
    --tab: var(--orange);
  }
  .t-health {
    --tab: var(--bad);
  }
  .bottom {
    margin-top: auto;
  }
</style>
