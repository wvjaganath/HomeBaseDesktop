<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import ShareDialog from '../components/ShareDialog.svelte';
  import SyncGate from '../components/SyncGate.svelte';
  import { newId, sync, type Item, type NoteItem, type NotePayload } from '../lib/sync.svelte';

  let query = $state('');
  let selectedId = $state<string | null>(null);
  let draft = $state<NotePayload | null>(null);
  let shareOpen = $state(false);
  let newItemText = $state('');
  let undo = $state<{ id: string; payload: NotePayload } | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  // Which note/version the editor holds, so only remote changes reload it.
  let loadedId: string | null = null;
  let localStamp = '';
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  const notes = $derived(
    sync
      .list('notes')
      .filter((n) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        const p = n.payload;
        return p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q) || p.items.some((i) => i.text.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
  );
  const pinned = $derived(notes.filter((n) => n.payload.pinned));
  const others = $derived(notes.filter((n) => !n.payload.pinned));
  const selected = $derived<Item<'notes'> | undefined>(selectedId ? sync.get('notes', selectedId) : undefined);
  const editable = $derived(selected ? sync.canEdit('notes', selected) : true);
  const share = $derived(selected ? sync.shareFor('notes', selected.id) : undefined);
  const sharedWithMe = $derived(selected !== undefined && selected.ownerId !== sync.me);

  // Load the selected note into the editor, and follow remote changes while
  // there are no unsaved local edits.
  $effect(() => {
    const n = selected;
    if (!n) {
      draft = null;
      loadedId = null;
      return;
    }
    const remoteChange = n.updatedAt !== localStamp && saveTimer === null;
    if (n.id !== loadedId || remoteChange) {
      draft = structuredClone($state.snapshot(n.payload));
      loadedId = n.id;
      localStamp = n.updatedAt;
    }
  });

  function summary(p: NotePayload): string {
    if (p.isChecklist) {
      const done = p.items.filter((i) => i.done).length;
      return `Checklist · ${done} of ${p.items.length} done`;
    }
    return p.body.split('\n').find((l) => l.trim()) ?? 'No text';
  }

  function relTime(iso: string): string {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
    if (new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function scheduleSave(): void {
    if (!editable) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), 600);
  }

  async function flush(): Promise<void> {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!draft || !selectedId || !editable) return;
    const p = $state.snapshot(draft);
    p.items = sortItems(p.items).map((it, i) => ({ ...it, position: i }));
    const pending = sync.save('notes', selectedId, p);
    localStamp = sync.get('notes', selectedId)?.updatedAt ?? '';
    await pending;
  }

  async function select(id: string): Promise<void> {
    await flush();
    selectedId = id;
    newItemText = '';
  }

  async function create(checklist: boolean): Promise<void> {
    await flush();
    const id = newId();
    await sync.save('notes', id, { title: '', body: '', isChecklist: checklist, pinned: false, items: [] });
    selectedId = id;
  }

  /** Unchecked first, completed at the bottom; each group keeps its order. */
  function sortItems(items: NoteItem[]): NoteItem[] {
    return [...items].sort((a, b) => Number(a.done) - Number(b.done) || a.position - b.position);
  }

  function toggleItem(id: string): void {
    if (!draft) return;
    const it = draft.items.find((i) => i.id === id);
    if (!it) return;
    it.done = !it.done;
    // Move to the end of its new group.
    it.position = Math.max(0, ...draft.items.map((i) => i.position)) + 1;
    scheduleSave();
  }

  function addItem(e: SubmitEvent): void {
    e.preventDefault();
    if (!draft || !newItemText.trim() || draft.items.length >= 200) return;
    const firstDone = sortItems(draft.items).findIndex((i) => i.done);
    const open = sortItems(draft.items).filter((i) => !i.done);
    const position = firstDone === -1 ? draft.items.length : (open.at(-1)?.position ?? -1) + 0.5;
    draft.items.push({ id: newId(), text: newItemText.trim().slice(0, 2000), done: false, position });
    draft.items = sortItems(draft.items).map((it, i) => ({ ...it, position: i }));
    newItemText = '';
    scheduleSave();
  }

  function removeItem(id: string): void {
    if (!draft) return;
    draft.items = draft.items.filter((i) => i.id !== id);
    scheduleSave();
  }

  function moveItem(id: string, dir: -1 | 1): void {
    if (!draft) return;
    const list = sortItems(draft.items);
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;
    const a = list[i];
    const b = list[j];
    if (!a || !b || a.done !== b.done) return;
    list[i] = b;
    list[j] = a;
    draft.items = list.map((it, k) => ({ ...it, position: k }));
    scheduleSave();
  }

  function setChecklist(on: boolean): void {
    if (!draft || draft.isChecklist === on) return;
    if (on) {
      const lines = draft.body.split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
      const base = draft.items.length;
      draft.items = [...draft.items, ...lines.map((text, i) => ({ id: newId(), text: text.slice(0, 2000), done: false, position: base + i }))];
      draft.body = '';
    } else {
      const text = sortItems(draft.items).map((i) => `${i.done ? '[x] ' : ''}${i.text}`).join('\n');
      draft.body = [draft.body, text].filter(Boolean).join('\n');
      draft.items = [];
    }
    draft.isChecklist = on;
    scheduleSave();
  }

  function togglePin(): void {
    if (!draft) return;
    draft.pinned = !draft.pinned;
    void flush();
  }

  async function remove(): Promise<void> {
    if (!selected || selected.ownerId !== sync.me) return;
    const payload = structuredClone($state.snapshot(selected.payload));
    const id = selected.id;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    selectedId = null;
    if (await sync.remove('notes', id)) {
      undo = { id, payload };
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => (undo = null), 8000);
    }
  }

  async function restore(): Promise<void> {
    if (!undo) return;
    const { id, payload } = undo;
    undo = null;
    await sync.save('notes', id, payload);
    selectedId = id;
  }
</script>

<SyncGate>
  <div class="notes">
    <aside class="listcol">
      <div class="head">
        <h1>Notes</h1>
        <div class="newbtns">
          <button class="btn primary small" onclick={() => create(false)}><Icon name="plus" size={18} />Note</button>
          <button class="btn small" onclick={() => create(true)}><Icon name="check" size={18} />Checklist</button>
        </div>
      </div>
      <label class="field">
        <span class="sr-only">Search notes</span>
        <input type="search" placeholder="Search" bind:value={query} />
      </label>
      {#if notes.length === 0}
        <p class="empty">{query ? 'No notes match.' : 'No notes yet.'}</p>
      {/if}
      {#each [{ label: 'Pinned', list: pinned }, { label: pinned.length ? 'Notes' : '', list: others }] as group (group.label)}
        {#if group.list.length > 0}
          {#if group.label}<span class="grouplabel">{group.label}</span>{/if}
          {#each group.list as n (n.id)}
            <button class="noterow" class:active={n.id === selectedId} class:pinned={n.payload.pinned} onclick={() => select(n.id)}>
              <span class="t">
                <span class="title">{n.payload.title || 'Untitled'}</span>
                {#if n.ownerId !== sync.me || sync.shareFor('notes', n.id)}<span class="badge share"><Icon name="share" size={14} />Shared</span>{/if}
              </span>
              <span class="sub">{relTime(n.updatedAt)} · {summary(n.payload)}</span>
            </button>
          {/each}
        {/if}
      {/each}
    </aside>

    <article class="editor">
      {#if selected && draft}
        <div class="toolbar">
          <span class="muted meta">
            {draft.isChecklist ? 'Checklist' : 'Note'}
            {#if sharedWithMe}· shared with you{editable ? ' (can edit)' : ' (view only)'}{:else if share}· shared ({share.permission === 'write' ? 'can edit' : 'can view'}){/if}
            · edited {relTime(selected.updatedAt)}
          </span>
          <div class="tools">
            <div class="seg" role="group" aria-label="Note type">
              <button class:on={!draft.isChecklist} disabled={!editable} onclick={() => setChecklist(false)}>Text</button>
              <button class:on={draft.isChecklist} disabled={!editable} onclick={() => setChecklist(true)}>Checklist</button>
            </div>
            <button class="btn small" class:pinon={draft.pinned} disabled={!editable} onclick={togglePin} aria-pressed={draft.pinned}><Icon name="pin" size={18} />{draft.pinned ? 'Pinned' : 'Pin'}</button>
            {#if selected.ownerId === sync.me}
              <button class="btn small" onclick={() => (shareOpen = true)}><Icon name="share" size={18} />Share</button>
              <button class="btn small danger" onclick={remove}><Icon name="trash" size={18} />Delete</button>
            {/if}
          </div>
        </div>

        <label class="field">
          <span class="sr-only">Title</span>
          <input class="titleinput" placeholder="Title" maxlength="200" disabled={!editable} bind:value={draft.title} oninput={scheduleSave} onblur={() => void flush()} />
        </label>

        {#if draft.isChecklist}
          <ul class="items">
            {#each sortItems(draft.items) as it, i (it.id)}
              {#if it.done && (i === 0 || !sortItems(draft.items)[i - 1]?.done)}<li class="donelabel">Completed</li>{/if}
              <li class="item" class:done={it.done}>
                <button class="box" class:checked={it.done} disabled={!editable} aria-pressed={it.done} aria-label={it.done ? `Mark “${it.text}” not done` : `Mark “${it.text}” done`} onclick={() => toggleItem(it.id)}>
                  {#if it.done}<Icon name="check" size={16} />{/if}
                </button>
                <label class="grow">
                  <span class="sr-only">Item text</span>
                  <input class="itemtext" maxlength="2000" disabled={!editable} bind:value={it.text} oninput={scheduleSave} onblur={() => void flush()} />
                </label>
                {#if editable}
                  <span class="itemtools">
                    <button class="btn ghost icon" aria-label="Move up" onclick={() => moveItem(it.id, -1)}><Icon name="up" size={18} /></button>
                    <button class="btn ghost icon" aria-label="Move down" onclick={() => moveItem(it.id, 1)}><Icon name="down" size={18} /></button>
                    <button class="btn ghost icon" aria-label="Remove item" onclick={() => removeItem(it.id)}><Icon name="close" size={18} /></button>
                  </span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if editable}
            <form class="additem" onsubmit={addItem}>
              <label class="field grow">
                <span class="sr-only">Add item</span>
                <input placeholder="Add an item and press Enter" maxlength="2000" bind:value={newItemText} />
              </label>
              <button class="btn" type="submit"><Icon name="plus" size={18} />Add</button>
            </form>
          {/if}
        {:else}
          <label class="field bodyfield">
            <span class="sr-only">Note text</span>
            <textarea placeholder="Start typing…" maxlength="20000" disabled={!editable} bind:value={draft.body} oninput={scheduleSave} onblur={() => void flush()}></textarea>
          </label>
        {/if}
        <span class="muted foot">Saves automatically and syncs to both iPhones.</span>
        <ShareDialog bind:open={shareOpen} itemType="notes" itemId={selected.id} itemName={draft.title} />
      {:else}
        <div class="empty pick">Pick a note on the left, or create one.</div>
      {/if}
    </article>
  </div>
  {#if undo}
    <div class="undo" role="status">Note deleted. <button class="btn small" onclick={restore}>Undo</button></div>
  {/if}
</SyncGate>

<style>
  .notes {
    height: 100%;
    display: flex;
    min-height: 0;
  }
  .listcol {
    width: 400px;
    flex-shrink: 0;
    padding: 26px 20px;
    border-right: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  h1 {
    margin: 0;
    font-size: 30px;
  }
  .newbtns {
    display: flex;
    gap: 6px;
  }
  .grouplabel {
    margin-top: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .noterow {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .noterow:hover {
    background: var(--surface);
  }
  .noterow.pinned {
    background: var(--surface);
    border-color: var(--line);
  }
  .noterow.active {
    border-color: #8a6a1e;
    background: #17140c;
  }
  .t {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .title {
    font-size: 17px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .share {
    color: var(--rem);
    border-color: #4c3f7a;
  }
  .sub {
    font-size: 14px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor {
    flex: 1;
    min-width: 0;
    padding: 26px 40px 40px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    background: #0e1218;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .meta {
    font-size: 14px;
  }
  .tools {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .pinon {
    color: var(--note);
    border-color: #8a6a1e;
  }
  .titleinput {
    font-size: 34px !important;
    font-weight: 700;
    min-height: 60px !important;
    background: transparent !important;
    border-color: transparent !important;
    padding: 0 !important;
  }
  .titleinput:focus {
    border-color: var(--line-2) !important;
  }
  .items {
    margin: 0;
    padding: 0;
    list-style: none;
    max-width: 760px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .donelabel {
    margin: 12px 0 4px;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 2px 6px;
    border-radius: 10px;
  }
  .item:hover {
    background: var(--surface);
  }
  .box {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 7px;
    border: 2px solid var(--muted);
    background: transparent;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: #1a1404;
    padding: 0;
  }
  .box.checked {
    background: var(--note);
    border-color: var(--note);
  }
  .itemtext {
    width: 100%;
    min-height: 44px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    font-size: 19px;
    padding: 0 8px;
  }
  .itemtext:focus {
    border-color: var(--line-2);
    background: var(--surface-2);
  }
  .done .itemtext {
    color: var(--faint);
    text-decoration: line-through;
  }
  .itemtools {
    display: flex;
    opacity: 0;
  }
  .item:hover .itemtools,
  .item:focus-within .itemtools {
    opacity: 1;
  }
  .additem {
    display: flex;
    gap: 10px;
    max-width: 760px;
  }
  .bodyfield textarea {
    min-height: 420px;
    font-size: 18px;
    max-width: 900px;
  }
  .foot {
    font-size: 13px;
    margin-top: auto;
  }
  .pick {
    margin: auto;
  }
  .undo {
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    z-index: 1500;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px 10px 18px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line-2);
  }
</style>
