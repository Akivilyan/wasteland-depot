// 区域制长局命令引擎（GAME_DESIGN §3~§11）——规则的唯一入口。
//
// 纯函数命令集：同 state + 同操作序列 → 同结果。表现层只调用这里的
// 命令并渲染返回值，不自行改规则数据。随机全部经 rng.ts，状态随档保存。
//
// 天数推进模型（§3）：去程 1 天（不扣食油）→ 每节点 1 天（扣当日油/食）
// → 返程 1 天（不扣）。波次日结（20/40/60…）在每次 day+1 时检查。

import type { Rng } from './rng.ts';
import {
  type RegionId,
  type TierId,
  type LayerId,
  type ResourceId,
  type ResourceStock,
  RESOURCE_IDS,
  layerId,
  tierIndex,
  regionDef,
  npcsInRegion,
  npcDef,
  rollScavenge,
  rollMonsterEncounter,
  bossEncounter,
  nextNodeRoll,
  resourceLabel,
  type LootDrop,
  type MonsterEncounter,
  type NodeKind,
} from './regions.ts';
import {
  START_DAY,
  WAVE_INTERVAL_DAYS,
  FINALE_COUNTDOWN_DAYS,
  STOCK_CAP_BASE,
  STOCK_CAP_PER_LEVEL,
  STOCK_UPGRADE_COSTS,
  WALL_HP_BASE,
  WALL_HP_LEVELS,
  WALL_UPGRADE_COSTS,
  VEHICLE_DURABILITY_BASE,
  VEHICLE_DURABILITY_LEVELS,
  VEHICLE_DURABILITY_COSTS,
  STORAGE_SLOTS_BASE,
  SEATS_BASE,
  SLOT_LADDER,
  SEAT_LADDER,
  LADDER_TAIL_STEP,
  REPAIR_PER_MATERIAL,
  WEAPON_UPGRADE_COSTS,
  ROCKET_BATTLE_LIMIT,
  FUEL_PER_NODE_DAY,
  FOOD_PER_NPC_PER_DAY,
  STARVE_DAMAGE_PER_DAY,
  MEDICINE_HEAL,
  SERUM_MEDICINE_COST,
  SERUM_CAP_BONUS,
  NPC_HP_HARD_CAP,
  STARTING_NPC_COUNT,
  STARTING_STOCK,
  QUEST_REQUIREMENT,
  RECRUIT_RESOURCE_COST,
  RECRUIT_FOOD_COST,
  PHARMACIST_RECRUIT_DISCOUNT,
  BOSS_PITY_NODE,
  PART_IDS,
  SCRAP_YIELD,
  COMBAT_LOOT_MULTIPLIER,
  hpTierMultiplier,
} from './config.ts';
import { layerBossDrop, type BossDrop } from './boss.ts';
import { heroLootMultiplier, type HeroId } from './hero.ts';
import { pickEvent, eventById, type RegionEvent, type EventOutcomeV2 } from './events.ts';
import { loadResource, remainingCapacity, holdTotals } from './hold.ts';
import { applyDamagePipeline } from './combat.ts';
import {
  type GameState,
  type NpcMember,
  type Expedition,
  RUN_SAVE_KEY,
  createMember,
} from './state.ts';

export interface CmdResult {
  readonly state: GameState;
  readonly message: string;
}

// —— 初始态 ——

const STARTER_NAMES = ['老赵'];

export function createNewGame(hero: HeroId, seed = 20261024): GameState {
  const members: NpcMember[] = [];
  for (let i = 0; i < STARTING_NPC_COUNT; i++) {
    members.push(createMember(i, STARTER_NAMES[i] ?? `乘员 ${i + 1}`));
  }
  return {
    version: 2,
    day: START_DAY,
    hero,
    stock: { ...STARTING_STOCK },
    stockUpgradeLevel: 0,
    vehicle: {
      durability: VEHICLE_DURABILITY_BASE,
      durabilityLevel: 0,
      slots: STORAGE_SLOTS_BASE,
      seats: SEATS_BASE,
    },
    weaponLevel: 0,
    wall: { hp: WALL_HP_BASE, level: 0 },
    members,
    npcMet: [],
    npcQuests: {},
    npcQuestsDone: [],
    unlockedLayers: [],
    bossKilled: [],
    layerNodeCount: {},
    globalNodeCount: 0,
    parts: [],
    wavesPassed: 0,
    wavesDefended: 0,
    finaleCountdown: null,
    finalePending: false,
    ending: null,
    expedition: null,
    homeBattlePending: false,
    rngState: seed >>> 0,
    log: [`第 ${START_DAY} 天：${hero === null ? '序章' : '仓库重启。'}`],
  };
}

// —— 派生查询（表现层只读用）——

export function stockCap(state: GameState, resource: ResourceId): number {
  return STOCK_CAP_BASE + STOCK_CAP_PER_LEVEL * state.stockUpgradeLevel;
}

export function wallHpCap(state: GameState): number {
  return state.wall.level === 0 ? WALL_HP_BASE : (WALL_HP_LEVELS[state.wall.level - 1] as number);
}

export function vehicleDurabilityCap(state: GameState): number {
  return state.vehicle.durabilityLevel === 0
    ? VEHICLE_DURABILITY_BASE
    : (VEHICLE_DURABILITY_LEVELS[state.vehicle.durabilityLevel - 1] as number);
}

export function isLayerUnlocked(state: GameState, region: RegionId, tier: TierId): boolean {
  return tier === 'outer' || state.unlockedLayers.includes(layerId(region, tier));
}

export function nextWaveDay(state: GameState): number {
  return (state.wavesPassed + 1) * WAVE_INTERVAL_DAYS;
}

/** 出行乘员 = 非濒死成员（自动随队，无逐次选人）。 */
export function awayMembers(state: GameState): readonly NpcMember[] {
  return state.expedition === null ? [] : state.members.filter((m) => !m.dying);
}

/** 探索掉落总乘数 = Σ出行成员血量档位（§8），燃油豁免在 drop 计算处。 */
export function tierSum(state: GameState): number {
  return awayMembers(state).reduce((sum, m) => sum + hpTierMultiplier(m.hp), 0);
}

/** 出发前置校验：层未解锁 / 油不足付首节点日 / 状态不允许。 */
export function canStartExpedition(state: GameState, region: RegionId, tier: TierId): string | null {
  if (state.ending !== null) return '本局已结束。';
  if (state.expedition !== null) return '已在探索途中。';
  if (state.finalePending || state.homeBattlePending) return '有待处理的战斗。';
  if (!isLayerUnlocked(state, region, tier)) return '该层未解锁。';
  const fuelCost = FUEL_PER_NODE_DAY[tierIndex(tier)] as number;
  if (state.stock.fuel < fuelCost) return `燃油不足：首个节点日需要 ${fuelCost} 燃油。`;
  return null;
}

// —— 天数推进与波次日历（内部统一入口）——

interface TickOptions {
  /** 推进时是否在探索途中（波次日结在途 = 缺席惩罚）。 */
  readonly inExpedition: boolean;
}

interface TickResult {
  readonly state: GameState;
  /** 本 tick 触发的波次序号（null = 非波次日）。 */
  readonly waveTriggered: number | null;
  /** 终局倒计时是否归零。 */
  readonly finaleReached: boolean;
}

function tickDay(state: GameState, options: TickOptions): TickResult {
  let next: GameState = { ...state, day: state.day + 1 };
  let waveTriggered: number | null = null;
  let finaleReached = false;

  // 终局倒计时：集齐零件后每次 day+1 递减，到 0 停表待战（§11）。
  if (next.finaleCountdown !== null && next.finaleCountdown > 0) {
    next = { ...next, finaleCountdown: next.finaleCountdown - 1 };
    if (next.finaleCountdown === 0) {
      finaleReached = true;
      if (!options.inExpedition) {
        next = { ...next, finalePending: true };
      }
    }
  }

  // 波次日结：day 命中 (wavesPassed+1)×20。
  if (next.day === nextWaveDay(next)) {
    const waveIndex = next.wavesPassed + 1;
    waveTriggered = waveIndex;
    if (options.inExpedition) {
      next = applyWaveAbsentInternal(next);
    } else {
      next = { ...next, homeBattlePending: true };
    }
  }
  return { state: next, waveTriggered, finaleReached };
}

/** 缺席惩罚（§10）：掉围墙 + 五种普通资源清空；地图/零件/升级保留。 */
function applyWaveAbsentInternal(state: GameState): GameState {
  const stock: ResourceStock = { fuel: 0, food: 0, material: 0, medicine: 0, ammo: 0 };
  return {
    ...state,
    stock,
    wall: { ...state.wall, hp: 0 },
    wavesPassed: state.wavesPassed + 1,
    log: [...state.log, `第 ${state.day} 天波次攻家：探索缺席，围墙被拆、仓库资源被清空。`],
  };
}

// —— 阶段：出发（§3：去程 1 天，不扣食油）——

export function startExpedition(
  state: GameState,
  region: RegionId,
  tier: TierId,
  rng: Rng,
): CmdResult {
  const block = canStartExpedition(state, region, tier);
  if (block !== null) return { state, message: block };
  const tick = tickDay(state, { inExpedition: false });
  // 出发日人在仓库：恰逢波次日或终局倒计时归零，都先处理再出门。
  if (tick.waveTriggered !== null) {
    return { state: tick.state, message: `第 ${tick.state.day} 天：怪物攻家，先守仓库再出发。` };
  }
  if (tick.state.finalePending) {
    return { state: tick.state, message: '抵抗军抵达在即——先打最终决战，再考虑出门。' };
  }
  const expedition: Expedition = {
    region,
    tier,
    hold: { slots: [] },
    nodesVisitedThisTrip: 0,
    recentEventIds: [],
    forcedReturn: false,
  };
  const next = { ...tick.state, expedition, rngState: rng.state() };
  const def = regionDef(region);
  return {
    state: next,
    message: `出发前往${def.label}（${tier === 'outer' ? '外围' : tier === 'inner' ? '内部' : '核心'}）。`,
  };
}

// —— 阶段：推进节点（每节点 1 天，扣当日油/食）——

export type NodeEncounter =
  | { readonly kind: 'scavenge'; readonly drop: LootDrop }
  | { readonly kind: 'event'; readonly event: RegionEvent }
  | { readonly kind: 'monster'; readonly encounter: MonsterEncounter }
  | { readonly kind: 'boss'; readonly encounter: MonsterEncounter; readonly layer: LayerId }
  | { readonly kind: 'npc'; readonly npcId: string; readonly questResource: ResourceId; readonly questAmount: number };

export interface NodeResult {
  readonly state: GameState;
  readonly encounter: NodeEncounter | null;
  readonly message: string;
  /** 油不足以付下一节点日 / 车辆打空：强制返程（表现层调 endExpedition）。 */
  readonly forcedReturn: boolean;
  /** 本节点日触发的波次（在途缺席结算已内置）。 */
  readonly waveTriggered: number | null;
}

export function nextNode(state: GameState, rng: Rng): NodeResult {
  const expedition = state.expedition;
  if (expedition === null) {
    return { state, encounter: null, message: '不在探索途中。', forcedReturn: false, waveTriggered: null };
  }
  if (expedition.forcedReturn) {
    return { state, encounter: null, message: '车辆打空，必须返程。', forcedReturn: true, waveTriggered: null };
  }
  const fuelCost = FUEL_PER_NODE_DAY[tierIndex(expedition.tier)] as number;
  if (state.stock.fuel < fuelCost) {
    return {
      state,
      encounter: null,
      message: `燃油不足以支付下一节点日（需 ${fuelCost}），强制返程。`,
      forcedReturn: true,
      waveTriggered: null,
    };
  }

  // 节点日结算：扣油 → 推进天数（波次/终局）→ 扣食（全员含驻留者）。
  let next: GameState = {
    ...state,
    stock: { ...state.stock, fuel: state.stock.fuel - fuelCost },
  };
  const tick = tickDay(next, { inExpedition: true });
  next = tick.state;
  const food = applyFoodTick(next);
  next = food.state;

  // 节点内容（boss/NPC 保底优先，§9）。
  const layer = layerId(expedition.region, expedition.tier);
  const layerCount = next.layerNodeCount[layer] ?? 0;
  const unmet = npcsInRegion(expedition.region)
    .map((n) => n.id)
    .filter((id) => !next.npcMet.includes(id));
  const roll = nextNodeRoll(
    rng,
    layer,
    layerCount,
    next.globalNodeCount,
    next.bossKilled.includes(layer),
    unmet,
  );

  const encounter = buildEncounter(next, rng, expedition.region, expedition.tier, roll, food.starvedNames);

  // 计数：layerNodeCount 计全部节点；globalNodeCount 只计普通节点（NPC 保底语义）。
  const isSpecial = roll.kind === 'boss' || roll.kind === 'npc';
  next = {
    ...next,
    layerNodeCount: { ...next.layerNodeCount, [layer]: layerCount + 1 },
    globalNodeCount: next.globalNodeCount + (isSpecial ? 0 : 1),
    expedition: {
      ...expedition,
      nodesVisitedThisTrip: expedition.nodesVisitedThisTrip + 1,
    },
    rngState: rng.state(),
  };

  const starveNote = food.starvedNames.length > 0 ? ` 断粮：${food.starvedNames.join('、')} 各 -${STARVE_DAMAGE_PER_DAY} 血。` : '';
  return {
    state: next,
    encounter,
    message: `推进 1 个节点（第 ${next.expedition?.nodesVisitedThisTrip ?? 0} 个，+1 天）。${starveNote}${tick.waveTriggered !== null ? ` 第 ${next.day} 天波次攻家：探索缺席，资源被清空。` : ''}`,
    forcedReturn: false,
    waveTriggered: tick.waveTriggered,
  };
}

function buildEncounter(
  state: GameState,
  rng: Rng,
  region: RegionId,
  tier: TierId,
  roll: { kind: NodeKind } | { kind: 'boss' } | { kind: 'npc'; npcId: string },
  starvedNames: readonly string[],
): NodeEncounter {
  if (roll.kind === 'boss') {
    return { kind: 'boss', encounter: bossEncounter(tier, region), layer: layerId(region, tier) };
  }
  if (roll.kind === 'npc') {
    const def = npcDef(roll.npcId);
    const depth = tierIndex(tier);
    const resource: ResourceId = def.questResource ?? rng.pick(RESOURCE_IDS);
    return { kind: 'npc', npcId: def.id, questResource: resource, questAmount: QUEST_REQUIREMENT[depth] as number };
  }
  if (roll.kind === 'scavenge') {
    const drop = rollScavenge(rng, region, tier, tierSum(state));
    return { kind: 'scavenge', drop: applyHeroMultiplier(state, drop, 'scavenge') };
  }
  if (roll.kind === 'event') {
    const event = pickEvent(rng, state.expedition?.recentEventIds ?? []);
    return { kind: 'event', event };
  }
  const encounter = rollMonsterEncounter(rng, region, tier);
  return {
    kind: 'monster',
    encounter: {
      ...encounter,
      lootPreview: encounter.lootPreview.map((d) => applyHeroMultiplier(state, d, 'combat')),
    },
  };
}

/** 流派掉落加成（§8）：燃油不参与一切乘数。 */
function applyHeroMultiplier(state: GameState, drop: LootDrop, scene: 'scavenge' | 'combat'): LootDrop {
  if (drop.resource === 'fuel' || state.hero === null) return drop;
  const mult = heroLootMultiplier(state.hero, drop.resource, scene);
  if (mult === 1) return drop;
  return { resource: drop.resource, amount: Math.max(1, Math.round(drop.amount * mult)) };
}

// —— 食物结算（§5/§8：每人每天 2 食物；断粮 -2 血）——

interface FoodResult {
  readonly state: GameState;
  readonly starvedNames: string[];
}

function applyFoodTick(state: GameState): FoodResult {
  const need = state.members.length * FOOD_PER_NPC_PER_DAY;
  const available = Math.min(state.stock.food, need);
  let fed = available;
  const starvedNames: string[] = [];
  const members = state.members.map((m) => ({ ...m }));
  for (const member of members) {
    if (fed >= FOOD_PER_NPC_PER_DAY) {
      // 全天份喂饱（整数口算：不按餐拆分）。
      fed -= FOOD_PER_NPC_PER_DAY;
    } else {
      // 没吃到全天份：断粮 -2 血（= 当日消耗量），残余食物吃掉不浪费。
      fed = 0;
      member.hp = Math.max(0, member.hp - STARVE_DAMAGE_PER_DAY);
      if (member.hp === 0) {
        member.dying = true;
      }
      if (!starvedNames.includes(member.name)) starvedNames.push(member.name);
    }
  }
  let next: GameState = {
    ...state,
    stock: { ...state.stock, food: state.stock.food - available },
    members,
  };
  next = checkDefeat(next);
  return { state: next, starvedNames };
}

/** 失败线唯一：所有 NPC（含驻留者）同时濒死（§8/§11）。 */
function checkDefeat(state: GameState): GameState {
  if (state.ending !== null) return state;
  if (state.members.length > 0 && state.members.every((m) => m.dying)) {
    return { ...state, ending: 'defeat', log: [...state.log, `第 ${state.day} 天：全员濒死，本局失败。`] };
  }
  return state;
}

// —— 节点交互结算 ——

/** 搜刮领取：候选掉落装舱（装不下的留在现场，取舍即核心体验）。 */
export function takeScavenge(state: GameState, drop: LootDrop): CmdResult {
  const expedition = state.expedition;
  if (expedition === null) return { state, message: '不在探索途中。' };
  const result = loadResource(expedition.hold, drop.resource, drop.amount, state.vehicle.slots);
  const next: GameState = {
    ...state,
    expedition: { ...expedition, hold: result.hold },
  };
  const left = drop.amount - result.loaded;
  return {
    state: next,
    message: left > 0
      ? `装舱 ${result.loaded} ${resourceLabel(drop.resource)}（${left} 装不下留在现场）。`
      : `装舱 ${result.loaded} ${resourceLabel(drop.resource)}。`,
  };
}

/** 事件结算（§9：信息 → 选择 → 即时后果；获得先装舱、损伤直接扣车）。 */
export function resolveEvent(state: GameState, eventId: string, choiceIndex: number): CmdResult {
  const expedition = state.expedition;
  if (expedition === null) return { state, message: '不在探索途中。' };
  const event = eventById(eventId);
  const outcome: EventOutcomeV2 | undefined = event.outcomes[choiceIndex];
  if (outcome === undefined) return { state, message: `无效选择：${choiceIndex}` };

  let next = { ...state };
  let message = '';
  if (outcome.type === 'gain') {
    const drop = applyHeroMultiplier(next, { resource: outcome.resource, amount: outcome.amount }, 'scavenge');
    const load = loadResource(expedition.hold, drop.resource, drop.amount, next.vehicle.slots);
    next = { ...next, expedition: { ...expedition, hold: load.hold, recentEventIds: pushRecent(expedition.recentEventIds, eventId) } };
    message = load.loaded > 0 ? `获得 ${load.loaded} ${resourceLabel(drop.resource)}（已装舱）。` : '货舱已满，什么都装不下。';
  } else if (outcome.type === 'lose') {
    const actual = Math.min(next.stock[outcome.resource], outcome.amount);
    next = { ...next, stock: { ...next.stock, [outcome.resource]: next.stock[outcome.resource] - actual } };
    next = { ...next, expedition: { ...expedition, recentEventIds: pushRecent(expedition.recentEventIds, eventId) } };
    message = `失去 ${actual} ${resourceLabel(outcome.resource)}。`;
  } else if (outcome.type === 'vehicleDamage') {
    const durability = Math.max(0, next.vehicle.durability - outcome.amount);
    next = {
      ...next,
      vehicle: { ...next.vehicle, durability },
      expedition: { ...expedition, recentEventIds: pushRecent(expedition.recentEventIds, eventId), forcedReturn: durability === 0 },
    };
    message = durability === 0 ? `车辆受损 ${outcome.amount}，耐久打空，强制返程！` : `车辆受损 ${outcome.amount}（剩 ${durability}）。`;
  } else {
    next = { ...next, expedition: { ...expedition, recentEventIds: pushRecent(expedition.recentEventIds, eventId) } };
    message = '无事发生。';
  }
  return { state: next, message };
}

function pushRecent(recent: readonly string[], id: string): string[] {
  const next = [...recent, id];
  return next.length > 6 ? next.slice(next.length - 6) : next;
}

/** NPC 首遇：自动接下任务（标准任务系统，§8）。 */
export function meetNpc(state: GameState, encounter: { npcId: string; questResource: ResourceId; questAmount: number }): CmdResult {
  const def = npcDef(encounter.npcId);
  if (state.npcMet.includes(def.id)) return { state, message: '已遇到过该 NPC。' };
  const next: GameState = {
    ...state,
    npcMet: [...state.npcMet, def.id],
    npcQuests: { ...state.npcQuests, [def.id]: { resource: encounter.questResource, amount: encounter.questAmount } },
  };
  return {
    state: next,
    message: `结识 ${def.name}：需要 ${encounter.questAmount} ${resourceLabel(encounter.questResource)}，回仓库任务板交付。`,
  };
}

// —— 战斗结算（实时演出归表现层；这里收结果，§7）——

export interface BattleOutcome {
  /** 击杀全部怪物（胜利）。 */
  readonly victory: boolean;
  /** 漏怪撞线总伤（= Σ撞线怪物剩余生命）。 */
  readonly breachDamage: number;
  /** 本场弹药消耗（机枪/火箭弹已折算），实时扣减的总账。 */
  readonly ammoSpent: number;
}

/** 探索战（含 boss）结算：胜利发掉落（战斗掉落 = 同层搜刮 ×2 + 流派加成，§7）；
 *  败北走撞线管道（车 → 人）+ 强制返程。 */
export function applyExpeditionBattle(
  state: GameState,
  rng: Rng,
  isBoss: boolean,
  outcome: BattleOutcome,
): CmdResult {
  const expedition = state.expedition;
  if (expedition === null) return { state, message: '不在探索途中。' };

  let next: GameState = {
    ...state,
    stock: { ...state.stock, ammo: Math.max(0, state.stock.ammo - outcome.ammoSpent) },
  };
  let message = '';

  if (outcome.victory) {
    if (isBoss) {
      const layer = layerId(expedition.region, expedition.tier);
      const drop = bossLootFor(next, layer);
      next = drop.state;
      message = drop.message;
    } else {
      // 普通怪战利品：区域主资源（购物中心随机），份量 = 同层搜刮 ×2，再乘流派。
      const def = regionDef(expedition.region);
      const resource: ResourceId =
        def.mainResource ?? rng.pick(RESOURCE_IDS);
      const base = (SCRAP_YIELD[tierIndex(expedition.tier)] as number) * COMBAT_LOOT_MULTIPLIER;
      const loot = applyHeroMultiplier(next, { resource, amount: base }, 'combat');
      const load = loadResource(expedition.hold, loot.resource, loot.amount, next.vehicle.slots);
      next = { ...next, expedition: { ...expedition, hold: load.hold } };
      message = `战斗胜利：装舱 ${load.loaded} ${resourceLabel(loot.resource)}。`;
    }
  } else {
    // 撞线伤害走管道（探索无墙，车 → 人，§7）。
    const pipeline = applyDamagePipeline({
      damage: outcome.breachDamage,
      wallHp: null,
      vehicleDurability: next.vehicle.durability,
      memberHps: next.members.filter((m) => !m.dying).map((m) => m.hp),
    });
    const away = next.members.filter((m) => !m.dying);
    const members = next.members.map((m) => {
      const index = away.indexOf(m);
      if (index < 0) return m;
      const hp = pipeline.memberHpsAfter[index] ?? 0;
      return { ...m, hp, dying: hp <= 0 };
    });
    next = {
      ...next,
      vehicle: { ...next.vehicle, durability: pipeline.vehicleDurabilityAfter },
      members,
      expedition: { ...expedition, forcedReturn: true },
    };
    next = checkDefeat(next);
    message = pipeline.vehicleBroken ? '战车耐久打空：本场结束，强制返仓（无掉落）。' : `硬扛撞线伤害 ${outcome.breachDamage}，车辆剩 ${pipeline.vehicleDurabilityAfter} 耐久。`;
  }
  return { state: next, message };
}

/** boss 首杀掉落（§9/§11）：深一层地图 + 特定核心层零件。已杀 boss 防御性拒绝。 */
function bossLootFor(state: GameState, layer: LayerId): { state: GameState; message: string } {
  const { region, tier } = parseLayer(layer);
  let next = state;
  if (next.bossKilled.includes(layer)) {
    return { state: next, message: '该层 boss 已被击杀，不再出现。' };
  }
  const notes: string[] = [];
  const drop: BossDrop | null = layerBossDrop(region, tier);
  if (drop !== null) {
    if (drop.kind === 'map') {
      next = { ...next, unlockedLayers: [...next.unlockedLayers, drop.layer] };
      notes.push(`获得${drop.label}`);
    } else {
      if (!next.parts.includes(drop.part)) {
        next = { ...next, parts: [...next.parts, drop.part] };
      }
      notes.push(`获得${drop.label}`);
    }
  }
  next = { ...next, bossKilled: [...next.bossKilled, layer] };
  // 集齐 4 零件：基站自动修复，终局倒计时开启（§11）。
  if (next.parts.length === PART_IDS.length && next.finaleCountdown === null) {
    next = { ...next, finaleCountdown: FINALE_COUNTDOWN_DAYS };
    notes.push(`信号零件集齐！通信基站自动修复，抵抗军 ${FINALE_COUNTDOWN_DAYS} 天后到达。`);
  }
  return {
    state: next,
    message: `boss 首杀！${notes.join('；')}。`,
  };
}

function parseLayer(layer: LayerId): { region: RegionId; tier: TierId } {
  const [region, tier] = layer.split('.');
  return { region: region as RegionId, tier: tier as TierId };
}

/** 弹药预检：战斗中实时扣（表现层逐发调），这里供出发/战前明牌。 */
export function rocketBattleLimit(state: GameState): number {
  return (ROCKET_BATTLE_LIMIT[state.weaponLevel] as number) + (state.hero === 'stark' ? 1 : 0);
}

// —— 返程（§3：返程 1 天，不扣食油；入库超上限溢出作废）——

export function endExpedition(state: GameState): CmdResult {
  const expedition = state.expedition;
  if (expedition === null) return { state, message: '不在探索途中。' };

  const tick = tickDay(state, { inExpedition: false });
  let next = tick.state;

  // 入库：货舱汇总 → 仓库（每资源独立上限，超出溢出作废，§5）。
  const totals = holdTotals(expedition.hold);
  const stock = { ...next.stock };
  const notes: string[] = [];
  for (const entry of totals) {
    const cap = stockCap(next, entry.resource);
    const taken = Math.min(cap - stock[entry.resource], entry.amount);
    const wasted = entry.amount - taken;
    stock[entry.resource] += Math.max(0, taken);
    notes.push(`${resourceLabel(entry.resource)} +${Math.max(0, taken)}${wasted > 0 ? `（溢出作废 ${wasted}）` : ''}`);
  }
  next = { ...next, stock, expedition: null };

  // 返仓当刻：终局待战顺延至此触发（§11）。
  if (next.finaleCountdown === 0 && !next.finalePending && next.ending === null) {
    next = { ...next, finalePending: true };
  }
  next = checkDefeat(next);

  const waveNote = tick.waveTriggered !== null ? ` 第 ${next.day} 天波次攻家：人在仓库，进入守家战！` : '';
  const message = `返回仓库：${notes.length > 0 ? notes.join('、') : '空舱而归'}。${waveNote}`;
  next = { ...next, log: [...next.log, message] };
  return { state: next, message };
}

// —— 守家战（§10：管道 围墙 → 车 → 人；车破不判负）——

export function applyHomeBattle(state: GameState, outcome: BattleOutcome): CmdResult {
  if (!state.homeBattlePending) return { state, message: '当前没有攻家波次。' };
  const pipeline = applyDamagePipeline({
    damage: outcome.breachDamage,
    wallHp: state.wall.hp,
    vehicleDurability: state.vehicle.durability,
    memberHps: state.members.map((m) => m.hp),
  });
  const members = state.members.map((m, i) => {
    const hp = pipeline.memberHpsAfter[i] ?? 0;
    return { ...m, hp, dying: hp <= 0 };
  });
  let next: GameState = {
    ...state,
    wall: { ...state.wall, hp: pipeline.wallHpAfter },
    vehicle: { ...state.vehicle, durability: pipeline.vehicleDurabilityAfter },
    members,
    stock: { ...state.stock, ammo: Math.max(0, state.stock.ammo - outcome.ammoSpent) },
    wavesPassed: state.wavesPassed + 1,
    wavesDefended: state.wavesDefended + 1,
    homeBattlePending: false,
    log: [...state.log, `第 ${state.day} 天：守住第 ${state.wavesPassed + 1} 波攻家。`],
  };
  next = checkDefeat(next);
  if (next.ending === 'defeat') {
    return { state: next, message: '守家战失败：全员濒死。' };
  }
  return { state: next, message: `守住第 ${state.wavesPassed} 波！（围墙剩 ${pipeline.wallHpAfter}、车剩 ${pipeline.vehicleDurabilityAfter}）` };
}

// —— 最终决战（§11：无限弹药；守住 = 胜利）——

export function applyFinalBattle(state: GameState, outcome: { victory: boolean; breachDamage: number }): CmdResult {
  if (!state.finalePending) return { state, message: '终局决战尚未触发。' };
  if (outcome.victory) {
    const next: GameState = {
      ...state,
      ending: 'victory',
      finalePending: false,
      log: [...state.log, `第 ${state.day} 天：最终决战胜利，抵抗军抵达——胜利！`],
    };
    return { state: next, message: '抵抗军抵达仓库，人类抵抗部队获得胜利！' };
  }
  const pipeline = applyDamagePipeline({
    damage: outcome.breachDamage,
    wallHp: state.wall.hp,
    vehicleDurability: state.vehicle.durability,
    memberHps: state.members.map((m) => m.hp),
  });
  const members = state.members.map((m, i) => {
    const hp = pipeline.memberHpsAfter[i] ?? 0;
    return { ...m, hp, dying: hp <= 0 };
  });
  let next: GameState = {
    ...state,
    wall: { ...state.wall, hp: pipeline.wallHpAfter },
    vehicle: { ...state.vehicle, durability: pipeline.vehicleDurabilityAfter },
    members,
    finalePending: false,
  };
  next = checkDefeat(next);
  if (next.ending === 'defeat') return { state: next, message: '最终决战失败：全员濒死。' };
  return { state: next, message: '最终决战失利，但人还活着——重整旗鼓再来。' };
}

// —— 仓库命令（升级/修理/医疗/任务板，§6/§8）——

/** 队长升级折扣 -25%（向上取整）。 */
function upgradeCost(state: GameState, base: number): number {
  return state.hero === 'captain' ? Math.ceil(base * 0.75) : base;
}

function trySpend(state: GameState, material: number): { state: GameState; ok: boolean } {
  if (state.stock.material < material) return { state, ok: false };
  return { state: { ...state, stock: { ...state.stock, material: state.stock.material - material } }, ok: true };
}

export function upgradeStockCap(state: GameState): CmdResult {
  if (state.stockUpgradeLevel >= STOCK_UPGRADE_COSTS.length) return { state, message: '储量已满级。' };
  const cost = upgradeCost(state, (STOCK_UPGRADE_COSTS[state.stockUpgradeLevel] as number));
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  return { state: { ...spend.state, stockUpgradeLevel: state.stockUpgradeLevel + 1 }, message: `储量升级（每种资源上限 +${STOCK_CAP_PER_LEVEL}）。` };
}

export function upgradeWallHp(state: GameState): CmdResult {
  if (state.wall.level >= WALL_UPGRADE_COSTS.length) return { state, message: '围墙已满级。' };
  const cost = upgradeCost(state, (WALL_UPGRADE_COSTS[state.wall.level] as number));
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  const level = state.wall.level + 1;
  const cap = (WALL_HP_LEVELS[level - 1] as number);
  return {
    state: { ...spend.state, wall: { hp: Math.min(state.wall.hp + (cap - wallHpCap(state)), cap), level } },
    message: `围墙升级：耐久上限 ${cap}（当前 ${Math.min(state.wall.hp + (cap - wallHpCap(state)), cap)}）。`,
  };
}

export function upgradeVehicleDurability(state: GameState): CmdResult {
  if (state.vehicle.durabilityLevel >= VEHICLE_DURABILITY_COSTS.length) return { state, message: '载具耐久已满级。' };
  const cost = upgradeCost(state, (VEHICLE_DURABILITY_COSTS[state.vehicle.durabilityLevel] as number));
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  const level = state.vehicle.durabilityLevel + 1;
  const cap = (VEHICLE_DURABILITY_LEVELS[level - 1] as number);
  return {
    state: { ...spend.state, vehicle: { ...spend.state.vehicle, durability: Math.min(state.vehicle.durability + (cap - vehicleDurabilityCap(state)), cap), durabilityLevel: level } },
    message: `载具耐久升级：上限 ${cap}。`,
  };
}

export function upgradeWeapon(state: GameState): CmdResult {
  if (state.weaponLevel >= WEAPON_UPGRADE_COSTS.length) return { state, message: '武器已满级。' };
  const cost = upgradeCost(state, (WEAPON_UPGRADE_COSTS[state.weaponLevel] as number));
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  return { state: { ...spend.state, weaponLevel: state.weaponLevel + 1 }, message: '武器升级完成。' };
}

/** 梯度成本：查表；超出表尾按最后值 +LADDER_TAIL_STEP 继续递增。 */
export function ladderCost(ladder: readonly number[], index: number): number {
  if (index < ladder.length) return ladder[index] as number;
  const tailStep = Math.ceil((index - ladder.length + 1) / 2) * LADDER_TAIL_STEP;
  return (ladder[ladder.length - 1] as number) + tailStep;
}

export function buySlot(state: GameState): CmdResult {
  const bought = state.vehicle.slots - STORAGE_SLOTS_BASE;
  const cost = ladderCost(SLOT_LADDER, bought);
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  return { state: { ...spend.state, vehicle: { ...spend.state.vehicle, slots: state.vehicle.slots + 1 } }, message: `储物 +1 格（现 ${state.vehicle.slots + 1} 格）。` };
}

export function buySeat(state: GameState): CmdResult {
  if (state.members.length >= state.vehicle.seats) {
    return { state, message: '没有空座位：先扩载客量或保持现状。' };
  }
  const bought = state.vehicle.seats - SEATS_BASE;
  const cost = ladderCost(SEAT_LADDER, bought);
  const spend = trySpend(state, cost);
  if (!spend.ok) return { state, message: `材料不足（需 ${cost}）。` };
  return { state: { ...spend.state, vehicle: { ...spend.state.vehicle, seats: state.vehicle.seats + 1 } }, message: `载客 +1 座（现 ${state.vehicle.seats + 1} 座）。` };
}

/** 修车/修墙统一单价 1 材料 = 10 耐久（§6）；不超上限。 */
export function repair(state: GameState, target: 'vehicle' | 'wall', times = 1): CmdResult {
  let next = state;
  let repaired = 0;
  for (let i = 0; i < times; i++) {
    if (next.stock.material < 1) break;
    const cap = target === 'vehicle' ? vehicleDurabilityCap(next) : wallHpCap(next);
    const current = target === 'vehicle' ? next.vehicle.durability : next.wall.hp;
    if (current >= cap) break;
    const heal = Math.min(REPAIR_PER_MATERIAL, cap - current);
    next = target === 'vehicle'
      ? { ...next, stock: { ...next.stock, material: next.stock.material - 1 }, vehicle: { ...next.vehicle, durability: current + heal } }
      : { ...next, stock: { ...next.stock, material: next.stock.material - 1 }, wall: { ...next.wall, hp: current + heal } };
    repaired += heal;
  }
  if (repaired === 0) {
    return { state, message: target === 'vehicle' ? '车辆耐久已满或材料不足。' : '围墙耐久已满或材料不足。' };
  }
  return { state: next, message: `修复 ${repaired} 耐久（用 ${Math.ceil(repaired / REPAIR_PER_MATERIAL)} 材料）。` };
}

/** 吃药：1 药 = 10 血，只回血不提上限（§5）。 */
export function healMember(state: GameState, memberId: number): CmdResult {
  const member = state.members.find((m) => m.id === memberId);
  if (member === undefined) return { state, message: '查无此成员。' };
  if (member.hp >= member.hpCap) return { state, message: `${member.name} 血量已满。` };
  if (state.stock.medicine < 1) return { state, message: '药品不足。' };
  const heal = Math.min(MEDICINE_HEAL, member.hpCap - member.hp);
  const members = state.members.map((m) =>
    m.id === memberId ? { ...m, hp: m.hp + heal, dying: false } : m,
  );
  return {
    state: { ...state, stock: { ...state.stock, medicine: state.stock.medicine - 1 }, members },
    message: `${member.name} +${heal} 血${members.find((m) => m.id === memberId)?.dying === false && member.dying ? '，脱离濒死' : ''}。`,
  };
}

/** 人类补完の剂（§8：药神专有；上限 +50 当前 +50，硬顶 200）。 */
export function useSerum(state: GameState, memberId: number): CmdResult {
  if (state.hero !== 'pharmacist') return { state, message: '只有「我就是药神」掌握这个配方。' };
  const member = state.members.find((m) => m.id === memberId);
  if (member === undefined) return { state, message: '查无此成员。' };
  if (member.hpCap >= NPC_HP_HARD_CAP) return { state, message: `${member.name} 血量上限已达硬顶 ${NPC_HP_HARD_CAP}。` };
  if (state.stock.medicine < SERUM_MEDICINE_COST) return { state, message: `药品不足（需 ${SERUM_MEDICINE_COST}）。` };
  const cap = Math.min(NPC_HP_HARD_CAP, member.hpCap + SERUM_CAP_BONUS);
  const hp = Math.min(cap, member.hp + SERUM_CAP_BONUS);
  const members = state.members.map((m) => (m.id === memberId ? { ...m, hp, hpCap: cap, dying: false } : m));
  return {
    state: { ...state, stock: { ...state.stock, medicine: state.stock.medicine - SERUM_MEDICINE_COST }, members },
    message: `${member.name} 服用人类补完の剂：上限 ${cap}、当前 ${hp}。`,
  };
}

/** 任务板提交（§8：库存够直接扣除，完成解锁邀请资格）。 */
export function submitQuest(state: GameState, npcId: string): CmdResult {
  const quest = state.npcQuests[npcId];
  if (quest === undefined) return { state, message: '没有该任务。' };
  if (state.npcQuestsDone.includes(npcId)) return { state, message: '任务已完成。' };
  if (state.stock[quest.resource] < quest.amount) {
    return { state, message: `${resourceLabel(quest.resource)}不足（需 ${quest.amount}）。` };
  }
  const next: GameState = {
    ...state,
    stock: { ...state.stock, [quest.resource]: state.stock[quest.resource] - quest.amount },
    npcQuestsDone: [...state.npcQuestsDone, npcId],
  };
  return { state: next, message: `任务完成：${npcDef(npcId).name} 的信任拿到了，可邀请入队（另付入队费）。` };
}

/** 邀请入队（§8：另一笔付费——20 对应资源；小当家可 40 食物；药神药品价 -25%）。 */
export function recruitNpc(state: GameState, npcId: string, payWith: 'resource' | 'food'): CmdResult {
  const def = npcDef(npcId);
  if (!state.npcQuestsDone.includes(npcId)) return { state, message: '先完成任务取得信任。' };
  if (state.members.length >= state.vehicle.seats) {
    return { state, message: `座位不足（${state.vehicle.seats} 座已有 ${state.members.length} 人），先扩载客量。` };
  }
  const quest = state.npcQuests[npcId];
  const resource = quest?.resource ?? 'food';
  let costResource: ResourceId = resource;
  let costAmount = RECRUIT_RESOURCE_COST;
  if (payWith === 'food' && state.hero === 'cook') {
    costResource = 'food';
    costAmount = RECRUIT_FOOD_COST;
  } else if (state.hero === 'pharmacist' && resource === 'medicine') {
    costAmount = Math.ceil(RECRUIT_RESOURCE_COST * PHARMACIST_RECRUIT_DISCOUNT);
  }
  if (state.stock[costResource] < costAmount) {
    return { state, message: `${resourceLabel(costResource)}不足（需 ${costAmount}）。` };
  }
  const next: GameState = {
    ...state,
    stock: { ...state.stock, [costResource]: state.stock[costResource] - costAmount },
    members: [...state.members, createMember(state.members.length, def.name)],
  };
  return { state: next, message: `${def.name} 入队（付 ${costAmount} ${resourceLabel(costResource)}）。` };
}

export { RUN_SAVE_KEY };
