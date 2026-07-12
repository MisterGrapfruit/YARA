import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecipeNutrition, calculateScaledIngredients } from '../src/models/Recipe.js';

test('scales ingredients by the target yield', () => {
  const recipe = {
    id: 'r1',
    title: 'Test recipe',
    baseYield: 4,
    ingredients: [
      { id: 'i1', ingredientId: 'ing-1', quantity: 2, unit: 'cup' },
      { id: 'i2', ingredientId: 'ing-2', quantity: 1, unit: 'g' }
    ]
  };

  const scaled = calculateScaledIngredients(recipe, 8);
  assert.equal(scaled[0].quantity, 4);
  assert.equal(scaled[1].quantity, 2);
});

test('calculates nutrition using ingredient density and calories per gram', () => {
  const recipe = {
    id: 'r2',
    title: 'Bean bowl',
    baseYield: 2,
    ingredients: [
      {
        id: 'i1',
        ingredientId: 'ing-1',
        quantity: 1,
        unit: 'cup',
        ingredient: {
          name: 'Black beans',
          caloriesPerGram: 0.34,
          density: 1.0
        }
      }
    ]
  };

  const nutrition = calculateRecipeNutrition(recipe, 4);
  assert.equal(nutrition.calories, 163);
  assert.equal(nutrition.perServing, 41);
});
