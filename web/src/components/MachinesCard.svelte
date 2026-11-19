<script lang="ts">
  import { temperature, uptime, usedOf } from '../lib/format';
  import { hub } from '../lib/hub.svelte';
  import type { MachineStatus } from '../lib/types';
  import Icon from './Icon.svelte';

  /** The house's machines on Home: online, CPU, memory, disk, temperature. */
  const units = $derived(hub.config?.units ?? 'imperial');
  const machines = $derived(hub.house?.machines ?? []);
  const online = $derived(machines.filter((m) => m.online).length);

  const pct = (u: number | null, t: number | null): number | null => (u !== null && t ? (u / t) * 100 : null);
  /** Bar colour: teal, then amber near the alert limits. */
  const tone = (p: number | null, warnAt: number): string => (p !== null && p >= warnAt ? 'var(--warn)' : 'var(--accent)');

  function meters(m: MachineStatus): Array<{ label: string; value: string; pct: number | null; warn: number }> {
    return [
      { label: 'CPU', value: m.cpuPct === null ? '—' : `${Math.round(m.cpuPct)}%`, pct: m.cpuPct, warn: 85 },
      { label: 'Memory', value: usedOf(m.memUsed, m.memTotal), pct: pct(m.memUsed, m.memTotal), warn: 85 },
      { label: 'Disk', value: usedOf(m.diskUsed, m.diskTotal), pct: pct(m.diskUsed, m.diskTotal), warn: 85 },
      // Bar scaled to 0–85 °C (Pis throttle at 80–85 °C).
      { label: 'CPU temp', value: temperature(m.tempC, units, 0, true), pct: m.tempC === null ? null : Math.min(100, (m.tempC / 85) * 100), warn: 75 },
    ];
  }
</script>

<section class="card machines" aria-label="Machines">
  <header>
    <span class="label"><Icon name="server" size={20} />Machines</span>
    {#if machines.length > 0}<span class="muted count">{online} of {machines.length} online</span>{/if}
  </header>
  {#each machines as m (m.id)}
    <div class="m">
      <span class="ico"><Icon name={m.kind === 'pi' ? 'board' : 'monitor'} size={18} /></span>
      <div class="body">
        <div class="name">
          <span class="nm">{m.name}{#if m.os}<span class="sub">{m.os}</span>{/if}</span>
          {#if m.online}
            <span class="st ok"><i></i>Online{m.uptimeSec !== null ? ` · ${uptime(m.uptimeSec)}` : ''}</span>
          {:else if m.lastSeenAt === null && !m.error}
            <span class="st"><i></i>Checking…</span>
          {:else}
            <span class="st bad"><i></i>Offline</span>
          {/if}
        </div>
        {#if m.online}
          <div class="meters">
            {#each meters(m) as mt (mt.label)}
              <span class="mt">{mt.label}<b>{mt.value}</b><span class="bar"><i style:width={`${mt.pct ?? 0}%`} style:background={tone(mt.pct, mt.warn)}></i></span></span>
            {/each}
          </div>
        {:else if m.error}
          <p class="err">{m.error}</p>
        {/if}
      </div>
    </div>
  {:else}
    <p class="muted">Add your machines in Settings → House.</p>
  {/each}
</section>

<style>
  .machines {
    min-height: 0;
    overflow: hidden;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .label {
    color: var(--accent);
  }
  .count {
    font-size: 15px;
  }
  .m {
    display: grid;
    grid-template-columns: 30px 1fr;
    gap: 12px;
    align-items: center;
    padding: 9px 0;
    border-top: 1px solid var(--line);
  }
  .m:first-of-type {
    border-top: none;
  }
  .ico {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: #0e2a27;
    color: var(--accent);
  }
  .body {
    min-width: 0;
  }
  .name {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    font-size: 18px;
    font-weight: 600;
  }
  .nm {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
    margin-left: 8px;
  }
  .st {
    flex: none;
    font-size: 14px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .st i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .st.ok {
    color: var(--ok);
  }
  .st.bad {
    color: var(--bad);
  }
  .meters {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    margin-top: 6px;
  }
  .mt {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
    color: var(--muted);
  }
  .mt b {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    height: 5px;
    border-radius: 3px;
    background: #1b2430;
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: 3px;
  }
  .err {
    margin: 4px 0 0;
    font-size: 14px;
    color: var(--bad);
  }
  p {
    margin: 0;
    font-size: 17px;
  }
</style>
