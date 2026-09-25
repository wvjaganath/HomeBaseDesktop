import { z } from 'zod';

// NOTE: these schemas are deliberately duplicated as Codable structs in the iOS
// app (app/HomeBase/Core/...). When a payload shape changes, change both sides.

const isoDate = z.string().datetime({ offset: true });

export const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
});

export const registerSchema = credentialsSchema.extend({
  displayName: z.string().min(1).max(50),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
});

const measurementPayload = z.object({
  recordedAt: isoDate,
  neckCm: z.number().min(20).max(80).nullable(),
  chestCm: z.number().min(50).max(150).nullable(),
  leftArmCm: z.number().min(15).max(60).nullable(),
  rightArmCm: z.number().min(15).max(60).nullable(),
  leftThighCm: z.number().min(30).max(90).nullable(),
  rightThighCm: z.number().min(30).max(90).nullable(),
  waistCm: z.number().min(40).max(150).nullable(),
});

const dailyFitnessPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.number().int().min(0).nullable(),
  restingHr: z.number().min(20).max(250).nullable(),
  avgHr: z.number().min(20).max(250).nullable(),
  minHr: z.number().min(20).max(250).nullable(),
  maxHr: z.number().min(20).max(250).nullable(),
  activeKcal: z.number().min(0).nullable(),
  exerciseMin: z.number().min(0).nullable(),
});

const workoutPayload = z.object({
  hkUuid: z.string().min(1).max(64),
  activityType: z.string().min(1).max(60),
  startedAt: isoDate,
  endedAt: isoDate,
  durationS: z.number().min(0),
  kcal: z.number().min(0).nullable(),
  distanceM: z.number().min(0).nullable(),
});

const noteItemPayload = z.object({
  id: z.string().uuid(),
  text: z.string().max(2000),
  done: z.boolean(),
  position: z.number().int().min(0),
});

const notePayload = z.object({
  title: z.string().max(200),
  body: z.string().max(20000),
  isChecklist: z.boolean(),
  pinned: z.boolean(),
  items: z.array(noteItemPayload).max(200),
});

const reminderPayload = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000),
  dueAt: isoDate,
  repeatRule: z.enum(['none', 'daily', 'weekly', 'monthly']),
  completedAt: isoDate.nullable(),
});

const weightEntryPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weight: z.number().min(50).max(700),
  note: z.string().max(2000),
});

// id here is the exercise-library id (e.g. "db-goblet-squat"), reused as the
// row identity within one session — a session never checks the same exercise
// twice. name is a point-in-time snapshot in case the library entry changes.
const loggedExercisePayload = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  note: z.string().max(500),
});

const workoutLogPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayType: z.string().min(1).max(100),
  duration: z.string().max(20),
  note: z.string().max(2000),
  exercises: z.array(loggedExercisePayload).max(50),
});

const fitnessProfilePayload = z.object({
  heightIn: z.number().min(36).max(96),
  startWeight: z.number().min(50).max(700),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goals: z.array(z.number().min(50).max(700)).max(10),
});

const mealEntryPayload = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  name: z.string().min(1).max(200),
  recipeId: z.string().max(60).nullable(),
  calories: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500),
  carbs: z.number().min(0).max(500),
  fat: z.number().min(0).max(500),
  note: z.string().max(2000),
});

export const collectionPayloads = {
  measurements: measurementPayload,
  daily_fitness: dailyFitnessPayload,
  workouts: workoutPayload,
  notes: notePayload,
  reminders: reminderPayload,
  weight_entries: weightEntryPayload,
  workout_logs: workoutLogPayload,
  fitness_profile: fitnessProfilePayload,
  meal_entries: mealEntryPayload,
} as const;

export type CollectionName = keyof typeof collectionPayloads;

const collectionEnum = z.enum([
  'measurements',
  'daily_fitness',
  'workouts',
  'notes',
  'reminders',
  'weight_entries',
  'workout_logs',
  'fitness_profile',
  'meal_entries',
]);

/** Collections that support sharing between the two accounts. */
export const shareableCollections: CollectionName[] = ['notes', 'reminders'];

export const changeSchema = z.object({
  collection: collectionEnum,
  id: z.string().uuid(),
  updatedAt: isoDate,
  deletedAt: isoDate.nullable(),
  payload: z.unknown(),
});

export const pushSchema = z.object({
  changes: z.array(changeSchema).max(500),
});

export const pullQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
});

export const shareCreateSchema = z.object({
  itemType: z.enum(['notes', 'reminders']),
  itemId: z.string().uuid(),
  sharedWithId: z.string().uuid(),
  permission: z.enum(['read', 'write']),
});
