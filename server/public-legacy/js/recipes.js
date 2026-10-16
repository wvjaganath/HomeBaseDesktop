// Recipe library data — mirrors Modules/Nutrition/RecipeLibrary.swift.
// Nutrition figures are per-serving estimates for planning, not lab values.

const RECIPES = [
  // ---------------- BREAKFAST ----------------
  {
    id: 'egg-white-bhurji', name: 'Masala Egg White Bhurji', mealType: 'breakfast',
    calories: 150, protein: 20, carbs: 6, fat: 5, prepMinutes: 10, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['4 egg whites', '1/4 onion, finely chopped', '1 small tomato, chopped', '1 green chili, chopped', '1/4 tsp turmeric', '1 tsp oil', 'Coriander leaves, salt'],
    instructions: [
      'Heat oil in a pan, sauté onion and green chili until soft.',
      'Add tomato and turmeric, cook until the tomato breaks down.',
      'Pour in the egg whites and scramble on medium heat until just set.',
      'Season with salt, garnish with coriander, and serve hot.'
    ]
  },
  {
    id: 'moong-dal-chilla', name: 'Moong Dal Chilla with Mint Chutney', mealType: 'breakfast',
    calories: 220, protein: 14, carbs: 30, fat: 6, prepMinutes: 20, servings: 1,
    tags: ['Vegetarian', 'High protein'],
    ingredients: ['1/2 cup split yellow moong dal, soaked 2+ hrs', '1/4 onion', '1 green chili', 'Ginger', '1 tsp oil', 'Mint-coriander chutney to serve'],
    instructions: [
      'Blend the soaked moong dal with ginger, chili, and a little water into a smooth, pourable batter.',
      'Stir in finely chopped onion and salt.',
      'Heat a non-stick pan, pour a ladle of batter and spread thin like a crepe.',
      'Drizzle a few drops of oil, cook both sides until golden, and serve with mint chutney.'
    ]
  },
  {
    id: 'vegetable-poha', name: 'Vegetable Poha', mealType: 'breakfast',
    calories: 280, protein: 7, carbs: 45, fat: 9, prepMinutes: 15, servings: 1,
    tags: ['Vegetarian'],
    ingredients: ['1.5 cups flattened rice (poha), rinsed', '1/4 cup peas', '1/4 onion', '1 tbsp peanuts', 'Mustard seeds, curry leaves, turmeric', '1 tsp oil', 'Lemon juice'],
    instructions: [
      'Rinse poha in a colander under water until soft, then drain well.',
      'Heat oil, temper mustard seeds and curry leaves, then sauté onion and peanuts.',
      'Add peas and turmeric, cook 2-3 minutes.',
      'Add the drained poha, toss gently to combine and heat through.',
      'Finish with a squeeze of lemon and coriander.'
    ]
  },
  {
    id: 'egg-sprouts-chaat', name: 'Boiled Egg & Sprouts Chaat', mealType: 'breakfast',
    calories: 250, protein: 20, carbs: 18, fat: 12, prepMinutes: 15, servings: 1,
    tags: ['High protein'],
    ingredients: ['2 boiled eggs, chopped', '1 cup mixed sprouts (moong/chana), steamed', '1/4 onion, 1 small tomato, chopped', 'Chaat masala, lemon juice, coriander'],
    instructions: [
      'Steam the sprouts for 5 minutes until just tender, then cool.',
      'Toss sprouts with chopped onion, tomato, chaat masala, and lemon juice.',
      'Top with chopped boiled egg and coriander, serve immediately.'
    ]
  },
  {
    id: 'oats-upma', name: 'Oats Upma', mealType: 'breakfast',
    calories: 220, protein: 8, carbs: 32, fat: 7, prepMinutes: 15, servings: 1,
    tags: ['Vegetarian', 'High fiber'],
    ingredients: ['1/2 cup rolled oats, dry-roasted', '1/4 onion', '1 carrot, diced', '2 tbsp peas', 'Mustard seeds, curry leaves, green chili', '1 tsp oil'],
    instructions: [
      'Dry-roast the oats in a pan for 2-3 minutes until lightly toasted; set aside.',
      'Heat oil, temper mustard seeds and curry leaves, sauté onion and chili.',
      'Add carrot and peas, cook until just tender.',
      'Add 1.5 cups hot water, bring to a simmer, then stir in the roasted oats.',
      'Cook 2-3 minutes until the mixture thickens, then serve.'
    ]
  },
  {
    id: 'yogurt-cucumber-bowl', name: 'Cucumber-Mint Yogurt Bowl', mealType: 'breakfast',
    calories: 180, protein: 12, carbs: 15, fat: 8, prepMinutes: 5, servings: 1,
    tags: ['Vegetarian', 'High protein', 'No cook'],
    ingredients: ['1 cup low-fat curd/yogurt', '1/2 cucumber, grated', 'Mint leaves, chopped', '1 tsp roasted nuts/seeds', 'Roasted cumin powder, salt'],
    instructions: [
      'Whisk the curd until smooth.',
      'Stir in grated cucumber, mint, roasted cumin, and salt.',
      'Top with roasted nuts or seeds and serve chilled.'
    ]
  },

  // ---------------- LUNCH / DINNER (chicken-forward) ----------------
  {
    id: 'tandoori-chicken', name: 'Tandoori Chicken (oven-baked)', mealType: 'dinner',
    calories: 320, protein: 42, carbs: 6, fat: 13, prepMinutes: 40, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['200g chicken (bone-in or breast)', '1/2 cup low-fat yogurt', '1 tbsp tandoori masala', '1 tsp ginger-garlic paste', '1 tsp lemon juice', '1 tsp oil'],
    instructions: [
      'Mix yogurt, tandoori masala, ginger-garlic paste, lemon juice, oil, and salt into a marinade.',
      'Coat the chicken and marinate at least 2 hours (overnight is better).',
      'Roast at 200°C/400°F for 25-30 minutes, turning once, until charred at the edges and cooked through.',
      'Rest 5 minutes, then serve with lemon wedges and salad.'
    ]
  },
  {
    id: 'chicken-tikka', name: 'Chicken Tikka (grilled)', mealType: 'dinner',
    calories: 280, protein: 40, carbs: 5, fat: 10, prepMinutes: 35, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['200g boneless chicken breast, cubed', '1/2 cup low-fat yogurt', '1 tbsp tikka masala spice mix', '1 tsp ginger-garlic paste', '1 tsp oil', 'Bell pepper & onion for skewers'],
    instructions: [
      'Marinate chicken cubes in yogurt, spice mix, ginger-garlic paste, oil, and salt for at least 1 hour.',
      'Thread onto skewers alternating with pepper and onion.',
      'Grill or broil 12-15 minutes, turning occasionally, until charred and cooked through.'
    ]
  },
  {
    id: 'light-chicken-curry', name: 'Light Chicken Curry', mealType: 'dinner',
    calories: 350, protein: 38, carbs: 12, fat: 15, prepMinutes: 35, servings: 1,
    tags: ['High protein'],
    ingredients: ['200g chicken, curry cut', '1 onion, pureed', '1 tomato, pureed', '1 tsp ginger-garlic paste', '1 tbsp oil', 'Turmeric, coriander powder, garam masala'],
    instructions: [
      'Heat oil, sauté onion puree until golden and the raw smell is gone.',
      'Add ginger-garlic paste and spices, cook 1 minute.',
      'Add tomato puree, cook until oil separates.',
      'Add chicken, sear briefly, then add a splash of water, cover, and simmer 15-18 minutes until cooked through.',
      'Finish with garam masala and coriander.'
    ]
  },
  {
    id: 'lemon-pepper-chicken', name: 'Lemon Pepper Grilled Chicken', mealType: 'dinner',
    calories: 260, protein: 42, carbs: 3, fat: 8, prepMinutes: 30, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['200g chicken breast', '1 tbsp lemon juice', '1 tsp cracked black pepper', '1 tsp ginger-garlic paste', '1 tsp oil'],
    instructions: [
      'Marinate chicken breast in lemon juice, black pepper, ginger-garlic paste, oil, and salt for 30+ minutes.',
      'Grill or pan-sear on medium-high heat, 5-6 minutes per side, until cooked through.',
      'Rest 5 minutes before slicing.'
    ]
  },
  {
    id: 'chicken-saag', name: 'Chicken Saag (spinach chicken)', mealType: 'dinner',
    calories: 330, protein: 40, carbs: 10, fat: 14, prepMinutes: 35, servings: 1,
    tags: ['High protein', 'Iron-rich'],
    ingredients: ['200g chicken', '2 cups spinach, blanched and pureed', '1/2 onion', '1 tsp ginger-garlic paste', '1 tbsp oil', '2 tbsp low-fat yogurt'],
    instructions: [
      'Blanch spinach 2 minutes, then blend to a smooth puree.',
      'Sauté onion and ginger-garlic paste in oil until golden.',
      'Add chicken and sear until lightly browned.',
      'Stir in the spinach puree and yogurt, cover, and simmer 15 minutes until chicken is cooked through.'
    ]
  },
  {
    id: 'chicken-chettinad-light', name: 'Chicken Chettinad (lightened)', mealType: 'dinner',
    calories: 340, protein: 38, carbs: 10, fat: 16, prepMinutes: 40, servings: 1,
    tags: ['High protein'],
    ingredients: ['200g chicken', '1/2 onion', '1 tomato', '1 tbsp Chettinad spice blend (pepper, fennel, coriander seed)', '1 tsp ginger-garlic paste', '1 tbsp oil'],
    instructions: [
      'Dry-roast and grind the Chettinad spices if not using a pre-made blend.',
      'Sauté onion in oil until golden, add ginger-garlic paste and spices.',
      'Add tomato, cook until soft, then add chicken and sear.',
      'Add a splash of water, cover, and simmer 15-18 minutes until cooked through.'
    ]
  },
  {
    id: 'chicken-veg-pulao', name: 'Chicken & Vegetable Brown Rice Pulao', mealType: 'lunch',
    calories: 420, protein: 30, carbs: 50, fat: 10, prepMinutes: 40, servings: 1,
    tags: ['Balanced meal'],
    ingredients: ['3/4 cup brown rice, soaked', '150g chicken, cubed', 'Mixed vegetables (carrot, beans, peas)', 'Whole spices (bay leaf, cardamom, cinnamon)', '1 tbsp oil'],
    instructions: [
      'Heat oil, temper whole spices, then sauté chicken until lightly browned.',
      'Add vegetables and soaked brown rice, stir to coat.',
      'Add water (about 1.5x rice volume), salt, bring to a boil, then cover and simmer on low 25-30 minutes until rice is tender.',
      'Rest 5 minutes covered before fluffing and serving.'
    ]
  },
  {
    id: 'chicken-kali-mirch', name: 'Chicken Kali Mirch (black pepper chicken)', mealType: 'dinner',
    calories: 300, protein: 40, carbs: 6, fat: 12, prepMinutes: 30, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['200g chicken', '2 tsp crushed black pepper', '1/2 cup low-fat yogurt', '1 tsp ginger-garlic paste', '1 tsp oil'],
    instructions: [
      'Whisk yogurt with crushed black pepper, ginger-garlic paste, and salt.',
      'Marinate chicken in the mixture for 30+ minutes.',
      'Cook in a hot pan with a little oil, 6-8 minutes per side, until cooked through and lightly charred.'
    ]
  },
  {
    id: 'chicken-pepper-stirfry', name: 'Indo-Chinese Chicken & Pepper Stir-Fry', mealType: 'dinner',
    calories: 310, protein: 38, carbs: 15, fat: 10, prepMinutes: 25, servings: 1,
    tags: ['High protein'],
    ingredients: ['200g chicken breast, sliced', '1 bell pepper, sliced', '1/2 onion, sliced', '1 tsp ginger-garlic, chopped', '1 tbsp light soy sauce', '1 tsp oil', 'Black pepper'],
    instructions: [
      'Heat oil in a wok on high heat, stir-fry chicken until just cooked, then set aside.',
      'Stir-fry ginger-garlic, onion, and pepper 2-3 minutes, keeping them crisp.',
      'Return chicken to the wok, add soy sauce and black pepper, toss well, and serve hot.'
    ]
  },
  {
    id: 'hariyali-chicken-kebab', name: 'Hariyali Chicken Kebabs', mealType: 'dinner',
    calories: 270, protein: 40, carbs: 5, fat: 9, prepMinutes: 35, servings: 1,
    tags: ['High protein', 'Low carb'],
    ingredients: ['200g chicken breast, cubed', '1 cup mint & coriander leaves', '2 tbsp low-fat yogurt', '1 green chili', '1 tsp ginger-garlic paste'],
    instructions: [
      'Blend mint, coriander, green chili, yogurt, ginger-garlic paste, and salt into a smooth marinade.',
      'Coat chicken cubes and marinate 1+ hour.',
      'Thread onto skewers and grill or broil 12-15 minutes, turning occasionally, until cooked through.'
    ]
  },
  {
    id: 'paneer-bhurji', name: 'Low-Fat Paneer Bhurji', mealType: 'lunch',
    calories: 230, protein: 20, carbs: 8, fat: 13, prepMinutes: 15, servings: 1,
    tags: ['Vegetarian', 'High protein'],
    ingredients: ['150g low-fat paneer, crumbled', '1/4 onion', '1 tomato', '1 green chili', 'Turmeric', '1 tsp oil'],
    instructions: [
      'Heat oil, sauté onion and green chili until soft.',
      'Add tomato and turmeric, cook until it breaks down.',
      "Add crumbled paneer, toss gently for 2-3 minutes until heated through — don't overcook or it turns rubbery.",
      'Season with salt and garnish with coriander.'
    ]
  },
  {
    id: 'dal-tadka', name: 'Dal Tadka', mealType: 'lunch',
    calories: 220, protein: 14, carbs: 30, fat: 6, prepMinutes: 30, servings: 1,
    tags: ['Vegetarian', 'High protein'],
    ingredients: ['1/2 cup toor or moong dal, rinsed', 'Turmeric', '1 tsp ghee or oil', 'Cumin seeds, garlic, dried red chili', '1/4 tomato, chopped'],
    instructions: [
      'Pressure-cook the dal with turmeric and water until soft (about 3-4 whistles), then mash lightly.',
      'In a small pan, heat ghee, sizzle cumin seeds, garlic, and dried chili until fragrant.',
      'Pour the tempering over the dal, add tomato, simmer 5 minutes, and season with salt.'
    ]
  },

  // ---------------- SNACKS / SIDES ----------------
  {
    id: 'roasted-chana', name: 'Roasted Chana (chickpeas)', mealType: 'snack',
    calories: 180, protein: 10, carbs: 27, fat: 4, prepMinutes: 10, servings: 1,
    tags: ['Vegetarian', 'High fiber'],
    ingredients: ['1/2 cup cooked chickpeas, patted dry', '1/2 tsp chaat masala', '1/4 tsp red chili powder', '1 tsp oil'],
    instructions: [
      'Toss chickpeas with oil and spices.',
      'Roast in an air fryer or oven at 200°C/400°F for 12-15 minutes, shaking halfway, until crisp.',
      'Cool slightly before eating — they crisp up further as they cool.'
    ]
  },
  {
    id: 'kachumber-salad', name: 'Cucumber-Tomato Kachumber Salad', mealType: 'snack',
    calories: 60, protein: 2, carbs: 10, fat: 1, prepMinutes: 10, servings: 1,
    tags: ['Vegetarian', 'Low calorie', 'No cook'],
    ingredients: ['1 cucumber, diced', '1 tomato, diced', '1/4 onion, diced', 'Lemon juice', 'Chaat masala, coriander'],
    instructions: [
      'Combine cucumber, tomato, and onion in a bowl.',
      'Dress with lemon juice and chaat masala, toss, and garnish with coriander.'
    ]
  },
  {
    id: 'sprouts-salad', name: 'Sprouts Salad', mealType: 'snack',
    calories: 150, protein: 10, carbs: 22, fat: 3, prepMinutes: 10, servings: 1,
    tags: ['Vegetarian', 'High protein', 'High fiber'],
    ingredients: ['1 cup mixed sprouts (moong/chana), steamed', '1/4 onion, 1 small tomato, chopped', 'Lemon juice, chaat masala, coriander'],
    instructions: [
      'Steam sprouts 5 minutes until just tender, then cool.',
      'Toss with onion, tomato, lemon juice, and chaat masala.',
      'Garnish with coriander and serve.'
    ]
  },
  {
    id: 'spiced-buttermilk', name: 'Spiced Buttermilk (Chaas)', mealType: 'snack',
    calories: 50, protein: 3, carbs: 5, fat: 1, prepMinutes: 5, servings: 1,
    tags: ['Vegetarian', 'Low calorie', 'No cook'],
    ingredients: ['1 cup low-fat curd/yogurt', '1 cup chilled water', 'Roasted cumin powder', 'Mint, salt'],
    instructions: [
      'Whisk curd and water together until smooth and frothy.',
      'Stir in roasted cumin powder, salt, and chopped mint.',
      'Serve chilled.'
    ]
  }
];

function findRecipe(id) {
  return RECIPES.find(r => r.id === id) || null;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

function mealTypeLabel(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
