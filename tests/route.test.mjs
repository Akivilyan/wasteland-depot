import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPOT_ROUTE,
  legFuelCost,
  createTripState,
  routeHasNode,
  depart,
  arrive,
  departReturn,
  backToMap,
  encodeTripState,
  decodeTripState,
} from '../assets/scripts/core/route.ts';

test('route skeleton: depot at 0km, five locations ascending', () => {
  assert.equal(DEPOT_ROUTE[0].id, 'depot');
  assert.equal(DEPOT_ROUTE[0].km, 0);
  assert.equal(DEPOT_ROUTE.length, 6);
  for (let i = 1; i < DEPOT_ROUTE.length; i++) {
    assert.ok(DEPOT_ROUTE[i].km > DEPOT_ROUTE[i - 1].km, 'km must ascend along the route');
  }
});

test('legFuelCost rounds up per 10km, minimum 1 for positive distance', () => {
  assert.equal(legFuelCost(0), 0);
  assert.equal(legFuelCost(-5), 0);
  assert.equal(legFuelCost(10), 1);
  assert.equal(legFuelCost(1), 1);
  assert.equal(legFuelCost(11), 2);
  assert.equal(legFuelCost(25), 3);
  assert.equal(legFuelCost(90), 9);
});

test('routeHasNode covers depot and locations, rejects unknown', () => {
  assert.equal(routeHasNode('depot'), true);
  assert.equal(routeHasNode('suburb'), true);
  assert.equal(routeHasNode('ammo_factory'), true);
  assert.equal(routeHasNode('riverside'), false);
  assert.equal(routeHasNode('nowhere'), false);
});

test('depart validates phase, destination and fuel; driving state records cost', () => {
  const fresh = createTripState();
  // 非法目的地
  const bad = depart(fresh, 'riverside', 99);
  assert.equal(bad.fuelCost, 0);
  assert.ok(bad.reason !== null);
  // 燃油不足（90km → 9 油）
  const poor = depart(fresh, 'ammo_factory', 8);
  assert.equal(poor.fuelCost, 0);
  assert.match(poor.reason ?? '', /燃油不足/);
  // 合法出发
  const ok = depart(fresh, 'hospital', 5);
  assert.equal(ok.fuelCost, 5);
  assert.equal(ok.reason, null);
  assert.equal(ok.state.phase, 'driving');
  assert.equal(ok.state.destination, 'hospital');
  assert.equal(ok.state.fuelSpent, 5);
  // 非 map 阶段不能再次出发
  const again = depart(ok.state, 'farm', 99);
  assert.equal(again.fuelCost, 0);
});

test('arrive/departReturn/backToMap walk the phase machine forward only', () => {
  let t = createTripState();
  // 在 map 阶段 arrive/departReturn 是无操作
  assert.equal(arrive(t).phase, 'map');
  assert.equal(departReturn(t).phase, 'map');
  t = depart(t, 'farm', 99).state;
  assert.equal(t.phase, 'driving');
  t = arrive(t);
  assert.equal(t.phase, 'atNode');
  // driving 阶段不能直接返程
  assert.equal(departReturn({ ...t, phase: 'driving' }).phase, 'driving');
  t = departReturn(t);
  assert.equal(t.phase, 'returning');
  t = backToMap(t);
  assert.equal(t.phase, 'map');
  assert.equal(t.destination, null);
  assert.equal(t.fuelSpent, 0);
});

test('trip state round-trips through encode/decode', () => {
  let t = depart(createTripState(), 'garage', 99).state;
  t = arrive(t);
  const restored = decodeTripState(encodeTripState(t));
  assert.deepEqual(restored, t);
});

test('decode falls back to fresh state on garbage input', () => {
  assert.deepEqual(decodeTripState(null), createTripState());
  assert.deepEqual(decodeTripState(''), createTripState());
  assert.deepEqual(decodeTripState('not json'), createTripState());
  assert.deepEqual(decodeTripState('{"phase":"flying"}'), createTripState());
  assert.deepEqual(decodeTripState('{"phase":"driving","destination":42}'), createTripState());
  const driving = decodeTripState('{"phase":"driving","destination":"farm","fuelSpent":3}');
  assert.equal(driving.phase, 'driving');
  assert.equal(driving.destination, 'farm');
  assert.equal(driving.fuelSpent, 3);
});
