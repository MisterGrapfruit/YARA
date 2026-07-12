import './styles.css';
import { calculateRecipeNutrition } from './models/Recipe.js';
import {
  signIn,
  handleRedirectCallback,
  getIdTokenClaims,
  signOut,
  getAccessToken
} from './auth/googleAuth.js';
import { syncRecipesToDrive } from './api/googleDrive.js';
import { createMealEvent, listUpcomingEvents } from './api/googleCalendar.js';

const STORAGE_KEY = 'recipe-app-state-v1';
const GOOGLE_CLIENT_ID = '765539968846-4pn21vj4s0225gutensmpiq4nj0s6tmh.apps.googleusercontent.com';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');
const REDIRECT_URI = `${window.location.origin}${import.meta.env.BASE_URL}`;

const initialState = {
  recipes: [
    {
      id: crypto.randomUUID(),
      title: 'Simple Bean Bowl',
      category: 'Dinner',
      baseYield: 2,
      instructions: 'Cook beans and serve with rice.',
      folderId: 'folder-unsorted',
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
  plan: [],
  folders: [{ id: 'folder-unsorted', name: 'Unsorted' }],
  ingredients: [
    { id: 'ing-beans', name: 'Black beans', aliases: ['chickpeas'], caloriesPerGram: 0.34, density: 1.0 },
    { id: 'ing-rice', name: 'Rice', aliases: ['white rice'], caloriesPerGram: 0.36, density: 0.8 }
  ],
  measurements: [
    { id: 'm-cup', name: 'cup', ml: 240 },
    { id: 'm-tbsp', name: 'tbsp', ml: 15 },
    { id: 'm-tsp', name: 'tsp', ml: 5 },
    { id: 'm-g', name: 'g', ml: null }
  ],
  driveFolders: {
    root: null,
    ingredients: null,
    measurements: null,
    recipes: null
  },
  driveStatus: 'not-synced',
  selectedTab: 'recipes',
  selectedRecipeId: null,
  calendarEvents: []
};

function mergeSavedState(saved) {
  return {
    ...initialState,
    ...saved,
    recipes: saved.recipes ?? initialState.recipes,
    plan: saved.plan ?? initialState.plan,
    folders: saved.folders ?? initialState.folders,
    ingredients: saved.ingredients ?? initialState.ingredients,
    measurements: saved.measurements ?? initialState.measurements,
    driveFolders: saved.driveFolders ?? initialState.driveFolders,
    driveStatus: saved.driveStatus ?? initialState.driveStatus,
    selectedTab: saved.selectedTab ?? initialState.selectedTab,
    selectedRecipeId: saved.selectedRecipeId ?? null,
    calendarEvents: saved.calendarEvents ?? initialState.calendarEvents
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return mergeSavedState({});
    }

    const parsed = JSON.parse(raw);
    return mergeSavedState(parsed);
  } catch (error) {
    console.warn('Unable to load state', error);
    return mergeSavedState({});
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getFolderName(state, folderId) {
  return state.folders.find((folder) => folder.id === folderId)?.name || 'Unsorted';
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

function render(state) {
  const app = document.getElementById('app');
  const user = getIdTokenClaims();

  app.innerHTML = `
    <header>
      <div class="row header-row">
        <div>
          <h1>Recipe & Meal Planner</h1>
          <p class="small">A lightweight offline-first MVP for recipes, nutrition math, Google Drive sync, and meal planning.</p>
          <p class="small">Google OAuth redirect URI: <code>${REDIRECT_URI}</code></p>
        </div>
        <div class="header-actions">
          ${user ? `<span class="badge">Signed in as ${user.email || user.name || 'User'}</span> <button id="sign-out" class="secondary">Sign out</button>` : `<button id="sign-in">Sign in with Google</button>`}
        </div>
      </div>
    </header>

    <nav class="tabs">
      <button class="tab${state.selectedTab === 'recipes' ? ' active' : ''}" data-tab="recipes">Recipes</button>
      <button class="tab${state.selectedTab === 'calendar' ? ' active' : ''}" data-tab="calendar">Calendar</button>
      <button class="tab${state.selectedTab === 'settings' ? ' active' : ''}" data-tab="settings">Settings</button>
    </nav>

    <section class="card" id="tab-content"></section>
  `;

  const signInButton = document.getElementById('sign-in');
  if (signInButton) {
    signInButton.addEventListener('click', () => signIn(GOOGLE_CLIENT_ID, REDIRECT_URI, GOOGLE_SCOPES));
  }

  const signOutButton = document.getElementById('sign-out');
  if (signOutButton) {
    signOutButton.addEventListener('click', () => {
      signOut();
      render(loadState());
    });
  }

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      render({ ...state, selectedTab: button.dataset.tab, selectedRecipeId: null });
    });
  });

  renderTabContent(state);
}

function renderTabContent(state) {
  const tabContent = document.getElementById('tab-content');
  const user = getIdTokenClaims();

  if (state.selectedTab === 'recipes') {
    tabContent.innerHTML = `
      <div class="section-row">
        <div>
          <h2>Recipes</h2>
          <p class="small">Tap a recipe card for full details. Folders are mirrored to Drive when synced.</p>
        </div>
        <span class="status-pill">${user ? 'Google signed in' : 'Offline mode only'}</span>
      </div>

      ${state.selectedRecipeId ? renderRecipeDetail(state) : renderRecipeList(state)}
    `;

    if (!state.selectedRecipeId) {
      document.querySelectorAll('.recipe-card').forEach((card) => {
        card.addEventListener('click', () => {
          render({ ...state, selectedRecipeId: card.dataset.id });
        });
      });

      document.getElementById('recipe-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const ingredientId = formData.get('ingredientId').toString();
        const selectedIngredient = state.ingredients.find((item) => item.id === ingredientId);
        const ingredientName = formData.get('ingredientName').toString().trim() || selectedIngredient?.name || 'Ingredient';
        const ingredientAliases = formData.get('ingredientAliases')?.toString().split(',').map((item) => item.trim()).filter(Boolean) || [];
        const ingredient = selectedIngredient || {
          name: ingredientName,
          aliases: ingredientAliases,
          caloriesPerGram: Number(formData.get('ingredientCalories') || 0),
          density: Number(formData.get('ingredientDensity') || 1)
        };

        const recipe = {
          id: crypto.randomUUID(),
          title: formData.get('title').toString().trim(),
          category: formData.get('category').toString().trim(),
          baseYield: Number(formData.get('baseYield') || 1),
          instructions: formData.get('instructions').toString().trim(),
          folderId: formData.get('folderId').toString() || state.folders[0]?.id,
          ingredients: [
            {
              id: crypto.randomUUID(),
              ingredientId: selectedIngredient?.id || `custom-${crypto.randomUUID()}`,
              name: ingredientName,
              quantity: Number(formData.get('ingredientQuantity') || 0),
              unit: formData.get('ingredientUnit').toString().trim(),
              ingredient
            }
          ]
        };

        let nextState = { ...state, recipes: [recipe, ...state.recipes] };
        saveState(nextState);

        if (user) {
          try {
            const result = await syncRecipesToDrive(nextState);
            nextState = {
              ...nextState,
              recipes: result.recipes,
              folders: result.folders,
              ingredients: result.ingredients,
              measurements: result.measurements,
              driveFolders: result.driveFolders,
              driveStatus: 'synced'
            };
            saveState(nextState);
          } catch (error) {
            console.error('Drive sync failed:', error);
          }
        }

        render(nextState);
      });

      document.getElementById('folder-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const folderName = formData.get('folderName').toString().trim();
        if (!folderName) {
          return;
        }

        const nextState = { ...state, folders: [{ id: crypto.randomUUID(), name: folderName }, ...state.folders] };
        saveState(nextState);
        render(nextState);
      });

      document.getElementById('reset-state').addEventListener('click', () => {
        saveState(initialState);
        render(loadState());
      });
    } else {
      document.getElementById('back-to-list').addEventListener('click', () => {
        render({ ...state, selectedRecipeId: null });
      });
    }
  } else if (state.selectedTab === 'calendar') {
    tabContent.innerHTML = `
      <div class="section-row">
        <div>
          <h2>Calendar</h2>
          <p class="small">Create planned meal events and sync them to Google Calendar.</p>
        </div>
        <span class="status-pill">${user ? 'Google Calendar ready' : 'Calendar offline only'}</span>
      </div>

      <div class="grid">
        <div class="card small-card">
          <h3>Plan a meal</h3>
          <form id="plan-form">
            <label>Date<input name="date" type="date" required /></label>
            <label>Recipe<select name="recipeId">
              ${state.recipes.map((recipe) => `<option value="${recipe.id}">${recipe.title}</option>`).join('')}
            </select></label>
            <label>Servings<input name="servings" type="number" min="1" value="4" /></label>
            <button type="submit">Add meal plan</button>
          </form>
        </div>

        <div class="card small-card">
          <h3>Google Calendar</h3>
          <p class="small">Sign in and load your next events.</p>
          <button id="load-google-events" class="secondary">Load Google events</button>
          <div id="google-events">${renderGoogleEvents(state)}</div>
        </div>
      </div>

      <div class="card">
        <h3>Planned meals</h3>
        <ul id="plan-list">${state.plan.length ? state.plan.map((entry) => {
          const recipe = state.recipes.find((item) => item.id === entry.recipeId);
          return `<li>${formatDate(entry.date)} — ${recipe?.title || 'Recipe'} (${entry.servings} servings) ${entry.calendarEventId ? '<span class="badge">Synced</span>' : ''}</li>`;
        }).join('') : '<li class="small muted">No planned meals yet.</li>'}</ul>
      </div>
    `;

    document.getElementById('plan-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const entry = {
        id: crypto.randomUUID(),
        date: formData.get('date').toString(),
        recipeId: formData.get('recipeId').toString(),
        servings: Number(formData.get('servings') || 1)
      };

      let nextState = { ...state, plan: [entry, ...state.plan] };
      saveState(nextState);

      if (user) {
        try {
          const recipe = nextState.recipes.find((item) => item.id === entry.recipeId);
          const event = await createMealEvent(entry, recipe);
          entry.calendarEventId = event.id;
          nextState = { ...nextState, plan: [entry, ...state.plan] };
          saveState(nextState);
        } catch (error) {
          console.error('Google Calendar sync failed:', error);
        }
      }

      render(nextState);
    });

    document.getElementById('load-google-events').addEventListener('click', async () => {
      if (!user) {
        alert('Sign in to access Google Calendar events.');
        return;
      }

      try {
        const calendar = await listUpcomingEvents();
        const nextState = { ...state, calendarEvents: calendar.items || [] };
        saveState(nextState);
        render(nextState);
      } catch (error) {
        console.error('Unable to load events:', error);
        alert('Unable to load Google events.');
      }
    });
  } else if (state.selectedTab === 'settings') {
    tabContent.innerHTML = `
      <div class="section-row">
        <div>
          <h2>Settings</h2>
          <p class="small">Maintain ingredients, measurements, folders, and Google Drive sync.</p>
        </div>
      </div>

      <div class="settings-grid">
        <div class="card small-card">
          <h3>Ingredients</h3>
          <ul>${state.ingredients.length ? state.ingredients.map((ingredient) => `<li>${ingredient.name}${ingredient.aliases?.length ? ` (${ingredient.aliases.join(', ')})` : ''} • ${ingredient.caloriesPerGram} kcal/g • density ${ingredient.density}</li>`).join('') : '<li class="small muted">No ingredients defined.</li>'}</ul>
          <form id="ingredient-form">
            <label>Name<input name="name" required /></label>
            <label>Aliases<input name="aliases" placeholder="Separate aliases with commas" /></label>
            <label>Calories per gram<input name="caloriesPerGram" type="number" min="0" step="0.01" value="0.0" /></label>
            <label>Density (g/ml)<input name="density" type="number" min="0" step="0.01" value="1.0" /></label>
            <button type="submit">Add ingredient</button>
          </form>
        </div>

        <div class="card small-card">
          <h3>Measurements</h3>
          <ul>${state.measurements.length ? state.measurements.map((measure) => `<li>${measure.name} • ${measure.ml !== null ? `${measure.ml} ml` : 'gram-based'}</li>`).join('') : '<li class="small muted">No measurements defined.</li>'}</ul>
          <form id="measurement-form">
            <label>Name<input name="name" required placeholder="cup, tbsp, g" /></label>
            <label>ML equivalent<input name="ml" type="number" min="0" step="1" placeholder="Leave blank for gram-based" /></label>
            <button type="submit">Add measurement</button>
          </form>
        </div>

        <div class="card small-card">
          <h3>Folders</h3>
          <ul>${state.folders.length ? state.folders.map((folder) => `<li>${folder.name}</li>`).join('') : '<li class="small muted">No folders defined.</li>'}</ul>
          <form id="folder-settings-form">
            <label>Folder name<input name="folderName" required placeholder="New folder" /></label>
            <button type="submit">Add folder</button>
          </form>
        </div>

        <div class="card small-card">
          <h3>Google Drive</h3>
          <p class="small">${user ? `Connected as ${user.email || user.name}` : 'Not connected'}</p>
          <p class="small">Root app folder: ${state.driveFolders.root || 'Not yet synced'}</p>
          <p class="small">Recipes folder: ${state.driveFolders.recipes || 'Not yet synced'}</p>
          <p class="small">Ingredients folder: ${state.driveFolders.ingredients || 'Not yet synced'}</p>
          <p class="small">Measurements folder: ${state.driveFolders.measurements || 'Not yet synced'}</p>
          <button id="google-sync" class="secondary">Sync recipes to Drive</button>
          <p class="small">${state.driveStatus === 'synced' ? 'Drive sync complete' : 'Sync available'}</p>
        </div>
      </div>
    `;

    document.getElementById('ingredient-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const ingredient = {
        id: crypto.randomUUID(),
        name: formData.get('name').toString().trim(),
        aliases: formData.get('aliases')?.toString().split(',').map((item) => item.trim()).filter(Boolean) || [],
        caloriesPerGram: Number(formData.get('caloriesPerGram') || 0),
        density: Number(formData.get('density') || 1)
      };
      const nextState = { ...state, ingredients: [ingredient, ...state.ingredients] };
      saveState(nextState);
      render(nextState);
    });

    document.getElementById('measurement-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const measurement = {
        id: crypto.randomUUID(),
        name: formData.get('name').toString().trim(),
        ml: formData.get('ml') ? Number(formData.get('ml')) : null
      };
      const nextState = { ...state, measurements: [measurement, ...state.measurements] };
      saveState(nextState);
      render(nextState);
    });

    document.getElementById('folder-settings-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const folderName = formData.get('folderName').toString().trim();
      const nextState = { ...state, folders: [{ id: crypto.randomUUID(), name: folderName }, ...state.folders] };
      saveState(nextState);
      render(nextState);
    });

    document.getElementById('google-sync').addEventListener('click', async () => {
      if (!user) {
        alert('Please sign in with Google before syncing.');
        return;
      }

      try {
        const result = await syncRecipesToDrive(state);
        const nextState = {
          ...state,
          recipes: result.recipes,
          folders: result.folders,
          driveFolders: result.driveFolders,
          driveStatus: 'synced'
        };
        saveState(nextState);
        render(nextState);
      } catch (error) {
        console.error('Drive sync failed:', error);
        alert('Unable to sync with Google Drive.');
      }
    });
  }
}

function renderRecipeList(state) {
  return `
    <div class="recipe-grid">
      ${state.recipes.map((recipe) => {
        const nutrition = calculateRecipeNutrition(recipe, recipe.baseYield || 1);
        return `
          <article class="recipe-card" data-id="${recipe.id}">
            <div class="row card-top-row">
              <div>
                <h3>${recipe.title}</h3>
                <p class="small">${recipe.category || 'Uncategorized'} • ${getFolderName(state, recipe.folderId)}</p>
              </div>
              <span class="badge">${Math.round(nutrition.perServing)} kcal</span>
            </div>
            <p class="small">${recipe.instructions || 'No instructions yet.'}</p>
            <ul>${(recipe.ingredients || []).map((item) => `<li>${item.quantity} ${item.unit} ${item.name}</li>`).join('')}</ul>
          </article>
        `;
      }).join('')}
    </div>

    <div class="grid">
      <div class="card small-card">
        <h3>Add Recipe</h3>
        <form id="recipe-form">
          <label>Title<input name="title" required /></label>
          <label>Category<input name="category" placeholder="Dinner, Breakfast, Snack" /></label>
          <label>Yield<input name="baseYield" type="number" min="1" value="4" /></label>
          <label>Folder<select name="folderId">
            ${state.folders.map((folder) => `<option value="${folder.id}">${folder.name}</option>`).join('')}
          </select></label>
          <label>Instructions<textarea name="instructions"></textarea></label>
          <label>Ingredient<select name="ingredientId">
            <option value="">Use custom ingredient</option>
            ${state.ingredients.map((ingredient) => `<option value="${ingredient.id}">${ingredient.name}</option>`).join('')}
          </select></label>
          <label>Ingredient name<input name="ingredientName" placeholder="Ingredient name" /></label>
          <label>Ingredient aliases<input name="ingredientAliases" placeholder="chickpeas, garbanzo beans" /></label>
          <label>Quantity<input name="ingredientQuantity" type="number" min="0" step="0.25" value="1" /></label>
          <label>Unit<select name="ingredientUnit">
            ${state.measurements.map((measure) => `<option value="${measure.name}">${measure.name}</option>`).join('')}
          </select></label>
          <label>Calories per gram<input name="ingredientCalories" type="number" min="0" step="0.01" value="0.3" /></label>
          <label>Density (g/ml)<input name="ingredientDensity" type="number" min="0" step="0.01" value="1.0" /></label>
          <div class="row">
            <button type="submit">Save recipe</button>
            <button type="button" class="secondary" id="reset-state">Reset demo</button>
          </div>
        </form>
      </div>

      <div class="card small-card">
        <h3>Create Folder</h3>
        <form id="folder-form">
          <label>Folder name<input name="folderName" required placeholder="Recipe folder" /></label>
          <button type="submit">Add folder</button>
        </form>
        <h4>Folders</h4>
        <ul>${state.folders.map((folder) => `<li>${folder.name}</li>`).join('')}</ul>
      </div>
    </div>
  `;
}

function renderRecipeDetail(state) {
  const recipe = state.recipes.find((item) => item.id === state.selectedRecipeId);
  if (!recipe) {
    return '<p class="small muted">Recipe not found.</p>';
  }

  const nutrition = calculateRecipeNutrition(recipe, recipe.baseYield || 1);

  return `
    <div class="detail-view">
      <button id="back-to-list" class="secondary">← Back to recipes</button>
      <div class="section-row">
        <div>
          <h2>${recipe.title}</h2>
          <p class="small">${recipe.category || 'Uncategorized'} • ${getFolderName(state, recipe.folderId)}</p>
        </div>
        <span class="badge">${Math.round(nutrition.perServing)} kcal/serving</span>
      </div>
      <p>${recipe.instructions || 'No instructions provided.'}</p>
      <div class="row">
        <div>
          <h3>Ingredients</h3>
          <ul>${(recipe.ingredients || []).map((item) => `<li>${item.quantity} ${item.unit} ${item.name}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Nutrition</h3>
          <p class="small">Total calories: ${nutrition.calories}</p>
          <p class="small">Per serving: ${nutrition.perServing}</p>
        </div>
      </div>
    </div>
  `;
}

function renderGoogleEvents(state) {
  if (!state.calendarEvents || state.calendarEvents.length === 0) {
    return '<p class="small muted">No Google Calendar events loaded.</p>';
  }

  return state.calendarEvents.map((event) => {
    const date = event.start?.date || event.start?.dateTime || 'Unknown date';
    return `<div class="event-card"><strong>${event.summary || 'Untitled event'}</strong><div class="small">${date}</div></div>`;
  }).join('');
}

let state = loadState();

handleRedirectCallback(GOOGLE_CLIENT_ID, REDIRECT_URI)
  .then(() => {
    state = loadState();
    render(state);
  })
  .catch((error) => {
    console.error('Google auth callback failed:', error);
    render(state);
  });

render(state);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error);
  });
}
