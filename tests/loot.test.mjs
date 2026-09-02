import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOOT_ITEM_IDS,
  LOOT_DRAW_MIN,
  LOOT_DRAW_MAX,
  buildLootWeights,
  rollNodeLoot,
  remainingLoot,
  takeLoot,
  putBackLoot,
  encodeLootState,
  decodeLootState,
  isLootItemId,
} from '../assets/scripts/core/loot.ts';
import { createRng } from '../assets/scripts/core/rng.ts';
import { LOCATIONS } from '../assets/scripts/core/game.ts';
import { DEFAULT_ITEM_DEFS } from '../assets/scripts/core/trunk.ts';

test('loot item ids all exist in trunk item defs', () => {
  for (const id of LOOT_ITEM_IDS) {
    assert.ok(
      DEFAULT_ITEM_DEFS.some((d) => d.id === id),
      `loot item ${id} must map to a trunk def`,
    );
  }
  assert.ok(!LOOT_ITEM_IDS.includes('survivor'), 'survivors are not loot');
});

test('weights: guaranteed > lean > other per location', () => {
  const farm = buildLootWeights('farm');
  assert.equal(farm.get('food'), 6); // farm guaranteed food
  assert.equal(farm.get('ammo'), 1); // untouched
  const garage = buildLootWeights('garage');
  assert.equal(garage.get('material'), 6); // guaranteed
  assert.equal(garage.get('fuel'), 4); // lean
  assert.throws(() => buildLootWeights('nowhere'));
});

test('rollNodeLoot is deterministic for the same seed', () => {
  const a = rollNodeLoot('hospital', createRng(42), 42);
  const b = rollNodeLoot('hospital', createRng(42), 42);
  assert.deepEqual(a.rolls, b.rolls);
  assert.equal(a.location, 'hospital');
  assert.equal(a.seed, 42);
});

test('rolls count within bounds, items unique', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const state = rollNodeLoot('suburb', createRng(seed), seed);
    assert.ok(state.rolls.length >= LOOT_DRAW_MIN, `seed ${seed} min count`);
    assert.ok(state.rolls.length <= LOOT_DRAW_MAX, `seed ${seed} max count`);
    const ids = state.rolls.map((r) => r.itemId);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed} unique`);
    for (const id of ids) {
      assert.ok(isLootItemId(id));
    }
  }
});

test('guaranteed fallback: most seeds include the location guarantee', () => {
  // hospital guarantees medicine; with fallback, zero-medicine draws must be rare.
  // We assert the fallback mechanics directly: craft a draw without the guarantee
  // by forcing the exact replacement path via many seeds and allow <= 2 misses
  // (fallback replaces one item, guaranteeing >= 1 hit per draw).
  let misses = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const state = rollNodeLoot('hospital', createRng(seed), seed);
    if (!state.rolls.some((r) => r.itemId === 'medicine')) {
      misses++;
    }
  }
  assert.equal(misses, 0, 'fallback must guarantee at least one guaranteed item');
});

test('takeLoot marks one card taken; putBackLoot restores', () => {
  const state = rollNodeLoot('farm', createRng(7), 7);
  const foodCard = state.rolls.find((r) => r.itemId === 'food');
  assert.ok(foodCard !== undefined, 'farm guarantee gives food');
  const taken = takeLoot(state, 'food');
  assert.equal(taken.ok, true);
  assert.equal(remainingLoot(taken.state).length, state.rolls.length - 1);
  // 第二次 take 应失败（该物品候选卡只有一张且已取）
  assert.equal(takeLoot(taken.state, 'food').ok, false);
  // 放回
  const back = putBackLoot(taken.state, 'food', 1);
  assert.equal(back.returned, 1);
  assert.equal(remainingLoot(back.state).length, state.rolls.length);
  // 未取过时放回返回 0
  assert.equal(putBackLoot(state, 'food', 1).returned, 0);
});

test('loot save: encode/decode round-trip, invalid falls back to null', () => {
  const state = rollNodeLoot('garage', createRng(11), 11);
  assert.deepEqual(decodeLootState(encodeLootState(state)), state);
  assert.equal(decodeLootState(null), null);
  assert.equal(decodeLootState(''), null);
  assert.equal(decodeLootState('not json'), null);
  assert.equal(decodeLootState('{"version":2}'), null);
  assert.equal(decodeLootState('{"version":1,"location":"nowhere","seed":1,"rolls":[]}'), null);
  assert.equal(
    decodeLootState('{"version":1,"location":"garage","seed":1,"rolls":[{"itemId":"steel","taken":false}]}'),
    null,
  );
  assert.equal(
    decodeLootState('{"version":1,"location":"garage","seed":1,"rolls":[{"itemId":"fuel","taken":"yes"}]}'),
    null,
  );
});

test('all six locations produce valid loot sessions', () => {
  for (const loc of LOCATIONS) {
    const state = rollNodeLoot(loc.id, createRng(99), 99);
    assert.ok(state.rolls.length >= LOOT_DRAW_MIN, `${loc.id} count`);
    assert.deepEqual(decodeLootState(encodeLootState(state)), state, `${loc.id} round-trip`);
  }
});
