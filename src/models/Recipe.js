const BUILTIN_UNITS = [
  { id: 'g', name: 'g', kind: 'mass', grams: 1 },
  { id: 'kg', name: 'kg', kind: 'mass', grams: 1000 },
  { id: 'oz', name: 'oz', kind: 'mass', grams: 28.35 },
  { id: 'lb', name: 'lb', kind: 'mass', grams: 453.59237 },
  { id: 'ml', name: 'mL', kind: 'volume', ml: 1 },
  { id: 'l', name: 'L', kind: 'volume', ml: 1000 },
  { id: 'tsp', name: 'tsp', kind: 'volume', ml: 4.92892159375 },
  { id: 'tbsp', name: 'tbsp', kind: 'volume', ml: 14.78676478125 },
  { id: 'cup', name: 'cup', kind: 'volume', ml: 240 },
  { id: 'fl-oz', name: 'fl oz', kind: 'volume', ml: 29.5735295625 }
];

const LEGACY_UNIT_ALIASES = {
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg',
  ounce: 'oz', ounces: 'oz', pound: 'lb', pounds: 'lb',
  milliliter: 'ml', milliliters: 'ml', litre: 'l', litres: 'l',
  liter: 'l', liters: 'l', cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp'
};

export { BUILTIN_UNITS };

export function normalizeUnitId(unit) {
  const normalized = String(unit || 'g').trim().toLowerCase();
  return LEGACY_UNIT_ALIASES[normalized] || normalized;
}

export function allUnits(customUnits = [], ingredient = null) {
  const scoped = ingredient?.customUnits || [];
  return [...BUILTIN_UNITS, ...customUnits, ...scoped];
}

export function findUnit(unitId, customUnits = [], ingredient = null) {
  const id = normalizeUnitId(unitId);
  return allUnits(customUnits, ingredient).find((unit) => normalizeUnitId(unit.id || unit.name) === id || normalizeUnitId(unit.name) === id) || null;
}

export function ingredientDensity(ingredient = {}) {
  const value = ingredient.densityGPerMl ?? ingredient.density;
  // Legacy/imported lines without density retain the historical 1 g/mL
  // assumption; explicitly entered zero still signals "needs density" to the UI.
  return value == null ? 1 : Number(value) || 0;
}

export function convertToGrams(quantity, unitId, ingredient = {}, customUnits = []) {
  const amount = Number(quantity) || 0;
  const unit = findUnit(unitId, customUnits, ingredient);
  if (!unit) return amount;
  if (unit.kind === 'mass' || unit.grams != null) return amount * (Number(unit.grams) || 1);
  const density = ingredientDensity(ingredient);
  return density > 0 ? amount * (Number(unit.ml) || 0) * density : 0;
}

export function convertGramsToUnit(grams, unitId = 'g', ingredient = {}, customUnits = []) {
  const amount = Number(grams) || 0;
  const unit = findUnit(unitId, customUnits, ingredient);
  if (!unit) return amount;
  if (unit.kind === 'mass' || unit.grams != null) return amount / (Number(unit.grams) || 1);
  const density = ingredientDensity(ingredient);
  return density > 0 ? amount / ((Number(unit.ml) || 1) * density) : 0;
}

export function formatNumber(value, digits = 2) {
  const number = Number(value) || 0;
  return Number(number.toFixed(digits)).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function recipeYield(recipe) {
  return Number(recipe.yield?.amount ?? recipe.baseYield ?? 1) || 1;
}

export function calculateScaledIngredients(recipe, targetYield, customUnits = [], ingredientsById = new Map()) {
  const baseYield = recipeYield(recipe);
  const scale = baseYield > 0 ? (Number(targetYield) || baseYield) / baseYield : 1;
  return (recipe.ingredients || []).map((item) => {
    const ingredient = item.ingredient || ingredientsById.get(item.ingredientId) || {};
    const grams = Number(item.grams ?? convertToGrams(item.quantity ?? 0, item.unit ?? item.displayUnit ?? 'g', ingredient, customUnits)) || 0;
    return { ...item, ingredient, grams, scaledGrams: grams * scale, quantity: item.quantity != null ? Number(((Number(item.quantity) || 0) * scale).toFixed(3)) : undefined };
  });
}

export function calculateRecipeNutrition(recipe, targetYield = recipeYield(recipe), customUnits = [], ingredientsById = new Map()) {
  const scaledIngredients = calculateScaledIngredients(recipe, targetYield, customUnits, ingredientsById);
  const grams = scaledIngredients.reduce((total, item) => total + Number(item.scaledGrams || 0), 0);
  const calories = Math.round(scaledIngredients.reduce((total, item) => total + Number(item.scaledGrams || 0) * (Number(item.ingredient?.caloriesPerGram) || 0), 0));
  const servings = Number(targetYield) || recipeYield(recipe);
  return { grams, calories, perServing: servings > 0 ? Math.round(calories / servings) : calories, scaledIngredients };
}

export function applyVariant(recipe, variantId) {
  const variant = (recipe.variants || []).find((item) => item.id === variantId);
  if (!variant) return { ...recipe, ingredients: [...(recipe.ingredients || [])] };
  const byBaseLine = new Map();
  const additions = [];
  for (const change of variant.changes || []) {
    if (change.type === 'add') additions.push({ ...change.line, isVariantChange: true });
    else byBaseLine.set(change.baseLineId, change);
  }
  const ingredients = (recipe.ingredients || []).flatMap((line) => {
    const change = byBaseLine.get(line.id);
    if (!change) return [{ ...line }];
    if (change.type === 'remove') return [];
    return [{ ...change.line, id: line.id, baseLineId: line.id, isVariantChange: true }];
  });
  return { ...recipe, ingredients: [...ingredients, ...additions], activeVariantId: variantId };
}

export function convertIngredientUnits(recipe, targetUnit, customUnits = [], ingredientsById = new Map()) {
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((item) => {
      const ingredient = item.ingredient || ingredientsById.get(item.ingredientId) || {};
      return { ...item, displayUnit: targetUnit, displayQuantity: Number(convertGramsToUnit(item.grams || 0, targetUnit, ingredient, customUnits).toFixed(3)) };
    })
  };
}
