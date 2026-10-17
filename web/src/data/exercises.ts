// Generated from server/public-legacy/js/exercises.js (mirrors the iOS ExerciseLibrary.swift). Static reference data, not user data.
export type ExerciseCategory = 'cardio' | 'bodyweight' | 'dumbbell' | 'bench';
export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  equipment: string;
  muscles: string[];
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  guidance: string;
  instructions: string[];
}
export interface PlanDay {
  day: string;
  type: string;
  note: string;
  exerciseIds: string[];
}

export const EXERCISES: Exercise[] = [
  {
    "id": "cardio-flat-walk",
    "name": "Flat Steady-State Walk",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Cardiovascular",
      "Legs"
    ],
    "difficulty": "Beginner",
    "guidance": "20-50 min at RPE 4-5/10 (conversational pace)",
    "instructions": [
      "Set the treadmill to 0% incline, 2.5-3.2 mph.",
      "Stand tall, eyes forward, shoulders relaxed, let arms swing naturally.",
      "Keep a pace where you could hold a conversation without gasping.",
      "Finish with 2-3 minutes at 1.5 mph to bring your heart rate down gradually."
    ]
  },
  {
    "id": "cardio-incline-walk",
    "name": "Incline Fat-Burn Walk",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Cardiovascular",
      "Glutes",
      "Calves"
    ],
    "difficulty": "Beginner",
    "guidance": "25-40 min at 8-12% incline, 2.5-3.5 mph",
    "instructions": [
      "Start flat for a 3-5 min warm-up, then raise incline gradually to 8-12%.",
      "Slow your speed slightly as incline rises so effort stays moderate (RPE 5-6/10).",
      "Hold the side rails only lightly, if at all, to keep posture upright and get the glute benefit.",
      "Lower incline back to 0% for the last 3-5 minutes to cool down."
    ]
  },
  {
    "id": "cardio-interval",
    "name": "Interval Walk/Jog",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Cardiovascular",
      "Legs"
    ],
    "difficulty": "Intermediate",
    "guidance": "20-30 min, alternating 2 min brisk walk / 1 min faster pace",
    "instructions": [
      "Warm up 5 minutes at an easy 2.5-3 mph.",
      "Alternate 2 minutes at a brisk pace (3.5-4 mph) with 1 minute at a faster pace or light jog.",
      "Repeat the cycle for the main set, keeping the \"faster\" bouts hard but controlled, not maximal.",
      "Cool down 5 minutes at an easy pace."
    ]
  },
  {
    "id": "cardio-reverse-walk",
    "name": "Reverse (Backward) Walk",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Quads",
      "Balance/Stability"
    ],
    "difficulty": "Beginner",
    "guidance": "5-10 min at very low speed (1-1.5 mph), 0% incline",
    "instructions": [
      "Lower speed to 1.0-1.5 mph and keep incline at 0%.",
      "Hold the side rails for safety and step backward with short, controlled steps.",
      "Keep your torso upright and glance down occasionally rather than twisting around.",
      "This is easy on the knees and great as a warm-up, cool-down, or active recovery move."
    ]
  },
  {
    "id": "cardio-sprint-intervals",
    "name": "Sprint Intervals",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Cardiovascular",
      "Legs"
    ],
    "difficulty": "Advanced",
    "guidance": "Later-stage only: 15-20 min, 30 sec hard / 90 sec easy, 6-8 rounds",
    "instructions": [
      "Only add this once flat/incline walking and interval walk/jog feel easy — this is a later-stage progression.",
      "Warm up 5 minutes easy.",
      "Push the pace hard for 30 seconds (fast walk or light jog), then recover for 90 seconds at an easy walk.",
      "Repeat for 6-8 rounds, then cool down 5 minutes."
    ]
  },
  {
    "id": "cardio-cooldown-walk",
    "name": "Cool-Down / Recovery Walk",
    "category": "cardio",
    "equipment": "Treadmill",
    "muscles": [
      "Cardiovascular"
    ],
    "difficulty": "Beginner",
    "guidance": "10-20 min easy pace, 0% incline",
    "instructions": [
      "Keep speed very easy, 1.8-2.5 mph, flat incline.",
      "Focus on relaxed breathing and loose shoulders.",
      "Good on rest days or after a strength session to aid recovery and daily step count."
    ]
  },
  {
    "id": "bw-squat",
    "name": "Bodyweight Squat",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-15 reps",
    "instructions": [
      "Stand with feet shoulder-width apart, toes slightly out.",
      "Push hips back and bend knees to lower down, as if sitting into a chair.",
      "Go as low as is comfortable while keeping your heels on the floor and chest up.",
      "Drive through your heels to stand back up."
    ]
  },
  {
    "id": "bw-pushup",
    "name": "Standard Push-Up",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Chest",
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 5-12 reps",
    "instructions": [
      "Hands slightly wider than shoulders, body in a straight line from head to heels.",
      "Lower your chest toward the floor, elbows at roughly a 45° angle to your body.",
      "Press back up to a full arm extension without letting your hips sag.",
      "If this is too hard, use the Incline or Knee Push-Up variation instead."
    ]
  },
  {
    "id": "bw-incline-pushup",
    "name": "Incline Push-Up (hands on bench)",
    "category": "bodyweight",
    "equipment": "Bench",
    "muscles": [
      "Chest",
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 8-15 reps",
    "instructions": [
      "Place both hands on the bench, feet on the floor, body in a straight line.",
      "Lower your chest toward the bench with elbows at ~45°.",
      "Press back up to full extension.",
      "The higher the bench surface, the easier the movement — great starting point."
    ]
  },
  {
    "id": "bw-knee-pushup",
    "name": "Knee Push-Up",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Chest",
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 8-15 reps",
    "instructions": [
      "Start in a push-up position but with knees on the floor, ankles crossed behind you.",
      "Keep a straight line from head to knees.",
      "Lower your chest toward the floor, then press back up."
    ]
  },
  {
    "id": "bw-walking-lunge",
    "name": "Walking Lunge",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Quads",
      "Glutes",
      "Hamstrings"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 8-10 steps per leg",
    "instructions": [
      "Step forward with one leg and lower your back knee toward the floor, front knee over ankle.",
      "Push through the front heel to bring your back foot forward into the next step.",
      "Keep your torso upright throughout.",
      "Hold nothing, or hold the dumbbells at your sides for added challenge later."
    ]
  },
  {
    "id": "bw-reverse-lunge",
    "name": "Reverse Lunge",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 8-10 reps per leg",
    "instructions": [
      "Stand tall, step one foot backward and lower the back knee toward the floor.",
      "Keep the front shin roughly vertical.",
      "Push through the front foot to return to standing.",
      "Easier on the knees than a forward lunge — a good starting variation."
    ]
  },
  {
    "id": "bw-side-lunge",
    "name": "Side (Lateral) Lunge",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Inner/Outer Thighs",
      "Glutes"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 8-10 reps per side",
    "instructions": [
      "Stand with feet together, step one leg out wide to the side.",
      "Bend that knee and push hips back, keeping the other leg straight.",
      "Push off the bent leg to return to standing.",
      "Keep toes pointed forward and chest up."
    ]
  },
  {
    "id": "bw-glute-bridge",
    "name": "Glute Bridge",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Glutes",
      "Hamstrings",
      "Core"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Lie on your back, knees bent, feet flat on the floor hip-width apart.",
      "Squeeze your glutes and lift your hips until your body forms a straight line from shoulders to knees.",
      "Pause briefly at the top, then lower with control."
    ]
  },
  {
    "id": "bw-wall-sit",
    "name": "Wall Sit",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 20-45 sec hold",
    "instructions": [
      "Lean your back against a wall and slide down until knees are bent around 90°.",
      "Keep knees over ankles, not past your toes.",
      "Hold the position while breathing normally, then slide back up to stand."
    ]
  },
  {
    "id": "bw-front-plank",
    "name": "Front Plank",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Core"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 20-45 sec hold",
    "instructions": [
      "Forearms on the floor, elbows under shoulders, body in a straight line from head to heels.",
      "Squeeze your glutes and brace your abs — don't let your hips sag or pike up.",
      "Breathe steadily and hold."
    ]
  },
  {
    "id": "bw-side-plank",
    "name": "Side Plank",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Obliques",
      "Core"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 15-30 sec hold per side",
    "instructions": [
      "Lie on your side, prop up on one forearm with elbow under your shoulder.",
      "Lift your hips so your body forms a straight line, stacking feet or staggering them for balance.",
      "Hold, keeping hips high, then switch sides."
    ]
  },
  {
    "id": "bw-mountain-climbers",
    "name": "Mountain Climbers",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Core",
      "Cardio"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 20-30 sec",
    "instructions": [
      "Start in a plank position with hands under shoulders.",
      "Drive one knee toward your chest, then quickly switch legs in a running-like motion.",
      "Keep your hips low and core braced throughout.",
      "Slow the pace down if needed to protect your lower back — control beats speed."
    ]
  },
  {
    "id": "bw-bird-dog",
    "name": "Bird Dog",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Core",
      "Lower Back"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 8-10 reps per side",
    "instructions": [
      "Start on hands and knees, hands under shoulders, knees under hips.",
      "Extend one arm forward and the opposite leg back, keeping your back flat and hips level.",
      "Hold briefly, return to start, then switch sides."
    ]
  },
  {
    "id": "bw-superman",
    "name": "Superman",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Lower Back",
      "Glutes"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-15 reps",
    "instructions": [
      "Lie face down, arms extended in front of you.",
      "Simultaneously lift your arms, chest, and legs a few inches off the floor.",
      "Hold briefly, squeezing your glutes and lower back, then lower with control."
    ]
  },
  {
    "id": "bw-dead-bug",
    "name": "Dead Bug",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Core"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 8-10 reps per side",
    "instructions": [
      "Lie on your back, arms reaching toward the ceiling, knees bent at 90° above your hips.",
      "Slowly lower one arm overhead and the opposite leg toward the floor while keeping your lower back pressed down.",
      "Return to start and switch sides, moving slowly and with control."
    ]
  },
  {
    "id": "bw-calf-raise",
    "name": "Standing Calf Raise",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Calves"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 15-20 reps",
    "instructions": [
      "Stand tall, feet hip-width apart, holding onto a wall or the bench for balance if needed.",
      "Rise up onto the balls of your feet as high as you can.",
      "Lower back down slowly with control."
    ]
  },
  {
    "id": "bw-high-knees",
    "name": "Low-Impact High Knees (marching)",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Cardio",
      "Core",
      "Hip Flexors"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 30-45 sec",
    "instructions": [
      "March in place, driving each knee up toward hip height without jumping.",
      "Pump your arms opposite to your legs for momentum.",
      "Keep your core braced and land softly — this is a joint-friendly cardio burst."
    ]
  },
  {
    "id": "bw-step-jacks",
    "name": "Step Jacks (low-impact jumping jack)",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Cardio",
      "Shoulders"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 30-45 sec",
    "instructions": [
      "Instead of jumping, step one foot out to the side as you raise your arms overhead, like a jumping jack.",
      "Step back to center lowering your arms, then repeat stepping out with the other foot.",
      "Keep a steady rhythm — this gives the jumping-jack cardio effect with no impact."
    ]
  },
  {
    "id": "bw-bicycle-crunch",
    "name": "Bicycle Crunch",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Abs",
      "Obliques"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 15-20 reps per side",
    "instructions": [
      "Lie on your back, hands lightly behind your head, knees bent to 90°.",
      "Bring one elbow toward the opposite knee while extending the other leg out.",
      "Alternate sides in a smooth pedaling motion, keeping your lower back pressed into the floor."
    ]
  },
  {
    "id": "bw-russian-twist",
    "name": "Russian Twist (bodyweight)",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Obliques",
      "Core"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 12-16 total twists",
    "instructions": [
      "Sit with knees bent, lean back slightly to engage your core, feet on the floor or lifted for more challenge.",
      "Clasp your hands together and rotate your torso to tap the floor on each side.",
      "Move slowly and with control rather than fast and sloppy."
    ]
  },
  {
    "id": "bw-standing-oblique-crunch",
    "name": "Standing Oblique Crunch",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Obliques"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps per side",
    "instructions": [
      "Stand tall, one hand behind your head, the other resting at your side.",
      "Lift the same-side knee up and out while crunching your elbow down to meet it.",
      "Lower back to standing and repeat, then switch sides.",
      "A gentler, joint-friendly alternative to floor-based ab work."
    ]
  },
  {
    "id": "bw-bear-crawl-hold",
    "name": "Bear Crawl Hold",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Core",
      "Shoulders"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 15-30 sec hold",
    "instructions": [
      "Start on hands and knees, then lift your knees an inch off the floor.",
      "Keep your back flat and core braced, hands under shoulders.",
      "Hold the position, breathing steadily, without letting hips pike up or sag."
    ]
  },
  {
    "id": "bw-modified-burpee",
    "name": "Modified Burpee (no jump)",
    "category": "bodyweight",
    "equipment": "None",
    "muscles": [
      "Full Body",
      "Cardio"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 6-10 reps",
    "instructions": [
      "From standing, hinge down and place your hands on the floor.",
      "Step (don't jump) one foot at a time back into a plank position.",
      "Step your feet back in one at a time, then stand back up — add an overhead reach at the top if you like.",
      "Keeping this step-based rather than jump-based protects your knees and joints."
    ]
  },
  {
    "id": "db-goblet-squat",
    "name": "Dumbbell Goblet Squat",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Quads",
      "Glutes",
      "Core"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Hold one dumbbell vertically against your chest with both hands, elbows pointed down.",
      "Squat down keeping your chest up and heels flat.",
      "Drive through your heels to stand back up."
    ]
  },
  {
    "id": "db-romanian-deadlift",
    "name": "Dumbbell Romanian Deadlift",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Hamstrings",
      "Glutes",
      "Lower Back"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Hold a dumbbell in each hand in front of your thighs, feet hip-width apart.",
      "Hinge at the hips, pushing your glutes back, and lower the weights along your legs while keeping a flat back.",
      "Go until you feel a stretch in your hamstrings, then drive your hips forward to stand back up.",
      "Keep the dumbbells close to your legs the whole time."
    ]
  },
  {
    "id": "db-bent-over-row",
    "name": "Dumbbell Bent-Over Row",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Back",
      "Biceps"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Hinge forward at the hips to about 45°, dumbbells hanging under your shoulders, back flat.",
      "Pull both dumbbells up toward your ribcage, squeezing your shoulder blades together.",
      "Lower with control back to the start."
    ]
  },
  {
    "id": "db-shoulder-press",
    "name": "Dumbbell Shoulder Press",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Stand or sit tall, holding a dumbbell in each hand at shoulder height, palms facing forward.",
      "Press both dumbbells overhead until arms are extended without locking elbows hard.",
      "Lower back to shoulder height with control."
    ]
  },
  {
    "id": "db-bicep-curl",
    "name": "Dumbbell Bicep Curl",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Biceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Stand tall, a dumbbell in each hand, arms fully extended, palms facing forward.",
      "Curl the weights up toward your shoulders, keeping elbows pinned at your sides.",
      "Lower slowly back to the start without swinging your body."
    ]
  },
  {
    "id": "db-overhead-tricep-extension",
    "name": "Dumbbell Overhead Tricep Extension",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Triceps"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Hold one dumbbell with both hands overhead, arms extended.",
      "Keeping your elbows pointed forward and close to your head, lower the weight behind your head.",
      "Extend back up to the starting position, squeezing your triceps."
    ]
  },
  {
    "id": "db-tricep-kickback",
    "name": "Dumbbell Tricep Kickback",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Hinge forward slightly, upper arm parallel to the floor, elbow bent at 90°.",
      "Extend your forearm backward until your arm is straight, squeezing the tricep.",
      "Return with control to the bent position."
    ]
  },
  {
    "id": "db-lateral-raise",
    "name": "Dumbbell Lateral Raise",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Shoulders"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Stand tall, a dumbbell in each hand at your sides, slight bend in the elbows.",
      "Raise both arms out to the sides until roughly shoulder height.",
      "Lower slowly back down — avoid using momentum to swing the weights up."
    ]
  },
  {
    "id": "db-front-raise",
    "name": "Dumbbell Front Raise",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Shoulders"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Stand tall, dumbbells in front of your thighs, palms facing your body.",
      "Raise one or both arms straight in front of you to about shoulder height.",
      "Lower with control back to the start."
    ]
  },
  {
    "id": "db-bench-chest-press",
    "name": "Dumbbell Bench Chest Press",
    "category": "dumbbell",
    "equipment": "Dumbbells + Bench",
    "muscles": [
      "Chest",
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Lie back on the bench, a dumbbell in each hand at chest level, palms facing forward.",
      "Press both dumbbells up until arms are extended above your chest.",
      "Lower with control until elbows are just below the bench line, then press back up."
    ]
  },
  {
    "id": "db-bench-chest-fly",
    "name": "Dumbbell Bench Chest Fly",
    "category": "dumbbell",
    "equipment": "Dumbbells + Bench",
    "muscles": [
      "Chest"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Lie back on the bench, dumbbells held above your chest, palms facing each other, slight bend in elbows.",
      "Lower the weights out to the sides in a wide arc until you feel a stretch across your chest.",
      "Bring the dumbbells back together above your chest, squeezing your pecs."
    ]
  },
  {
    "id": "db-floor-press",
    "name": "Dumbbell Floor Press",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Chest",
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Lie on your back on the floor, knees bent, a dumbbell in each hand at chest level.",
      "Press the dumbbells straight up until arms are extended.",
      "Lower until your upper arms touch the floor, then press back up. Easier on the shoulders than a bench press."
    ]
  },
  {
    "id": "db-renegade-row",
    "name": "Dumbbell Renegade Row",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Back",
      "Core"
    ],
    "difficulty": "Advanced",
    "guidance": "2-3 sets x 6-8 reps per side",
    "instructions": [
      "Get into a plank position with a hand on each dumbbell, feet set wide for stability.",
      "Row one dumbbell up toward your hip while keeping your hips square and core braced.",
      "Lower it back down and repeat on the other side."
    ]
  },
  {
    "id": "db-deadlift",
    "name": "Dumbbell Deadlift",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Glutes",
      "Hamstrings",
      "Back"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Stand with feet hip-width apart, a dumbbell in each hand in front of your thighs.",
      "Hinge at the hips and bend your knees slightly, lowering the dumbbells toward the floor while keeping your back flat.",
      "Drive through your heels and squeeze your glutes to stand back up."
    ]
  },
  {
    "id": "db-shrug",
    "name": "Dumbbell Shrug",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Traps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Stand tall, a dumbbell in each hand at your sides.",
      "Shrug your shoulders straight up toward your ears.",
      "Lower with control — avoid rolling your shoulders, just a straight up-and-down motion."
    ]
  },
  {
    "id": "db-squat-to-press",
    "name": "Dumbbell Squat-to-Press",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Full Body"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Hold a dumbbell in each hand at shoulder height and squat down.",
      "As you stand up, press both dumbbells overhead in one fluid motion.",
      "Lower the dumbbells back to your shoulders as you descend into the next squat."
    ]
  },
  {
    "id": "db-bench-pullover",
    "name": "Dumbbell Bench Pullover",
    "category": "dumbbell",
    "equipment": "Dumbbells + Bench",
    "muscles": [
      "Lats",
      "Chest"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Lie with your upper back on the bench, hips low, feet flat on the floor, holding one dumbbell with both hands above your chest.",
      "Keeping a slight bend in your elbows, lower the dumbbell back and overhead until you feel a stretch in your lats.",
      "Pull it back up over your chest, leading with your lats rather than your arms."
    ]
  },
  {
    "id": "db-single-arm-row",
    "name": "Dumbbell Single-Arm Row (bench-supported)",
    "category": "dumbbell",
    "equipment": "Dumbbells + Bench",
    "muscles": [
      "Back",
      "Biceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps per side",
    "instructions": [
      "Place one knee and hand on the bench for support, other foot on the floor, back flat and parallel to the ground.",
      "Hold a dumbbell in the free hand, arm extended.",
      "Pull the dumbbell up toward your hip, squeezing your shoulder blade, then lower with control."
    ]
  },
  {
    "id": "db-farmers-carry",
    "name": "Dumbbell Farmer's Carry",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Grip",
      "Core",
      "Traps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 30-45 sec walk",
    "instructions": [
      "Hold a dumbbell in each hand at your sides, shoulders back and down.",
      "Walk at a controlled pace for the set distance/time, keeping your core braced and posture tall.",
      "Avoid leaning to either side — this also works your grip and core stability."
    ]
  },
  {
    "id": "db-sumo-squat",
    "name": "Dumbbell Sumo Squat",
    "category": "dumbbell",
    "equipment": "Dumbbells",
    "muscles": [
      "Inner Thighs",
      "Glutes"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Stand with feet wider than shoulder-width, toes turned out, holding one dumbbell vertically with both hands between your legs.",
      "Squat straight down, tracking your knees over your toes.",
      "Drive through your heels to stand back up, squeezing your glutes at the top."
    ]
  },
  {
    "id": "bn-bulgarian-split-squat",
    "name": "Bulgarian Split Squat (rear foot on bench)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Advanced",
    "guidance": "2-3 sets x 8-10 reps per leg",
    "instructions": [
      "Stand a couple feet in front of the bench, rest the top of one foot on it behind you.",
      "Lower your back knee toward the floor, keeping your front shin fairly vertical.",
      "Push through your front heel to stand back up.",
      "Hold something sturdy nearby for balance at first — this is a challenging move, progress into it slowly."
    ]
  },
  {
    "id": "bn-step-up",
    "name": "Bench Step-Up",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 8-10 reps per leg",
    "instructions": [
      "Stand facing the bench, place one foot fully on top of it.",
      "Push through that foot to step up onto the bench, bringing the other foot up to meet it.",
      "Step back down with control and repeat, alternating the lead leg."
    ]
  },
  {
    "id": "bn-decline-pushup",
    "name": "Decline Push-Up (feet on bench)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Chest",
      "Shoulders"
    ],
    "difficulty": "Advanced",
    "guidance": "2-3 sets x 6-10 reps",
    "instructions": [
      "Place both feet on the bench, hands on the floor slightly wider than shoulders.",
      "Lower your chest toward the floor, keeping your body in a straight line.",
      "Press back up to full extension. Harder than a standard push-up — build up to it."
    ]
  },
  {
    "id": "bn-bench-dip",
    "name": "Bench Dip",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Triceps",
      "Shoulders"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 8-12 reps",
    "instructions": [
      "Sit on the edge of the bench, hands gripping the edge next to your hips, legs extended out in front.",
      "Slide your hips off the bench and lower yourself by bending your elbows to about 90°.",
      "Press back up through your palms to straighten your arms.",
      "Keep elbows pointed backward, not flared out, to protect your shoulders."
    ]
  },
  {
    "id": "bn-seated-overhead-press",
    "name": "Seated Dumbbell Overhead Press",
    "category": "bench",
    "equipment": "Dumbbells + Bench",
    "muscles": [
      "Shoulders",
      "Triceps"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-12 reps",
    "instructions": [
      "Sit upright on the bench, a dumbbell in each hand at shoulder height.",
      "Press both dumbbells overhead until arms are extended.",
      "Lower back to shoulder height with control. The seated position removes leg drive, isolating the shoulders."
    ]
  },
  {
    "id": "bn-hip-thrust",
    "name": "Hip Thrust (shoulders on bench)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Glutes",
      "Hamstrings"
    ],
    "difficulty": "Intermediate",
    "guidance": "2-3 sets x 12-15 reps",
    "instructions": [
      "Sit on the floor with your upper back against the edge of the bench, knees bent, feet flat.",
      "Drive your hips up until your body forms a straight line from shoulders to knees, squeezing your glutes.",
      "Lower with control and repeat. Hold a dumbbell across your hips later for added resistance."
    ]
  },
  {
    "id": "bn-single-leg-glute-bridge",
    "name": "Single-Leg Glute Bridge (feet on bench)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Glutes",
      "Hamstrings"
    ],
    "difficulty": "Advanced",
    "guidance": "2-3 sets x 8-10 reps per leg",
    "instructions": [
      "Lie on your back, one heel on the bench, other leg lifted straight up toward the ceiling.",
      "Drive through the heel on the bench to lift your hips, keeping the other leg extended.",
      "Lower with control, then switch legs."
    ]
  },
  {
    "id": "bn-incline-plank",
    "name": "Incline Plank (forearms on bench)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Core",
      "Shoulders"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 20-45 sec hold",
    "instructions": [
      "Rest your forearms on the bench, feet on the floor behind you, body in a straight line.",
      "Brace your core and squeeze your glutes, not letting your hips sag.",
      "Hold, breathing steadily. Easier on the shoulders/wrists than a floor plank."
    ]
  },
  {
    "id": "bn-box-squat",
    "name": "Bench Box Squat (sit-to-stand)",
    "category": "bench",
    "equipment": "Bench",
    "muscles": [
      "Quads",
      "Glutes"
    ],
    "difficulty": "Beginner",
    "guidance": "2-3 sets x 10-15 reps",
    "instructions": [
      "Stand in front of the bench as if you were about to sit down on it, feet shoulder-width apart.",
      "Lower yourself with control until you lightly touch the bench, then stand back up.",
      "This controls your squat depth and is a great way to build confidence with squat form."
    ]
  }
];

export const DEFAULT_PLAN: PlanDay[] = [
  {
    "day": "Monday",
    "type": "Cardio + Core",
    "note": "Incline Treadmill Walk (30-40 min) + Core circuit",
    "exerciseIds": [
      "cardio-incline-walk",
      "bw-front-plank",
      "bw-bird-dog",
      "bw-dead-bug",
      "bw-bicycle-crunch"
    ]
  },
  {
    "day": "Tuesday",
    "type": "Upper Body Strength",
    "note": "Dumbbell + bench upper body",
    "exerciseIds": [
      "db-shoulder-press",
      "db-bicep-curl",
      "db-tricep-kickback",
      "db-bench-chest-press",
      "db-bent-over-row",
      "bn-bench-dip"
    ]
  },
  {
    "day": "Wednesday",
    "type": "Cardio + Mobility",
    "note": "Interval Walk/Jog (25-30 min) + gentle mobility",
    "exerciseIds": [
      "cardio-interval",
      "bw-superman",
      "bw-bird-dog",
      "bw-standing-oblique-crunch"
    ]
  },
  {
    "day": "Thursday",
    "type": "Lower Body Strength",
    "note": "Dumbbell + bench lower body",
    "exerciseIds": [
      "db-goblet-squat",
      "db-romanian-deadlift",
      "bn-step-up",
      "db-sumo-squat",
      "bw-glute-bridge"
    ]
  },
  {
    "day": "Friday",
    "type": "Full Body Circuit",
    "note": "Dumbbell + bodyweight + bench mix",
    "exerciseIds": [
      "db-squat-to-press",
      "bw-mountain-climbers",
      "db-renegade-row",
      "bn-hip-thrust",
      "bw-walking-lunge"
    ]
  },
  {
    "day": "Saturday",
    "type": "Cardio + Core",
    "note": "Long Steady Walk (40-50 min) + Core",
    "exerciseIds": [
      "cardio-flat-walk",
      "bw-side-plank",
      "bw-russian-twist",
      "bw-standing-oblique-crunch"
    ]
  },
  {
    "day": "Sunday",
    "type": "Active Recovery",
    "note": "Easy walk + full-body stretch/mobility",
    "exerciseIds": [
      "cardio-cooldown-walk",
      "bw-superman",
      "bw-bird-dog",
      "bw-dead-bug"
    ]
  }
];

export const exerciseById = new Map(EXERCISES.map((e) => [e.id, e]));

export function formVideoUrl(name: string): string {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(name + ' exercise form');
}
