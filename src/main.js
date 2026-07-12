import './styles.css';
import {
  calculateRecipeNutrition,
  calculateScaledIngredients,
  convertGramsToUnit,
  convertToGrams
} from './models/Recipe.js';
import {
  signIn,
  handleRedirectCallback,
  getIdTokenClaims,
  signOut
} from './auth/googleAuth.js';
import { syncRecipesToDrive } from './api/googleDrive.js';
import { createMealEvent, listUpcomingEvents } from './api/googleCalendar.js';

const STORAGE_KEY = 'recipe-app-state-v2';
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
      instructions: 'Cook beans, combine rice, and serve with a squeeze of lime.',
      folderId: 'folder-unsorted',
      ingredients: [
        {
          id: crypto.randomUUID(),
          ingredientId: 'ing-beans',
          name: 'Black beans',
          grams: 240,
          displayUnit: 'cup',
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
          grams: 180,
          displayUnit: 'cup',
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
    { id: 'm-g', name: 'g', ml: 1 },
    { id: 'm-ml', name: 'ml', ml: 1 },
    { id: 'm-cup', name: 'cup', ml: 240 },
    { id: 'm-tbsp', name: 'tbsp', ml: 15 },
    { id: 'm-tsp', name: 'tsp', ml: 5 },
    { id: 'm-oz', name: 'oz', ml: 29.57 },
    { id: 'm-lb', name: 'lb', ml: 453.59 }
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
  selectedRecipeScale: 2,
  calendarEvents: []
};

function normalizeUnit(unit) {
  return unit?.toString().trim().toLowerCase() || 'g';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (match) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[match];
  });
}

function formatDate(dateString) {
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return dateString;
  }
}

function prepareIngredientLine(item) {
  return {
    ...item,
    grams: item.grams ?? convertToGrams(item.quantity ?? 0, item.unit ?? 'g', item.ingredient || {}),
    displayUnit: item.displayUnit || item.unit || 'g',
    ingredient: item.ingredient || { name: item.name, caloriesPerGram: 0, density: 1 }
  };
}

function normalizeState(saved) {
  const normalized = {
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
    selectedRecipeId: saved.selectedRecipeId ?? initialState.selectedRecipeId,
    selectedRecipeScale: saved.selectedRecipeScale ?? initialState.selectedRecipeScale,
    calendarEvents: saved.calendarEvents ?? initialState.calendarEvents
  };

  normalized.recipes = normalized.recipes.map((recipe) => ({
    ...recipe,
    ingredients: (recipe.ingredients || []).map(prepareIngredientLine)
  }));

  return normalized;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return normalizeState({});
    }
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.warn('Unable to load state', error);
    return normalizeState({});
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getFolderName(state, folderId) {
  return state.folders.find((folder) => folder.id === folderId)?.name || 'Unsorted';
}

function filterRecipesByFolder(state) {
  if (state.selectedFolderId === 'all') {
    return state.recipes;
  }
  return state.recipes.filter((recipe) => recipe.folderId === state.selectedFolderId);
}

function selectedRecipe(state) {
  return state.recipes.find((recipe) => recipe.id === state.selectedRecipeId) || null;
}

function getRecipeCountForFolder(state, folderId) {
  return state.recipes.filter((recipe) => recipe.folderId === folderId).length;
}

function createIngredientLinesHtml(recipe, state, previewScale) {
  return (recipe.ingredients || []).map((item) => {
    const scale = previewScale || recipe.baseYield || 1;
    const scaledGrams = (item.grams || 0) * (scale / (recipe.baseYield || 1));
    const displayCount = convertGramsToUnit(scaledGrams, item.displayUnit, item.ingredient);
    return `
      <div class="ingredient-row" data-id="${item.id}" data-ingredient-id="${item.ingredientId || ''}">
        <div class="ingredient-main">
          <input name="ingredientName" value="${escapeHtml(item.name)}" placeholder="Ingredient" />
          <div class="row ingredient-meta-row">
            <label>
              <span class="label-text">Grams</span>
              <input name="grams" type="number" min="0" step="1" value="${item.grams}" />
            </label>
            <label>
              <span class="label-text">Display</span>
              <select name="displayUnit">
                ${state.measurements.map((measure) => `<option value="${measure.name}"${measure.name === item.displayUnit ? ' selected' : ''}>${escapeHtml(measure.name)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span class="label-text">kcal/g</span>
              <input name="ingredientCalories" type="number" min="0" step="0.01" value="${Number(item.ingredient?.caloriesPerGram || 0)}" />
            </label>
          </div>
        </div>
        <div class="ingredient-row-foot">
          <span class="small">Preview: ${Number(displayCount.toFixed(2))} ${escapeHtml(item.displayUnit)}</span>
          <button type="button" class="danger remove-ingredient">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

function render(state) {
  const app = document.getElementById('app');
  const user = getIdTokenClaims();

  app.innerHTML = `
    <div class="app-shell">
      <nav class="app-nav">
        <div class="brand">
          <h1>Recipe Planner</h1>
        </div>
        <div class="nav-links">
          <button class="nav-button${state.selectedTab === 'recipes' ? ' active' : ''}" data-tab="recipes">Recipes</button>
          <button class="nav-button${state.selectedTab === 'calendar' ? ' active' : ''}" data-tab="calendar">Calendar</button>
          <button class="nav-button${state.selectedTab === 'settings' ? ' active' : ''}" data-tab="settings">Settings</button>
        </div>
        <div class="nav-footer">
          ${user ? `<div class="user-badge">${escapeHtml(user.email || user.name || 'Signed in')}</div><button id="sign-out" class="secondary">Sign out</button>` : '<button id="sign-in" class="primary">Sign in with Google</button>'}
        </div>
      </nav>
      <main class="app-main">
        <header class="app-header">
          <div>
            <h2>${state.selectedTab === 'recipes' ? 'Recipes' : state.selectedTab === 'calendar' ? 'Calendar' : 'Settings'}</h2>
            <p class="small">${state.selectedTab === 'recipes' ? 'Organize, edit, and preview recipes with grams-first storage.' : state.selectedTab === 'calendar' ? 'Plan meals and sync events to Google Calendar.' : 'Manage ingredients, folders, and sync settings.'}</p>
          </div>
          <div>${user ? '<span class="pill">Google connected</span>' : '<span class="pill muted">Offline mode</span>'}</div>
        </header>
        <section id="tab-content" class="content-panel"></section>
      </main>
    </div>
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

  document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => {
      render({ ...state, selectedTab: button.dataset.tab, selectedRecipeId: null });
    });
  });

  renderTabContent(state);
}

function renderTabContent(state) {
  const tabContent = document.getElementById('tab-content');

  if (state.selectedTab === 'recipes') {
    tabContent.innerHTML = renderRecipesPage(state);
    attachRecipeEvents(state);
    attachRecipeFormEvents(state);
  } else if (state.selectedTab === 'calendar') {
    tabContent.innerHTML = renderCalendarPage(state);
    attachCalendarEvents(state);
  } else if (state.selectedTab === 'settings') {
    tabContent.innerHTML = renderSettingsPage(state);
    attachSettingsEvents(state);
  }
}

function renderRecipesPage(state) {
  const activeFolder = state.selectedFolderId === 'all' ? 'All recipes' : getFolderName(state, state.selectedFolderId);
  const filteredRecipes = filterRecipesByFolder(state);
  const recipeCount = filteredRecipes.length;

  return `
    <div class="recipes-page">
      <aside class="recipe-sidebar card">
        <div class="panel-title">Folders</div>
        <div class="folder-list">
          <button class="folder-button${state.selectedFolderId === 'all' ? ' active' : ''}" data-folder-id="all">All recipes (${state.recipes.length})</button>
          ${state.folders.map((folder) => `
            <button class="folder-button${state.selectedFolderId === folder.id ? ' active' : ''}" data-folder-id="${folder.id}">
              ${escapeHtml(folder.name)} (${getRecipeCountForFolder(state, folder.id)})
            </button>
          `).join('')}
        </div>
        <form id="folder-form" class="compact-form folder-form">
          <label>
            <span class="label-text">New folder</span>
            <input name="folderName" placeholder="Folder name" />
          </label>
          <button type="submit" class="secondary">Add folder</button>
        </form>
      </aside>

      <section class="recipe-list-panel">
        <div class="panel-row">
          <div>
            <div class="panel-title">${escapeHtml(activeFolder)}</div>
            <p class="small">${recipeCount} recipe${recipeCount === 1 ? '' : 's'} in this view.</p>
          </div>
          <button id="reset-state" class="secondary">Reset demo</button>
        </div>

        <div class="cards-grid">
          ${filteredRecipes.length ? filteredRecipes.map((recipe) => renderRecipeCard(recipe, state)).join('') : '<div class="empty-state card"><p>No recipes in this folder yet. Add one from the form below.</p></div>'}
        </div>

        <div class="card add-card">
          <div class="panel-title">New recipe</div>
          <form id="recipe-form" class="compact-form">
            <label>
              <span class="label-text">Recipe title</span>
              <input name="title" placeholder="Recipe title" required />
            </label>
            <div class="row wrap-gap">
              <label>
                <span class="label-text">Category</span>
                <input name="category" placeholder="Category" />
              </label>
              <label>
                <span class="label-text">Base servings</span>
                <input name="baseYield" type="number" min="1" value="2" placeholder="Servings" />
              </label>
            </div>
            <label>
              <span class="label-text">Instructions</span>
              <textarea name="instructions" placeholder="Write the recipe instructions here..."></textarea>
            </label>
            <div class="panel-title small">Primary ingredient</div>
            <div class="row wrap-gap">
              <label>
                <span class="label-text">Ingredient</span>
                <input name="ingredientName" placeholder="Ingredient name" />
              </label>
              <label>
                <span class="label-text">Grams</span>
                <input name="ingredientGrams" type="number" min="0" step="1" value="100" placeholder="Grams" />
              </label>
              <label>
                <span class="label-text">Display unit</span>
                <select name="ingredientUnit">${state.measurements.map((measure) => `<option value="${measure.name}">${escapeHtml(measure.name)}</option>`).join('')}</select>
              </label>
              <label>
                <span class="label-text">kcal/g</span>
                <input name="ingredientCalories" type="number" min="0" step="0.01" value="0.34" placeholder="0.34" />
              </label>
              <label>
                <span class="label-text">Density</span>
                <input name="ingredientDensity" type="number" min="0.01" step="0.01" value="1" placeholder="g/ml" />
              </label>
            </div>
            <button type="submit" class="primary">Create recipe</button>
          </form>
        </div>
      </section>

      <aside class="recipe-detail-aside card">
        ${state.selectedRecipeId ? renderRecipeDetail(state) : '<div class="empty-state"><h3>Recipe preview</h3><p>Select a recipe card to edit it quickly, then scale without changing the base recipe.</p></div>'}
      </aside>
    </div>
  `;
}

function renderRecipeCard(recipe, state) {
  const nutrition = calculateRecipeNutrition(recipe, recipe.baseYield || 1);
  const ingredientPreview = recipe.ingredients.slice(0, 3).map((item) => `${Math.round(convertGramsToUnit(item.grams || 0, item.displayUnit || 'g', item.ingredient))} ${escapeHtml(item.displayUnit || 'g')} ${escapeHtml(item.name)}`).join(' • ');

  return `
    <article class="recipe-card" draggable="true" data-id="${recipe.id}">
      <div class="card-top">
        <strong>${escapeHtml(recipe.title)}</strong>
        <span class="badge">${Math.round(nutrition.perServing)} kcal</span>
      </div>
      <div class="card-meta">
        <span>${escapeHtml(recipe.category || 'Uncategorized')}</span>
        <span>${escapeHtml(getFolderName(state, recipe.folderId))}</span>
      </div>
      <p class="tiny">${escapeHtml(recipe.instructions || 'No instructions yet.')}</p>
      <div class="ingredient-teaser">${ingredientPreview}</div>
    </article>
  `;
}

function renderRecipeDetail(state) {
  const recipe = selectedRecipe(state);
  if (!recipe) {
    return '<div class="empty-state"><p>Recipe not found.</p></div>';
  }

  const previewScale = state.selectedRecipeScale || recipe.baseYield || 1;
  const previewIngredients = calculateScaledIngredients(recipe, previewScale);
  const nutrition = calculateRecipeNutrition(recipe, previewScale);

  return `
    <div class="detail-top">
      <div>
        <div class="panel-title">${escapeHtml(recipe.title)}</div>
        <p class="small">Folder: ${escapeHtml(getFolderName(state, recipe.folderId))}</p>
      </div>
      <span class="badge">${Math.round(nutrition.perServing)} kcal/s</span>
    </div>
    <form id="recipe-edit-form" class="recipe-detail-form">
      <label class="hero-input-label">
        <input class="hero-input" name="title" value="${escapeHtml(recipe.title)}" placeholder="Recipe title" />
      </label>
      <div class="row wrap-gap detail-meta-row">
        <label>
          <span class="label-text">Category</span>
          <input name="category" value="${escapeHtml(recipe.category)}" placeholder="Category" />
        </label>
        <label>
          <span class="label-text">Base servings</span>
          <input name="baseYield" type="number" min="1" value="${recipe.baseYield}" />
        </label>
        <label>
          <span class="label-text">Folder</span>
          <select name="folderId">${state.folders.map((folder) => `<option value="${folder.id}"${folder.id === recipe.folderId ? ' selected' : ''}>${escapeHtml(folder.name)}</option>`).join('')}</select>
        </label>
      </div>
      <label>
        <span class="label-text">Instructions</span>
        <textarea name="instructions" placeholder="Write steps, notes, and serving ideas...">${escapeHtml(recipe.instructions)}</textarea>
      </label>

      <div class="panel-title">Ingredients</div>
      <div id="ingredient-rows">${createIngredientLinesHtml(recipe, state, previewScale)}</div>
      <button type="button" id="add-ingredient" class="secondary">+ Add ingredient</button>

      <div class="panel-title">Preview ingredients</div>
      <div class="preview-list">
        ${previewIngredients.map((item) => `
          <div class="preview-item">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${Math.round(convertGramsToUnit(item.scaledGrams, item.displayUnit || 'g', item.ingredient))} ${escapeHtml(item.displayUnit || 'g')}</span>
          </div>
        `).join('')}
      </div>

      <div class="panel-title">Scale preview</div>
      <div class="field-row">
        <label>
          <span class="label-text">Preview servings</span>
          <input id="detail-scale" type="number" min="1" value="${previewScale}" />
        </label>
        <div class="preview-summary">${Math.round(nutrition.calories)} kcal total · ${Math.round(nutrition.perServing)} kcal / serving</div>
      </div>

      <div class="detail-actions">
        <button type="submit" class="primary">Save changes</button>
        <button type="button" id="delete-recipe" class="danger">Delete</button>
      </div>
    </form>
  `;
}

function renderCalendarPage(state) {
  return `
    <div class="calendar-page">
      <div class="card compact-card">
        <div class="panel-title">Plan a meal</div>
        <form id="plan-form" class="compact-form">
          <input name="date" type="date" required />
          <select name="recipeId">${state.recipes.map((recipe) => `<option value="${recipe.id}">${escapeHtml(recipe.title)}</option>`).join('')}</select>
          <input name="servings" type="number" min="1" value="2" />
          <button type="submit" class="primary">Add meal plan</button>
        </form>
      </div>
      <div class="card compact-card">
        <div class="panel-title">Google Calendar</div>
        <button id="load-google-events" class="secondary">Load Calendar events</button>
        <div class="event-list">${renderGoogleEvents(state)}</div>
      </div>
      <div class="card">
        <div class="panel-title">Planned meals</div>
        <ul>${state.plan.length ? state.plan.map((entry) => {
          const recipe = state.recipes.find((item) => item.id === entry.recipeId);
          return `<li>${formatDate(entry.date)} � ${escapeHtml(recipe?.title || 'Recipe')} (${entry.servings} servings) ${entry.calendarEventId ? '<span class="badge">Synced</span>' : ''}</li>`;
        }).join('') : '<li class="small muted">No planned meals yet.</li>'}</ul>
      </div>
    </div>
  `;
}

function renderSettingsPage(state) {
  return `
    <div class="settings-page">
      <div class="card compact-card">
        <div class="panel-title">Ingredients</div>
        <ul>${state.ingredients.length ? state.ingredients.map((ingredient) => `<li>${escapeHtml(ingredient.name)} (${escapeHtml((ingredient.aliases || []).join(', '))}) � ${ingredient.caloriesPerGram} kcal/g</li>`).join('') : '<li class="small muted">No ingredients defined.</li>'}</ul>
      </div>
      <div class="card compact-card">
        <div class="panel-title">Measurements</div>
        <ul>${state.measurements.length ? state.measurements.map((measure) => `<li>${escapeHtml(measure.name)} � ${measure.ml !== null ? `${measure.ml} ml` : 'gram-based'}</li>`).join('') : '<li class="small muted">No measurements defined.</li>'}</ul>
      </div>
      <div class="card compact-card">
        <div class="panel-title">Drive sync</div>
        <button id="google-sync" class="primary">Sync recipes to Drive</button>
        <p class="small">${state.driveStatus === 'synced' ? 'Drive sync complete' : 'Not synced yet'}</p>
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
    return `<div class="event-card"><strong>${escapeHtml(event.summary || 'Untitled event')}</strong><div class="small">${escapeHtml(date)}</div></div>`;
  }).join('');
}

function attachRecipeEvents(state) {
  document.querySelectorAll('.recipe-card').forEach((card) => {
    card.addEventListener('click', () => {
      render({ ...state, selectedRecipeId: card.dataset.id, selectedRecipeScale: selectedRecipe(state)?.baseYield || 1 });
    });
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', card.dataset.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  document.querySelectorAll('.folder-button').forEach((button) => {
    button.addEventListener('click', () => {
      render({ ...state, selectedFolderId: button.dataset.folderId, selectedRecipeId: null });
    });
  });

  document.querySelectorAll('.folder-drop-zone').forEach((zone) => {
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('drag-over');
      const recipeId = event.dataTransfer.getData('text/plain');
      const folderId = zone.dataset.folderId;
      if (!recipeId || !folderId) {
        return;
      }
      const nextState = {
        ...state,
        recipes: state.recipes.map((recipe) => (recipe.id === recipeId ? { ...recipe, folderId } : recipe))
      };
      saveState(nextState);
      render(nextState);
    });
  });

  const recipeForm = document.getElementById('recipe-form');
  if (recipeForm) {
    recipeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(recipeForm);
      const ingredientName = formData.get('ingredientName')?.toString().trim() || 'Ingredient';
      const ingredient = {
        name: ingredientName,
        caloriesPerGram: Number(formData.get('ingredientCalories') || 0),
        density: Number(formData.get('ingredientDensity') || 1)
      };
      const recipe = {
        id: crypto.randomUUID(),
        title: formData.get('title')?.toString().trim() || 'New recipe',
        category: formData.get('category')?.toString().trim() || 'Uncategorized',
        baseYield: Number(formData.get('baseYield') || 1),
        instructions: formData.get('instructions')?.toString().trim(),
        folderId: formData.get('folderId')?.toString() || state.folders[0]?.id,
        ingredients: [
          {
            id: crypto.randomUUID(),
            ingredientId: formData.get('ingredientId')?.toString() || `custom-${crypto.randomUUID()}`,
            name: ingredientName,
            grams: Number(formData.get('ingredientGrams') || 0),
            displayUnit: formData.get('ingredientUnit')?.toString() || 'g',
            ingredient
          }
        ]
      };

      let nextState = { ...state, recipes: [recipe, ...state.recipes] };
      saveState(nextState);
      if (getIdTokenClaims()) {
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
  }

  const folderForm = document.getElementById('folder-form');
  if (folderForm) {
    folderForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(folderForm);
      const folderName = formData.get('folderName')?.toString().trim();
      if (!folderName) return;
      const nextState = { ...state, folders: [{ id: crypto.randomUUID(), name: folderName }, ...state.folders] };
      saveState(nextState);
      render(nextState);
    });
  }

  const resetButton = document.getElementById('reset-state');
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      saveState(initialState);
      render(loadState());
    });
  }
}

function attachRecipeFormEvents(state) {
  const detailForm = document.getElementById('recipe-edit-form');
  if (!detailForm) return;

  detailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(detailForm);
    const recipe = selectedRecipe(state);
    if (!recipe) return;

    const updatedRecipe = {
      ...recipe,
      title: formData.get('title')?.toString().trim() || recipe.title,
      category: formData.get('category')?.toString().trim() || recipe.category,
      baseYield: Number(formData.get('baseYield') || recipe.baseYield),
      instructions: formData.get('instructions')?.toString().trim() || recipe.instructions,
      folderId: formData.get('folderId')?.toString() || recipe.folderId,
      ingredients: Array.from(detailForm.querySelectorAll('.ingredient-row')).map((row) => ({
        id: row.dataset.id || crypto.randomUUID(),
        ingredientId: row.dataset.ingredientId || `custom-${crypto.randomUUID()}`,
        name: row.querySelector('[name="ingredientName"]').value.trim() || 'Ingredient',
        grams: Number(row.querySelector('[name="grams"]').value || 0),
        displayUnit: row.querySelector('[name="displayUnit"]').value,
        ingredient: {
          name: row.querySelector('[name="ingredientName"]').value.trim() || 'Ingredient',
          caloriesPerGram: Number(row.querySelector('[name="ingredientCalories"]').value || 0),
          density: Number(row.querySelector('[name="ingredientDensity"]').value || 1)
        }
      }))
    };

    let nextState = {
      ...state,
      recipes: state.recipes.map((item) => (item.id === updatedRecipe.id ? updatedRecipe : item)),
      selectedRecipeScale: Number(formData.get('detail-scale') || updatedRecipe.baseYield)
    };

    saveState(nextState);
    if (getIdTokenClaims()) {
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

  detailForm.querySelectorAll('.remove-ingredient').forEach((button) => {
    button.addEventListener('click', () => {
      button.closest('.ingredient-row')?.remove();
    });
  });

  const addButton = document.getElementById('add-ingredient');
  if (addButton) {
    addButton.addEventListener('click', () => {
      const container = document.getElementById('ingredient-rows');
      if (!container) return;
      const row = document.createElement('div');
      row.className = 'ingredient-row';
      row.dataset.id = crypto.randomUUID();
      row.dataset.ingredientId = `custom-${crypto.randomUUID()}`;
      row.innerHTML = `
        <div class="ingredient-main">
          <input name="ingredientName" placeholder="Ingredient" />
          <input name="grams" type="number" min="0" step="1" value="0" />
          <select name="displayUnit">${state.measurements.map((measure) => `<option value="${measure.name}">${escapeHtml(measure.name)}</option>`).join('')}</select>
        </div>
        <div class="ingredient-meta">
          <label>
            <span class="label-text">kcal/g</span>
            <input name="ingredientCalories" type="number" min="0" step="0.01" value="0" />
          </label>
          <label>
            <span class="label-text">Density</span>
            <input name="ingredientDensity" type="number" min="0.01" step="0.01" value="1" />
          </label>
          <span class="small">Preview will update after save.</span>
          <button type="button" class="danger remove-ingredient">Remove</button>
        </div>
      `;
      container.appendChild(row);
      row.querySelector('.remove-ingredient')?.addEventListener('click', () => row.remove());
    });
  }

  const scaleInput = document.getElementById('detail-scale');
  if (scaleInput) {
    scaleInput.addEventListener('input', (event) => {
      const recipe = selectedRecipe(state);
      if (!recipe) return;
      const nextState = { ...state, selectedRecipeScale: Number(event.currentTarget.value) || recipe.baseYield };
      render(nextState);
    });
  }

  const deleteButton = document.getElementById('delete-recipe');
  if (deleteButton) {
    deleteButton.addEventListener('click', () => {
      if (!confirm('Delete this recipe?')) return;
      const nextState = {
        ...state,
        recipes: state.recipes.filter((recipe) => recipe.id !== state.selectedRecipeId),
        selectedRecipeId: null
      };
      saveState(nextState);
      render(nextState);
    });
  }
}

function attachCalendarEvents(state) {
  const planForm = document.getElementById('plan-form');
  if (planForm) {
    planForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(planForm);
      const entry = {
        id: crypto.randomUUID(),
        date: formData.get('date')?.toString(),
        recipeId: formData.get('recipeId')?.toString(),
        servings: Number(formData.get('servings') || 1)
      };
      let nextState = { ...state, plan: [entry, ...state.plan] };
      saveState(nextState);
      if (getIdTokenClaims()) {
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
  }

  const loadButton = document.getElementById('load-google-events');
  if (loadButton) {
    loadButton.addEventListener('click', async () => {
      if (!getIdTokenClaims()) {
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
  }
}

function attachSettingsEvents(state) {
  const syncButton = document.getElementById('google-sync');
  if (syncButton) {
    syncButton.addEventListener('click', async () => {
      if (!getIdTokenClaims()) {
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
