import './styles.css';
import { calculateRecipeNutrition, calculateScaledIngredients, convertIngredientUnits } from './models/Recipe.js';
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
  selectedFolderId: 'all',
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
    selectedFolderId: saved.selectedFolderId ?? initialState.selectedFolderId,
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

function escapeHtml(text) {
  return text?.toString().replace(/[&"'<>]/g, (char) => ({
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
    '<': '&lt;',
    '>': '&gt;'
  }[char])) || '';
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

function filterRecipesByFolder(state) {
  return state.selectedFolderId === 'all'
    ? state.recipes
    : state.recipes.filter((recipe) => recipe.folderId === state.selectedFolderId);
}

function getRecipeCountForFolder(state, folderId) {
  return state.recipes.filter((recipe) => recipe.folderId === folderId).length;
}

function findRecipe(state, recipeId) {
  return state.recipes.find((recipe) => recipe.id === recipeId);
}

function updateRecipe(state, updatedRecipe) {
  return {
    ...state,
    recipes: state.recipes.map((recipe) => (recipe.id === updatedRecipe.id ? updatedRecipe : recipe))
  };
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

      document.getElementById('recipe-edit-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const recipe = findRecipe(state, state.selectedRecipeId);
        const updatedRecipe = {
          ...recipe,
          title: formData.get('title').toString().trim(),
          category: formData.get('category').toString().trim(),
          baseYield: Number(formData.get('baseYield') || 1),
          instructions: formData.get('instructions').toString().trim(),
          folderId: formData.get('folderId').toString(),
          ingredients: Array.from(form.querySelectorAll('.ingredient-row')).map((row) => {
            const ingredientName = row.querySelector('[name="ingredientName"]').value.trim() || 'Ingredient';
            const quantity = Number(row.querySelector('[name="ingredientQuantity"]').value || 0);
            const unit = row.querySelector('[name="ingredientUnit"]').value;
            const caloriesPerGram = Number(row.querySelector('[name="ingredientCalories"]').value || 0);
            const density = Number(row.querySelector('[name="ingredientDensity"]').value || 1);
            return {
              id: row.dataset.id || crypto.randomUUID(),
              ingredientId: row.dataset.ingredientId || `custom-${crypto.randomUUID()}`,
              name: ingredientName,
              quantity,
              unit,
              ingredient: { name: ingredientName, caloriesPerGram, density }
            };
          })
        };

        let nextState = updateRecipe(state, updatedRecipe);
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

      document.getElementById('add-ingredient').addEventListener('click', () => {
        const container = document.getElementById('ingredient-rows');
        const row = document.createElement('div');
        row.className = 'ingredient-row';
        row.dataset.id = crypto.randomUUID();
        row.dataset.ingredientId = '';
        row.innerHTML = `
          <input name="ingredientName" placeholder="Ingredient name" required />
          <input name="ingredientQuantity" type="number" min="0" step="0.01" value="0" />
          <select name="ingredientUnit">${state.measurements.map((measure) => `<option value="${measure.name}">${measure.name}</option>`).join('')}</select>
          <input name="ingredientCalories" type="number" min="0" step="0.01" value="0" />
          <input name="ingredientDensity" type="number" min="0" step="0.01" value="1" />
          <button type="button" class="danger remove-ingredient">Remove</button>
        `;
        container.appendChild(row);
        row.querySelector('.remove-ingredient').addEventListener('click', () => row.remove());
      });

      document.querySelectorAll('.remove-ingredient').forEach((button) => {
        button.addEventListener('click', () => {
          button.closest('.ingredient-row')?.remove();
        });
      });

      document.getElementById('scale-recipe').addEventListener('click', () => {
        const targetYield = Number(document.getElementById('scale-yield').value || 1);
        if (targetYield <= 0) {
          return;
        }
        const recipe = findRecipe(state, state.selectedRecipeId);
        const scaledIngredients = calculateScaledIngredients(recipe, targetYield);
        const nextState = updateRecipe(state, { ...recipe, baseYield: targetYield, ingredients: scaledIngredients });
        saveState(nextState);
        render(nextState);
      });

      document.getElementById('convert-recipe').addEventListener('click', () => {
        const targetUnit = document.getElementById('convert-unit').value;
        const recipe = findRecipe(state, state.selectedRecipeId);
        const convertedRecipe = convertIngredientUnits(recipe, targetUnit);
        const nextState = updateRecipe(state, convertedRecipe);
        saveState(nextState);
        render(nextState);
      });

      document.getElementById('delete-recipe').addEventListener('click', () => {
        if (!confirm('Delete this recipe?')) {
          return;
        }
        const nextState = {
          ...state,
          recipes: state.recipes.filter((recipe) => recipe.id !== state.selectedRecipeId),
          selectedRecipeId: null
        };
        saveState(nextState);
        render(nextState);
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
  const filteredRecipes = filterRecipesByFolder(state);

  return `
    <div class="recipe-tab-layout">
      <aside class="folder-column card">
        <div class="folder-sidebar">
          <h3>Folders</h3>
          <button type="button" class="folder-filter${state.selectedFolderId === 'all' ? ' active' : ''}" data-folder-id="all">All recipes (${state.recipes.length})</button>
          ${state.folders.map((folder) => `
            <div class="folder-drop-target${state.selectedFolderId === folder.id ? ' active' : ''}" data-folder-id="${folder.id}">
              <button type="button" class="folder-filter">${folder.name} (${getRecipeCountForFolder(state, folder.id)})</button>
            </div>
          `).join('')}
          <p class="small">Drag a recipe card onto a folder to move it.</p>
        </div>
      </aside>

      <main class="recipe-column">
        <div class="recipe-grid">
          ${filteredRecipes.length ? filteredRecipes.map((recipe) => {
            const nutrition = calculateRecipeNutrition(recipe, recipe.baseYield || 1);
            return `
              <article class="recipe-card" draggable="true" data-id="${recipe.id}">
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
          }).join('') : '<p class="small muted">No recipes in this folder.</p>'}
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
      </main>
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
    <div class="recipe-detail-layout">
      <aside class="card detail-sidebar">
        <h3>${escapeHtml(recipe.title)}</h3>
        <p class="small">${escapeHtml(recipe.category || 'Uncategorized')}</p>
        <p class="small">Folder: ${escapeHtml(getFolderName(state, recipe.folderId))}</p>
        <p class="small">Yield: ${recipe.baseYield}</p>
        <p class="small">Per serving: ${Math.round(nutrition.perServing)} kcal</p>
        <div class="row">
          <button type="button" id="delete-recipe" class="danger">Delete</button>
        </div>
        <div class="card small-card">
          <h4>Scale recipe</h4>
          <label>Target yield<input id="scale-yield" type="number" min="1" value="${recipe.baseYield}" /></label>
          <button type="button" id="scale-recipe">Apply scale</button>
        </div>
        <div class="card small-card">
          <h4>Convert units</h4>
          <label>Target unit<select id="convert-unit">
            ${state.measurements.map((measure) => `<option value="${measure.name}">${measure.name}</option>`).join('')}
          </select></label>
          <button type="button" id="convert-recipe">Convert</button>
        </div>
      </aside>

      <main class="card detail-main">
        <button id="back-to-list" class="secondary">← Back to recipes</button>
        <form id="recipe-edit-form">
          <div class="section-row">
            <div>
              <label>Title<input name="title" value="${escapeHtml(recipe.title)}" required /></label>
              <label>Category<input name="category" value="${escapeHtml(recipe.category)}" /></label>
              <label>Yield<input name="baseYield" type="number" min="1" value="${recipe.baseYield}" /></label>
              <label>Folder<select name="folderId">
                ${state.folders.map((folder) => `<option value="${folder.id}"${folder.id === recipe.folderId ? ' selected' : ''}>${escapeHtml(folder.name)}</option>`).join('')}
              </select></label>
            </div>
          </div>

          <label>Instructions<textarea name="instructions">${escapeHtml(recipe.instructions)}</textarea></label>
          <div id="ingredient-rows">
            ${(recipe.ingredients || []).map((item) => `
              <div class="ingredient-row" data-id="${item.id}" data-ingredient-id="${item.ingredientId}">
                <input name="ingredientName" value="${escapeHtml(item.name)}" placeholder="Ingredient name" required />
                <input name="ingredientQuantity" type="number" min="0" step="0.01" value="${item.quantity}" />
                <select name="ingredientUnit">${state.measurements.map((measure) => `<option value="${measure.name}"${measure.name === item.unit ? ' selected' : ''}>${measure.name}</option>`).join('')}</select>
                <input name="ingredientCalories" type="number" min="0" step="0.01" value="${item.ingredient?.caloriesPerGram || 0}" />
                <input name="ingredientDensity" type="number" min="0" step="0.01" value="${item.ingredient?.density || 1}" />
                <button type="button" class="danger remove-ingredient">Remove</button>
              </div>
            `).join('')}
          </div>
          <button type="button" id="add-ingredient" class="secondary">Add ingredient</button>
          <div class="row" style="margin-top:18px; gap:12px;">
            <button type="submit">Save changes</button>
            <button type="button" class="secondary" id="back-to-list-mobile">Cancel</button>
          </div>
        </form>
      </main>
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
