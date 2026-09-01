import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialState,
  decodePrototypeState,
  encodePrototypeState,
  placeItem,
} from '../assets/scripts/core/prototype-state.ts';

test('initial state has three empty trunk slots', () => {
  assert.deepEqual(createInitialState().trunkSlots, [null, null, null]);
});

test('placing an item moves it instead of duplicating it', () => {
  const first = placeItem(createInitialState(), 'fuel', 0);
  const moved = placeItem(first, 'fuel', 2);
  assert.deepEqual(moved.trunkSlots, [null, null, 'fuel']);
});

test('placing into an occupied slot replaces the previous item', () => {
  const withFuel = placeItem(createInitialState(), 'fuel', 1);
  const withFood = placeItem(withFuel, 'food', 1);
  assert.deepEqual(withFood.trunkSlots, [null, 'food', null]);
});

test('encoded state round-trips and invalid data falls back safely', () => {
  const state = placeItem(createInitialState(), 'medicine', 2);
  assert.deepEqual(decodePrototypeState(encodePrototypeState(state)), state);
  assert.deepEqual(decodePrototypeState('{broken').trunkSlots, [null, null, null]);
  assert.deepEqual(decodePrototypeState('{"version":1,"trunkSlots":["ammo"]}').trunkSlots, [null, null, null]);
});
