import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialGameState,
  advanceDay,
  returnHome,
} from '../assets/scripts/core/sim.ts';
import {
  encodeGameState,
  decodeGameState,
  SAVE_KEY,
} from '../assets/scripts/core/scenario.ts';

test('encoded state round-trips exactly', () => {
  const state = createInitialGameState();
  const advanced = advanceDay(state).state;
  const back = returnHome(advanced, [{ resource: 'material', amount: 2 }]).state;
  const decoded = decodeGameState(encodeGameState(back));
  assert.deepEqual(decoded, back);
});

test('decode null returns null', () => {
  assert.equal(decodeGameState(null), null);
});

test('decode broken json returns null', () => {
  assert.equal(decodeGameState('{broken'), null);
});

test('decode wrong shape returns null', () => {
  assert.equal(decodeGameState('{"version":2,"day":1}'), null);
  assert.equal(decodeGameState('{"version":1}'), null);
  assert.equal(decodeGameState('"just a string"'), null);
});

test('SAVE_KEY is namespaced', () => {
  assert.match(SAVE_KEY, /^wasteland-depot\./);
});
