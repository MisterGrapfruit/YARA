import './styles.css';
import { loadDatabaseState, saveDatabaseState } from './data/db.js';
import { recipeFromSchema, recipeToSchema } from './data/schema.js';
import { BUILTIN_UNITS, allUnits, applyVariant, calculateRecipeNutrition, convertGramsToUnit, convertToGrams, formatNumber, recipeYield } from './models/Recipe.js';

const app = document.querySelector('#app');
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const ui = { quickIngredientFor: null, quickAliasFor: null, quickUnitFor: null };

const seed = {
  version: 1,
  ingredients: [
    { id: 'black-beans', name: 'Black beans', aliases: ['black bean'], caloriesPerGram: 1.32, densityGPerMl: 0.73 },
    { id: 'rice', name: 'Rice, cooked', aliases: ['white rice'], caloriesPerGram: 1.30, densityGPerMl: 0.66 },
    { id: 'egg', name: 'Egg', aliases: ['large egg'], caloriesPerGram: 1.43, densityGPerMl: 1.03 },
    { id: 'chickpeas', name: 'Chickpeas', aliases: ['garbanzo beans'], caloriesPerGram: 1.64, densityGPerMl: 0.80 }
  ],
  customUnits: [{ id: 'large-can', name: 'large can', kind: 'mass', grams: 439, description: 'Drained large can of beans' }],
  recipes: [{
    id: 'bean-bowl', title: 'Simple bean bowl', category: 'Dinner', tags: ['quick', 'vegetarian'], description: 'A small starter recipe that demonstrates grams-first scaling.',
    yield: { amount: 2, unit: 'servings' },
    instructions: ['Warm the beans and rice.', 'Divide between bowls and season to taste.'],
    ingredients: [
      { id: 'beans-line', ingredientId: 'black-beans', grams: 240, displayUnit: 'cup', note: 'drained' },
      { id: 'rice-line', ingredientId: 'rice', grams: 180, displayUnit: 'cup', note: '' }
    ],
    variants: [{ id: 'chickpea-variant', name: 'Chickpea variation', description: 'Swap the beans for chickpeas.', changes: [{ type: 'replace', baseLineId: 'beans-line', line: { ingredientId: 'chickpeas', grams: 240, displayUnit: 'cup', note: 'drained' } }] }],
    createdAt: now(), updatedAt: now()
  }],
  view: 'recipes', selectedRecipeId: 'bean-bowl', selectedVariantId: '', scaleTarget: 2
};

let state = structuredClone(seed);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function recipeById(recipeId = state.selectedRecipeId) { return state.recipes.find((recipe) => recipe.id === recipeId); }
function ingredientById(ingredientId) { return state.ingredients.find((ingredient) => ingredient.id === ingredientId); }
function ingredientMap() { return new Map(state.ingredients.map((ingredient) => [ingredient.id, ingredient])); }
function unitLabel(unit) { return unit?.name || unit?.id || 'unit'; }
function selectedRecipe() { return recipeById() || state.recipes[0]; }

async function commit(next) {
  state = { ...next, updatedAt: now() };
  await saveDatabaseState(state);
  render();
}

function updateRecipe(recipeId, updater) {
  return commit({ ...state, recipes: state.recipes.map((recipe) => recipe.id === recipeId ? { ...updater(recipe), updatedAt: now() } : recipe) });
}

function setView(view) { commit({ ...state, view, selectedVariantId: '' }); }

function unitOptions(selected, ingredient) {
  return allUnits(state.customUnits, ingredient).map((unit) => `<option value="${escapeHtml(unit.id)}"${unit.id === selected ? ' selected' : ''}>${escapeHtml(unitLabel(unit))}</option>`).join('');
}

function ingredientOptions(selected) {
  return `<option value="">Choose an ingredient</option>${state.ingredients.map((ingredient) => `<option value="${ingredient.id}"${ingredient.id === selected ? ' selected' : ''}>${escapeHtml(ingredient.name)}${ingredient.aliases?.length ? ` — ${escapeHtml(ingredient.aliases.join(', '))}` : ''}</option>`).join('')}`;
}

function lineEditor(line, { recipeId, variantId = '', baseLineId = line.id, isVariant = false } = {}) {
  const ingredient = ingredientById(line.ingredientId) || {};
  const amount = convertGramsToUnit(line.grams || 0, line.displayUnit || 'g', ingredient, state.customUnits);
  const densityMessage = !ingredient.densityGPerMl && ['volume', ''].includes((allUnits(state.customUnits, ingredient).find((unit) => unit.id === line.displayUnit) || {}).kind) ? 'Add density to convert volume.' : '';
  const target = isVariant ? `data-variant-id="${variantId}" data-base-line-id="${baseLineId}"` : `data-line-id="${line.id}"`;
  return `
    <div class="ingredient-line" ${target}>
      <select data-field="ingredientId" aria-label="Ingredient">${ingredientOptions(line.ingredientId)}</select>
      <div class="quantity-control">
        <input data-field="quantity" aria-label="Quantity" type="number" min="0" step="any" value="${escapeHtml(amount.toFixed(3).replace(/\.0+$/, ''))}" />
        <select data-field="displayUnit" aria-label="Unit">${unitOptions(line.displayUnit || 'g', ingredient)}</select>
      </div>
      <input data-field="note" aria-label="Ingredient note" value="${escapeHtml(line.note || '')}" placeholder="optional note" />
      <div class="line-meta"><span>${formatNumber(line.grams)} g canonical</span><span>${formatNumber((line.grams || 0) * (ingredient.caloriesPerGram || 0), 0)} kcal</span>${densityMessage ? `<span class="warning">${densityMessage}</span>` : ''}</div>
      <div class="line-actions">
        <button class="text-button" type="button" data-action="quick-ingredient" data-line-id="${baseLineId}" data-variant-id="${variantId}">New ingredient</button>
        ${line.ingredientId ? `<button class="text-button" type="button" data-action="quick-alias" data-line-id="${baseLineId}" data-variant-id="${variantId}">Add alias</button>` : ''}
        <button class="text-button" type="button" data-action="quick-unit" data-line-id="${baseLineId}" data-variant-id="${variantId}">New unit</button>
        <button class="text-button danger-text" type="button" data-action="${isVariant ? 'delete-variant-change' : 'delete-line'}" data-line-id="${baseLineId}" data-variant-id="${variantId}">Remove</button>
      </div>
      ${renderQuickForms(baseLineId, variantId)}
    </div>`;
}

function renderQuickForms(lineId, variantId) {
  const key = `${variantId}:${lineId}`;
  const forms = [];
  if (ui.quickIngredientFor === key) forms.push(`<form class="quick-form" data-form="quick-ingredient" data-line-id="${lineId}" data-variant-id="${variantId}"><strong>Create ingredient and link it</strong><input name="name" required placeholder="Name (e.g. chickpeas)" /><div class="two-up"><label>kcal / g<input name="caloriesPerGram" type="number" min="0" step="any" value="0" /></label><label>density g / mL<input name="densityGPerMl" type="number" min="0" step="any" value="1" /></label></div><button class="small-button" type="submit">Create & link</button></form>`);
  if (ui.quickAliasFor === key) forms.push(`<form class="quick-form" data-form="quick-alias" data-line-id="${lineId}" data-variant-id="${variantId}"><strong>Add an alternate name</strong><input name="alias" required placeholder="e.g. garbanzo beans" /><button class="small-button" type="submit">Save alias</button></form>`);
  if (ui.quickUnitFor === key) forms.push(`<form class="quick-form" data-form="quick-unit" data-line-id="${lineId}" data-variant-id="${variantId}"><strong>Create a reusable custom unit</strong><input name="name" required placeholder="e.g. large can" /><div class="two-up"><label>Kind<select name="kind"><option value="mass">Mass</option><option value="volume">Volume</option></select></label><label>Equivalent<input name="amount" required type="number" min="0.001" step="any" value="1" /></label></div><button class="small-button" type="submit">Create & use</button></form>`);
  return forms.join('');
}

function renderRecipeEditor() {
  const recipe = selectedRecipe();
  if (!recipe) return '<section class="empty-panel"><h2>No recipes yet</h2><p>Create one to start building your library.</p></section>';
  const activeVariant = recipe.variants?.find((variant) => variant.id === state.selectedVariantId);
  const effective = applyVariant(recipe, activeVariant?.id);
  const nutrition = calculateRecipeNutrition(effective, state.scaleTarget || recipeYield(recipe), state.customUnits, ingredientMap());
  return `<section class="workspace">
    <aside class="recipe-list panel">
      <div class="panel-heading"><div><p class="eyebrow">Library</p><h2>Recipes</h2></div><button class="icon-button" type="button" data-action="new-recipe" title="New recipe">+</button></div>
      <input id="recipe-filter" class="search" placeholder="Filter recipes" aria-label="Filter recipes" />
      <div class="recipe-cards">${state.recipes.map((item) => { const cardNutrition = calculateRecipeNutrition(item, recipeYield(item), state.customUnits, ingredientMap()); return `<button class="recipe-card${item.id === recipe.id ? ' selected' : ''}" data-action="select-recipe" data-recipe-id="${item.id}"><span>${escapeHtml(item.category || 'Unsorted')}</span><strong>${escapeHtml(item.title)}</strong><small>${recipeYield(item)} servings · ${cardNutrition.perServing} kcal each</small></button>`; }).join('')}</div>
    </aside>
    <main class="recipe-editor panel">
      <form data-form="recipe" data-recipe-id="${recipe.id}">
        <div class="editor-title"><div><p class="eyebrow">${activeVariant ? 'Variant preview' : 'Base recipe'}</p><input name="title" class="title-input" value="${escapeHtml(recipe.title)}" placeholder="Recipe name" ${activeVariant ? 'disabled' : ''}/></div><button class="danger-outline" type="button" data-action="delete-recipe" data-recipe-id="${recipe.id}">Delete</button></div>
        <div class="recipe-fields"><label>Category<input name="category" value="${escapeHtml(recipe.category || '')}" placeholder="Dinner" ${activeVariant ? 'disabled' : ''}/></label><label>Tags<input name="tags" value="${escapeHtml((recipe.tags || []).join(', '))}" placeholder="quick, vegetarian" ${activeVariant ? 'disabled' : ''}/></label><label>Yield<input name="yield" type="number" min="0.1" step="any" value="${recipeYield(recipe)}" ${activeVariant ? 'disabled' : ''}/></label><label>Yield unit<input name="yieldUnit" value="${escapeHtml(recipe.yield?.unit || 'servings')}" ${activeVariant ? 'disabled' : ''}/></label></div>
        ${!activeVariant ? `<label class="description-field">Description<textarea name="description" placeholder="A note about this recipe">${escapeHtml(recipe.description || '')}</textarea></label>` : `<div class="variant-note"><strong>${escapeHtml(activeVariant.name)}</strong><span>${escapeHtml(activeVariant.description || 'Only its overrides will be changed below.')}</span></div>`}
        ${!activeVariant ? `<div class="instructions"><div class="section-title"><h3>Method</h3><button class="text-button" type="button" data-action="add-step">Add step</button></div><div id="instruction-lines">${(recipe.instructions || []).map((step, index) => `<div class="instruction-line"><span>${index + 1}</span><textarea data-step-index="${index}" placeholder="Step ${index + 1}">${escapeHtml(step)}</textarea><button type="button" class="text-button danger-text" data-action="delete-step" data-step-index="${index}">Remove</button></div>`).join('')}</div></div>` : ''}
        ${!activeVariant ? `<section class="ingredients"><div class="section-title"><div><h3>Ingredients</h3><p>Change a quantity or unit—the stored amount remains canonical grams.</p></div><button class="secondary-button" type="button" data-action="add-line">Add ingredient</button></div><div id="base-lines">${recipe.ingredients.map((line) => lineEditor(line, { recipeId: recipe.id })).join('')}</div></section>` : renderVariantEditor(recipe, activeVariant)}
        ${!activeVariant ? '<button class="primary-button" type="submit">Save recipe</button>' : ''}
      </form>
      <section class="variants"><div class="section-title"><div><h3>Variations</h3><p>Variations are small patches over this recipe, not duplicate copies.</p></div></div><div class="variant-tabs"><button type="button" data-action="select-variant" data-variant-id="" class="variant-tab${!activeVariant ? ' active' : ''}">Base</button>${(recipe.variants || []).map((variant) => `<button type="button" data-action="select-variant" data-variant-id="${variant.id}" class="variant-tab${activeVariant?.id === variant.id ? ' active' : ''}">${escapeHtml(variant.name)}</button>`).join('')}</div><form data-form="variant" data-recipe-id="${recipe.id}" class="add-variant"><input name="name" required placeholder="New variation, e.g. egg-free" /><input name="description" placeholder="What changes?" /><button class="secondary-button" type="submit">Add variation</button></form></section>
    </main>
    <aside class="preview panel"><p class="eyebrow">Live conversion</p><h2>${formatNumber(nutrition.calories, 0)} kcal</h2><p>${formatNumber(nutrition.perServing, 0)} kcal per serving · ${formatNumber(nutrition.grams, 0)} g total</p><label>Preview yield<input data-action="scale" type="number" min="0.1" step="any" value="${state.scaleTarget || recipeYield(recipe)}" /></label><div class="scaled-list">${nutrition.scaledIngredients.map((line) => { const ingredient = ingredientById(line.ingredientId) || {}; return `<div><strong>${escapeHtml(ingredient.name || 'Unlinked ingredient')}</strong><span>${formatNumber(convertGramsToUnit(line.scaledGrams, line.displayUnit || 'g', ingredient, state.customUnits))} ${escapeHtml(line.displayUnit || 'g')} <small>(${formatNumber(line.scaledGrams, 0)} g)</small></span></div>`; }).join('')}</div><p class="hint">This changes only the preview. Planned servings can later be saved separately.</p></aside>
  </section>`;
}

function renderVariantEditor(recipe, variant) {
  const overridden = new Set((variant.changes || []).filter((change) => change.type !== 'add').map((change) => change.baseLineId));
  const changes = variant.changes || [];
  return `<section class="ingredients"><div class="section-title"><div><h3>${escapeHtml(variant.name)} overrides</h3><p>Replace or remove a base line, or add a new ingredient just for this variation.</p></div><button class="secondary-button" type="button" data-action="add-variant-line" data-variant-id="${variant.id}">Add ingredient</button></div><div class="base-reference">${recipe.ingredients.map((line) => { const ing = ingredientById(line.ingredientId) || {}; return `<div><span>${escapeHtml(ing.name)}</span>${overridden.has(line.id) ? '<small>Overridden</small>' : `<button class="text-button" type="button" data-action="override-line" data-line-id="${line.id}" data-variant-id="${variant.id}">Override</button>`}</div>`; }).join('')}</div><div class="variant-change-lines">${changes.map((change) => change.type === 'remove' ? `<div class="removed-line">Removed base ingredient <button class="text-button danger-text" type="button" data-action="delete-variant-change" data-variant-id="${variant.id}" data-line-id="${change.baseLineId}">Undo</button></div>` : lineEditor(change.line, { recipeId: recipe.id, variantId: variant.id, baseLineId: change.baseLineId || change.line.id, isVariant: true })).join('')}</div><button class="danger-outline" type="button" data-action="delete-variant" data-variant-id="${variant.id}">Delete variation</button></section>`;
}

function renderIngredients() {
  return `<section class="library-page"><div class="page-heading"><div><p class="eyebrow">Canonical library</p><h1>Ingredients</h1><p>Recipes point here for names, aliases, density, and nutrition.</p></div></div><div class="library-layout"><form class="panel create-panel" data-form="ingredient"><h2>New ingredient</h2><label>Name<input name="name" required placeholder="e.g. Tahini" /></label><label>Aliases <span>comma separated</span><input name="aliases" placeholder="sesame paste" /></label><div class="two-up"><label>kcal / g<input name="caloriesPerGram" type="number" min="0" step="any" value="0" /></label><label>density g / mL<input name="densityGPerMl" type="number" min="0" step="any" value="1" /></label></div><button class="primary-button" type="submit">Create ingredient</button></form><div class="panel library-list"><h2>${state.ingredients.length} ingredients</h2>${state.ingredients.map((ingredient) => `<form class="library-row" data-form="ingredient-update" data-ingredient-id="${ingredient.id}"><div><input name="name" value="${escapeHtml(ingredient.name)}" /><input name="aliases" value="${escapeHtml((ingredient.aliases || []).join(', '))}" placeholder="aliases" /></div><div class="mini-field"><label>kcal/g<input name="caloriesPerGram" type="number" min="0" step="any" value="${ingredient.caloriesPerGram || 0}" /></label><label>g/mL<input name="densityGPerMl" type="number" min="0" step="any" value="${ingredient.densityGPerMl || 0}" /></label></div><button class="text-button" type="submit">Save</button><button class="text-button danger-text" type="button" data-action="delete-ingredient" data-ingredient-id="${ingredient.id}">Delete</button></form>`).join('')}</div></div></section>`;
}

function renderUnits() {
  return `<section class="library-page"><div class="page-heading"><p class="eyebrow">Conversion library</p><h1>Measurements</h1><p>Built-in units are fixed. Add product or household units once and reuse them everywhere.</p></div><div class="library-layout"><form class="panel create-panel" data-form="unit"><h2>New custom unit</h2><label>Name<input name="name" required placeholder="large can" /></label><label>Type<select name="kind"><option value="mass">Mass (equivalent to grams)</option><option value="volume">Volume (equivalent to mL)</option></select></label><label>Equivalent amount<input name="amount" required type="number" min="0.001" step="any" placeholder="439" /></label><label>Description<input name="description" placeholder="optional reminder" /></label><button class="primary-button" type="submit">Add unit</button></form><div class="panel library-list"><h2>Built in</h2><div class="unit-pills">${BUILTIN_UNITS.map((unit) => `<span>${unit.name} <small>${unit.kind === 'mass' ? `${unit.grams} g` : `${unit.ml} mL`}</small></span>`).join('')}</div><h2>Custom units</h2>${state.customUnits.length ? state.customUnits.map((unit) => `<form class="library-row unit-row" data-form="unit-update" data-unit-id="${unit.id}"><input name="name" value="${escapeHtml(unit.name)}" /><select name="kind"><option value="mass"${unit.kind === 'mass' ? ' selected' : ''}>mass</option><option value="volume"${unit.kind === 'volume' ? ' selected' : ''}>volume</option></select><input name="amount" type="number" min="0.001" step="any" value="${unit.kind === 'mass' ? unit.grams : unit.ml}" /><input name="description" value="${escapeHtml(unit.description || '')}" placeholder="description" /><button class="text-button" type="submit">Save</button><button class="text-button danger-text" type="button" data-action="delete-unit" data-unit-id="${unit.id}">Delete</button></form>`).join('') : '<p class="hint">No custom units yet.</p>'}</div></div></section>`;
}

function renderTransfer() {
  const recipe = selectedRecipe();
  return `<section class="transfer-page"><div class="page-heading"><p class="eyebrow">Portable data</p><h1>Import & export</h1><p>Use schema.org Recipe JSON to move recipes through compatible scrapers and tools.</p></div><div class="transfer-grid"><section class="panel"><h2>Export selected recipe</h2><p>${recipe ? `Export <strong>${escapeHtml(recipe.title)}</strong> as a standard schema.org Recipe. YARA’s extra structured fields are preserved in an extension property.` : 'Select a recipe first.'}</p><button class="primary-button" type="button" data-action="export-schema" ${recipe ? '' : 'disabled'}>Download schema.org JSON</button></section><form class="panel" data-form="schema-import"><h2>Import schema.org Recipe</h2><p>Paste JSON-LD from a scraper. Unknown ingredients are added as review-needed library entries so you can set density and calories.</p><textarea name="json" required placeholder='{"@context":"https://schema.org", "@type":"Recipe", ...}'></textarea><button class="secondary-button" type="submit">Import recipe</button></form><section class="panel"><h2>Local-first storage</h2><p>Your library is stored in this browser’s IndexedDB. This makes editing instant and keeps it usable offline; Drive sync can be added as a separate synchronization adapter without changing recipes themselves.</p></section></div></section>`;
}

function render() {
  const content = state.view === 'ingredients' ? renderIngredients() : state.view === 'units' ? renderUnits() : state.view === 'transfer' ? renderTransfer() : renderRecipeEditor();
  app.innerHTML = `<div class="app-shell"><header class="topbar"><a class="brand" href="#" data-action="view" data-view="recipes"><span>Y</span><div><strong>YARA</strong><small>Your adaptable recipe archive</small></div></a><nav>${[['recipes', 'Recipes'], ['ingredients', 'Ingredients'], ['units', 'Measurements'], ['transfer', 'Import / Export']].map(([view, label]) => `<button class="nav-link${state.view === view ? ' active' : ''}" data-action="view" data-view="${view}">${label}</button>`).join('')}</nav><div class="storage-state">Saved locally</div></header>${content}</div>`;
}

function getRecipeLine(recipe, lineId) { return recipe.ingredients.find((line) => line.id === lineId); }
function getVariantChange(recipe, variantId, baseLineId) { return recipe.variants.find((variant) => variant.id === variantId)?.changes.find((change) => (change.baseLineId || change.line?.id) === baseLineId); }

function updateLineFromElement(element) {
  const holder = element.closest('.ingredient-line');
  const recipe = selectedRecipe();
  if (!holder || !recipe) return;
  const field = element.dataset.field;
  const variantId = holder.dataset.variantId;
  const baseLineId = holder.dataset.baseLineId || holder.dataset.lineId;
  const update = (line) => {
    const next = { ...line, [field]: element.value };
    if (field === 'ingredientId') { const ingredient = ingredientById(element.value); if (ingredient) next.ingredientId = ingredient.id; }
    const ingredient = ingredientById(next.ingredientId) || {};
    const unit = holder.querySelector('[data-field="displayUnit"]')?.value || next.displayUnit || 'g';
    const quantity = holder.querySelector('[data-field="quantity"]')?.value ?? convertGramsToUnit(next.grams, unit, ingredient, state.customUnits);
    if (field === 'quantity' || field === 'displayUnit' || field === 'ingredientId') next.grams = convertToGrams(quantity, unit, ingredient, state.customUnits);
    next.displayUnit = unit;
    return next;
  };
  if (!variantId) updateRecipe(recipe.id, (current) => ({ ...current, ingredients: current.ingredients.map((line) => line.id === baseLineId ? update(line) : line) }));
  else updateRecipe(recipe.id, (current) => ({ ...current, variants: current.variants.map((variant) => variant.id !== variantId ? variant : { ...variant, changes: variant.changes.map((change) => (change.baseLineId || change.line?.id) === baseLineId && change.line ? { ...change, line: update(change.line) } : change) }) }));
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (['scale'].includes(action)) return;
  if (action === 'view') return setView(button.dataset.view);
  if (action === 'select-recipe') return commit({ ...state, selectedRecipeId: button.dataset.recipeId, selectedVariantId: '', scaleTarget: recipeYield(recipeById(button.dataset.recipeId)) });
  if (action === 'new-recipe') { const recipe = { id: id(), title: 'Untitled recipe', category: '', tags: [], description: '', yield: { amount: 2, unit: 'servings' }, instructions: [], ingredients: [], variants: [], createdAt: now(), updatedAt: now() }; return commit({ ...state, recipes: [recipe, ...state.recipes], selectedRecipeId: recipe.id, selectedVariantId: '', scaleTarget: 2 }); }
  if (action === 'delete-recipe') { if (confirm('Delete this recipe?')) { const recipes = state.recipes.filter((recipe) => recipe.id !== button.dataset.recipeId); return commit({ ...state, recipes, selectedRecipeId: recipes[0]?.id || '', selectedVariantId: '' }); } return; }
  if (action === 'add-line') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, ingredients: [...recipe.ingredients, { id: id(), ingredientId: state.ingredients[0]?.id || '', grams: 0, displayUnit: 'g', note: '' }] }));
  if (action === 'delete-line') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, ingredients: recipe.ingredients.filter((line) => line.id !== button.dataset.lineId) }));
  if (action === 'add-step') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, instructions: [...recipe.instructions, ''] }));
  if (action === 'delete-step') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, instructions: recipe.instructions.filter((_, index) => index !== Number(button.dataset.stepIndex)) }));
  if (action === 'select-variant') return commit({ ...state, selectedVariantId: button.dataset.variantId });
  if (action === 'delete-variant') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, variants: recipe.variants.filter((variant) => variant.id !== button.dataset.variantId) })).then(() => commit({ ...state, selectedVariantId: '' }));
  if (action === 'override-line') return updateRecipe(selectedRecipe().id, (recipe) => { const base = getRecipeLine(recipe, button.dataset.lineId); return { ...recipe, variants: recipe.variants.map((variant) => variant.id !== button.dataset.variantId ? variant : { ...variant, changes: [...variant.changes, { type: 'replace', baseLineId: base.id, line: { ...base } }] }) }; });
  if (action === 'add-variant-line') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, variants: recipe.variants.map((variant) => variant.id !== button.dataset.variantId ? variant : { ...variant, changes: [...variant.changes, { type: 'add', line: { id: id(), ingredientId: state.ingredients[0]?.id || '', grams: 0, displayUnit: 'g', note: '' } }] }) }));
  if (action === 'delete-variant-change') return updateRecipe(selectedRecipe().id, (recipe) => ({ ...recipe, variants: recipe.variants.map((variant) => variant.id !== button.dataset.variantId ? variant : { ...variant, changes: variant.changes.filter((change) => (change.baseLineId || change.line?.id) !== button.dataset.lineId) }) }));
  if (['quick-ingredient', 'quick-alias', 'quick-unit'].includes(action)) { const property = action === 'quick-ingredient' ? 'quickIngredientFor' : action === 'quick-alias' ? 'quickAliasFor' : 'quickUnitFor'; ui[property] = `${button.dataset.variantId || ''}:${button.dataset.lineId}`; return render(); }
  if (action === 'delete-ingredient') { const isUsed = state.recipes.some((recipe) => recipe.ingredients.some((line) => line.ingredientId === button.dataset.ingredientId)); if (isUsed) return alert('This ingredient is used by a recipe. Re-link its recipe lines before deleting it.'); return commit({ ...state, ingredients: state.ingredients.filter((item) => item.id !== button.dataset.ingredientId) }); }
  if (action === 'delete-unit') return commit({ ...state, customUnits: state.customUnits.filter((unit) => unit.id !== button.dataset.unitId) });
  if (action === 'export-schema') { const recipe = selectedRecipe(); const nutrition = calculateRecipeNutrition(recipe, recipeYield(recipe), state.customUnits, ingredientMap()); const schema = recipeToSchema({ ...recipe, calories: nutrition.calories }, state.ingredients, state.customUnits); const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/ld+json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'recipe'}.json`; link.click(); URL.revokeObjectURL(link.href); }
});

app.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('.ingredient-line [data-field]')) return updateLineFromElement(target);
  if (target.dataset.action === 'scale') return commit({ ...state, scaleTarget: Number(target.value) || recipeYield(selectedRecipe()) });
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const type = form.dataset.form;
  if (type === 'recipe') { const recipeId = form.dataset.recipeId; const steps = [...form.querySelectorAll('[data-step-index]')].map((item) => item.value.trim()).filter(Boolean); return updateRecipe(recipeId, (recipe) => ({ ...recipe, title: data.get('title').trim() || 'Untitled recipe', category: data.get('category').trim(), tags: data.get('tags').split(',').map((tag) => tag.trim()).filter(Boolean), description: data.get('description').trim(), yield: { amount: Number(data.get('yield')) || 1, unit: data.get('yieldUnit').trim() || 'servings' }, instructions: steps })); }
  if (type === 'variant') { const variant = { id: id(), name: data.get('name').trim(), description: data.get('description').trim(), changes: [] }; return updateRecipe(form.dataset.recipeId, (recipe) => ({ ...recipe, variants: [...recipe.variants, variant] })).then(() => commit({ ...state, selectedVariantId: variant.id })); }
  if (type === 'ingredient' || type === 'quick-ingredient') { const ingredient = { id: id(), name: data.get('name').trim(), aliases: String(data.get('aliases') || '').split(',').map((item) => item.trim()).filter(Boolean), caloriesPerGram: Number(data.get('caloriesPerGram')) || 0, densityGPerMl: Number(data.get('densityGPerMl')) || 0 }; const next = { ...state, ingredients: [...state.ingredients, ingredient] }; if (type === 'quick-ingredient') { const lineId = form.dataset.lineId; const variantId = form.dataset.variantId; const recipe = selectedRecipe(); if (!variantId) next.recipes = state.recipes.map((current) => current.id !== recipe.id ? current : { ...current, ingredients: current.ingredients.map((line) => line.id === lineId ? { ...line, ingredientId: ingredient.id } : line) }); else next.recipes = state.recipes.map((current) => current.id !== recipe.id ? current : { ...current, variants: current.variants.map((variant) => variant.id !== variantId ? variant : { ...variant, changes: variant.changes.map((change) => (change.baseLineId || change.line?.id) === lineId && change.line ? { ...change, line: { ...change.line, ingredientId: ingredient.id } } : change) }) }); ui.quickIngredientFor = null; } return commit(next); }
  if (type === 'quick-alias') { const line = form.closest('.ingredient-line'); const variantId = form.dataset.variantId; let source = !variantId ? getRecipeLine(selectedRecipe(), form.dataset.lineId) : getVariantChange(selectedRecipe(), variantId, form.dataset.lineId)?.line; const ingredient = ingredientById(source?.ingredientId); if (!ingredient) return; ui.quickAliasFor = null; return commit({ ...state, ingredients: state.ingredients.map((item) => item.id === ingredient.id ? { ...item, aliases: [...new Set([...item.aliases, data.get('alias').trim()])].filter(Boolean) } : item) }); }
  if (type === 'quick-unit' || type === 'unit') { const kind = data.get('kind'); const unit = { id: id(), name: data.get('name').trim(), kind, [kind === 'mass' ? 'grams' : 'ml']: Number(data.get('amount')) || 1, description: data.get('description')?.trim() || '' }; const next = { ...state, customUnits: [...state.customUnits, unit] }; if (type === 'quick-unit') { const lineId = form.dataset.lineId; const variantId = form.dataset.variantId; const recipe = selectedRecipe(); if (!variantId) next.recipes = state.recipes.map((current) => current.id !== recipe.id ? current : { ...current, ingredients: current.ingredients.map((line) => line.id === lineId ? { ...line, displayUnit: unit.id } : line) }); else next.recipes = state.recipes.map((current) => current.id !== recipe.id ? current : { ...current, variants: current.variants.map((variant) => variant.id !== variantId ? variant : { ...variant, changes: variant.changes.map((change) => (change.baseLineId || change.line?.id) === lineId && change.line ? { ...change, line: { ...change.line, displayUnit: unit.id } } : change) }) }); ui.quickUnitFor = null; } return commit(next); }
  if (type === 'ingredient-update') return commit({ ...state, ingredients: state.ingredients.map((ingredient) => ingredient.id !== form.dataset.ingredientId ? ingredient : { ...ingredient, name: data.get('name').trim(), aliases: data.get('aliases').split(',').map((item) => item.trim()).filter(Boolean), caloriesPerGram: Number(data.get('caloriesPerGram')) || 0, densityGPerMl: Number(data.get('densityGPerMl')) || 0 }) });
  if (type === 'unit-update') { const kind = data.get('kind'); return commit({ ...state, customUnits: state.customUnits.map((unit) => unit.id !== form.dataset.unitId ? unit : { ...unit, name: data.get('name').trim(), kind, grams: kind === 'mass' ? Number(data.get('amount')) || 1 : undefined, ml: kind === 'volume' ? Number(data.get('amount')) || 1 : undefined, description: data.get('description').trim() }) }); }
  if (type === 'schema-import') { try { const result = recipeFromSchema(JSON.parse(data.get('json')), state.ingredients, state.customUnits); return commit({ ...state, ingredients: [...state.ingredients, ...result.addedIngredients], recipes: [result.recipe, ...state.recipes], selectedRecipeId: result.recipe.id, selectedVariantId: '', scaleTarget: recipeYield(result.recipe), view: 'recipes' }); } catch (error) { alert(error.message); } }
});

async function start() {
  try { const saved = await loadDatabaseState(); if (saved?.version) state = { ...structuredClone(seed), ...saved, view: 'recipes', selectedRecipeId: saved.selectedRecipeId || saved.recipes?.[0]?.id || '' }; } catch (error) { console.warn('IndexedDB is unavailable; using this-tab state.', error); }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => console.warn('Service worker registration failed.', error));
}

start();
