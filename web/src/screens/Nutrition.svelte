<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import SyncGate from '../components/SyncGate.svelte';
  import { MEAL_TYPES, mealTypeLabel, RECIPES, recipeById, type MealType } from '../data/recipes';
  import { addDays, prettyDate, todayStr } from '../lib/dates';
  import { newId, sync, type Item, type MealEntryPayload } from '../lib/sync.svelte';

  type View = 'today' | 'history' | 'recipes' | 'targets';
  interface Targets {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }
  // Per-device, like the iOS app's @AppStorage and the old website (README §5).
  const TARGETS_KEY = 'homebase.nutritionTargets';
  const DEFAULT_TARGETS: Targets = { calories: 2950, protein: 190, carbs: 355, fat: 85 };

  function loadTargets(): Targets {
    try {
      const raw = localStorage.getItem(TARGETS_KEY);
      return raw ? { ...DEFAULT_TARGETS, ...(JSON.parse(raw) as Partial<Targets>) } : { ...DEFAULT_TARGETS };
    } catch {
      return { ...DEFAULT_TARGETS };
    }
  }

  let view = $state<View>('today');
  let day = $state(todayStr());
  const initialTargets = loadTargets();
  let targets = $state<Targets>(initialTargets);
  let tForm = $state({ ...initialTargets });
  let tMsg = $state('');

  const meals = $derived(sync.list('meal_entries').filter((m) => m.ownerId === sync.me));
  const dayMeals = $derived(meals.filter((m) => m.payload.date === day));
  const totals = $derived(
    dayMeals.reduce(
      (a, m) => ({ calories: a.calories + m.payload.calories, protein: a.protein + m.payload.protein, carbs: a.carbs + m.payload.carbs, fat: a.fat + m.payload.fat }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ),
  );
  const history = $derived.by(() => {
    const byDate: Record<string, Array<Item<'meal_entries'>>> = {};
    for (const m of meals) (byDate[m.payload.date] ??= []).push(m);
    return Object.entries(byDate).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 60);
  });

  // ---- log form --------------------------------------------------------------
  const blank = (): { id: string; recipeId: string; mealType: MealType; name: string; calories: string; protein: string; carbs: string; fat: string; note: string } => ({
    id: '',
    recipeId: '',
    mealType: guessMealType(),
    name: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    note: '',
  });
  function guessMealType(): MealType {
    const h = new Date().getHours();
    return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
  }
  let form = $state(blank());
  let formError = $state('');

  function pickRecipe(id: string): void {
    const r = recipeById.get(id);
    form.recipeId = id;
    if (!r) return;
    form = { ...form, mealType: r.mealType, name: r.name, calories: String(r.calories), protein: String(r.protein), carbs: String(r.carbs), fat: String(r.fat) };
  }

  async function saveMeal(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const num = (s: string, max: number): number | null => {
      const n = s.trim() === '' ? 0 : Number(s);
      return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null;
    };
    const calories = num(form.calories, 5000);
    const protein = num(form.protein, 500);
    const carbs = num(form.carbs, 500);
    const fat = num(form.fat, 500);
    if (!form.name.trim() || form.calories.trim() === '' || calories === null || protein === null || carbs === null || fat === null) {
      formError = 'Give it a name and calories (0–5000); macros 0–500 g.';
      return;
    }
    formError = '';
    const payload: MealEntryPayload = {
      date: day,
      mealType: form.mealType,
      name: form.name.trim().slice(0, 200),
      recipeId: form.recipeId || null,
      calories,
      protein,
      carbs,
      fat,
      note: form.note.trim().slice(0, 2000),
    };
    if (await sync.save('meal_entries', form.id || newId(), payload)) form = blank();
  }

  function editMeal(m: Item<'meal_entries'>): void {
    const p = m.payload;
    day = p.date;
    form = { id: m.id, recipeId: p.recipeId ?? '', mealType: p.mealType, name: p.name, calories: String(p.calories), protein: String(p.protein), carbs: String(p.carbs), fat: String(p.fat), note: p.note };
    view = 'today';
  }

  function logRecipe(id: string): void {
    form = blank();
    pickRecipe(id);
    day = todayStr();
    view = 'today';
  }

  // ---- recipes -----------------------------------------------------------------
  let rFilter = $state<'all' | MealType>('all');
  let rSearch = $state('');
  let openRecipe = $state<string | null>(null);
  const recipes = $derived(RECIPES.filter((r) => (rFilter === 'all' || r.mealType === rFilter) && (!rSearch.trim() || r.name.toLowerCase().includes(rSearch.trim().toLowerCase()))));

  function saveTargets(e: SubmitEvent): void {
    e.preventDefault();
    const t: Targets = {
      calories: Number(tForm.calories) || DEFAULT_TARGETS.calories,
      protein: Number(tForm.protein) || DEFAULT_TARGETS.protein,
      carbs: Number(tForm.carbs) || DEFAULT_TARGETS.carbs,
      fat: Number(tForm.fat) || DEFAULT_TARGETS.fat,
    };
    targets = t;
    try {
      localStorage.setItem(TARGETS_KEY, JSON.stringify(t));
      tMsg = 'Saved on this computer.';
    } catch {
      tMsg = 'Saved for now; this browser won’t remember it after closing.';
    }
  }

  const macros = $derived([
    { key: 'calories', label: 'Calories', unit: 'kcal', value: totals.calories, target: targets.calories },
    { key: 'protein', label: 'Protein', unit: 'g', value: totals.protein, target: targets.protein },
    { key: 'carbs', label: 'Carbs', unit: 'g', value: totals.carbs, target: targets.carbs },
    { key: 'fat', label: 'Fat', unit: 'g', value: totals.fat, target: targets.fat },
  ]);
</script>

<SyncGate>
  <div class="page">
    <div class="page-head">
      <h1>Nutrition</h1>
      <div class="seg push" role="tablist" aria-label="Nutrition sections">
        {#each [['today', 'Day'], ['history', 'History'], ['recipes', 'Recipes'], ['targets', 'Targets']] as [v, l] (v)}
          <button role="tab" aria-selected={view === v} class:on={view === v} onclick={() => (view = v as View)}>{l}</button>
        {/each}
      </div>
    </div>

    {#if view === 'today'}
      <div class="dayhead">
        <button class="btn icon" aria-label="Previous day" onclick={() => (day = addDays(day, -1))}><Icon name="left" size={20} /></button>
        <h2>{day === todayStr() ? 'Today' : prettyDate(day)}</h2>
        <button class="btn icon" aria-label="Next day" disabled={day >= todayStr()} onclick={() => (day = addDays(day, 1))}><Icon name="right" size={20} /></button>
        {#if day !== todayStr()}<button class="btn small" onclick={() => (day = todayStr())}>Today</button>{/if}
      </div>
      <div class="stat-grid">
        {#each macros as m (m.key)}
          {@const pct = m.target > 0 ? Math.min(100, (m.value / m.target) * 100) : 0}
          <div class="stat">
            <span class="k">{m.label}</span>
            <span class="v">{Math.round(m.value).toLocaleString('en-US')}<span class="of"> / {m.target.toLocaleString('en-US')} {m.unit}</span></span>
            <div class="meter" role="progressbar" aria-label={`${m.label} vs target`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><span style:width={`${pct}%`} class:over={m.value > m.target}></span></div>
            <span class="s">{m.value > m.target ? `${Math.round(m.value - m.target)} ${m.unit} over` : `${Math.round(m.target - m.value)} ${m.unit} left`}</span>
          </div>
        {/each}
      </div>

      <div class="two">
        <section class="card section">
          <h2>{form.id ? 'Edit meal' : 'Log food'}</h2>
          <form class="form" onsubmit={saveMeal}>
            <label class="field"><span>From the recipe library</span>
              <select value={form.recipeId} onchange={(e) => pickRecipe(e.currentTarget.value)}>
                <option value="">Custom item</option>
                {#each MEAL_TYPES as t (t)}
                  <optgroup label={mealTypeLabel(t)}>
                    {#each RECIPES.filter((r) => r.mealType === t) as r (r.id)}<option value={r.id}>{r.name} · {r.calories} kcal</option>{/each}
                  </optgroup>
                {/each}
              </select>
            </label>
            <div class="row">
              <label class="field"><span>Meal</span>
                <select bind:value={form.mealType}>{#each MEAL_TYPES as t (t)}<option value={t}>{mealTypeLabel(t)}</option>{/each}</select>
              </label>
              <label class="field grow"><span>Name</span><input required maxlength="200" bind:value={form.name} /></label>
            </div>
            <div class="row">
              <label class="field"><span>Calories</span><input inputmode="decimal" required bind:value={form.calories} /></label>
              <label class="field"><span>Protein g</span><input inputmode="decimal" bind:value={form.protein} /></label>
              <label class="field"><span>Carbs g</span><input inputmode="decimal" bind:value={form.carbs} /></label>
              <label class="field"><span>Fat g</span><input inputmode="decimal" bind:value={form.fat} /></label>
            </div>
            <label class="field"><span>Note</span><input maxlength="2000" bind:value={form.note} placeholder="Optional" /></label>
            {#if formError}<p class="error" role="alert">{formError}</p>{/if}
            <div class="row">
              <button class="btn primary" type="submit">{form.id ? 'Update' : `Add to ${day === todayStr() ? 'today' : prettyDate(day)}`}</button>
              {#if form.id}<button class="btn" type="button" onclick={() => (form = blank())}>Cancel</button>{/if}
            </div>
          </form>
        </section>
        <section class="card section">
          <h2>Meals</h2>
          {#each MEAL_TYPES as t (t)}
            {@const list = dayMeals.filter((m) => m.payload.mealType === t)}
            {#if list.length > 0}
              <h3>{mealTypeLabel(t)}</h3>
              <ul class="list">
                {#each list as m (m.id)}
                  <li>
                    <span class="grow">{m.payload.name}<span class="muted macros">P {Math.round(m.payload.protein)} · C {Math.round(m.payload.carbs)} · F {Math.round(m.payload.fat)}</span></span>
                    <strong class="kcal">{Math.round(m.payload.calories)} kcal</strong>
                    <button class="btn small" aria-label={`Edit ${m.payload.name}`} onclick={() => editMeal(m)}><Icon name="edit" size={16} /></button>
                    <button class="btn small danger" aria-label={`Delete ${m.payload.name}`} onclick={() => sync.remove('meal_entries', m.id)}><Icon name="trash" size={16} /></button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/each}
          {#if dayMeals.length === 0}<p class="muted">Nothing logged for this day.</p>{/if}
        </section>
      </div>
    {:else if view === 'history'}
      <section class="card section">
        <h2>Recent days</h2>
        <ul class="list">
          {#each history as [d, list] (d)}
            {@const kcal = list.reduce((a, m) => a + m.payload.calories, 0)}
            {@const prot = list.reduce((a, m) => a + m.payload.protein, 0)}
            <li>
              <button class="dayrow" onclick={() => { day = d; view = 'today'; }}>
                <span class="date">{prettyDate(d)}</span>
                <span class="grow muted">{list.length} item{list.length === 1 ? '' : 's'}</span>
                <span class="muted">P {Math.round(prot)} g</span>
                <strong class="kcal" class:overtext={kcal > targets.calories}>{Math.round(kcal).toLocaleString('en-US')} kcal</strong>
              </button>
            </li>
          {:else}
            <li class="muted">No meals logged yet.</li>
          {/each}
        </ul>
      </section>
    {:else if view === 'recipes'}
      <div class="row">
        <div class="seg" role="group" aria-label="Meal type">
          <button class:on={rFilter === 'all'} onclick={() => (rFilter = 'all')}>All</button>
          {#each MEAL_TYPES as t (t)}<button class:on={rFilter === t} onclick={() => (rFilter = t)}>{mealTypeLabel(t)}</button>{/each}
        </div>
        <label class="field grow"><span class="sr-only">Search recipes</span><input type="search" placeholder="Search recipes" bind:value={rSearch} /></label>
      </div>
      <div class="grid">
        {#each recipes as r (r.id)}
          <section class="card section">
            <div class="row between"><h2>{r.name}</h2><span class="badge">{mealTypeLabel(r.mealType)}</span></div>
            <p class="small"><strong>{r.calories} kcal</strong> · P {r.protein} g · C {r.carbs} g · F {r.fat} g · {r.prepMinutes} min</p>
            <p class="tags">{#each r.tags as t (t)}<span class="badge">{t}</span>{/each}</p>
            <div class="row">
              <button class="btn small" aria-expanded={openRecipe === r.id} onclick={() => (openRecipe = openRecipe === r.id ? null : r.id)}>Recipe</button>
              <button class="btn small primary" onclick={() => logRecipe(r.id)}><Icon name="plus" size={16} />Log it</button>
            </div>
            {#if openRecipe === r.id}
              <h3>Ingredients</h3>
              <ul class="steps">{#each r.ingredients as x, i (i)}<li>{x}</li>{/each}</ul>
              <h3>Steps</h3>
              <ol class="steps">{#each r.instructions as x, i (i)}<li>{x}</li>{/each}</ol>
            {/if}
          </section>
        {/each}
      </div>
    {:else}
      <section class="card section narrow">
        <h2>Daily targets</h2>
        <p class="muted">Kept on this computer only, like on each iPhone.</p>
        <form class="row" onsubmit={saveTargets}>
          <label class="field"><span>Calories</span><input type="number" min="500" max="9000" bind:value={tForm.calories} /></label>
          <label class="field"><span>Protein g</span><input type="number" min="0" max="600" bind:value={tForm.protein} /></label>
          <label class="field"><span>Carbs g</span><input type="number" min="0" max="900" bind:value={tForm.carbs} /></label>
          <label class="field"><span>Fat g</span><input type="number" min="0" max="400" bind:value={tForm.fat} /></label>
          <button class="btn primary" type="submit">Save</button>
        </form>
        {#if tMsg}<p class="muted" role="status">{tMsg}</p>{/if}
      </section>
    {/if}
  </div>
</SyncGate>

<style>
  .dayhead {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .dayhead h2 {
    margin: 0;
    min-width: 260px;
    text-align: center;
    font-size: 24px;
  }
  .of {
    font-size: 16px;
    color: var(--muted);
    font-weight: 500;
  }
  .meter span {
    background: var(--orange);
  }
  /* Over target: status "critical" red, always paired with the "over" text label. */
  .meter span.over {
    background: #d03b3b;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 18px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .form .row .field:not(.grow) input {
    width: 110px;
  }
  h3 {
    margin: 8px 0 0;
    font-size: 14px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .macros {
    display: block;
    font-size: 13px;
  }
  .kcal {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .overtext {
    color: var(--orange);
  }
  .dayrow {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 14px;
    border: none;
    background: transparent;
    text-align: left;
    min-height: 44px;
    cursor: pointer;
    font-size: 16px;
  }
  .date {
    width: 190px;
  }
  .between {
    justify-content: space-between;
    align-items: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 16px;
  }
  .small {
    font-size: 15px;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .steps {
    margin: 0;
    padding-left: 20px;
    color: var(--text-2);
    line-height: 1.6;
  }
  .narrow {
    max-width: 860px;
  }
  .narrow input {
    width: 120px;
  }
  p {
    margin: 0;
  }
  .error {
    color: var(--bad);
  }
</style>
