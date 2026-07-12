import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecipeNutrition, calculateScaledIngredients, convertToGrams, convertGramsToUnit } from '../src/models/Recipe.js';

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
  assert.equal(scaled[0].scaledGrams, 480 * 2);
  assert.equal(scaled[1].scaledGrams, 2);
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

test('converts between grams and display units', () => {
  assert.equal(convertToGrams(1, 'cup', { density: 1 }), 240);
  assert.equal(convertGramsToUnit(240, 'cup', { density: 1 }), 1);
  assert.equal(convertToGrams(2, 'oz', {}), 56.7);
  assert.equal(Math.round(convertGramsToUnit(56.7, 'oz', {})), 2);
});
