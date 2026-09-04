import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInitialGameState,
  startTrip,
  drawRoadEvent,
  resolveEvent,
  loadCargo,
  returnHome,
  cargoFromTrunk,
  advanceDay,
  runSimulation,
  canAffordTrip,
} from '../assets/scripts/core/sim.ts';
import { createGameConfig } from '../assets/scripts/core/game.ts';
import { createRng } from '../assets/scripts/core/rng.ts';
import { GAME_DAYS, STARTING_RESOURCES } from '../assets/scripts/core/constants.ts';
import { legFuelCost } from '../assets/scripts/core/route.ts';
import { createTrunkState, placeItem, DEFAULT_ITEM_DEFS } from '../assets/scripts/core/trunk.ts';

test('initial state is day 1 with starting resources', () => {
  const state = createInitialGameState();
  assert.equal(state.day, 1);
  assert.deepEqual(state.stock, STARTING_RESOURCES);
  assert.equal(state.ending, null);
});

test('startTrip consumes distance-based fuel and ammo and logs the trip', () => {
  const state = createInitialGameState();
  const { state: after, message } = startTrip(state, 'suburb');
  const fuelCost = legFuelCost(10); // 城郊 10km → 与地图节点牌一致
  assert.equal(after.stock.fuel, STARTING_RESOURCES.fuel - fuelCost);
  assert.equal(after.stock.ammo, STARTING_RESOURCES.ammo - 1);
  assert.match(message, /出发前往/);
  assert.equal(after.day, 1, 'startTrip must not advance the day');
});

test('startTrip refuses non-route locations', () => {
  const state = createInitialGameState();
  const { message } = startTrip(state, 'riverside'); // 河边不在首版单线路线上
  assert.match(message, /不在路线图上/);
});

test('startTrip refuses when fuel or ammo is insufficient', () => {
  const noFuel = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, fuel: 0 } };
  assert.match(startTrip(noFuel, 'suburb').message, /燃油不足/);
  const noAmmo = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, ammo: 0 } };
  assert.match(startTrip(noAmmo, 'suburb').message, /弹药不足/);
});

test('drawRoadEvent is deterministic per seed and returns null or a table event', () => {
  const config = createGameConfig();
  const a = drawRoadEvent(createRng(7), config);
  const b = drawRoadEvent(createRng(7), config);
  assert.equal(a?.id ?? null, b?.id ?? null, '同种子必须抽出同一结果（含 null）');
  if (a !== null) {
    assert.ok(config.eventTable.some((e) => e.id === a.id), '抽中事件必须来自事件表');
  }
  // 概率闸门：存在让事件落空的种子（无事件趟次存在）
  const draws = Array.from({ length: 40 }, (_, i) => drawRoadEvent(createRng(i + 100), config));
  assert.ok(draws.some((e) => e === null), 'ROAD_EVENT_CHANCE<1 时应当出现无事件趟次');
});

test('resolveEvent applies gain outcome, logs it, and never advances the day', () => {
  const state = createInitialGameState();
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'supply_cache');
  assert.ok(event);
  const before = state.stock.food;
  const { state: after, message } = resolveEvent(state, event, 0, config); // 搜刮 → 食物+3
  assert.equal(after.stock.food, before + 3);
  assert.equal(after.day, 1, 'resolveEvent must not advance the day');
  assert.match(message, /事件「补给点」/);
  assert.match(after.log.at(-1) ?? '', /补给点/);
});

test('resolveEvent clamps losses at zero (no negative stock)', () => {
  const state = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, ammo: 0 } };
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'roadblock');
  assert.ok(event);
  const { state: after, message } = resolveEvent(state, event, 1, config); // 强闯 → 弹药-2
  assert.equal(after.stock.ammo, 0, '库存不足时损失应截断到 0');
  assert.match(message, /失去 0/);
});

test('resolveEvent reveal outcome adds the location to explored', () => {
  const state = createInitialGameState();
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'radar_contact');
  assert.ok(event);
  assert.ok(!state.explored.includes('hospital'));
  const { state: after } = resolveEvent(state, event, 0, config); // 追踪 → 揭示医院
  assert.ok(after.explored.includes('hospital'));
});

test('resolveEvent vehicle protection reduces damage outcome', () => {
  const state = { ...createInitialGameState(), vehicle: { ...createInitialGameState().vehicle, protection: 2 } };
  const config = createGameConfig();
  // 当前事件表无 damage 条目，构造合成事件验证防护减免分支
  const damageEvent = {
    id: 'synthetic_hit', kind: 'hazard', title: '撞击',
    choices: ['硬扛'], outcomes: [{ type: 'damage', amount: 5 }],
    protectionSensitive: true,
  };
  const { message } = resolveEvent(state, damageEvent, 0, config);
  assert.match(message, /车辆受损 3/, '防护 2 点应把 5 点伤害减到 3');
});

test('resolveEvent recruit outcome adds a survivor to the depot', () => {
  const state = createInitialGameState();
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'survivor_call');
  assert.ok(event);
  const { state: after, message } = resolveEvent(state, event, 0, config); // 救助 → 招募
  assert.equal(after.survivors.length, 1, '救助必须真实招募幸存者');
  assert.equal(after.survivors[0].profession, 'doctor');
  assert.equal(after.day, 1, '招募不推进天数');
  assert.match(message, /医生/);
  assert.match(after.log.at(-1) ?? '', /加入了据点/);
});

test('resolveEvent damage outcome flags vehicleDamaged', () => {
  const state = createInitialGameState();
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'ambush');
  assert.ok(event);
  const { state: after } = resolveEvent(state, event, 0, config); // 反击 → damage
  assert.equal(after.vehicleDamaged, true, 'damage 后果必须置车辆损坏标记');
});

test('resolveEvent rejects invalid choice without mutating state', () => {
  const state = createInitialGameState();
  const config = createGameConfig();
  const event = config.eventTable.find((e) => e.id === 'roadblock');
  assert.ok(event);
  const { state: after, message } = resolveEvent(state, event, 9, config);
  assert.equal(after, state, '无效选择必须原样返回同一状态');
  assert.match(message, /无效选择/);
});

test('resolving every event with empty stock never yields negative resources', () => {
  const config = createGameConfig();
  for (const event of config.eventTable) {
    const state = { ...createInitialGameState(), stock: { fuel: 0, food: 0, material: 0, medicine: 0, ammo: 0 } };
    for (let i = 0; i < event.choices.length; i++) {
      const { state: after } = resolveEvent(state, event, i, config);
      for (const value of Object.values(after.stock)) {
        assert.ok(value >= 0, `${event.id} 选项${i} 导致负库存`);
      }
    }
  }
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

test('returnHome accepts unit loads beyond cell capacity (grid fit enforced by trunk)', () => {
  // 载重占格由货舱放置保证；入库按物资单位折算，不按格数复查
  const state = createInitialGameState();
  const { state: after } = returnHome(state, [{ resource: 'food', amount: 25 }]);
  assert.equal(after.stock.food, STARTING_RESOURCES.food + 25);
});

test('cargoFromTrunk folds trunk items into per-resource loads', () => {
  let trunk = createTrunkState();
  trunk = placeItem(trunk, DEFAULT_ITEM_DEFS, 'food', 0, 0).state; // 1x1
  trunk = placeItem(trunk, DEFAULT_ITEM_DEFS, 'food', 1, 0).state; // 堆叠到同组
  trunk = placeItem(trunk, DEFAULT_ITEM_DEFS, 'fuel', 2, 0).state; // 2x1
  const cargo = cargoFromTrunk(trunk, DEFAULT_ITEM_DEFS);
  assert.deepEqual(cargo, [
    { resource: 'food', amount: 2 },
    { resource: 'fuel', amount: 1 },
  ]);
});

test('advanceDay consumes food, grows danger, and advances the day', () => {
  const state = createInitialGameState();
  const { state: after } = advanceDay(state);
  assert.equal(after.day, 2);
  assert.ok(after.danger > state.danger, 'danger should grow each day');
});

test('advanceDay uses DANGER_STEP for the hunger penalty', () => {
  const fed = createInitialGameState();
  const starving = { ...createInitialGameState(), stock: { ...STARTING_RESOURCES, food: 1 } };
  const fedNext = advanceDay(fed).state;
  const starvedNext = advanceDay(starving).state;
  assert.equal(starvedNext.danger - starving.danger, fedNext.danger - fed.danger + 1,
    'food shortage must add exactly one DANGER_STEP on top of daily growth');
});

test('advanceDay only ends the game after day 10 has been played out', () => {
  // 玩满十天：第 9 天结算 → 第 10 天（无结局），第 10 天结算 → ending。
  // 旧行为在第 9 天返仓时即触发结局，玩家实际只玩 9 天。
  let state = createInitialGameState();
  for (let i = 0; i < 9; i++) {
    state = advanceDay(state).state;
    assert.equal(state.ending, null, `结算到第 ${state.day} 天不应提前出结局`);
  }
  state = advanceDay(state).state;
  assert.equal(state.day, GAME_DAYS);
  assert.equal(state.ending, 'survived', '第 10 天结算完毕才进入存活结局');
});

test('advanceDay backfills survived ending for day-10 saves without one', () => {
  // 注入/异常可能产生 day==GAME_DAYS 且 ending==null 的存档；守卫必须兜底，不能永远卡住。
  const stuck = { ...createInitialGameState(), day: GAME_DAYS };
  const { state: after, message } = advanceDay(stuck);
  assert.equal(after.ending, 'survived', 'day-10 存档补结局');
  assert.match(message, /最后一天/);
  // 已有结局的存档原样返回，不覆盖
  const done = { ...createInitialGameState(), day: GAME_DAYS, ending: 'survived' };
  assert.equal(advanceDay(done).state, done, '已有结局的存档原样返回');
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

test('canAffordTrip respects distance fuel, ammo, route, and range', () => {
  const state = createInitialGameState();
  assert.ok(canAffordTrip(state, 'suburb'));
  assert.ok(canAffordTrip(state, 'farm'));
  assert.ok(!canAffordTrip(state, 'riverside'), '非路线地点不可出发');
  const broke = { ...state, stock: { ...state.stock, fuel: 0 } };
  assert.ok(!canAffordTrip(broke, 'suburb'));
  const noAmmo = { ...state, stock: { ...state.stock, ammo: 0 } };
  assert.ok(!canAffordTrip(noAmmo, 'suburb'));
});
