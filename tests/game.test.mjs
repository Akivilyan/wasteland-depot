import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESOURCE_IDS,
  LOCATIONS,
  LOCATION_IDS,
  PROFESSIONS,
  createGameConfig,
  emptyStock,
  applyOutcome,
  pickEvent,
  eventById,
} from '../assets/scripts/core/game.ts';
import { createRng } from '../assets/scripts/core/rng.ts';

test('exactly five resources exist and are the canonical set', () => {
  assert.deepEqual(RESOURCE_IDS, ['fuel', 'food', 'material', 'medicine', 'ammo']);
});

test('six locations exist with non-empty leans', () => {
  assert.equal(LOCATIONS.length, 6);
  assert.deepEqual(LOCATION_IDS.length, 6);
  for (const loc of LOCATIONS) {
    assert.ok(loc.lean.length > 0, `location ${loc.id} has empty lean`);
    assert.ok(loc.guaranteed.length > 0, `location ${loc.id} has no guaranteed resource`);
    assert.ok(loc.risk >= 0 && loc.risk <= 1, `location ${loc.id} risk out of range`);
  }
});

test('four professions exist', () => {
  assert.equal(PROFESSIONS.length, 4);
});

test('config exposes vehicle with capacity and fuelCost', () => {
  const config = createGameConfig();
  assert.ok(config.vehicle.capacity > 0);
  assert.ok(config.vehicle.fuelCost > 0);
});

test('applyOutcome gain adds to stock', () => {
  const config = createGameConfig();
  const { stock, message } = applyOutcome(emptyStock(), { type: 'gain', resource: 'food', amount: 3 }, config);
  assert.equal(stock.food, 3);
  assert.match(message, /获得 3 食物/);
});

test('applyOutcome lose never goes below zero', () => {
  const config = createGameConfig();
  const { stock } = applyOutcome(emptyStock(), { type: 'lose', resource: 'fuel', amount: 5 }, config);
  assert.equal(stock.fuel, 0);
});

test('pickEvent returns an event from the table', () => {
  const config = createGameConfig();
  const rng = createRng(10);
  for (let i = 0; i < 50; i++) {
    const event = pickEvent(rng, config);
    assert.ok(config.eventTable.some((e) => e.id === event.id));
    assert.ok(event.choices.length >= 2, `event ${event.id} needs >= 2 choices`);
  }
});

test('every event has a matching outcome per choice', () => {
  const config = createGameConfig();
  for (const event of config.eventTable) {
    assert.equal(event.choices.length, event.outcomes.length, `event ${event.id} choice/outcome mismatch`);
  }
});

test('eventById finds known and throws on unknown', () => {
  const config = createGameConfig();
  assert.ok(eventById('roadblock', config));
  assert.throws(() => eventById('nope', config));
});
