// Data layer backed by the HomeBase sync API instead of localStorage, kept
// as a drop-in replacement so app.js's render/form code doesn't need to
// change: same getX()/setX() function names, same synchronous return values.
// Writes update the in-memory cache immediately (so the very next getX()
// call in the same synchronous block sees the change), then push to the
// server in the background — there's no offline queue like the iOS app has,
// since a website is assumed to be used online.

const DEFAULT_PROFILE = { heightIn: 76, startWeight: 340, startDate: '2026-07-21', goals: [260, 230, 205, 190] };

const DEFAULT_NUTRITION_TARGETS = { calories: 2950, protein: 190, carbs: 355, fat: 85 };
const NUTRITION_TARGETS_KEY = 'gym.nutritionTargets';

let _profile = null;
let _profileId = null;
let _weightLog = [];
let _workoutLog = [];
let _mealLog = [];

function isUuid(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function cloneArr(arr) {
  return arr.map(e => (Array.isArray(e.exercises) ? { ...e, exercises: e.exercises.map(x => ({ ...x })) } : { ...e }));
}

function toWirePayloadWeightEntry(e) {
  return { date: e.date, weight: e.weight, note: e.note || '' };
}

function toWirePayloadWorkoutLog(e) {
  return {
    date: e.date,
    dayType: e.dayType,
    duration: e.duration != null ? String(e.duration) : '',
    note: e.note || '',
    exercises: (e.exercises || []).map(x => ({ id: x.id, name: x.name, note: x.note || '' }))
  };
}

function toWirePayloadProfile(p) {
  return { heightIn: p.heightIn, startWeight: p.startWeight, startDate: p.startDate, goals: p.goals };
}

function toWirePayloadMealEntry(e) {
  return {
    date: e.date,
    mealType: e.mealType,
    name: e.name,
    recipeId: e.recipeId || null,
    calories: e.calories,
    protein: e.protein || 0,
    carbs: e.carbs || 0,
    fat: e.fat || 0,
    note: e.note || ''
  };
}

/** Diff two id-keyed arrays and return the sync changes needed to go from prev -> next. */
function diffChanges(collection, prevArray, nextArray, toPayload) {
  const prevById = new Map(prevArray.map(e => [e.id, e]));
  const nextById = new Map(nextArray.map(e => [e.id, e]));
  const now = new Date().toISOString();
  const changes = [];

  for (const [id, entry] of nextById) {
    const prev = prevById.get(id);
    if (!prev || JSON.stringify(toPayload(prev)) !== JSON.stringify(toPayload(entry))) {
      changes.push({ collection, id, updatedAt: now, deletedAt: null, payload: toPayload(entry) });
    }
  }
  for (const [id] of prevById) {
    if (!nextById.has(id)) {
      changes.push({ collection, id, updatedAt: now, deletedAt: now, payload: {} });
    }
  }
  return changes;
}

async function initStorage() {
  const response = await apiPull(0);
  const weightLog = [];
  const workoutLog = [];
  const mealLog = [];
  let profile = null;
  let profileId = null;

  for (const change of response.changes) {
    if (change.deletedAt) continue;
    if (change.collection === 'weight_entries') {
      weightLog.push({ id: change.id, date: change.payload.date, weight: change.payload.weight, note: change.payload.note });
    } else if (change.collection === 'workout_logs') {
      workoutLog.push({
        id: change.id,
        date: change.payload.date,
        dayType: change.payload.dayType,
        duration: change.payload.duration,
        note: change.payload.note,
        exercises: change.payload.exercises
      });
    } else if (change.collection === 'fitness_profile') {
      profileId = change.id;
      profile = {
        heightIn: change.payload.heightIn,
        startWeight: change.payload.startWeight,
        startDate: change.payload.startDate,
        goals: change.payload.goals
      };
    } else if (change.collection === 'meal_entries') {
      mealLog.push({
        id: change.id,
        date: change.payload.date,
        mealType: change.payload.mealType,
        name: change.payload.name,
        recipeId: change.payload.recipeId,
        calories: change.payload.calories,
        protein: change.payload.protein,
        carbs: change.payload.carbs,
        fat: change.payload.fat,
        note: change.payload.note
      });
    }
  }

  _weightLog = weightLog;
  _workoutLog = workoutLog;
  _mealLog = mealLog;

  if (!profile) {
    profileId = crypto.randomUUID();
    profile = { ...DEFAULT_PROFILE };
    await apiPush([{
      collection: 'fitness_profile', id: profileId,
      updatedAt: new Date().toISOString(), deletedAt: null,
      payload: toWirePayloadProfile(profile)
    }]);
  }
  _profile = profile;
  _profileId = profileId;

  if (_weightLog.length === 0) {
    const seedId = crypto.randomUUID();
    const seed = { id: seedId, date: DEFAULT_PROFILE.startDate, weight: 290, note: 'Starting point in the tracker' };
    await apiPush([{
      collection: 'weight_entries', id: seedId,
      updatedAt: new Date().toISOString(), deletedAt: null,
      payload: toWirePayloadWeightEntry(seed)
    }]);
    _weightLog = [seed];
  }
}

function getProfile() {
  return { ..._profile };
}

function setProfile(next) {
  const changed = JSON.stringify(toWirePayloadProfile(_profile)) !== JSON.stringify(toWirePayloadProfile(next));
  _profile = { ...next };
  if (changed) {
    apiPush([{
      collection: 'fitness_profile', id: _profileId,
      updatedAt: new Date().toISOString(), deletedAt: null,
      payload: toWirePayloadProfile(_profile)
    }]).catch(err => console.error('push fitness_profile failed', err));
  }
}

function getWeightLog() {
  return cloneArr(_weightLog);
}

function setWeightLog(next) {
  const changes = diffChanges('weight_entries', _weightLog, next, toWirePayloadWeightEntry);
  _weightLog = cloneArr(next);
  if (changes.length) {
    apiPush(changes).catch(err => console.error('push weight_entries failed', err));
  }
}

function getWorkoutLog() {
  return cloneArr(_workoutLog);
}

function setWorkoutLog(next) {
  const changes = diffChanges('workout_logs', _workoutLog, next, toWirePayloadWorkoutLog);
  _workoutLog = cloneArr(next);
  if (changes.length) {
    apiPush(changes).catch(err => console.error('push workout_logs failed', err));
  }
}

function getMealLog() {
  return cloneArr(_mealLog);
}

function setMealLog(next) {
  const changes = diffChanges('meal_entries', _mealLog, next, toWirePayloadMealEntry);
  _mealLog = cloneArr(next);
  if (changes.length) {
    apiPush(changes).catch(err => console.error('push meal_entries failed', err));
  }
}

function getPlan() {
  return DEFAULT_PLAN;
}

// Nutrition targets are personal, device-local settings (like the app's
// @AppStorage), not synced — same rationale as keeping the weekly plan local.
function getNutritionTargets() {
  try {
    const raw = localStorage.getItem(NUTRITION_TARGETS_KEY);
    return raw ? { ...DEFAULT_NUTRITION_TARGETS, ...JSON.parse(raw) } : { ...DEFAULT_NUTRITION_TARGETS };
  } catch {
    return { ...DEFAULT_NUTRITION_TARGETS };
  }
}

function setNutritionTargets(targets) {
  localStorage.setItem(NUTRITION_TARGETS_KEY, JSON.stringify(targets));
}

function exportAllData() {
  const data = {
    profile: getProfile(),
    weightLog: getWeightLog(),
    workoutLog: getWorkoutLog(),
    mealLog: getMealLog(),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gym-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importAllData(fileObj, onDone) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.profile) setProfile(data.profile);
      if (Array.isArray(data.weightLog)) {
        const incoming = data.weightLog.map(en => ({ ...en, id: isUuid(en.id) ? en.id : crypto.randomUUID() }));
        setWeightLog(getWeightLog().concat(incoming));
      }
      if (Array.isArray(data.workoutLog)) {
        const incoming = data.workoutLog.map(en => ({ ...en, id: isUuid(en.id) ? en.id : crypto.randomUUID() }));
        setWorkoutLog(getWorkoutLog().concat(incoming));
      }
      if (Array.isArray(data.mealLog)) {
        const incoming = data.mealLog.map(en => ({ ...en, id: isUuid(en.id) ? en.id : crypto.randomUUID() }));
        setMealLog(getMealLog().concat(incoming));
      }
      onDone(true);
    } catch (err) {
      console.error('Import failed', err);
      onDone(false);
    }
  };
  reader.readAsText(fileObj);
}

async function resetAllData() {
  const now = new Date().toISOString();
  const changes = [
    ..._weightLog.map(e => ({ collection: 'weight_entries', id: e.id, updatedAt: now, deletedAt: now, payload: {} })),
    ..._workoutLog.map(e => ({ collection: 'workout_logs', id: e.id, updatedAt: now, deletedAt: now, payload: {} })),
    ..._mealLog.map(e => ({ collection: 'meal_entries', id: e.id, updatedAt: now, deletedAt: now, payload: {} }))
  ];
  if (changes.length) await apiPush(changes);
  _weightLog = [];
  _workoutLog = [];
  _mealLog = [];
  setProfile({ ...DEFAULT_PROFILE });
}
