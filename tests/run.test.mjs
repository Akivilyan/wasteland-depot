// SLICE_007 引擎测试：长局命令链（run.ts）玩家视角语义复述。
//
// 口径对照 GAME_DESIGN：去程 1 天不扣 → 每节点 1 天扣油食 → 返程 1 天不扣；
// 波次每 20 天日结；失败唯一线 = 全员濒死。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../assets/scripts/core/rng.ts';
import {
  createNewGame,
  startExpedition,
  nextNode,
  takeScavenge,
  resolveEvent,
  meetNpc,
  applyExpeditionBattle,
  endExpedition,
  applyHomeBattle,
  applyFinalBattle,
  upgradeStockCap,
  upgradeWallHp,
  upgradeVehicleDurability,
  upgradeWeapon,
  buySlot,
  buySeat,
  repair,
  healMember,
  useSerum,
  submitQuest,
  recruitNpc,
  canStartExpedition,
  stockCap,
  nextWaveDay,
  tierSum,
  ladderCost,
  isLayerUnlocked,
} from '../assets/scripts/core/run.ts';
import {
  encodeGameState,
  decodeGameState,
  RUN_SAVE_KEY,
} from '../assets/scripts/core/state.ts';
import { SLOT_LADDER, SEAT_LADDER } from '../assets/scripts/core/config.ts';

const seedRng = (seed = 20261024) => createRng(seed);

function newGame(hero = 'captain') {
  return createNewGame(hero, 20261024);
}

function depart(state, region = 'food', tier = 'outer') {
  return startExpedition(state, region, tier, seedRng(state.rngState)).state;
}

// —— 初始态 ——

test('new game: day 1, one starting member, outer layers all unlocked, stock caps 100', () => {
  const state = newGame();
  assert.equal(state.day, 1);
  assert.equal(state.members.length, 1);
  assert.equal(state.members[0].hp, 100);
  assert.equal(state.stock.fuel, 10);
  for (const region of ['food', 'oil', 'pharma', 'arms', 'industry', 'mall']) {
    assert.ok(isLayerUnlocked(state, region, 'outer'));
    assert.ok(!isLayerUnlocked(state, region, 'inner'));
    assert.ok(!isLayerUnlocked(state, region, 'core'));
  }
  assert.equal(stockCap(state, 'food'), 100);
  assert.equal(nextWaveDay(state), 20);
});

// —— 出发与节点推进 ——

test('expedition day model: outbound 1 day free, each node 1 day with fuel/food, return 1 day free', () => {
  let state = newGame();
  state = depart(state); // 去程：day 1 → 2
  assert.equal(state.day, 2);
  const rng = seedRng(state.rngState);

  const node1 = nextNode(state, rng); // 节点 1：day 2 → 3，外围免油
  state = node1.state;
  assert.equal(state.day, 3);
  assert.equal(state.stock.fuel, 10); // 外围 0 油
  assert.equal(state.stock.food, 8); // 1 人 × 2 食
  assert.equal(node1.encounter === null, false);

  state = endExpedition(state).state; // 返程：day 3 → 4
  assert.equal(state.day, 4);
  assert.equal(state.stock.food, 8); // 返程不扣食
});

test('layer fuel: inner costs 1 fuel per node day; cannot depart without first-day fuel', () => {
  let state = newGame();
  state = { ...state, unlockedLayers: [...state.unlockedLayers, 'food.inner'] };
  assert.equal(canStartExpedition(state, 'food', 'inner'), null);
  state = depart(state, 'food', 'inner');
  let rng = seedRng(state.rngState);
  const node = nextNode(state, rng);
  assert.equal(node.state.stock.fuel, 9); // 内部 1 油/节点日
  // 油耗尽：强制返程
  let drained = { ...node.state, stock: { ...node.state.stock, fuel: 0 } };
  const forced = nextNode(drained, rng);
  assert.equal(forced.forcedReturn, true);
  assert.equal(forced.encounter, null);
  // 内部层油不足付首日：不可选
  const noFuel = newGame();
  assert.match(
    canStartExpedition({ ...noFuel, unlockedLayers: [...noFuel.unlockedLayers, 'food.inner'], stock: { ...noFuel.stock, fuel: 0 } }, 'food', 'inner'),
    /燃油不足/,
  );
});

test('locked layer and mid-expedition guards reject departure', () => {
  const state = newGame();
  assert.match(canStartExpedition(state, 'food', 'core'), /未解锁/);
  const away = depart(state);
  assert.match(canStartExpedition(away, 'oil', 'outer'), /探索途中/);
});

test('starvation: missing food costs 2 hp per member per day; all dying = defeat', () => {
  let state = newGame();
  state = { ...state, stock: { ...state.stock, food: 0 } }; // 断粮
  state = depart(state);
  let rng = seedRng(state.rngState);
  const node = nextNode(state, rng);
  state = node.state;
  assert.equal(state.members[0].hp, 98); // -2 血
  assert.match(node.message, /断粮/);

  // 打到全员濒死：失败
  state = { ...state, members: state.members.map((m) => ({ ...m, hp: 2, dying: false })) };
  state = depart(state);
  rng = seedRng(state.rngState);
  const fatal = nextNode(state, rng);
  assert.equal(fatal.state.members[0].dying, true);
  assert.equal(fatal.state.ending, 'defeat');
});

test('scavenge flows into hold; over-capacity part stays behind (the core tradeoff)', () => {
  let state = newGame();
  state = depart(state, 'food');
  const result = takeScavenge(state, { resource: 'food', amount: 999 });
  // 12 格 × 50 = 600 上限
  assert.equal(result.state.expedition?.hold.slots.length, 12);
  assert.match(result.message, /装不下留在现场/);
});

// —— 事件 ——

test('event outcomes: gain loads hold, vehicleDamage forces return at zero durability', () => {
  let state = newGame();
  state = depart(state, 'arms');
  state = { ...state, vehicle: { ...state.vehicle, durability: 15 } };
  const hurt = resolveEvent(state, 'ambush-dogs', 0); // 15 车损
  assert.equal(hurt.state.vehicle.durability, 0);
  assert.equal(hurt.state.expedition?.forcedReturn, true);
  assert.match(hurt.message, /强制返程/);

  const gain = resolveEvent(depart(newGame('stark')), 'collapsed-shelf', 0);
  assert.equal(gain.state.expedition?.hold.slots[0]?.amount, 3); // 史塔克不加探索掉落
});

test('captain doubles non-fuel scavenge loot; fuel stays flat', () => {
  // 队长：全资源 ×2 → 食物 3 → 6
  let captainState = depart(newGame('captain'));
  let captain = resolveEvent(captainState, 'collapsed-shelf', 0);
  assert.equal(captain.state.expedition?.hold.slots[0]?.amount, 6);

  // 小当家：食物 ×2 同样生效；史塔克不生效
  let cookState = depart(newGame('cook'));
  let cook = resolveEvent(cookState, 'collapsed-shelf', 0);
  assert.equal(cook.state.expedition?.hold.slots[0]?.amount, 6);
  let starkState = depart(newGame('stark'));
  let stark = resolveEvent(starkState, 'collapsed-shelf', 0);
  assert.equal(stark.state.expedition?.hold.slots[0]?.amount, 3);
});

// —— NPC 首遇与任务 ——

test('npc encounter records quest by tier depth; submit consumes stock; recruit is a second payment', () => {
  let state = newGame('cook');
  state = depart(state, 'food');
  const met = meetNpc(state, { npcId: 'food-1', questResource: 'food', questAmount: 10 });
  state = met.state;
  assert.ok(state.npcMet.includes('food-1'));
  assert.deepEqual(state.npcQuests['food-1'], { resource: 'food', amount: 10 });

  state = endExpedition(state).state;
  // 未完成前不能招募
  assert.match(recruitNpc(state, 'food-1', 'resource').message, /先完成任务/);
  // 材料不够扣 10 食物前：食物 10-节点消耗……直接补足
  state = { ...state, stock: { ...state.stock, food: 50 } };
  const submitted = submitQuest(state, 'food-1');
  assert.equal(submitted.state.stock.food, 40);
  assert.ok(submitted.state.npcQuestsDone.includes('food-1'));

  // 入队第二笔：小当家可用 40 食物
  const recruited = recruitNpc(submitted.state, 'food-1', 'food');
  assert.equal(recruited.state.members.length, 2);
  assert.equal(recruited.state.stock.food, 0); // 40 食物
  // 座位满（2 座 2 人）：拒绝再招
  const blocked = recruitNpc({ ...recruited.state, npcQuestsDone: [...recruited.state.npcQuestsDone, 'food-2'], npcQuests: { ...recruited.state.npcQuests, 'food-2': { resource: 'food', amount: 10 } } }, 'food-2', 'resource');
  assert.match(blocked.message, /座位不足/);
});

// —— 战斗结算 ——

test('expedition battle: victory loots region resource x2 into hold; defeat breaches vehicle then members', () => {
  let state = newGame('pharmacist'); // 无掉落加成，掉落即基础值
  state = depart(state, 'food');
  let rng = seedRng(state.rngState);
  const win = applyExpeditionBattle(state, rng, false, { victory: true, breachDamage: 0, ammoSpent: 20 });
  assert.equal(win.state.stock.ammo, 10); // 30 - 20
  assert.equal(win.state.expedition?.hold.slots[0]?.resource, 'food');
  assert.equal(win.state.expedition?.hold.slots[0]?.amount, 2); // 外围 1 × 战斗 2 倍

  const loss = applyExpeditionBattle(state, rng, false, { victory: false, breachDamage: 230, ammoSpent: 0 });
  assert.equal(loss.state.vehicle.durability, 0); // 200 耐久吃 200
  assert.equal(loss.state.members[0].hp, 70); // 剩 30 伤进人
  assert.equal(loss.state.expedition?.forcedReturn, true);
  assert.match(loss.message, /强制返仓/);
});

test('boss victory unlocks next layer / grants part; 4 parts start finale countdown', () => {
  let state = newGame();
  state = { ...state, unlockedLayers: [...state.unlockedLayers, 'food.inner', 'food.core'] };
  state = depart(state, 'food', 'outer');
  let rng = seedRng(state.rngState);
  const bossWin = applyExpeditionBattle(state, rng, true, { victory: true, breachDamage: 0, ammoSpent: 50 });
  assert.ok(bossWin.state.unlockedLayers.includes('food.inner'));
  assert.ok(bossWin.state.bossKilled.includes('food.outer'));
  assert.equal(bossWin.state.parts.length, 0); // 食品厂外围 boss 掉地图不掉零件

  // 集齐 4 零件：返仓 → 再出发购物中心核心 → boss 掉第 4 件
  const back = endExpedition(bossWin.state).state;
  let finale = { ...back, parts: ['transmitter', 'amplifier', 'regulator'], unlockedLayers: [...back.unlockedLayers, 'mall.core'] };
  finale = depart(finale, 'mall', 'core');
  assert.notEqual(finale.expedition, null);
  const partWin = applyExpeditionBattle(finale, rng, true, { victory: true, breachDamage: 0, ammoSpent: 0 });
  assert.equal(partWin.state.parts.length, 4);
  assert.equal(partWin.state.finaleCountdown, 10);
  // 已杀 boss 不重复掉落
  const again = applyExpeditionBattle(partWin.state, rng, true, { victory: true, breachDamage: 0, ammoSpent: 0 });
  assert.match(again.message, /已被击杀/);
});

// —— 波次日历与守家 ——

test('wave calendar: day 20 triggers home battle at depot; absent expedition loses wall + stock', () => {
  let state = newGame();
  // 快进到第 18 天出发、节点推到 20：在途缺席
  state = { ...state, day: 18, stock: { ...state.stock, food: 100, fuel: 100 } };
  state = depart(state, 'food'); // 去程 → 19
  let rng = seedRng(state.rngState);
  const node = nextNode(state, rng); // → 20：波次日结在途
  assert.equal(node.state.day, 20);
  assert.equal(node.waveTriggered, 1);
  assert.equal(node.state.wall.hp, 0);
  assert.equal(node.state.stock.material, 0); // 五资源清空
  assert.equal(node.state.wavesPassed, 1);
  // 地图/零件/升级保留
  assert.deepEqual(node.state.unlockedLayers, []);
  assert.equal(node.state.vehicle.slots, 12);

  // 在仓触发：出发日恰逢波次日 → 先守家、不出发
  const ticked = startExpedition({ ...newGame(), day: 19 }, 'food', 'outer', rng);
  assert.equal(ticked.state.day, 20);
  assert.equal(ticked.state.homeBattlePending, true);
  assert.equal(ticked.state.expedition, null); // 未出发，先守家

  const defended = applyHomeBattle(ticked.state, { victory: true, breachDamage: 150, ammoSpent: 30 });
  assert.equal(defended.state.wall.hp, 50); // 200 - 150
  assert.equal(defended.state.wavesDefended, 1);
  assert.equal(defended.state.homeBattlePending, false);
});

// —— 终局链 ——

test('finale: countdown reaching zero at depot blocks departure; away trips defer to return; victory ends game', () => {
  // 出发日倒计时归零：在仓立即触发最终战，不许出发
  const blocked = startExpedition(
    { ...newGame(), day: 30, parts: ['transmitter', 'amplifier', 'regulator', 'antenna'], finaleCountdown: 1 },
    'food',
    'outer',
    seedRng(1),
  );
  assert.equal(blocked.state.day, 31);
  assert.equal(blocked.state.finalePending, true);
  assert.equal(blocked.state.expedition, null);
  assert.match(blocked.message, /最终决战/);

  // 在途归零：顺延至返仓当刻
  let state = newGame();
  state = { ...state, day: 29, parts: ['transmitter', 'amplifier', 'regulator', 'antenna'], finaleCountdown: 2 };
  state = depart(state, 'food'); // 去程 → 30，countdown → 1
  assert.equal(state.finaleCountdown, 1);
  let rng = seedRng(state.rngState);
  const nodeAway = nextNode(state, rng); // 节点 → 31，countdown → 0 在途
  assert.equal(nodeAway.state.finaleCountdown, 0);
  assert.equal(nodeAway.state.finalePending, false); // 在途顺延
  const returned = endExpedition(nodeAway.state);
  assert.equal(returned.state.finalePending, true); // 返仓当刻触发

  const finalWin = applyFinalBattle(returned.state, { victory: true, breachDamage: 0 });
  assert.equal(finalWin.state.ending, 'victory');
});

// —— 仓库命令 ——

test('upgrades consume material; captain pays 75%; ladders escalate', () => {
  let state = newGame('captain');
  state = { ...state, stock: { ...state.stock, material: 1000 } };
  // 队长储量 30 → 23
  const upgraded = upgradeStockCap(state);
  assert.equal(upgraded.state.stockUpgradeLevel, 1);
  assert.equal(upgraded.state.stock.material, 1000 - 23);
  assert.equal(stockCap(upgraded.state, 'food'), 150);

  // 普通队长价对照：无折扣英雄付 30
  const plain = upgradeStockCap({ ...newGame('stark'), stock: { ...state.stock, material: 1000 } });
  assert.equal(plain.state.stock.material, 970);

  // 梯度：储物 20/20/40/40/60/60…；载客 40/60/80/100…
  assert.equal(ladderCost(SLOT_LADDER, 0), 20);
  assert.equal(ladderCost(SLOT_LADDER, 2), 40);
  assert.equal(ladderCost(SLOT_LADDER, 5), 60);
  assert.equal(ladderCost(SLOT_LADDER, 6), 80); // 表尾外 +20
  assert.equal(ladderCost(SEAT_LADDER, 0), 40);
  assert.equal(ladderCost(SEAT_LADDER, 3), 100);
  assert.equal(ladderCost(SEAT_LADDER, 4), 120);

  const seat = buySeat({ ...state, vehicle: { ...state.vehicle, seats: 2 }, members: [state.members[0]] });
  assert.equal(seat.state.vehicle.seats, 3);
});

test('repair: 1 material = 10 durability, capped', () => {
  let state = newGame();
  state = { ...state, stock: { ...state.stock, material: 5 }, vehicle: { ...state.vehicle, durability: 150 } };
  const fixed = repair(state, 'vehicle', 3); // 30 耐久 = 3 材料
  assert.equal(fixed.state.vehicle.durability, 180);
  assert.equal(fixed.state.stock.material, 2);
  const wall = repair({ ...state, wall: { hp: 180, level: 0 }, stock: { ...state.stock, material: 99 } }, 'wall', 99);
  assert.equal(wall.state.wall.hp, 200); // 上限截止，不多扣材料
});

test('medicine heals 10 and revives dying; serum is pharmacist-only, +50/+50, hard cap 200', () => {
  let state = newGame();
  state = { ...state, members: [{ ...state.members[0], hp: 85, dying: true }], stock: { ...state.stock, medicine: 10 } };
  const healed = healMember(state, 0);
  assert.equal(healed.state.members[0].hp, 95);
  assert.equal(healed.state.members[0].dying, false);

  // 非药神不能用补剂
  const denied = useSerum({ ...state, hero: 'stark' }, 0);
  assert.match(denied.message, /药神/);

  const pharma = useSerum({ ...state, hero: 'pharmacist', stock: { ...state.stock, medicine: 5 } }, 0);
  assert.equal(pharma.state.members[0].hpCap, 150);
  assert.equal(pharma.state.members[0].hp, 135); // 85 + 50
  assert.equal(pharma.state.stock.medicine, 0);

  // 硬顶 200
  const capped = useSerum({ ...pharma.state, members: [{ ...pharma.state.members[0], hpCap: 180, hp: 180 }], stock: { ...pharma.state.stock, medicine: 20 } }, 0);
  assert.equal(capped.state.members[0].hpCap, 200);
});

// —— 返程入库溢出 ——

test('return home: overflow beyond stock cap is discarded', () => {
  let state = newGame();
  state = depart(state, 'food');
  state = takeScavenge(state, { resource: 'food', amount: 300 }).state; // 装得下（12 格 ×50=600）
  const returned = endExpedition(state);
  assert.equal(returned.state.stock.food, 100); // 上限 100，溢出作废
  assert.match(returned.message, /溢出作废/);
});

// —— 存档 ——

test('save round-trip preserves full expedition state', () => {
  let state = newGame();
  state = depart(state, 'pharma');
  state = takeScavenge(state, { resource: 'medicine', amount: 7 }).state;
  const encoded = encodeGameState(state);
  assert.equal(typeof encoded, 'string');
  const decoded = decodeGameState(encoded);
  assert.ok(decoded !== null);
  assert.equal(decoded.day, state.day);
  assert.deepEqual(decoded.expedition?.hold, state.expedition?.hold);
  assert.equal(decoded.rngState, state.rngState);
  assert.equal(decodeGameState('not json'), null);
  assert.equal(RUN_SAVE_KEY, 'wasteland-depot.run.v2');
});
