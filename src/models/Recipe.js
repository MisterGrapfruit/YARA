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
  oz: 0,
  ounce: 0,
  ounces: 0,
  lb: 0,
  pound: 0,
  pounds: 0
};

function toGrams(quantity, unit, ingredient) {
  const baseUnit = unit?.toLowerCase();
  if (!ingredient) {
    return quantity * (UNIT_TO_ML[baseUnit] || 0);
  }

  if (baseUnit === 'g' || baseUnit === 'gram' || baseUnit === 'grams') {
    return quantity;
  }

  if (baseUnit === 'oz' || baseUnit === 'ounce' || baseUnit === 'ounces') {
    return quantity * 28.35;
  }

  if (baseUnit === 'lb' || baseUnit === 'pound' || baseUnit === 'pounds') {
    return quantity * 453.59;
  }

  if (baseUnit === 'ml' || baseUnit === 'milliliter' || baseUnit === 'milliliters') {
    return quantity * (ingredient.density || 1);
  }

  const mlEquivalent = UNIT_TO_ML[baseUnit] || 0;
  return quantity * mlEquivalent * (ingredient.density || 1);
}

export function calculateScaledIngredients(recipe, targetYield) {
  const baseYield = Number(recipe.baseYield || 1);
  const scale = baseYield > 0 ? targetYield / baseYield : 1;

  return (recipe.ingredients || []).map((ingredientLine) => ({
    ...ingredientLine,
    quantity: Number(ingredientLine.quantity || 0) * scale
  }));
}

export function calculateRecipeNutrition(recipe, targetYield = recipe.baseYield || 1) {
  const scaledIngredients = calculateScaledIngredients(recipe, targetYield);
  const grams = scaledIngredients.reduce((total, item) => {
    const ingredient = item.ingredient || null;
    return total + toGrams(item.quantity, item.unit, ingredient);
  }, 0);

  const calories = Number(scaledIngredients.reduce((total, item) => {
    const ingredient = item.ingredient || null;
    const gramsForItem = toGrams(item.quantity, item.unit, ingredient);
    return total + gramsForItem * (ingredient?.caloriesPerGram || 0);
  }, 0).toFixed(0));

  const perServing = targetYield > 0 ? Math.round(calories / targetYield) : calories;

  return {
    grams,
    calories,
    perServing,
    scaledIngredients
  };
}

export function convertIngredientUnits(recipe, targetUnit) {
  const normalizedTarget = targetUnit?.toString().toLowerCase();
  if (!normalizedTarget) {
    return recipe;
  }

  const targetMl = UNIT_TO_ML[normalizedTarget] ?? 0;
  if (targetMl <= 0) {
    return recipe;
  }

  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map((item) => {
      const ingredient = item.ingredient || null;
      const grams = toGrams(item.quantity, item.unit, ingredient);
      const convertedQuantity = grams / (ingredient?.density || 1) / targetMl;
      return {
        ...item,
        quantity: Number(convertedQuantity.toFixed(2)),
        unit: normalizedTarget
      };
    })
  };
}
