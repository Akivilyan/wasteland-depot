import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTrunkState,
  placeItem,
  moveItem,
  removeItem,
  canPlace,
  firstFreeSpot,
  usedCells,
  encodeTrunkState,
  decodeTrunkState,
  TRUNK_CAPACITY,
  DEFAULT_ITEM_DEFS,
  cellIndex,
  cellCoords,
} from '../assets/scripts/core/trunk.ts';

test('empty trunk has 12 null cells', () => {
  const state = createTrunkState();
  assert.equal(state.grid.length, TRUNK_CAPACITY);
  assert.ok(state.grid.every((c) => c === null));
  assert.equal(usedCells(state, DEFAULT_ITEM_DEFS), 0);
});

test('cell index and coords round-trip', () => {
  assert.equal(cellIndex(0, 0), 0);
  assert.equal(cellIndex(3, 2), 11);
  assert.deepEqual(cellCoords(11), { x: 3, y: 2 });
  assert.throws(() => cellIndex(4, 0));
});

test('placing a 1x1 item occupies one cell', () => {
  const { state, ok } = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'food', 0, 0);
  assert.equal(ok, true);
  assert.equal(state.grid[0], 'food');
  assert.equal(state.items.length, 1);
  assert.equal(usedCells(state, DEFAULT_ITEM_DEFS), 1);
});

test('placing a 2x1 item occupies two cells', () => {
  const { state, ok } = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'fuel', 0, 0);
  assert.equal(ok, true);
  assert.equal(state.grid[0], 'fuel');
  assert.equal(state.grid[1], 'fuel');
  assert.equal(usedCells(state, DEFAULT_ITEM_DEFS), 2);
});

test('placing overlapping items fails with a reason', () => {
  const first = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'food', 0, 0);
  const second = placeItem(first.state, DEFAULT_ITEM_DEFS, 'medicine', 0, 0);
  assert.equal(second.ok, false);
  assert.match(second.reason ?? '', /占用|空间不足/);
});

test('canPlace detects collisions', () => {
  const state = createTrunkState();
  const food = itemDefFor('food');
  assert.equal(canPlace(state, food, 3, 2), true);
  const placed = placeItem(state, DEFAULT_ITEM_DEFS, 'food', 0, 0).state;
  assert.equal(canPlace(placed, food, 0, 0), false);
  assert.equal(canPlace(placed, food, 1, 0), true);
});

test('firstFreeSpot finds the top-left free cell', () => {
  const state = createTrunkState();
  assert.deepEqual(firstFreeSpot(state, itemDefFor('food')), { x: 0, y: 0 });
  const occupied = placeItem(state, DEFAULT_ITEM_DEFS, 'food', 0, 0).state;
  assert.deepEqual(firstFreeSpot(occupied, itemDefFor('food')), { x: 1, y: 0 });
});

test('moving an item updates its position and grid', () => {
  const placed = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'food', 0, 0).state;
  const moved = moveItem(placed, DEFAULT_ITEM_DEFS, 'food', 2, 1);
  assert.equal(moved.ok, true);
  assert.equal(moved.state.grid[0], null);
  assert.equal(moved.state.grid[cellIndex(2, 1)], 'food');
  assert.equal(moved.state.items[0].x, 2);
  assert.equal(moved.state.items[0].y, 1);
});

test('moveItem fails when target overlaps another item', () => {
  const a = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'food', 0, 0).state;
  const b = placeItem(a, DEFAULT_ITEM_DEFS, 'medicine', 1, 0).state;
  const attempt = moveItem(b, DEFAULT_ITEM_DEFS, 'food', 1, 0);
  assert.equal(attempt.ok, false);
});

test('removeItem clears grid and returns removed count', () => {
  const placed = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'fuel', 0, 0).state;
  const { state, removed } = removeItem(placed, 'fuel');
  assert.equal(removed, 1);
  assert.ok(state.grid.every((c) => c === null));
  assert.equal(state.items.length, 0);
});

test('stacking increases amount up to maxStack then fails', () => {
  let state = createTrunkState();
  for (let i = 0; i < 5; i++) {
    const r = placeItem(state, DEFAULT_ITEM_DEFS, 'food', 0, 0);
    state = r.state;
  }
  assert.equal(state.items[0].amount, 5);
  const over = placeItem(state, DEFAULT_ITEM_DEFS, 'food', 0, 0);
  assert.equal(over.ok, false);
});

test('trunk state round-trips and invalid data falls back', () => {
  const placed = placeItem(createTrunkState(), DEFAULT_ITEM_DEFS, 'food', 0, 0).state;
  const moved = moveItem(placed, DEFAULT_ITEM_DEFS, 'food', 2, 1).state;
  assert.deepEqual(decodeTrunkState(encodeTrunkState(moved)), moved);
  assert.equal(decodeTrunkState(null).items.length, 0);
  assert.equal(decodeTrunkState('{broken').items.length, 0);
  assert.equal(decodeTrunkState('{"version":1}').items.length, 0);
});

function itemDefFor(id) {
  const def = DEFAULT_ITEM_DEFS.find((d) => d.id === id);
  assert.ok(def, `def for ${id}`);
  return def;
}
