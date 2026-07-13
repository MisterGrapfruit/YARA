import { allUnits, convertGramsToUnit, convertToGrams, formatNumber, recipeYield } from '../models/Recipe.js';

const fractions = { '¼': 0.25, '½': 0.5, '¾': 0.75 };

function parseAmount(value) {
  if (fractions[value] != null) return fractions[value];
  if (value.includes('/')) { const [a, b] = value.split('/').map(Number); return b ? a / b : 0; }
  return Number(value) || 0;
}

function instructionText(value) {
  if (Array.isArray(value)) return value.flatMap(instructionText);
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return instructionText(value.text || value.itemListElement || []);
  return [];
}

function parseIngredientText(text, customUnits) {
  const raw = String(text || '').trim();
  const amountMatch = raw.match(/^([0-9]+(?:\.[0-9]+)?(?:\s+[0-9]+\/[0-9]+)?|[0-9]+\/[0-9]+|[¼½¾])\s+(.+)$/);
  if (!amountMatch) return { amount: 0, unit: 'g', name: raw, needsReview: true };
  const amount = amountMatch[1].includes(' ') ? amountMatch[1].split(' ').reduce((sum, part) => sum + parseAmount(part), 0) : parseAmount(amountMatch[1]);
  const remainder = amountMatch[2];
  const unit = allUnits(customUnits).flatMap((item) => [item.id, item.name]).filter(Boolean).sort((a, b) => b.length - a.length).find((candidate) => remainder.toLowerCase().startsWith(candidate.toLowerCase() + ' '));
  return unit
    ? { amount, unit, name: remainder.slice(unit.length).trim(), needsReview: false }
    : { amount, unit: 'g', name: remainder, needsReview: true };
}

export function recipeToSchema(recipe, ingredientList, customUnits = []) {
  const byId = new Map(ingredientList.map((item) => [item.id, item]));
  const ingredientText = (recipe.ingredients || []).map((line) => {
    const ingredient = byId.get(line.ingredientId) || { name: line.name || 'Ingredient' };
    const unit = line.displayUnit || 'g';
    const quantity = convertGramsToUnit(line.grams || 0, unit, ingredient, customUnits);
    return `${formatNumber(quantity)} ${unit} ${ingredient.name}${line.note ? `, ${line.note}` : ''}`;
  });
  return {
    '@context': 'https://schema.org', '@type': 'Recipe', name: recipe.title,
    description: recipe.description || undefined,
    recipeCategory: recipe.category || undefined,
    keywords: (recipe.tags || []).join(', ') || undefined,
    recipeYield: `${recipeYield(recipe)} ${recipe.yield?.unit || 'servings'}`,
    recipeIngredient: ingredientText,
    recipeInstructions: (recipe.instructions || []).filter(Boolean).map((text, position) => ({ '@type': 'HowToStep', position: position + 1, text })),
    nutrition: { '@type': 'NutritionInformation', calories: `${recipe.calories || 0} calories` },
    additionalProperty: [{ '@type': 'PropertyValue', name: 'yara:recipe', value: JSON.stringify({ version: 1, id: recipe.id, ingredients: recipe.ingredients, variants: recipe.variants || [] }) }]
  };
}

export function recipeFromSchema(document, ingredientList, customUnits = []) {
  const candidates = document?.['@graph'] || [document];
  const source = candidates.find((item) => item?.['@type'] === 'Recipe' || item?.['@type']?.includes?.('Recipe'));
  if (!source) throw new Error('This JSON does not contain a schema.org Recipe.');
  const addedIngredients = [];
  const library = [...ingredientList];
  const findIngredient = (name) => library.find((item) => [item.name, ...(item.aliases || [])].some((label) => label.toLowerCase() === name.toLowerCase()));
  const lines = (source.recipeIngredient || []).map((text) => {
    const parsed = parseIngredientText(text, customUnits);
    const [name, note] = parsed.name.split(/,(.+)/).map((item) => item?.trim());
    let ingredient = findIngredient(name);
    if (!ingredient) {
      ingredient = { id: crypto.randomUUID(), name, aliases: [], caloriesPerGram: 0, densityGPerMl: 0, needsReview: true };
      library.push(ingredient); addedIngredients.push(ingredient);
    }
    return { id: crypto.randomUUID(), ingredientId: ingredient.id, grams: convertToGrams(parsed.amount, parsed.unit, ingredient, customUnits), displayUnit: parsed.unit, note: note || '', needsReview: parsed.needsReview || ingredient.needsReview };
  });
  const yieldMatch = String(source.recipeYield || '1 servings').match(/([0-9.]+)/);
  const extension = (source.additionalProperty || []).find((property) => property.name === 'yara:recipe');
  let yaraData = null;
  try { yaraData = extension?.value ? JSON.parse(extension.value) : null; } catch { /* Keep the interoperable fields if an extension is malformed. */ }
  return {
    recipe: { id: yaraData?.id || crypto.randomUUID(), title: source.name || 'Imported recipe', description: source.description || '', category: source.recipeCategory || '', tags: String(source.keywords || '').split(',').map((item) => item.trim()).filter(Boolean), yield: { amount: Number(yieldMatch?.[1]) || 1, unit: 'servings' }, instructions: instructionText(source.recipeInstructions), ingredients: yaraData?.ingredients || lines, variants: yaraData?.variants || [], importedSchema: source },
    addedIngredients
  };
}
