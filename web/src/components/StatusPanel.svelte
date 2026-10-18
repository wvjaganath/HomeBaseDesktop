<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { ApiError, api } from '../lib/api';

  interface BackupInfo {
    file: string;
    at: string;
    bytes: number;
  }
  interface Status {
    hub: { version: string; node: string; startedAt: string; https: boolean };
    database: { bytes: number; items: number };
    backup: { enabled: boolean; keep: number; hour: number; count: number; last: BackupInfo | null; error: string | null };
    tracker: { enabled: boolean; reachable: boolean; updatedAt: string | null };
    radar: { enabled: boolean; off?: 'disabled' | 'no_home' | null; source: string | null; updatedAt: string | null; aircraft: number; homeSource?: 'tracker' | 'settings' | null };
    calendars: Array<{ name: string; ok: boolean | null; error: string | null; fetchedAt: string | null }>;
    mirror: { enabled: boolean; reachable: boolean };
    mapTiles?: { key: boolean };
    screens: { count: number; lastSeenAt: string | null };
  }
  type Level = 'ok' | 'warn' | 'bad' | 'off';
  interface Row {
    label: string;
    level: Level;
    text: string;
  }

  let status = $state<Status | null>(null);
  let error = $state('');
  let backingUp = $state(false);
  let backupMsg = $state('');

  async function load(): Promise<void> {
    try {
      status = await api.get<Status>('/api/status');
      error = '';
    } catch {
      error = 'Couldn’t load the hub status.';
    }
  }
  $effect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  });

  async function backupNow(): Promise<void> {
    backingUp = true;
    backupMsg = '';
    try {
      const r = await api.post<{ backup: BackupInfo }>('/api/status/backup', {});
      backupMsg = `Saved ${r.backup.file} (${size(r.backup.bytes)}).`;
      await load();
    } catch (err) {
      backupMsg = err instanceof ApiError && err.status === 429 ? 'Please wait a few minutes between manual backups.' : 'Backup failed. Check the hub logs.';
    } finally {
      backingUp = false;
    }
  }

  function ago(iso: string | null): string {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129_600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86_400)} days ago`;
  }
  function size(b: number): string {
    return b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1_048_576).toFixed(1)} MB`;
  }
  /** Stale if the last update is older than `max` seconds. */
  function fresh(iso: string | null, max: number): boolean {
    return iso !== null && Date.now() - Date.parse(iso) < max * 1000;
  }

  const rows = $derived.by((): Row[] => {
    const s = status;
    if (!s) return [];
    const cal = s.calendars;
    const calBad = cal.filter((c) => c.ok === false);
    return [
      {
        label: 'Connection',
        level: s.hub.https ? 'ok' : 'warn',
        text: s.hub.https ? 'HTTPS' : 'Plain HTTP (fine on your home network; use the https:// address for browsers)',
      },
      {
        label: 'Backups',
        level: !s.backup.enabled ? 'off' : s.backup.error ? 'bad' : fresh(s.backup.last?.at ?? null, 36 * 3600) ? 'ok' : 'warn',
        text: !s.backup.enabled
          ? 'Off (BACKUP_KEEP=0)'
          : s.backup.error
            ? `Last attempt failed: ${s.backup.error}`
            : s.backup.last
              ? `Last ${ago(s.backup.last.at)} · ${size(s.backup.last.bytes)} · ${s.backup.count} of ${s.backup.keep} kept · nightly at ${String(s.backup.hour).padStart(2, '0')}:07`
              : `None yet · first one tonight at ${String(s.backup.hour).padStart(2, '0')}:07`,
      },
      {
        label: 'Plane tracker',
        level: !s.tracker.enabled ? 'off' : s.tracker.reachable ? 'ok' : 'bad',
        text: !s.tracker.enabled ? 'Not configured (TRACKER_URL)' : s.tracker.reachable ? `Connected · updated ${ago(s.tracker.updatedAt)}` : `Can’t reach it · last data ${ago(s.tracker.updatedAt)}`,
      },
      {
        label: 'Radar',
        level: !s.radar.enabled ? 'off' : s.radar.updatedAt === null || fresh(s.radar.updatedAt, 120) ? 'ok' : 'warn',
        text: !s.radar.enabled
          ? s.radar.off === 'no_home'
            ? 'Waiting for a home location (Plane tracker → Location)'
            : 'Turned off (Settings → Hub → Radar & maps)'
          : s.radar.updatedAt === null
            ? 'Idle until someone opens the Radar tab'
            : `${s.radar.aircraft} aircraft from ${s.radar.source ?? '—'} · ${ago(s.radar.updatedAt)}`,
      },
      {
        label: 'Map tiles',
        level: mapLevel(s.mapTiles),
        text: mapText(s.mapTiles),
      },
      {
        label: 'Calendars',
        level: cal.length === 0 ? 'off' : calBad.length > 0 ? 'bad' : 'ok',
        text: cal.length === 0 ? 'None added' : calBad.length > 0 ? `${calBad.map((c) => c.name).join(', ')}: ${calBad[0]?.error ?? 'error'}` : `${cal.length} syncing`,
      },
      {
        label: 'MagicMirror',
        level: !s.mirror.enabled ? 'off' : s.mirror.reachable ? 'ok' : 'bad',
        text: !s.mirror.enabled ? 'Not set up (MIRROR_URL)' : s.mirror.reachable ? 'Running' : 'Not responding',
      },
      {
        label: 'Screens',
        level: s.screens.count === 0 ? 'off' : 'ok',
        text: s.screens.count === 0 ? 'None paired' : `${s.screens.count} paired · last seen ${ago(s.screens.lastSeenAt)}`,
      },
      {
        label: 'Database',
        level: 'ok',
        text: `${size(s.database.bytes)} · ${s.database.items.toLocaleString()} items`,
      },
    ];
  });

  const ICON: Record<Level, IconName> = { ok: 'check', warn: 'alert', bad: 'close', off: 'minus' };
  const WORD: Record<Level, string> = { ok: 'OK', warn: 'Check', bad: 'Problem', off: 'Off' };

  type Tiles = NonNullable<Status['mapTiles']>;
  const mapLevel = (t: Tiles | undefined): Level => (!t ? 'off' : t.key ? 'ok' : 'warn');
  const mapText = (t: Tiles | undefined): string =>
    !t ? '—' : t.key ? 'CARTO key saved · tiles load straight from CARTO' : 'No CARTO key yet (Settings → Hub → Radar & maps): maps show “API KEY REQUIRED”';
</script>

<section class="card">
  <h2><Icon name="pulse" /> Status</h2>
  {#if error}
    <p class="bad-text">{error}</p>
  {:else if !status}
    <p class="muted">Loading…</p>
  {:else}
    <dl class="status">
      {#each rows as r (r.label)}
        <div class="srow">
          <dt>{r.label}</dt>
          <dd>
            <span class="pill {r.level}"><Icon name={ICON[r.level]} size={14} />{WORD[r.level]}</span>
            <span class="txt">{r.text}</span>
          </dd>
        </div>
      {/each}
    </dl>
    <div class="foot">
      <span class="muted small">Hub {status.hub.version} · Node {status.hub.node.replace(/^v/, '')} · up since {new Date(status.hub.startedAt).toLocaleString()}</span>
      {#if status.backup.enabled}
        <button class="btn" disabled={backingUp} onclick={backupNow}>{backingUp ? 'Backing up…' : 'Back up now'}</button>
      {/if}
    </div>
    {#if backupMsg}<p class="muted small" role="status">{backupMsg}</p>{/if}
  {/if}
</section>

<style>
  section {
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  p {
    margin: 0;
  }
  .status {
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  .srow {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 16px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
    align-items: baseline;
  }
  .srow:first-child {
    border-top: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    display: flex;
    gap: 12px;
    align-items: baseline;
    min-width: 0;
  }
  .txt {
    color: var(--text-2);
    overflow-wrap: anywhere;
  }
  .pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 9px 2px 7px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid currentColor;
    transform: translateY(-1px);
  }
  .pill.ok {
    color: var(--ok);
  }
  .pill.warn {
    color: var(--warn);
  }
  .pill.bad {
    color: var(--bad);
  }
  .pill.off {
    color: var(--muted);
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .small {
    font-size: 14px;
  }
  .bad-text {
    color: var(--bad);
  }
  @media (max-width: 640px) {
    .srow {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
</style>
