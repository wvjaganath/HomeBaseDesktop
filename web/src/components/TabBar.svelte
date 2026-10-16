<script lang="ts">
  import { router } from '../lib/router.svelte';
  import type { Tab } from '../lib/types';
  import Icon from './Icon.svelte';

  let { kiosk = false, visible = true }: { kiosk?: boolean; visible?: boolean } = $props();

  const items: Array<{ tab: Tab; label: string; icon: 'home' | 'plane' | 'radar' | 'calendar' | 'settings' }> = [
    { tab: 'home', label: 'Home', icon: 'home' },
    { tab: 'flights', label: 'Flights', icon: 'plane' },
    { tab: 'radar', label: 'Radar', icon: 'radar' },
    { tab: 'calendar', label: 'Calendar', icon: 'calendar' },
  ];
</script>

<nav class="rail" class:kiosk class:hidden={!visible} aria-label="Sections">
  <img class="logo" src="/icons/icon.svg" alt="HomeBase" width="40" height="40" />
  {#each items as item (item.tab)}
    <a href={`#/${item.tab}`} class:active={router.route === item.tab} aria-current={router.route === item.tab ? 'page' : undefined}>
      <Icon name={item.icon} size={22} />
      <span>{item.label}</span>
    </a>
  {/each}
  {#if !kiosk}
    <a class="bottom" href="/legacy/" title="Weight loss & nutrition tracker (classic)">
      <Icon name="legacy" size={22} />
      <span>Fitness</span>
    </a>
    <a href="#/settings" class:active={router.route === 'settings'} aria-current={router.route === 'settings' ? 'page' : undefined}>
      <Icon name="settings" size={22} />
      <span>Settings</span>
    </a>
  {/if}
</nav>

<style>
  .rail {
    width: 96px;
    flex-shrink: 0;
    padding: 20px 10px;
    background: #0c1016;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
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
    margin-bottom: 18px;
  }
  a {
    width: 76px;
    padding: 10px 0;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    color: var(--text-2);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
  }
  a:hover {
    background: var(--surface);
  }
  a.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .bottom {
    margin-top: auto;
  }
</style>
