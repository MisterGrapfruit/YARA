const UNIT_TO_ML = {
  g: 0,
  gram: 0,
  grams: 0,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.59,
  pound: 453.59,
  pounds: 453.59
};

function normalizeUnit(unit) {
  return String(unit || '').trim().toLowerCase();
}

export function convertToGrams(quantity, unit, ingredient = {}) {
  const amount = Number(quantity) || 0;
  const baseUnit = normalizeUnit(unit);

  if (baseUnit === 'g' || baseUnit === 'gram' || baseUnit === 'grams') {
    return amount;
  }

  if (baseUnit === 'oz' || baseUnit === 'ounce' || baseUnit === 'ounces') {
    return amount * 28.35;
  }

  if (baseUnit === 'lb' || baseUnit === 'pound' || baseUnit === 'pounds') {
    return amount * 453.59;
  }

  const mlEquivalent = UNIT_TO_ML[baseUnit] || 0;
  if (mlEquivalent === 0) {
    return amount;
  }

  return amount * mlEquivalent * (Number(ingredient.density) || 1);
}

export function convertGramsToUnit(grams, unit = 'g', ingredient = {}) {
  const amount = Number(grams) || 0;
  const baseUnit = normalizeUnit(unit);

  if (baseUnit === 'g' || baseUnit === 'gram' || baseUnit === 'grams') {
    return amount;
  }

  if (baseUnit === 'oz' || baseUnit === 'ounce' || baseUnit === 'ounces') {
    return amount / 28.35;
  }

  if (baseUnit === 'lb' || baseUnit === 'pound' || baseUnit === 'pounds') {
    return amount / 453.59;
  }

  const mlEquivalent = UNIT_TO_ML[baseUnit] || 0;
  if (mlEquivalent === 0) {
    return amount;
  }

  return amount / ((Number(ingredient.density) || 1) * mlEquivalent);
}

export function calculateScaledIngredients(recipe, targetYield) {
  const baseYield = Number(recipe.baseYield || 1);
  const scale = baseYield > 0 ? Number(targetYield || baseYield) / baseYield : 1;

  return (recipe.ingredients || []).map((item) => {
    const ingredient = item.ingredient || {};
    const grams = Number(item.grams ?? convertToGrams(item.quantity ?? 0, item.unit ?? 'g', ingredient)) || 0;
    return {
      ...item,
      grams,
      scaledGrams: grams * scale,
      quantity: item.quantity != null ? Number((Number(item.quantity || 0) * scale).toFixed(2)) : undefined
    };
  });
}

export function calculateRecipeNutrition(recipe, targetYield = recipe.baseYield || 1) {
  const scaledIngredients = calculateScaledIngredients(recipe, targetYield);

  const grams = scaledIngredients.reduce((total, item) => total + Number(item.scaledGrams || 0), 0);
  const calories = Number(scaledIngredients.reduce((total, item) => {
    return total + Number(item.scaledGrams || 0) * (Number(item.ingredient?.caloriesPerGram) || 0);
  }, 0).toFixed(0));

  const perServing = targetYield > 0 ? Math.round(calories / Number(targetYield)) : calories;

  return {
    grams,
    calories,
    perServing,
    scaledIngredients
  };
}

export function convertIngredientUnits(recipe, targetUnit) {
  const normalizedTarget = normalizeUnit(targetUnit);
  if (!normalizedTarget) {
    return recipe;
  }

  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((item) => ({
      ...item,
      displayUnit: normalizedTarget,
      displayQuantity: Number(convertGramsToUnit(Number(item.grams || 0), normalizedTarget, item.ingredient).toFixed(2))
    }))
  };
}
