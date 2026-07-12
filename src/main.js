import './styles.css';
import { calculateRecipeNutrition, calculateScaledIngredients } from './models/Recipe.js';

const STORAGE_KEY = 'recipe-app-state-v1';
const initialState = {
  recipes: [
    {
      id: crypto.randomUUID(),
      title: 'Simple Bean Bowl',
      category: 'Dinner',
      baseYield: 2,
      instructions: 'Cook beans and serve with rice.',
      ingredients: [
        {
          id: crypto.randomUUID(),
          ingredientId: 'ing-beans',
          name: 'Black beans',
          quantity: 1,
          unit: 'cup',
          ingredient: {
            name: 'Black beans',
            caloriesPerGram: 0.34,
            density: 1.0
          }
        },
        {
          id: crypto.randomUUID(),
          ingredientId: 'ing-rice',
          name: 'Rice',
          quantity: 1,
          unit: 'cup',
          ingredient: {
            name: 'Rice',
            caloriesPerGram: 0.36,
            density: 0.8
          }
        }
      ]
    }
  ],
  plan: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : initialState;
  } catch (error) {
    console.warn('Unable to load state', error);
    return initialState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render(state) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <header>
      <h1>Recipe & Meal Planner</h1>
      <p class="small">A lightweight offline-first MVP for recipes, nutrition math, and meal planning.</p>
    </header>

    <section class="grid">
      <div class="card">
        <h2>Add Recipe</h2>
        <form id="recipe-form">
          <label>Title<input name="title" required /></label>
          <label>Category<input name="category" /></label>
          <label>Base Yield<input name="baseYield" type="number" min="1" value="4" /></label>
          <label>Instructions<textarea name="instructions"></textarea></label>
          <label>Ingredient 1<br /><input name="ingredientName" placeholder="Ingredient name" /></label>
          <label>Quantity<input name="ingredientQuantity" type="number" min="0" step="0.25" value="1" /></label>
          <label>Unit<select name="ingredientUnit">
            <option value="cup">cup</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="tbsp">tbsp</option>
            <option value="tsp">tsp</option>
            <option value="oz">oz</option>
          </select></label>
          <div class="row">
            <button type="submit">Save recipe</button>
            <button type="button" class="secondary" id="reset-state">Reset demo</button>
          </div>
        </form>
      </div>

      <div class="card">
        <h2>Plan a meal</h2>
        <form id="plan-form">
          <label>Date<input name="date" type="date" required /></label>
          <label>Recipe<select name="recipeId"></select></label>
          <label>Servings<input name="servings" type="number" min="1" value="4" /></label>
          <button type="submit">Add to calendar</button>
        </form>
        <h3>Upcoming plan</h3>
        <ul id="plan-list"></ul>
      </div>
    </section>

    <section class="card">
      <h2>Recipes</h2>
      <div class="recipe-list" id="recipe-list"></div>
    </section>
  `;

  const recipeListEl = document.getElementById('recipe-list');
  recipeListEl.innerHTML = state.recipes.map((recipe) => {
    const nutrition = calculateRecipeNutrition(recipe, recipe.baseYield || 1);
    return `
      <div class="recipe-item">
        <div class="row"><strong>${recipe.title}</strong><span class="badge">${recipe.category || 'Uncategorized'}</span></div>
        <p class="small">Base yield: ${recipe.baseYield} • ${nutrition.calories} calories • ${nutrition.perServing} per serving</p>
        <ul>${(recipe.ingredients || []).map((item) => `<li>${item.quantity} ${item.unit} ${item.name}</li>`).join('')}</ul>
      </div>
    `;
  }).join('');

  const recipeSelectEl = document.querySelector('#plan-form select[name="recipeId"]');
  recipeSelectEl.innerHTML = state.recipes.map((recipe) => `<option value="${recipe.id}">${recipe.title}</option>`).join('');

  const planListEl = document.getElementById('plan-list');
  planListEl.innerHTML = state.plan.map((entry) => `<li>${entry.date}: ${state.recipes.find((recipe) => recipe.id === entry.recipeId)?.title || 'Recipe'} (${entry.servings} servings)</li>`).join('');

  document.getElementById('recipe-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const recipe = {
      id: crypto.randomUUID(),
      title: formData.get('title').toString().trim(),
      category: formData.get('category').toString().trim(),
      baseYield: Number(formData.get('baseYield') || 4),
      instructions: formData.get('instructions').toString().trim(),
      ingredients: [
        {
          id: crypto.randomUUID(),
          ingredientId: `ing-${crypto.randomUUID()}`,
          name: formData.get('ingredientName').toString().trim(),
          quantity: Number(formData.get('ingredientQuantity') || 0),
          unit: formData.get('ingredientUnit').toString().trim(),
          ingredient: {
            name: formData.get('ingredientName').toString().trim(),
            caloriesPerGram: 0.3,
            density: 1.0
          }
        }
      ]
    };

    const nextState = { ...state, recipes: [recipe, ...state.recipes] };
    saveState(nextState);
    render(nextState);
  });

  document.getElementById('plan-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const entry = {
      id: crypto.randomUUID(),
      date: formData.get('date').toString(),
      recipeId: formData.get('recipeId').toString(),
      servings: Number(formData.get('servings') || 1)
    };
    const nextState = { ...state, plan: [entry, ...state.plan] };
    saveState(nextState);
    render(nextState);
  });

  document.getElementById('reset-state').addEventListener('click', () => {
    saveState(initialState);
    render(loadState());
  });
}

const state = loadState();
render(state);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error);
  });
}
