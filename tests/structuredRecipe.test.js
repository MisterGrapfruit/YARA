import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVariant, convertGramsToUnit, convertToGrams } from '../src/models/Recipe.js';
import { recipeFromSchema, recipeToSchema } from '../src/data/schema.js';

test('custom units preserve a canonical gram amount', () => {
  const unit = { id: 'large-can', name: 'large can', kind: 'mass', grams: 439 };
  assert.equal(convertToGrams(1, 'large-can', {}, [unit]), 439);
  assert.equal(convertGramsToUnit(439, 'large-can', {}, [unit]), 1);
});

test('a variant patches a base ingredient instead of duplicating the recipe', () => {
  const recipe = { ingredients: [{ id: 'egg-line', ingredientId: 'egg', grams: 50 }], variants: [{ id: 'egg-free', changes: [{ type: 'replace', baseLineId: 'egg-line', line: { ingredientId: 'flax', grams: 15 } }] }] };
  const result = applyVariant(recipe, 'egg-free');
  assert.equal(result.ingredients.length, 1);
  assert.equal(result.ingredients[0].ingredientId, 'flax');
  assert.equal(result.ingredients[0].grams, 15);
});

test('schema.org export and import retain the interoperable recipe fields', () => {
  const ingredients = [{ id: 'beans', name: 'Beans', aliases: [], caloriesPerGram: 1, densityGPerMl: 1 }];
  const recipe = { id: 'r1', title: 'Beans', yield: { amount: 2, unit: 'servings' }, ingredients: [{ id: 'line1', ingredientId: 'beans', grams: 240, displayUnit: 'cup', note: 'drained' }], instructions: ['Warm and serve'], variants: [] };
  const schema = recipeToSchema(recipe, ingredients);
  const result = recipeFromSchema(schema, ingredients);
  assert.equal(schema['@type'], 'Recipe');
  assert.equal(result.recipe.title, 'Beans');
  assert.equal(result.recipe.ingredients[0].grams, 240);
});
