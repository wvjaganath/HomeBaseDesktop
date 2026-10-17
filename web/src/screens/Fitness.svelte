<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import LineChart from '../components/LineChart.svelte';
  import SyncGate from '../components/SyncGate.svelte';
  import { DEFAULT_PLAN, EXERCISES, exerciseById, formVideoUrl, type ExerciseCategory } from '../data/exercises';
  import { addDays, prettyDate, RANGES, rangeStart, todayStr, WEEKDAYS, ymdToTime, type Range } from '../lib/dates';
  import { newId, sync, type FitnessProfilePayload, type Item } from '../lib/sync.svelte';

  type View = 'overview' | 'weighins' | 'workouts' | 'plan' | 'library' | 'goals';
  const VIEWS: Array<{ id: View; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'weighins', label: 'Weigh-ins' },
    { id: 'workouts', label: 'Workouts' },
    { id: 'plan', label: 'Weekly plan' },
    { id: 'library', label: 'Exercises' },
    { id: 'goals', label: 'Goals' },
  ];
  // Same defaults as the iOS app's FitnessProfile.new() and the old website.
  const DEFAULT_PROFILE: FitnessProfilePayload = { heightIn: 76, startWeight: 340, startDate: '2026-07-21', goals: [260, 230, 205, 190] };
  const SERIES_BLUE = '#3987e5';

  let view = $state<View>('overview');
  let range = $state<Range>('3M');
  const today = todayStr();

  // ---- data -------------------------------------------------------------------
  const profileItem = $derived(
    sync
      .list('fitness_profile')
      .filter((p) => p.ownerId === sync.me)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0],
  );
  const profile = $derived(profileItem?.payload ?? DEFAULT_PROFILE);
  const weights = $derived(
    sync
      .list('weight_entries')
      .filter((w) => w.ownerId === sync.me)
      .sort((a, b) => (a.payload.date < b.payload.date ? -1 : a.payload.date > b.payload.date ? 1 : a.updatedAt < b.updatedAt ? -1 : 1)),
  );
  const workouts = $derived(
    sync
      .list('workout_logs')
      .filter((w) => w.ownerId === sync.me)
      .sort((a, b) => (a.payload.date < b.payload.date ? 1 : -1)),
  );
  const workoutDates = $derived(new Set(workouts.map((w) => w.payload.date)));

  // ---- calculations (same rules as the iOS app / old website) ----------------
  const current = $derived(weights.at(-1)?.payload.weight ?? profile.startWeight);
  const totalLost = $derived(profile.startWeight - current);
  const bmi = $derived((703 * current) / (profile.heightIn * profile.heightIn));
  const bmiCategory = $derived(bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : bmi < 35 ? 'Obese I' : bmi < 40 ? 'Obese II' : 'Obese III');
  const weekChange = $derived.by(() => {
    const last = weights.at(-1);
    if (!last || weights.length < 2) return null;
    const boundary = addDays(last.payload.date, -6);
    const prior = [...weights].reverse().find((w) => w.payload.date <= boundary);
    return prior ? last.payload.weight - prior.payload.weight : null;
  });
  const streak = $derived.by(() => {
    let n = 0;
    let d = today;
    while (workoutDates.has(d)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  });
  const sortedGoals = $derived([...profile.goals].sort((a, b) => b - a));
  const nextGoal = $derived(sortedGoals.find((g) => current > g) ?? null);
  const goalPct = $derived.by(() => {
    if (nextGoal === null) return 100;
    const idx = sortedGoals.indexOf(nextGoal);
    const prevTarget = idx > 0 ? (sortedGoals[idx - 1] ?? profile.startWeight) : profile.startWeight;
    const total = prevTarget - nextGoal;
    return total <= 0 ? 100 : Math.max(0, Math.min(100, ((prevTarget - current) / total) * 100));
  });
  const todayPlan = $derived(DEFAULT_PLAN.find((d) => d.day === WEEKDAYS[new Date().getDay()]));
  const chartSeries = $derived([
    {
      name: 'Weight',
      color: SERIES_BLUE,
      points: weights.filter((w) => w.payload.date >= rangeStart(range)).map((w) => ({ t: ymdToTime(w.payload.date), v: w.payload.weight })),
    },
  ]);
  const last7 = $derived(Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)));

  // ---- weigh-ins ---------------------------------------------------------------
  let wForm = $state({ id: '', date: today, weight: '', note: '' });
  let wError = $state('');
  async function saveWeight(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const weight = Number(wForm.weight);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(wForm.date) || !(weight >= 50 && weight <= 700)) {
      wError = 'Enter a date and a weight between 50 and 700 lbs.';
      return;
    }
    wError = '';
    if (await sync.save('weight_entries', wForm.id || newId(), { date: wForm.date, weight: Math.round(weight * 10) / 10, note: wForm.note.trim().slice(0, 2000) })) {
      wForm = { id: '', date: today, weight: '', note: '' };
    }
  }
  function editWeight(w: Item<'weight_entries'>): void {
    wForm = { id: w.id, date: w.payload.date, weight: String(w.payload.weight), note: w.payload.note };
    view = 'weighins';
  }

  // ---- workouts ----------------------------------------------------------------
  let woForm = $state({ date: today, day: WEEKDAYS[new Date().getDay()] as string, duration: '', note: '' });
  let woChecked = $state<Record<string, { on: boolean; note: string }>>({});
  let woSearch = $state('');
  let woError = $state('');
  const woExercises = $derived.by(() => {
    if (woForm.day === 'Custom') {
      const q = woSearch.trim().toLowerCase();
      return EXERCISES.filter((e) => !q || e.name.toLowerCase().includes(q) || e.muscles.join(' ').toLowerCase().includes(q));
    }
    return (DEFAULT_PLAN.find((d) => d.day === woForm.day)?.exerciseIds ?? []).map((id) => exerciseById.get(id)).filter((e) => e !== undefined);
  });
  function setCheck(id: string, patch: Partial<{ on: boolean; note: string }>): void {
    woChecked[id] = { on: false, note: '', ...woChecked[id], ...patch };
  }
  async function saveWorkout(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const done = Object.entries(woChecked)
      .filter(([, v]) => v.on)
      .map(([id, v]) => ({ id, name: exerciseById.get(id)?.name ?? id, note: v.note.trim().slice(0, 500) }));
    if (done.length === 0) {
      woError = 'Check off at least one completed exercise.';
      return;
    }
    woError = '';
    const ok = await sync.save('workout_logs', newId(), {
      date: woForm.date,
      dayType: woForm.day,
      duration: woForm.duration.trim().slice(0, 20),
      note: woForm.note.trim().slice(0, 2000),
      exercises: done.slice(0, 50),
    });
    if (ok) {
      woChecked = {};
      woForm = { ...woForm, duration: '', note: '' };
    }
  }

  // ---- library -----------------------------------------------------------------
  let libFilter = $state<'all' | ExerciseCategory>('all');
  let libSearch = $state('');
  let openHowTo = $state<string | null>(null);
  const library = $derived(
    EXERCISES.filter((e) => {
      const q = libSearch.trim().toLowerCase();
      return (libFilter === 'all' || e.category === libFilter) && (!q || e.name.toLowerCase().includes(q) || e.muscles.join(' ').toLowerCase().includes(q));
    }),
  );

  // ---- goals -------------------------------------------------------------------
  let gForm = $state({ feet: '6', inches: '4', startWeight: '340', startDate: '2026-07-21', goals: ['', '', '', ''] });
  let gMsg = $state('');
  $effect(() => {
    const p = profile;
    gForm = {
      feet: String(Math.floor(p.heightIn / 12)),
      inches: String(Math.round(p.heightIn % 12)),
      startWeight: String(p.startWeight),
      startDate: p.startDate,
      goals: [0, 1, 2, 3].map((i) => (sortedGoals[i] === undefined ? '' : String(sortedGoals[i]))),
    };
  });
  async function saveGoals(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const heightIn = Number(gForm.feet) * 12 + Number(gForm.inches);
    const startWeight = Number(gForm.startWeight);
    const goals = gForm.goals.map(Number).filter((g, i) => gForm.goals[i]?.trim() !== '' && g >= 50 && g <= 700);
    if (!(heightIn >= 36 && heightIn <= 96) || !(startWeight >= 50 && startWeight <= 700) || goals.length === 0) {
      gMsg = 'Check height (3–8 ft), start weight (50–700 lbs) and at least one goal.';
      return;
    }
    const ok = await sync.save('fitness_profile', profileItem?.id ?? newId(), { heightIn, startWeight, startDate: gForm.startDate, goals });
    gMsg = ok ? 'Saved.' : '';
  }
</script>

<SyncGate>
  <div class="page">
    <div class="page-head">
      <h1>Weight loss</h1>
      <div class="seg push" role="tablist" aria-label="Weight loss sections">
        {#each VIEWS as v (v.id)}
          <button role="tab" aria-selected={view === v.id} class:on={view === v.id} onclick={() => (view = v.id)}>{v.label}</button>
        {/each}
      </div>
    </div>

    {#if view === 'overview'}
      <div class="stat-grid">
        <div class="stat"><span class="k">Current</span><span class="v">{current} lbs</span><span class="s">{weights.at(-1) ? prettyDate(weights.at(-1)?.payload.date ?? today) : 'Start weight'}</span></div>
        <div class="stat"><span class="k">Total lost</span><span class="v">{Math.max(0, totalLost).toFixed(1)} lbs</span><span class="s">from {profile.startWeight} lbs</span></div>
        <div class="stat"><span class="k">Last 7 days</span><span class="v">{weekChange === null ? '—' : `${weekChange > 0 ? '+' : ''}${weekChange.toFixed(1)} lbs`}</span><span class="s">vs a week earlier</span></div>
        <div class="stat"><span class="k">BMI</span><span class="v">{bmi.toFixed(1)}</span><span class="s">{bmiCategory}</span></div>
        <div class="stat"><span class="k">Streak</span><span class="v">{streak} day{streak === 1 ? '' : 's'}</span><span class="s">workouts in a row</span></div>
      </div>

      <section class="card section">
        <div class="row between">
          <h2>Weight</h2>
          <div class="seg" role="group" aria-label="Range">
            {#each RANGES as r (r)}<button class:on={range === r} onclick={() => (range = r)}>{r}</button>{/each}
          </div>
        </div>
        <LineChart series={chartSeries} unit="lbs" label="Weight over time" reference={nextGoal === null ? null : { value: nextGoal, label: `Goal ${nextGoal}` }} />
        <div class="goal">
          <span>{nextGoal === null ? 'All staged goals reached. Set a new one in Goals.' : `Next goal: ${nextGoal} lbs · ${goalPct.toFixed(0)}% of the way there`}</span>
          <div class="meter" role="progressbar" aria-label="Progress to next goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(goalPct)}><span style:width={`${goalPct}%`} style:background={SERIES_BLUE}></span></div>
        </div>
      </section>

      <div class="two">
        <section class="card section">
          <h2>Today · {todayPlan?.type ?? 'Rest'}</h2>
          <p class="muted">{todayPlan?.note}</p>
          <ul class="list">
            {#each todayPlan?.exerciseIds ?? [] as id (id)}
              {@const ex = exerciseById.get(id)}
              {#if ex}<li><span class="grow">{ex.name}</span><span class="muted small">{ex.guidance}</span></li>{/if}
            {/each}
          </ul>
          <button class="btn primary start" onclick={() => (view = 'workouts')}>Log today’s workout</button>
        </section>
        <section class="card section">
          <h2>This week</h2>
          <ol class="week">
            {#each last7 as d (d)}
              <li class:done={workoutDates.has(d)} class:today={d === today}>
                <span class="wd">{new Date(ymdToTime(d)).toLocaleDateString('en-US', { weekday: 'short' })}</span>
                <span class="mark" aria-label={workoutDates.has(d) ? 'Workout logged' : 'No workout'}>{#if workoutDates.has(d)}<Icon name="check" size={18} />{:else}–{/if}</span>
                <span class="dn">{new Date(ymdToTime(d)).getDate()}</span>
              </li>
            {/each}
          </ol>
        </section>
      </div>
    {:else if view === 'weighins'}
      <section class="card section">
        <h2>{wForm.id ? 'Edit weigh-in' : 'Log a weigh-in'}</h2>
        <form class="row" onsubmit={saveWeight}>
          <label class="field"><span>Date</span><input type="date" required max={today} bind:value={wForm.date} /></label>
          <label class="field"><span>Weight (lbs)</span><input type="number" step="0.1" min="50" max="700" required inputmode="decimal" bind:value={wForm.weight} /></label>
          <label class="field grow"><span>Note</span><input maxlength="2000" bind:value={wForm.note} placeholder="Optional" /></label>
          <button class="btn primary" type="submit">{wForm.id ? 'Update' : 'Add'}</button>
          {#if wForm.id}<button class="btn" type="button" onclick={() => (wForm = { id: '', date: today, weight: '', note: '' })}>Cancel</button>{/if}
        </form>
        {#if wError}<p class="error" role="alert">{wError}</p>{/if}
      </section>
      <section class="card section">
        <h2>History</h2>
        <ul class="list">
          {#each [...weights].reverse() as w, i (w.id)}
            {@const prev = weights[weights.length - 2 - i]}
            <li>
              <span class="date">{prettyDate(w.payload.date)}</span>
              <strong class="wt">{w.payload.weight} lbs</strong>
              <span class="muted delta">{prev ? `${w.payload.weight - prev.payload.weight > 0 ? '+' : ''}${(w.payload.weight - prev.payload.weight).toFixed(1)}` : ''}</span>
              <span class="grow muted">{w.payload.note}</span>
              <button class="btn small" onclick={() => editWeight(w)}><Icon name="edit" size={16} />Edit</button>
              <button class="btn small danger" aria-label={`Delete weigh-in on ${w.payload.date}`} onclick={() => sync.remove('weight_entries', w.id)}><Icon name="trash" size={16} /></button>
            </li>
          {:else}
            <li class="muted">No weigh-ins yet.</li>
          {/each}
        </ul>
      </section>
    {:else if view === 'workouts'}
      <section class="card section">
        <h2>Log a workout</h2>
        <form class="wo" onsubmit={saveWorkout}>
          <div class="row">
            <label class="field"><span>Date</span><input type="date" required max={today} bind:value={woForm.date} /></label>
            <label class="field"><span>Plan day</span>
              <select bind:value={woForm.day} onchange={() => (woChecked = {})}>
                {#each DEFAULT_PLAN as d (d.day)}<option value={d.day}>{d.day} · {d.type}</option>{/each}
                <option value="Custom">Custom (any exercises)</option>
              </select>
            </label>
            <label class="field"><span>Duration (min)</span><input inputmode="numeric" maxlength="20" bind:value={woForm.duration} /></label>
            <label class="field grow"><span>Note</span><input maxlength="2000" bind:value={woForm.note} placeholder="Optional" /></label>
          </div>
          {#if woForm.day === 'Custom'}
            <label class="field"><span>Find exercises</span><input type="search" bind:value={woSearch} placeholder="Name or muscle" /></label>
          {/if}
          <ul class="checks">
            {#each woExercises as ex (ex.id)}
              <li>
                <label class="exlabel"><input type="checkbox" checked={woChecked[ex.id]?.on ?? false} onchange={(e) => setCheck(ex.id, { on: e.currentTarget.checked })} /> {ex.name}</label>
                <label class="grow"><span class="sr-only">Sets and reps for {ex.name}</span><input class="exnote" placeholder="e.g. 3×12 @ 12 lb" maxlength="500" value={woChecked[ex.id]?.note ?? ''} oninput={(e) => setCheck(ex.id, { note: e.currentTarget.value, on: true })} /></label>
              </li>
            {/each}
          </ul>
          {#if woError}<p class="error" role="alert">{woError}</p>{/if}
          <button class="btn primary start" type="submit">Save workout</button>
        </form>
      </section>
      <section class="card section">
        <h2>History</h2>
        {#each workouts as w (w.id)}
          <div class="session">
            <div class="row between">
              <strong>{prettyDate(w.payload.date)} · {DEFAULT_PLAN.find((d) => d.day === w.payload.dayType)?.type ?? w.payload.dayType}{w.payload.duration ? ` · ${w.payload.duration} min` : ''}</strong>
              <button class="btn small danger" aria-label={`Delete workout on ${w.payload.date}`} onclick={() => sync.remove('workout_logs', w.id)}><Icon name="trash" size={16} /></button>
            </div>
            <ul>{#each w.payload.exercises as x (x.id)}<li>{x.name}{x.note ? ` · ${x.note}` : ''}</li>{/each}</ul>
            {#if w.payload.note}<p class="muted">{w.payload.note}</p>{/if}
          </div>
        {:else}
          <p class="muted">No workouts logged yet.</p>
        {/each}
      </section>
    {:else if view === 'plan'}
      <div class="plan">
        {#each DEFAULT_PLAN as d (d.day)}
          <section class="card section" class:todaycard={d.day === WEEKDAYS[new Date().getDay()]}>
            <h2>{d.day}</h2>
            <span class="badge">{d.type}</span>
            <p class="muted">{d.note}</p>
            <ul class="planlist">{#each d.exerciseIds as id (id)}<li>{exerciseById.get(id)?.name ?? id}</li>{/each}</ul>
          </section>
        {/each}
      </div>
    {:else if view === 'library'}
      <div class="row">
        <div class="seg" role="group" aria-label="Category">
          {#each [['all', 'All'], ['cardio', 'Cardio'], ['bodyweight', 'Bodyweight'], ['dumbbell', 'Dumbbell'], ['bench', 'Bench']] as [v, l] (v)}
            <button class:on={libFilter === v} onclick={() => (libFilter = v as typeof libFilter)}>{l}</button>
          {/each}
        </div>
        <label class="field grow"><span class="sr-only">Search exercises</span><input type="search" placeholder="Search by name or muscle" bind:value={libSearch} /></label>
      </div>
      <div class="libgrid">
        {#each library as ex (ex.id)}
          <section class="card section">
            <div class="row between"><h2>{ex.name}</h2><span class="badge">{ex.difficulty}</span></div>
            <p class="muted small">{ex.equipment} · {ex.muscles.join(', ')}</p>
            <p class="small">{ex.guidance}</p>
            <button class="btn small howto" aria-expanded={openHowTo === ex.id} onclick={() => (openHowTo = openHowTo === ex.id ? null : ex.id)}>How to do it</button>
            {#if openHowTo === ex.id}
              <ol class="steps">{#each ex.instructions as s, i (i)}<li>{s}</li>{/each}</ol>
              <a href={formVideoUrl(ex.name)} target="_blank" rel="noopener noreferrer">Watch form videos (YouTube search)</a>
            {/if}
          </section>
        {:else}
          <p class="muted">No exercises match.</p>
        {/each}
      </div>
    {:else if view === 'goals'}
      <section class="card section goalsform">
        <h2>Profile and staged goals</h2>
        <form onsubmit={saveGoals}>
          <div class="row">
            <label class="field"><span>Height (ft)</span><input type="number" min="3" max="8" required bind:value={gForm.feet} /></label>
            <label class="field"><span>(in)</span><input type="number" min="0" max="11" required bind:value={gForm.inches} /></label>
            <label class="field"><span>Start weight (lbs)</span><input type="number" step="0.1" min="50" max="700" required bind:value={gForm.startWeight} /></label>
            <label class="field"><span>Start date</span><input type="date" required bind:value={gForm.startDate} /></label>
          </div>
          <div class="row">
            {#each gForm.goals as _g, i (i)}
              <label class="field"><span>Goal {i + 1} (lbs)</span><input type="number" step="0.1" min="50" max="700" bind:value={gForm.goals[i]} /></label>
            {/each}
          </div>
          <div class="row"><button class="btn primary" type="submit">Save</button>{#if gMsg}<span class="muted" role="status">{gMsg}</span>{/if}</div>
        </form>
      </section>
    {/if}
  </div>
</SyncGate>

<style>
  .between {
    justify-content: space-between;
    align-items: center;
  }
  .goal {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 16px;
  }
  .two {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 18px;
  }
  .small {
    font-size: 14px;
  }
  .start {
    align-self: flex-start;
  }
  p {
    margin: 0;
  }
  .week {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
  .week li {
    padding: 12px 0;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1.5px solid var(--line);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .week li.today {
    border-color: var(--blue);
  }
  .week .wd {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .week .mark {
    height: 22px;
    color: var(--faint);
  }
  .week li.done .mark {
    color: var(--ok);
  }
  .week .dn {
    font-size: 15px;
  }
  .date {
    width: 170px;
  }
  .wt {
    width: 110px;
    font-variant-numeric: tabular-nums;
  }
  .delta {
    width: 60px;
    font-variant-numeric: tabular-nums;
  }
  .wo {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .checks {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .checks li {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .exlabel {
    width: 340px;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .exlabel input {
    width: 20px;
    height: 20px;
  }
  .exnote {
    width: 100%;
    min-height: 40px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--line-2);
    background: var(--surface-2);
  }
  .session {
    padding: 14px 0;
    border-top: 1px solid var(--line);
  }
  .session ul {
    margin: 8px 0;
    padding-left: 20px;
    color: var(--text-2);
  }
  .plan,
  .libgrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 16px;
  }
  .todaycard {
    border-color: var(--blue);
  }
  .planlist,
  .steps {
    margin: 0;
    padding-left: 20px;
    color: var(--text-2);
    line-height: 1.6;
  }
  .howto {
    align-self: flex-start;
  }
  .goalsform form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .error {
    color: var(--bad);
  }
</style>
