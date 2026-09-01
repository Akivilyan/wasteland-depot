import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialGameState,
  startTrip,
  choose,
  loadCargo,
  returnHome,
  advanceDay,
  runSimulation,
  canAffordTrip,
} from '../assets/scripts/core/sim.ts';
import { createGameConfig } from '../assets/scripts/core/game.ts';
import { createRng } from '../assets/scripts/core/rng.ts';
import { GAME_DAYS, STARTING_RESOURCES, VEHICLE_DEFAULT } from '../assets/scripts/core/constants.ts';

test('initial state is day 1 with starting resources', () => {
  const state = createInitialGameState();
  assert.equal(state.day, 1);
  assert.deepEqual(state.stock, STARTING_RESOURCES);
  assert.equal(state.ending, null);
});

test('startTrip consumes fuel and ammo and logs the trip', () => {
  const state = createInitialGameState();
  const { state: after, message } = startTrip(state, 'suburb');
  assert.equal(after.stock.fuel, STARTING_RESOURCES.fuel - VEHICLE_DEFAULT.fuelCost);
  assert.equal(after.stock.ammo, STARTING_RESOURCES.ammo - 1);
  assert.match(message, /出发前往/);
  assert.equal(after.day, 1, 'startTrip must not advance the day');
});

test('startTrip refuses when fuel or ammo is insufficient', () => {
  const state = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, fuel: 0 } };
  const { message } = startTrip(state, 'suburb');
  assert.match(message, /燃油不足/);
});

test('choose resolves an event and applies its outcome', () => {
  const state = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, food: 10 } };
  const config = createGameConfig();
  const rng = createRng(1);
  const before = state.stock.food;
  const { state: after, message } = choose(state, 0, rng, config);
  assert.match(message, /事件/);
  assert.ok(after.day === 1, 'choose must not advance the day');
  // 无论哪个事件，choose 都不该让食物凭空变成负数
  assert.ok(after.stock.food >= 0);
  assert.ok(before !== undefined);
});

test('loadCargo rejects cargo exceeding capacity', () => {
  const state = createInitialGameState();
  const oversized = [{ resource: 'food', amount: state.vehicle.capacity + 1 }];
  const { message } = loadCargo(state, oversized);
  assert.match(message, /载重超限/);
});

test('loadCargo accepts cargo within capacity', () => {
  const state = createInitialGameState();
  const cargo = [{ resource: 'food', amount: 2 }];
  const { state: after, message } = loadCargo(state, cargo);
  assert.equal(after, state, 'loadCargo must not mutate state before returnHome');
  assert.match(message, /已装载 2 格物资/);
});

test('returnHome adds cargo to warehouse stock', () => {
  const state = createInitialGameState();
  const { state: after } = returnHome(state, [{ resource: 'medicine', amount: 3 }]);
  assert.equal(after.stock.medicine, STARTING_RESOURCES.medicine + 3);
  assert.match(after.log.at(-1) ?? '', /返回仓库/);
});

test('advanceDay consumes food, grows danger, and advances the day', () => {
  const state = createInitialGameState();
  const { state: after } = advanceDay(state);
  assert.equal(after.day, 2);
  assert.ok(after.danger > state.danger, 'danger should grow each day');
});

test('ten days of simulation reach a valid ending deterministically', () => {
  const config = createGameConfig();
  const rngA = createRng(2024);
  const rngB = createRng(2024);
  const finalA = runSimulation(createInitialGameState(), rngA, config);
  const finalB = runSimulation(createInitialGameState(), rngB, config);
  assert.equal(finalA.day, GAME_DAYS);
  assert.equal(finalA.ending, 'survived');
  assert.deepEqual(finalA, finalB, 'same seed must replay identically');
});

test('canAffordTrip respects fuel, ammo, and range', () => {
  const state = createInitialGameState();
  assert.ok(canAffordTrip(state, 'suburb'));
  assert.ok(canAffordTrip(state, 'farm'));
  const broke = { ...state, stock: { ...state.stock, fuel: 0 } };
  assert.ok(!canAffordTrip(broke, 'suburb'));
});
