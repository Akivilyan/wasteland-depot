// SLICE_007 数据层测试：货舱槽位（hold）、区域/节点生成（regions）、战斗结算（combat）、boss 掉落（boss）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../assets/scripts/core/rng.ts';
import {
  createHold,
  loadResource,
  remainingCapacity,
  unloadResource,
  holdTotals,
} from '../assets/scripts/core/hold.ts';
import {
  rollNodeKind,
  nextNodeRoll,
  isNpcPityNode,
  rollScavenge,
  rollMonsterEncounter,
  bossEncounter,
  npcsInRegion,
} from '../assets/scripts/core/regions.ts';
import {
  applyDamagePipeline,
  waveComposition,
  weaponProfile,
  ramDamage,
} from '../assets/scripts/core/combat.ts';
import { layerBossDrop } from '../assets/scripts/core/boss.ts';

// —— hold：每格类型上限、堆叠、开新槽 ——

test('hold stacks same resource up to slot cap then opens new slot', () => {
  let hold = createHold();
  // 食物每格上限 50：装 80 → 第一格 50 + 第二格 30
  const first = loadResource(hold, 'food', 80, 12);
  assert.equal(first.loaded, 80);
  assert.equal(first.hold.slots.length, 2);
  assert.equal(first.hold.slots[0].amount, 50);
  assert.equal(first.hold.slots[1].amount, 30);

  // 槽满后装不下
  let full = createHold();
  for (let i = 0; i < 2; i++) full = loadResource(full, 'ammo', 100, 2).hold;
  const overflow = loadResource(full, 'ammo', 50, 2);
  assert.equal(overflow.loaded, 0);
  assert.equal(remainingCapacity(full, 'ammo', 2), 0);
});

test('hold unload and totals', () => {
  let hold = createHold();
  hold = loadResource(hold, 'food', 30, 12).hold;
  hold = loadResource(hold, 'fuel', 10, 12).hold;
  hold = unloadResource(hold, 'food', 12);
  const totals = holdTotals(hold);
  assert.deepEqual(
    totals.sort((a, b) => a.resource.localeCompare(b.resource)),
    [
      { resource: 'food', amount: 18 },
      { resource: 'fuel', amount: 10 },
    ],
  );
});

// —— regions：5:2:2 权重、保底必遇 ——

test('rollNodeKind approximates 5:2:2 over many rolls', () => {
  const rng = createRng(42);
  const counts = { scavenge: 0, event: 0, monster: 0 };
  for (let i = 0; i < 9000; i++) counts[rollNodeKind(rng)]++;
  const total = counts.scavenge + counts.event + counts.monster;
  assert.ok(Math.abs(counts.scavenge / total - 5 / 9) < 0.02, `scavenge=${counts.scavenge / total}`);
  assert.ok(Math.abs(counts.event / total - 2 / 9) < 0.02, `event=${counts.event / total}`);
  assert.ok(Math.abs(counts.monster / total - 2 / 9) < 0.02, `monster=${counts.monster / total}`);
});

test('boss pity: 10th node in layer is boss until killed', () => {
  const rng = createRng(7);
  // 第 1~9 个普通 roll
  for (let n = 1; n <= 9; n++) {
    const roll = nextNodeRoll(rng, 'food.outer', n - 1, 0, false, []);
    assert.notEqual(roll.kind, 'boss', `node ${n} should not be boss`);
  }
  // 第 10 个必 boss
  assert.equal(nextNodeRoll(rng, 'food.outer', 9, 9, false, []).kind, 'boss');
  // boss 已杀：不再触发
  assert.notEqual(nextNodeRoll(rng, 'food.outer', 9, 9, true, []).kind, 'boss');
  // 第 11、12 个（boss 未杀、玩家跳过返程再来）仍是 boss：必遇不可绕
  assert.equal(nextNodeRoll(rng, 'food.outer', 10, 10, false, []).kind, 'boss');
});

test('npc pity triggers at 10/15/20 then every 5', () => {
  assert.ok(isNpcPityNode(10));
  assert.ok(isNpcPityNode(15));
  assert.ok(isNpcPityNode(20));
  assert.ok(isNpcPityNode(25));
  assert.ok(!isNpcPityNode(24));
  assert.ok(!isNpcPityNode(9));
  assert.ok(!isNpcPityNode(11));
  const rng = createRng(3);
  const unmet = ['food-1'];
  const roll = nextNodeRoll(rng, 'food.outer', 0, 9, true, unmet);
  assert.deepEqual(roll, { kind: 'npc', npcId: 'food-1' });
  // 该区 NPC 全遇过：不触发，走普通池
  const plain = nextNodeRoll(rng, 'food.outer', 0, 9, true, []);
  assert.ok(['scavenge', 'event', 'monster'].includes(plain.kind));
});

test('scavenge yield scales by tier and multiplier; fuel exempt; mall random', () => {
  const rng = createRng(11);
  assert.equal(rollScavenge(rng, 'food', 'outer', 1).amount, 1);
  assert.equal(rollScavenge(rng, 'food', 'inner', 1).amount, 2);
  assert.equal(rollScavenge(rng, 'food', 'core', 1).amount, 4);
  // 倍率 2（满血双人）：基础 ×2
  assert.equal(rollScavenge(rng, 'food', 'inner', 2).amount, 4);
  // 残血单人 0.5：核心 4 ×0.5 = 2（round）
  assert.equal(rollScavenge(rng, 'food', 'core', 0.5).amount, 2);
  // 外围 1 ×0.5 = 0.5 → 保底 1
  assert.equal(rollScavenge(rng, 'food', 'outer', 0.5).amount, 1);
  // 燃油不乘倍率
  const fuel = rollScavenge(rng, 'oil', 'core', 2);
  assert.equal(fuel.resource, 'fuel');
  assert.equal(fuel.amount, 4);
  // 购物中心任意资源
  const kinds = new Set();
  for (let i = 0; i < 200; i++) kinds.add(rollScavenge(rng, 'mall', 'outer', 1).resource);
  assert.ok(kinds.size >= 3, 'mall should drop various resources');
});

test('monster encounter: 40-80 horde, tier scaling, boss x3 hp', () => {
  const rng = createRng(5);
  for (let i = 0; i < 50; i++) {
    const enc = rollMonsterEncounter(rng, 'arms', 'inner');
    assert.ok(enc.total >= 40 && enc.total <= 80);
    const groupTotal = enc.groups.reduce((s, g) => s + g.count, 0);
    assert.ok(Math.abs(groupTotal - enc.total) <= 2, `groups ${groupTotal} ~ total ${enc.total}`);
    assert.equal(enc.lootPreview[0].amount, 2 * 2); // 内部 2 × 战斗 2 倍
  }
  const boss = bossEncounter('core', 'arms');
  assert.equal(boss.hpBySize.small, 30);
  assert.equal(boss.hpBySize.medium, 60);
  assert.equal(boss.hpBySize.large, 120);
  assert.ok(boss.total >= 100);
});

test('each region has exactly 2 npcs', () => {
  for (const region of ['food', 'oil', 'pharma', 'arms', 'industry', 'mall']) {
    assert.equal(npcsInRegion(region).length, 2);
  }
});

// —— combat：伤害管道 围墙 → 车 → 人 ——

test('damage pipeline order: wall absorbs first, then vehicle, then members in order', () => {
  const result = applyDamagePipeline({
    damage: 250,
    wallHp: 100,
    vehicleDurability: 200,
    memberHps: [100, 100],
  });
  assert.equal(result.wallHpAfter, 0); // 墙吃 100
  assert.equal(result.vehicleDurabilityAfter, 50); // 车吃 150 剩 50
  assert.deepEqual(result.memberHpsAfter, [100, 100]);
  assert.equal(result.vehicleBroken, false);
});

test('damage pipeline breaks vehicle then bleeds into members sequentially', () => {
  const result = applyDamagePipeline({
    damage: 230,
    wallHp: null, // 探索战无墙
    vehicleDurability: 200,
    memberHps: [100, 100],
  });
  assert.equal(result.vehicleDurabilityAfter, 0);
  assert.equal(result.vehicleBroken, true);
  assert.deepEqual(result.memberHpsAfter, [70, 100]); // 剩 30 伤 → 第一人扣 30
});

test('wave composition grows unbounded with wave index', () => {
  const w1 = waveComposition(1);
  assert.equal(w1.total, 40);
  const w5 = waveComposition(5);
  assert.equal(w5.total, 80);
  const w20 = waveComposition(20);
  assert.equal(w20.total, 230);
  for (const w of [w1, w5, w20]) {
    assert.equal(w.groups.reduce((s, g) => s + g.count, 0), w.total);
  }
});

test('weapon profile: level scaling + stark rocket limit bonus', () => {
  assert.deepEqual(weaponProfile(0, false), { gunDamagePerShot: 5, gunPierce: 1, rocketDamagePerShot: 40, rocketBattleLimit: 3 });
  assert.deepEqual(weaponProfile(2, false), { gunDamagePerShot: 20, gunPierce: 2, rocketDamagePerShot: 100, rocketBattleLimit: 5 });
  assert.equal(weaponProfile(0, true).rocketBattleLimit, 4);
  assert.equal(ramDamage(17), 17); // 撞线伤害 = 剩余生命
});

// —— boss 掉落表 ——

test('boss drops: outer→inner map, inner→core map, core→part or nothing', () => {
  const outer = layerBossDrop('food', 'outer');
  assert.equal(outer?.kind, 'map');
  assert.equal(outer && outer.kind === 'map' ? outer.layer : '', 'food.inner');

  const inner = layerBossDrop('arms', 'inner');
  assert.equal(inner && inner.kind === 'map' ? inner.layer : '', 'arms.core');

  assert.equal(layerBossDrop('arms', 'core')?.kind, 'part');
  assert.equal(layerBossDrop('industry', 'core')?.kind, 'part');
  assert.equal(layerBossDrop('pharma', 'core')?.kind, 'part');
  assert.equal(layerBossDrop('mall', 'core')?.kind, 'part');
  assert.equal(layerBossDrop('food', 'core'), null); // 食品厂核心无特殊掉落
  assert.equal(layerBossDrop('oil', 'core'), null);
});
