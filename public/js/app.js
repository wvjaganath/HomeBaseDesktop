// Main application logic: tabs, rendering, forms, calculations.

let editingWeightId = null;
let editingMealId = null;

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return toISODate(new Date());
}

function uid() {
  return crypto.randomUUID();
}

function calcBMI(weightLbs, heightIn) {
  return (703 * weightLbs) / (heightIn * heightIn);
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Normal';
  if (bmi < 30) return 'Overweight';
  if (bmi < 35) return 'Obese I';
  if (bmi < 40) return 'Obese II';
  return 'Obese III';
}

function getSortedWeightLog() {
  return getWeightLog().slice().sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getCurrentWeight() {
  const log = getSortedWeightLog();
  if (log.length === 0) return getProfile().startWeight;
  return log[log.length - 1].weight;
}

function getWeekAgoWeight() {
  const log = getSortedWeightLog();
  if (log.length < 2) return null;
  const latestDate = new Date(log[log.length - 1].date);
  const boundary = new Date(latestDate);
  boundary.setDate(boundary.getDate() - 6);
  let candidate = null;
  for (const entry of log) {
    const d = new Date(entry.date);
    if (d <= boundary) candidate = entry;
  }
  return candidate ? candidate.weight : null;
}

function getNextGoal(profile, currentWeight) {
  const goals = profile.goals.slice().sort((a, b) => b - a);
  for (const g of goals) {
    if (currentWeight > g) return g;
  }
  return null;
}

function getGoalProgressPct(profile, currentWeight, nextGoal) {
  if (nextGoal == null) return 100;
  const goals = profile.goals.slice().sort((a, b) => b - a);
  const idx = goals.indexOf(nextGoal);
  const prevTarget = idx > 0 ? goals[idx - 1] : profile.startWeight;
  const total = prevTarget - nextGoal;
  const done = prevTarget - currentWeight;
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, (done / total) * 100));
}

// A day counts as "done" if a workout was logged for it — derived from
// workout_logs rather than a separate manually-checked flag.
function calcStreak(workoutDates) {
  let streak = 0;
  let d = new Date();
  while (workoutDates.has(toISODate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------------- TABS ----------------

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
    });
  });
}

// ---------------- DASHBOARD ----------------

function renderDashboard() {
  const profile = getProfile();
  const current = getCurrentWeight();
  const totalLost = profile.startWeight - current;
  const weekAgo = getWeekAgoWeight();
  const weekChange = weekAgo != null ? current - weekAgo : null;
  const bmi = calcBMI(current, profile.heightIn);
  const streak = calcStreak(new Set(getWorkoutLog().map(w => w.date)));
  const nextGoal = getNextGoal(profile, current);
  const progressPct = getGoalProgressPct(profile, current, nextGoal);

  document.getElementById('stat-current-weight').textContent = `${current} lbs`;
  document.getElementById('stat-total-lost').textContent = `${totalLost >= 0 ? totalLost.toFixed(1) : 0} lbs`;
  document.getElementById('stat-bmi').textContent = `${bmi.toFixed(1)} (${bmiCategory(bmi)})`;
  document.getElementById('stat-week-change').textContent = weekChange == null
    ? '—'
    : `${weekChange > 0 ? '+' : ''}${weekChange.toFixed(1)} lbs`;
  document.getElementById('stat-streak').textContent = `${streak} day${streak === 1 ? '' : 's'}`;

  const goalLabel = document.getElementById('goal-progress-label');
  const goalBar = document.getElementById('goal-progress-bar');
  if (nextGoal == null) {
    goalLabel.textContent = 'All staged goals reached! 🎉 Consider setting a new goal in Settings.';
    goalBar.style.width = '100%';
  } else {
    goalLabel.textContent = `Next goal: ${nextGoal} lbs — ${progressPct.toFixed(0)}% of the way there`;
    goalBar.style.width = `${progressPct}%`;
  }

  renderWeightChart(document.getElementById('weight-chart'), getWeightLog(), nextGoal);
}

// ---------------- WEIGHT LOG ----------------

function renderWeightLog() {
  const log = getWeightLog().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const profile = getProfile();
  const tbody = document.getElementById('weight-table-body');
  if (log.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-hint">No entries yet — add your first weigh-in above.</td></tr>';
    return;
  }
  tbody.innerHTML = log.map(entry => {
    const bmi = calcBMI(entry.weight, profile.heightIn);
    return `<tr>
      <td>${escapeHtml(entry.date)}</td>
      <td>${entry.weight}</td>
      <td>${bmi.toFixed(1)}</td>
      <td>${escapeHtml(entry.note || '')}</td>
      <td class="row-actions">
        <button class="btn-link" data-edit-weight="${entry.id}">Edit</button>
        <button class="btn-link danger" data-delete-weight="${entry.id}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit-weight]').forEach(btn => {
    btn.addEventListener('click', () => startEditWeight(btn.getAttribute('data-edit-weight')));
  });
  tbody.querySelectorAll('[data-delete-weight]').forEach(btn => {
    btn.addEventListener('click', () => deleteWeightEntry(btn.getAttribute('data-delete-weight')));
  });
}

function startEditWeight(id) {
  const entry = getWeightLog().find(e => e.id === id);
  if (!entry) return;
  editingWeightId = id;
  document.getElementById('weight-date').value = entry.date;
  document.getElementById('weight-value').value = entry.weight;
  document.getElementById('weight-note').value = entry.note || '';
  document.getElementById('weight-submit-btn').textContent = 'Update Entry';
  document.getElementById('weight-cancel-edit').classList.remove('hidden');
  document.getElementById('weight-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelEditWeight() {
  editingWeightId = null;
  document.getElementById('weight-form').reset();
  document.getElementById('weight-date').value = todayISO();
  document.getElementById('weight-submit-btn').textContent = 'Add Entry';
  document.getElementById('weight-cancel-edit').classList.add('hidden');
}

function deleteWeightEntry(id) {
  if (!confirm('Delete this weight entry?')) return;
  setWeightLog(getWeightLog().filter(e => e.id !== id));
  if (editingWeightId === id) cancelEditWeight();
  renderWeightLog();
  renderDashboard();
}

function setupWeightForm() {
  const form = document.getElementById('weight-form');
  document.getElementById('weight-date').value = todayISO();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('weight-date').value;
    const weight = parseFloat(document.getElementById('weight-value').value);
    const note = document.getElementById('weight-note').value.trim();
    if (!date || isNaN(weight) || weight <= 0) return;

    const log = getWeightLog();
    if (editingWeightId) {
      const idx = log.findIndex(en => en.id === editingWeightId);
      if (idx !== -1) log[idx] = { id: editingWeightId, date, weight, note };
      setWeightLog(log);
      cancelEditWeight();
    } else {
      log.push({ id: uid('w'), date, weight, note });
      setWeightLog(log);
      form.reset();
      document.getElementById('weight-date').value = todayISO();
    }
    renderWeightLog();
    renderDashboard();
  });
  document.getElementById('weight-cancel-edit').addEventListener('click', cancelEditWeight);
}

// ---------------- EXERCISE LIBRARY ----------------

function exerciseCardHtml(ex) {
  const yt = ytLink(ex.name);
  const muscles = ex.muscles.join(', ');
  const instructions = ex.instructions.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  return `<div class="exercise-card" data-category="${ex.category}">
    <div class="exercise-card-header">
      <h4>${escapeHtml(ex.name)}</h4>
      <span class="badge badge-${ex.difficulty.toLowerCase()}">${ex.difficulty}</span>
    </div>
    <p class="exercise-meta"><strong>Equipment:</strong> ${escapeHtml(ex.equipment)} &nbsp;·&nbsp; <strong>Targets:</strong> ${escapeHtml(muscles)}</p>
    <p class="exercise-meta"><strong>Guidance:</strong> ${escapeHtml(ex.guidance)}</p>
    <button class="btn-secondary btn-small" data-toggle-howto="${ex.id}">How to do it ▾</button>
    <div class="howto hidden" id="howto-${ex.id}">
      <ol>${instructions}</ol>
      <a href="${yt}" target="_blank" rel="noopener noreferrer">▶ Watch form video (YouTube search)</a>
    </div>
  </div>`;
}

function renderLibrary() {
  const grid = document.getElementById('library-grid');
  const activeFilter = document.querySelector('.filter-btn.active')?.getAttribute('data-filter') || 'all';
  const search = (document.getElementById('library-search').value || '').toLowerCase();

  const filtered = EXERCISES.filter(ex => {
    const matchesCategory = activeFilter === 'all' || ex.category === activeFilter;
    const matchesSearch = !search ||
      ex.name.toLowerCase().includes(search) ||
      ex.muscles.join(' ').toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });

  grid.innerHTML = filtered.length
    ? filtered.map(exerciseCardHtml).join('')
    : '<p class="empty-hint">No exercises match your filter/search.</p>';

  grid.querySelectorAll('[data-toggle-howto]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-howto');
      const panel = document.getElementById(`howto-${id}`);
      panel.classList.toggle('hidden');
      btn.textContent = panel.classList.contains('hidden') ? 'How to do it ▾' : 'How to do it ▴';
    });
  });
}

function setupLibraryFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderLibrary();
    });
  });
  document.getElementById('library-search').addEventListener('input', renderLibrary);
}

// ---------------- WEEKLY PLAN ----------------

function renderPlan() {
  const plan = getPlan();
  const grid = document.getElementById('plan-grid');
  grid.innerHTML = plan.map(day => {
    const exercises = day.exerciseIds
      .map(id => EXERCISES.find(e => e.id === id))
      .filter(Boolean);
    const list = exercises.map(ex => `<li>${escapeHtml(ex.name)} <span class="muted">(${escapeHtml(ex.guidance)})</span></li>`).join('');
    return `<div class="plan-card">
      <div class="plan-card-header" data-toggle-day="${day.day}">
        <h4>${day.day}</h4>
        <span class="plan-type">${escapeHtml(day.type)}</span>
      </div>
      <p class="exercise-meta">${escapeHtml(day.note)}</p>
      <ul class="plan-exercise-list hidden" id="plan-list-${day.day}">${list}</ul>
      <button class="btn-link" data-toggle-day-btn="${day.day}">Show exercises ▾</button>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-toggle-day-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.getAttribute('data-toggle-day-btn');
      const list = document.getElementById(`plan-list-${day}`);
      list.classList.toggle('hidden');
      btn.textContent = list.classList.contains('hidden') ? 'Show exercises ▾' : 'Hide exercises ▴';
    });
  });

  renderWeekTracker();
}

function renderWeekTracker() {
  const container = document.getElementById('week-tracker');
  const workoutDates = new Set(getWorkoutLog().map(w => w.date));
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  container.innerHTML = days.map(d => {
    const iso = toISODate(d);
    const label = `${weekdayNames[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
    const done = workoutDates.has(iso);
    const isToday = iso === todayISO() ? ' today' : '';
    return `<span class="day-check${isToday}">
      <span aria-hidden="true">${done ? '✓' : '—'}</span>
      <span>${label}</span>
    </span>`;
  }).join('');
}

// ---------------- WORKOUT LOG ----------------

function renderWorkoutExerciseChecklist() {
  const dayName = document.getElementById('workout-day-select').value;
  const container = document.getElementById('workout-exercise-list');
  let exercises;
  if (dayName === 'Custom') {
    exercises = EXERCISES;
  } else {
    const plan = getPlan();
    const dayPlan = plan.find(d => d.day === dayName);
    exercises = dayPlan ? dayPlan.exerciseIds.map(id => EXERCISES.find(e => e.id === id)).filter(Boolean) : [];
  }
  container.innerHTML = exercises.map(ex => `
    <label class="exercise-check">
      <input type="checkbox" data-ex-id="${ex.id}" />
      <span>${escapeHtml(ex.name)}</span>
      <input type="text" class="ex-note" data-ex-note="${ex.id}" placeholder="e.g. 3x12 @ 12lb" />
    </label>
  `).join('');
}

function setupWorkoutForm() {
  document.getElementById('workout-date').value = todayISO();
  document.getElementById('workout-day-select').addEventListener('change', renderWorkoutExerciseChecklist);
  renderWorkoutExerciseChecklist();

  document.getElementById('workout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('workout-date').value;
    const dayType = document.getElementById('workout-day-select').value;
    const duration = document.getElementById('workout-duration').value;
    const note = document.getElementById('workout-note').value.trim();

    const doneExercises = [];
    document.querySelectorAll('#workout-exercise-list [data-ex-id]').forEach(cb => {
      if (cb.checked) {
        const id = cb.getAttribute('data-ex-id');
        const ex = EXERCISES.find(x => x.id === id);
        const noteInput = document.querySelector(`[data-ex-note="${id}"]`);
        doneExercises.push({ id, name: ex ? ex.name : id, note: noteInput ? noteInput.value.trim() : '' });
      }
    });

    if (!date || doneExercises.length === 0) {
      alert('Pick a date and check off at least one completed exercise.');
      return;
    }

    const log = getWorkoutLog();
    log.push({ id: uid('wo'), date, dayType, duration, note, exercises: doneExercises });
    setWorkoutLog(log);

    document.getElementById('workout-form').reset();
    document.getElementById('workout-date').value = todayISO();
    renderWorkoutExerciseChecklist();
    renderWorkoutHistory();
    renderDashboard();
    renderWeekTracker();
  });
}

function renderWorkoutHistory() {
  const log = getWorkoutLog().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const list = document.getElementById('workout-history-list');
  if (log.length === 0) {
    list.innerHTML = '<p class="empty-hint">No workouts logged yet.</p>';
    return;
  }
  list.innerHTML = log.map(session => `
    <div class="workout-session">
      <div class="workout-session-header">
        <strong>${escapeHtml(session.date)}</strong> — ${escapeHtml(session.dayType)}
        ${session.duration ? `<span class="muted">(${escapeHtml(session.duration)} min)</span>` : ''}
        <button class="btn-link danger" data-delete-workout="${session.id}">Delete</button>
      </div>
      <ul>
        ${session.exercises.map(ex => `<li>${escapeHtml(ex.name)}${ex.note ? ` — ${escapeHtml(ex.note)}` : ''}</li>`).join('')}
      </ul>
      ${session.note ? `<p class="exercise-meta">Note: ${escapeHtml(session.note)}</p>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('[data-delete-workout]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this workout session?')) return;
      setWorkoutLog(getWorkoutLog().filter(s => s.id !== btn.getAttribute('data-delete-workout')));
      renderWorkoutHistory();
    });
  });
}

// ---------------- NUTRITION ----------------

function renderNutrition() {
  renderNutritionStats();
  renderTodayMeals();
  renderMealHistory();
  renderRecipeLibrary();
  renderNutritionTargetsForm();
}

function renderNutritionStats() {
  const targets = getNutritionTargets();
  const today = getMealLog().filter(m => m.date === todayISO());
  const totals = today.reduce((acc, m) => {
    acc.calories += m.calories || 0;
    acc.protein += m.protein || 0;
    acc.carbs += m.carbs || 0;
    acc.fat += m.fat || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  document.getElementById('nutri-stat-calories').textContent = `${Math.round(totals.calories)} / ${targets.calories} kcal`;
  document.getElementById('nutri-stat-protein').textContent = `${Math.round(totals.protein)} / ${targets.protein} g`;
  document.getElementById('nutri-stat-carbs').textContent = `${Math.round(totals.carbs)} / ${targets.carbs} g`;
  document.getElementById('nutri-stat-fat').textContent = `${Math.round(totals.fat)} / ${targets.fat} g`;
}

function renderTodayMeals() {
  const today = getMealLog().filter(m => m.date === todayISO());
  const list = document.getElementById('meal-today-list');
  if (today.length === 0) {
    list.innerHTML = '<p class="empty-hint">Nothing logged yet today.</p>';
    return;
  }
  list.innerHTML = MEAL_TYPES.map(type => {
    const entries = today.filter(m => m.mealType === type);
    if (entries.length === 0) return '';
    const rows = entries.map(m => `<li>${escapeHtml(m.name)} <span class="muted">(${Math.round(m.calories)} kcal)</span></li>`).join('');
    return `<p class="exercise-meta"><strong>${mealTypeLabel(type)}</strong></p><ul class="plan-exercise-list">${rows}</ul>`;
  }).join('');
}

function populateMealRecipeSelect() {
  const select = document.getElementById('meal-recipe-select');
  select.innerHTML = '<option value="">— custom item —</option>' +
    RECIPES.map(r => `<option value="${r.id}">${escapeHtml(r.name)} (${mealTypeLabel(r.mealType)})</option>`).join('');
}

function setupMealForm() {
  document.getElementById('meal-date').value = todayISO();
  populateMealRecipeSelect();

  document.getElementById('meal-recipe-select').addEventListener('change', (e) => {
    const recipe = findRecipe(e.target.value);
    if (!recipe) return;
    document.getElementById('meal-type').value = recipe.mealType;
    document.getElementById('meal-name').value = recipe.name;
    document.getElementById('meal-calories').value = recipe.calories;
    document.getElementById('meal-protein').value = recipe.protein;
    document.getElementById('meal-carbs').value = recipe.carbs;
    document.getElementById('meal-fat').value = recipe.fat;
  });

  document.getElementById('meal-form-2').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('meal-date').value;
    const mealType = document.getElementById('meal-type').value;
    const recipeId = document.getElementById('meal-recipe-select').value || null;
    const name = document.getElementById('meal-name').value.trim();
    const calories = parseFloat(document.getElementById('meal-calories').value);
    const protein = parseFloat(document.getElementById('meal-protein').value) || 0;
    const carbs = parseFloat(document.getElementById('meal-carbs').value) || 0;
    const fat = parseFloat(document.getElementById('meal-fat').value) || 0;
    const note = document.getElementById('meal-note').value.trim();
    if (!date || !name || isNaN(calories)) return;

    const log = getMealLog();
    if (editingMealId) {
      const idx = log.findIndex(m => m.id === editingMealId);
      if (idx !== -1) log[idx] = { id: editingMealId, date, mealType, recipeId, name, calories, protein, carbs, fat, note };
      setMealLog(log);
      cancelEditMeal();
    } else {
      log.push({ id: uid(), date, mealType, recipeId, name, calories, protein, carbs, fat, note });
      setMealLog(log);
      document.getElementById('meal-form-2').reset();
      document.getElementById('meal-date').value = todayISO();
      document.getElementById('meal-recipe-select').value = '';
    }
    renderNutritionStats();
    renderTodayMeals();
    renderMealHistory();
  });

  document.getElementById('meal-cancel-edit').addEventListener('click', cancelEditMeal);
}

function cancelEditMeal() {
  editingMealId = null;
  document.getElementById('meal-form-2').reset();
  document.getElementById('meal-date').value = todayISO();
  document.getElementById('meal-recipe-select').value = '';
  document.getElementById('meal-submit-btn').textContent = 'Add Meal';
  document.getElementById('meal-cancel-edit').classList.add('hidden');
}

function startEditMeal(id) {
  const entry = getMealLog().find(m => m.id === id);
  if (!entry) return;
  editingMealId = id;
  document.getElementById('meal-date').value = entry.date;
  document.getElementById('meal-type').value = entry.mealType;
  document.getElementById('meal-recipe-select').value = entry.recipeId || '';
  document.getElementById('meal-name').value = entry.name;
  document.getElementById('meal-calories').value = entry.calories;
  document.getElementById('meal-protein').value = entry.protein;
  document.getElementById('meal-carbs').value = entry.carbs;
  document.getElementById('meal-fat').value = entry.fat;
  document.getElementById('meal-note').value = entry.note || '';
  document.getElementById('meal-submit-btn').textContent = 'Update Meal';
  document.getElementById('meal-cancel-edit').classList.remove('hidden');
  document.getElementById('meal-form-2').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderMealHistory() {
  const log = getMealLog().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const list = document.getElementById('meal-history-list');
  if (log.length === 0) {
    list.innerHTML = '<p class="empty-hint">No meals logged yet.</p>';
    return;
  }
  list.innerHTML = log.map(m => `
    <div class="workout-session">
      <div class="workout-session-header">
        <strong>${escapeHtml(m.date)}</strong> — ${mealTypeLabel(m.mealType)}: ${escapeHtml(m.name)}
        <span class="muted">(${Math.round(m.calories)} kcal)</span>
        <button class="btn-link" data-edit-meal="${m.id}">Edit</button>
        <button class="btn-link danger" data-delete-meal="${m.id}">Delete</button>
      </div>
      ${m.note ? `<p class="exercise-meta">${escapeHtml(m.note)}</p>` : ''}
    </div>
  `).join('');

  list.querySelectorAll('[data-edit-meal]').forEach(btn => {
    btn.addEventListener('click', () => startEditMeal(btn.getAttribute('data-edit-meal')));
  });
  list.querySelectorAll('[data-delete-meal]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this meal entry?')) return;
      setMealLog(getMealLog().filter(m => m.id !== btn.getAttribute('data-delete-meal')));
      if (editingMealId === btn.getAttribute('data-delete-meal')) cancelEditMeal();
      renderNutritionStats();
      renderTodayMeals();
      renderMealHistory();
    });
  });
}

function recipeCardHtml(recipe) {
  const tags = recipe.tags.map(t => `<span class="badge">${escapeHtml(t)}</span>`).join(' ');
  const ingredients = recipe.ingredients.map(i => `<li>${escapeHtml(i)}</li>`).join('');
  const instructions = recipe.instructions.map(s => `<li>${escapeHtml(s)}</li>`).join('');
  return `<div class="exercise-card" data-meal-type="${recipe.mealType}">
    <div class="exercise-card-header">
      <h4>${escapeHtml(recipe.name)}</h4>
      <span class="badge">${mealTypeLabel(recipe.mealType)}</span>
    </div>
    <p class="exercise-meta"><strong>${Math.round(recipe.calories)} kcal</strong> · P ${Math.round(recipe.protein)}g · C ${Math.round(recipe.carbs)}g · F ${Math.round(recipe.fat)}g · ${recipe.prepMinutes} min</p>
    <p class="exercise-meta">${tags}</p>
    <button class="btn-secondary btn-small" data-toggle-recipe="${recipe.id}">Recipe ▾</button>
    <div class="howto hidden" id="recipe-howto-${recipe.id}">
      <p><strong>Ingredients</strong></p>
      <ul class="plan-exercise-list">${ingredients}</ul>
      <p><strong>Instructions</strong></p>
      <ol>${instructions}</ol>
    </div>
  </div>`;
}

function renderRecipeLibrary() {
  const grid = document.getElementById('recipe-grid');
  const activeFilter = document.querySelector('.recipe-filter-btn.active')?.getAttribute('data-recipe-filter') || 'all';
  const search = (document.getElementById('recipe-search').value || '').toLowerCase();

  const filtered = RECIPES.filter(r => {
    const matchesType = activeFilter === 'all' || r.mealType === activeFilter;
    const matchesSearch = !search || r.name.toLowerCase().includes(search);
    return matchesType && matchesSearch;
  });

  grid.innerHTML = filtered.length
    ? filtered.map(recipeCardHtml).join('')
    : '<p class="empty-hint">No recipes match your filter/search.</p>';

  grid.querySelectorAll('[data-toggle-recipe]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-recipe');
      const panel = document.getElementById(`recipe-howto-${id}`);
      panel.classList.toggle('hidden');
      btn.textContent = panel.classList.contains('hidden') ? 'Recipe ▾' : 'Recipe ▴';
    });
  });
}

function setupRecipeFilters() {
  document.querySelectorAll('.recipe-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.recipe-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderRecipeLibrary();
    });
  });
  document.getElementById('recipe-search').addEventListener('input', renderRecipeLibrary);
}

function renderNutritionTargetsForm() {
  const targets = getNutritionTargets();
  document.getElementById('target-calories').value = targets.calories;
  document.getElementById('target-protein').value = targets.protein;
  document.getElementById('target-carbs').value = targets.carbs;
  document.getElementById('target-fat').value = targets.fat;
}

function setupNutritionTargetsForm() {
  document.getElementById('nutrition-targets-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setNutritionTargets({
      calories: parseFloat(document.getElementById('target-calories').value) || DEFAULT_NUTRITION_TARGETS.calories,
      protein: parseFloat(document.getElementById('target-protein').value) || DEFAULT_NUTRITION_TARGETS.protein,
      carbs: parseFloat(document.getElementById('target-carbs').value) || DEFAULT_NUTRITION_TARGETS.carbs,
      fat: parseFloat(document.getElementById('target-fat').value) || DEFAULT_NUTRITION_TARGETS.fat
    });
    renderNutritionStats();
  });
}

// ---------------- SETTINGS ----------------

function renderSettings() {
  const profile = getProfile();
  document.getElementById('settings-start-weight').value = profile.startWeight;
  document.getElementById('settings-height').value = `${Math.floor(profile.heightIn / 12)}'${profile.heightIn % 12}" (${profile.heightIn} in)`;
  const goals = profile.goals.slice().sort((a, b) => b - a);
  for (let i = 0; i < 4; i++) {
    const input = document.getElementById(`settings-goal${i + 1}`);
    if (input) input.value = goals[i] != null ? goals[i] : '';
  }
}

function setupSettingsForm() {
  document.getElementById('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const profile = getProfile();
    profile.startWeight = parseFloat(document.getElementById('settings-start-weight').value) || profile.startWeight;
    const goals = [];
    for (let i = 1; i <= 4; i++) {
      const v = parseFloat(document.getElementById(`settings-goal${i}`).value);
      if (!isNaN(v)) goals.push(v);
    }
    if (goals.length) profile.goals = goals;
    setProfile(profile);
    document.getElementById('settings-message').textContent = 'Saved!';
    setTimeout(() => { document.getElementById('settings-message').textContent = ''; }, 2000);
    renderDashboard();
  });

  document.getElementById('export-btn').addEventListener('click', exportAllData);

  document.getElementById('import-btn').addEventListener('click', () => {
    const fileInput = document.getElementById('import-file');
    if (!fileInput.files.length) {
      document.getElementById('settings-message').textContent = 'Choose a backup file first.';
      return;
    }
    importAllData(fileInput.files[0], (ok) => {
      document.getElementById('settings-message').textContent = ok ? 'Import successful — reloading…' : 'Import failed: invalid file.';
      if (ok) setTimeout(() => location.reload(), 800);
    });
  });

  document.getElementById('reset-btn').addEventListener('click', async () => {
    if (!confirm('This will permanently erase all logged weight and workout data for your account. Continue?')) return;
    await resetAllData();
    location.reload();
  });

  document.getElementById('signout-btn').addEventListener('click', () => {
    apiLogout();
    location.reload();
  });
}

// ---------------- INIT ----------------

function renderAll() {
  renderDashboard();
  renderWeightLog();
  renderWorkoutHistory();
  renderLibrary();
  renderPlan();
  renderNutrition();
  renderSettings();
}

function showLogin(message) {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-root').classList.add('hidden');
  document.getElementById('login-error').textContent = message || '';
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-root').classList.remove('hidden');
}

function setupLoginForm() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      await apiLogin(email, password);
      await boot();
    } catch (err) {
      showLogin('Sign in failed — check your email and password.');
    }
  });
}

async function boot() {
  try {
    await initStorage();
  } catch (err) {
    console.error('initStorage failed', err);
    apiLogout();
    showLogin('Session expired — sign in again.');
    return;
  }
  showApp();
  setupTabs();
  setupWeightForm();
  setupWorkoutForm();
  setupLibraryFilters();
  setupMealForm();
  setupRecipeFilters();
  setupNutritionTargetsForm();
  setupSettingsForm();
  renderAll();
}

document.addEventListener('DOMContentLoaded', () => {
  setupLoginForm();
  if (isLoggedIn()) {
    boot();
  } else {
    showLogin();
  }
});
