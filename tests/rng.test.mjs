import assert from 'node:assert/strict';
import test from 'node:test';

import { createRng } from '../assets/scripts/core/rng.ts';

test('same seed produces identical sequences', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('different seeds produce different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notDeepEqual(
    Array.from({ length: 10 }, () => a.next()),
    Array.from({ length: 10 }, () => b.next()),
  );
});

test('int stays within inclusive bounds', () => {
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const value = rng.int(1, 6);
    assert.ok(value >= 1 && value <= 6, `out of bounds: ${value}`);
  }
});

test('chance returns true roughly at the given probability', () => {
  const rng = createRng(99);
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (rng.chance(0.3)) hits++;
  }
  // 300 /- 15% 容差，避免偶发 flaky
  assert.ok(hits > 250 && hits < 350, `unexpected hit count: ${hits}`);
});

test('pick returns one of the given values', () => {
  const rng = createRng(5);
  const values = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) {
    assert.ok(values.includes(rng.pick(values)));
  }
});

test('pick on empty array throws', () => {
  const rng = createRng(1);
  assert.throws(() => rng.pick([]));
});

test('state round-trips: restore resumes the same sequence', () => {
  const a = createRng(123);
  a.next();
  a.next();
  const snapshot = a.state();
  const a1 = a.next();
  const b = createRng(0);
  b.restore(snapshot);
  const b1 = b.next();
  assert.equal(a1, b1);
});
