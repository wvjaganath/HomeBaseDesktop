<script lang="ts">
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import ShareDialog from '../components/ShareDialog.svelte';
  import SyncGate from '../components/SyncGate.svelte';
  import { clock } from '../lib/clock.svelte';
  import { newId, sync, type Item, type ReminderPayload, type RepeatRule } from '../lib/sync.svelte';

  const REPEAT_LABEL: Record<RepeatRule, string> = { none: 'Never', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state({ title: '', notes: '', due: '', repeatRule: 'none' as RepeatRule });
  let formError = $state('');
  let showCompleted = $state(false);
  let shareOpen = $state(false);

  const all = $derived(sync.list('reminders'));
  const open = $derived(all.filter((r) => r.payload.completedAt === null).sort((a, b) => (a.payload.dueAt < b.payload.dueAt ? -1 : 1)));
  const completed = $derived(
    all
      .filter((r) => r.payload.completedAt !== null)
      .sort((a, b) => ((a.payload.completedAt ?? '') < (b.payload.completedAt ?? '') ? 1 : -1))
      .slice(0, 50),
  );
  const groups = $derived.by(() => {
    const now = clock.now;
    // Scratch dates for the day boundaries, rebuilt on every run (not reactive state).
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const endToday = new Date(now);
    endToday.setHours(23, 59, 59, 999);
    const endTomorrow = new Date(endToday.getTime() + 86_400_000);
    const out = { overdue: [] as Array<Item<'reminders'>>, today: [] as Array<Item<'reminders'>>, tomorrow: [] as Array<Item<'reminders'>>, later: [] as Array<Item<'reminders'>> };
    for (const r of open) {
      const due = new Date(r.payload.dueAt);
      if (due < now) out.overdue.push(r);
      else if (due <= endToday) out.today.push(r);
      else if (due <= endTomorrow) out.tomorrow.push(r);
      else out.later.push(r);
    }
    return [
      { key: 'overdue', label: 'Overdue', list: out.overdue },
      { key: 'today', label: 'Today', list: out.today },
      { key: 'tomorrow', label: 'Tomorrow', list: out.tomorrow },
      { key: 'later', label: 'Later', list: out.later },
    ].filter((g) => g.list.length > 0);
  });
  const editing = $derived(editingId ? sync.get('reminders', editingId) : undefined);
  const editable = $derived(editing ? sync.canEdit('reminders', editing) : true);

  /** Local date-time "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
  function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function dueLabel(iso: string): string {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === clock.now.getFullYear();
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
  }

  /** Same rule as the iOS app: add a day/week/month; months clamp to the last day. */
  function nextOccurrence(iso: string, rule: RepeatRule): string {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch value
    const d = new Date(iso);
    if (rule === 'daily') d.setDate(d.getDate() + 1);
    else if (rule === 'weekly') d.setDate(d.getDate() + 7);
    else if (rule === 'monthly') {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
    }
    return d.toISOString();
  }

  async function complete(r: Item<'reminders'>): Promise<void> {
    if (!sync.canEdit('reminders', r)) return;
    const p = $state.snapshot(r.payload);
    if (p.repeatRule === 'none') p.completedAt = new Date().toISOString();
    else p.dueAt = nextOccurrence(p.dueAt, p.repeatRule);
    await sync.save('reminders', r.id, p);
  }

  async function reopen(r: Item<'reminders'>): Promise<void> {
    await sync.save('reminders', r.id, { ...$state.snapshot(r.payload), completedAt: null });
  }

  function openNew(): void {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local scratch value
    const due = new Date();
    due.setHours(due.getHours() + 1, 0, 0, 0);
    editingId = null;
    form = { title: '', notes: '', due: toLocalInput(due.toISOString()), repeatRule: 'none' };
    formError = '';
    editorOpen = true;
  }

  function openEdit(r: Item<'reminders'>): void {
    editingId = r.id;
    form = { title: r.payload.title, notes: r.payload.notes, due: toLocalInput(r.payload.dueAt), repeatRule: r.payload.repeatRule };
    formError = '';
    editorOpen = true;
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const title = form.title.trim();
    const due = new Date(form.due);
    if (!title) {
      formError = 'Give the reminder a title.';
      return;
    }
    if (Number.isNaN(due.getTime())) {
      formError = 'Pick a due date and time.';
      return;
    }
    const id = editingId ?? newId();
    const payload: ReminderPayload = {
      title: title.slice(0, 200),
      notes: form.notes.slice(0, 2000),
      dueAt: due.toISOString(),
      repeatRule: form.repeatRule,
      completedAt: editing?.payload.completedAt ?? null,
    };
    if (await sync.save('reminders', id, payload)) {
      editingId = id;
      editorOpen = false;
    }
  }

  async function remove(): Promise<void> {
    if (!editingId) return;
    if (await sync.remove('reminders', editingId)) {
      editorOpen = false;
      editingId = null;
    }
  }
</script>

<SyncGate>
  <div class="page">
    <div class="page-head">
      <h1>Reminders</h1>
      <span class="muted">{open.length} open</span>
      <button class="btn primary push" onclick={openNew}><Icon name="plus" size={18} />New reminder</button>
    </div>

    {#if groups.length === 0}
      <div class="card empty">All caught up. Nothing is due.</div>
    {/if}

    {#each groups as g (g.key)}
      <section class="card section">
        <h2 class:overdue={g.key === 'overdue'}>{g.label}</h2>
        <ul class="list">
          {#each g.list as r (r.id)}
            {@const canEdit = sync.canEdit('reminders', r)}
            <li>
              <button class="ring" class:over={g.key === 'overdue'} disabled={!canEdit} aria-label={r.payload.repeatRule === 'none' ? `Complete “${r.payload.title}”` : `Done for now; move “${r.payload.title}” to its next date`} onclick={() => complete(r)}></button>
              <button class="rowbody" onclick={() => openEdit(r)}>
                <span class="title">{r.payload.title}</span>
                <span class="sub">
                  <span class:overtext={g.key === 'overdue'}>{dueLabel(r.payload.dueAt)}</span>
                  {#if r.payload.repeatRule !== 'none'}<span class="badge"><Icon name="repeat" size={14} />{REPEAT_LABEL[r.payload.repeatRule]}</span>{/if}
                  {#if r.ownerId !== sync.me || sync.shareFor('reminders', r.id)}<span class="badge shared"><Icon name="share" size={14} />Shared{canEdit ? '' : ' · view only'}</span>{/if}
                </span>
                {#if r.payload.notes}<span class="notes">{r.payload.notes}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}

    {#if completed.length > 0}
      <section class="card section">
        <button class="disclose" aria-expanded={showCompleted} onclick={() => (showCompleted = !showCompleted)}>
          <Icon name={showCompleted ? 'down' : 'right'} size={18} />Completed ({completed.length})
        </button>
        {#if showCompleted}
          <ul class="list">
            {#each completed as r (r.id)}
              <li>
                <span class="ring checked"><Icon name="check" size={14} /></span>
                <span class="rowbody static">
                  <span class="title done">{r.payload.title}</span>
                  <span class="sub">Done {r.payload.completedAt ? dueLabel(r.payload.completedAt) : ''}</span>
                </span>
                {#if sync.canEdit('reminders', r)}
                  <button class="btn small" onclick={() => reopen(r)}>Mark not done</button>
                  <button class="btn small danger" aria-label={`Delete “${r.payload.title}”`} onclick={() => sync.remove('reminders', r.id)}><Icon name="trash" size={16} /></button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>

  <Dialog bind:open={editorOpen} title={editingId ? 'Edit reminder' : 'New reminder'}>
    <form class="form" onsubmit={save}>
      {#if editing && !editable}<p class="muted">Shared with you as view-only.</p>{/if}
      <label class="field"><span>Title</span><input required maxlength="200" disabled={!editable} bind:value={form.title} /></label>
      <label class="field"><span>Notes</span><textarea maxlength="2000" disabled={!editable} bind:value={form.notes}></textarea></label>
      <div class="row">
        <label class="field grow"><span>Due</span><input type="datetime-local" required disabled={!editable} bind:value={form.due} /></label>
        <label class="field"><span>Repeat</span>
          <select disabled={!editable} bind:value={form.repeatRule}>
            {#each Object.entries(REPEAT_LABEL) as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
        </label>
      </div>
      {#if formError}<p class="error" role="alert">{formError}</p>{/if}
      <div class="row actions">
        {#if editing && editing.ownerId === sync.me}
          <button type="button" class="btn" onclick={() => (shareOpen = true)}><Icon name="share" size={18} />Share</button>
          <button type="button" class="btn danger" onclick={remove}><Icon name="trash" size={18} />Delete</button>
        {/if}
        <button type="submit" class="btn primary push" disabled={!editable}>Save</button>
      </div>
      <p class="muted small">Phones schedule the notification after their next sync.</p>
    </form>
  </Dialog>
  {#if editing}
    <ShareDialog bind:open={shareOpen} itemType="reminders" itemId={editing.id} itemName={editing.payload.title} />
  {/if}
</SyncGate>

<style>
  .page {
    max-width: 1100px;
  }
  h2.overdue {
    color: var(--orange);
  }
  .ring {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 50%;
    border: 2.5px solid var(--rem);
    background: transparent;
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .ring:hover:not(:disabled) {
    background: color-mix(in srgb, var(--rem) 20%, transparent);
  }
  .ring.over {
    border-color: var(--orange);
  }
  .ring.checked {
    background: var(--rem);
    color: #120c24;
    cursor: default;
  }
  .rowbody {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    background: transparent;
    border: none;
    padding: 4px 0;
    cursor: pointer;
  }
  .rowbody.static {
    cursor: default;
  }
  .title {
    font-size: 20px;
    font-weight: 500;
  }
  .title.done {
    color: var(--faint);
    text-decoration: line-through;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    color: var(--muted);
  }
  .overtext {
    color: var(--orange);
    font-weight: 600;
  }
  .shared {
    color: var(--rem);
    border-color: #4c3f7a;
  }
  .notes {
    font-size: 15px;
    color: var(--muted);
    white-space: pre-line;
  }
  .disclose {
    align-self: flex-start;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    border: none;
    background: transparent;
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .actions .push {
    margin-left: auto;
  }
  .error {
    color: var(--bad);
    margin: 0;
  }
  .small {
    font-size: 14px;
    margin: 0;
  }
  p {
    margin: 0;
  }
</style>
