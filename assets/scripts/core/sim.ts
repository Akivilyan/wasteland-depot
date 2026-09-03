// 十日核心循环引擎（GAME_SKELETON 第 3、4 节）。
//
// 纯 TypeScript，不 import `cc`，不碰 `wx`。它把「一天」描述成一组
// 纯函数命令：看据点 → 选目的地/同行者 → 消耗燃油弹药出发 → 处理
// 道路事件 → 装车取舍 → 回仓库分配 → 推进一天。
//
// 全部确定性：同 seed + 同决策序列 → 同结果。AI 测试与未来人工测试
// 都走同一套命令。

import type { Rng } from './rng.ts';
import type {
  GameConfig,
  GameEvent,
  ResourceStock,
  ResourceId,
  LocationId,
  LocationDef,
} from './game.ts';
import {
  pickEvent,
  applyOutcome,
  LOCATIONS,
} from './game.ts';
import { locationKm, legFuelCost } from './route.ts';
import type { TrunkState, TrunkItemDef } from './trunk.ts';
import type {
  VehicleStats,
} from './constants.ts';
import {
  GAME_DAYS,
  STARTING_RESOURCES,
  DAILY_FOOD_COST,
  STARTING_DAY_NUMBER,
  FACILITY_LEVELS,
  VEHICLE_DEFAULT,
  TRIP_AMMO_COST,
  ROAD_EVENT_CHANCE,
  DANGER_STEP,
  MAX_DANGER,
  DANGER_GROWTH_PER_DAY,
  FINAL_DAY_INDEX,
} from './constants.ts';

// —— 游戏态（可序列化，与 scenario.ts 共用）——

export interface SurvivorInGame {
  readonly id: number;
  readonly name: string;
  readonly profession: string;
  readonly wounded: boolean;
}

export interface GameState {
  readonly version: 1;
  /** 从 1 开始，到 GAME_DAYS 结束。 */
  readonly day: number;
  /** 据点仓库里的资源存量。 */
  readonly stock: ResourceStock;
  /** 已招募的幸存者。 */
  readonly survivors: readonly SurvivorInGame[];
  /** 车辆装备（载重/油耗/防护/探索距离）。 */
  readonly vehicle: VehicleStats;
  /** 仓库设施等级（storage/repair/clinic/radio）。 */
  readonly facilityLevels: typeof FACILITY_LEVELS;
  /** 世界危险度（0..MAX_DANGER），随推进增长。 */
  readonly danger: number;
  /** 已探索/已解锁的地点集合。 */
  readonly explored: readonly LocationId[];
  /** 车辆是否损坏（外出遇险时置位，回仓库需修复）。 */
  readonly vehicleDamaged: boolean;
  /** 本次外出的日志，用于回放与展示。 */
  readonly log: readonly string[];
  /** 最终结局标记。 */
  readonly ending: string | null;
}

export interface CargoLoad {
  readonly resource: ResourceId;
  readonly amount: number;
}

export interface ActionResult {
  readonly state: GameState;
  /** 本次命令产生的即时反馈，供表现层展示。 */
  readonly message: string;
}

// —— 初始态 ——

export function createInitialGameState(): GameState {
  return {
    version: 1,
    day: STARTING_DAY_NUMBER,
    stock: { ...STARTING_RESOURCES },
    survivors: [],
    vehicle: { ...VEHICLE_DEFAULT },
    facilityLevels: { ...FACILITY_LEVELS },
    danger: 0,
    explored: ['suburb'],
    vehicleDamaged: false,
    log: ['第 1 天：据点建立。'],
    ending: null,
  };
}

function findLocation(id: LocationId): LocationDef {
  const def = LOCATIONS.find((l) => l.id === id);
  if (def === undefined) {
    throw new RangeError(`Unknown location: ${id}`);
  }
  return def;
}

// —— 阶段：出发（startTrip）——
//
// 油耗用 route.ts 的里程模型（legFuelCost，地图节点牌上展示的就是它）；
// vehicle.fuelCost 保留为车辆属性，供司机职业/车辆升级未来消费。

export function startTrip(state: GameState, location: LocationId): ActionResult {
  const km = locationKm(location);
  if (km === null) {
    return { state, message: '目的地不在路线图上。' };
  }
  const fuelCost = legFuelCost(km);
  if (state.stock.fuel < fuelCost) {
    return { state, message: `燃油不足：前往该地需要 ${fuelCost} 燃油。` };
  }
  if (state.stock.ammo < TRIP_AMMO_COST) {
    return { state, message: `弹药不足：出发需要 ${TRIP_AMMO_COST} 弹药。` };
  }

  const def = findLocation(location);
  const next: GameState = {
    ...state,
    stock: {
      ...state.stock,
      fuel: state.stock.fuel - fuelCost,
      ammo: state.stock.ammo - TRIP_AMMO_COST,
    },
    log: [...state.log, `出发前往 ${def.label}（耗燃油 ${fuelCost}、弹药 ${TRIP_AMMO_COST}）。`],
  };
  return { state: next, message: `出发前往 ${def.label}。` };
}

// —— 阶段：道路事件（drawRoadEvent + resolveEvent）——
//
// 行车途中由表现层先 drawRoadEvent 抽取（可能为 null=本趟无事），展示面板
// 等玩家选择，再 resolveEvent 结算。命令不改变 day，只推进本次外出的子步骤。
// 防护（车辆保护）可降低 damage 后果。

/** 行车途中抽一个道路事件；按 ROAD_EVENT_CHANCE 概率返回 null（本趟无事件）。 */
export function drawRoadEvent(rng: Rng, config: GameConfig): GameEvent | null {
  if (!rng.chance(ROAD_EVENT_CHANCE)) {
    return null;
  }
  return pickEvent(rng, config);
}

/** 结算指定事件的指定选项。choiceIndex 越界/缺后果时原样返回并附原因。 */
export function resolveEvent(
  state: GameState,
  event: GameEvent,
  choiceIndex: number,
  config: GameConfig,
): ActionResult {
  const choice = event.choices[choiceIndex];
  if (choice === undefined) {
    return { state, message: `无效选择：${choiceIndex}` };
  }
  const outcome = event.outcomes[choiceIndex];
  if (outcome === undefined) {
    return { state, message: `事件 ${event.id} 缺少该选项后果。` };
  }

  let appliedOutcome = outcome;
  if (outcome.type === 'damage' && event.protectionSensitive && state.vehicle.protection > 0) {
    appliedOutcome = { type: 'damage', amount: Math.max(0, outcome.amount - state.vehicle.protection) };
  }

  const { stock, message } = applyOutcome(state.stock, appliedOutcome, config);
  // reveal 后果：把揭示的地点加入已探索集合（applyOutcome 只产出文案）
  let explored = state.explored;
  if (appliedOutcome.type === 'reveal' && !state.explored.includes(appliedOutcome.location)) {
    explored = [...state.explored, appliedOutcome.location];
  }
  const next: GameState = {
    ...state,
    stock,
    explored,
    log: [...state.log, `事件「${event.title}」→ ${message}`],
  };
  return { state: next, message: `事件「${event.title}」→ ${message}` };
}

// —— 阶段：装车取舍（loadCargo）——
//
// 玩家把本地点可带走的资源装进后备箱。cargo 是想要带走的清单，
// 超过载重会拒绝并提示（取舍压力由表现层引导，这里保证规则一致）。
// 真正的入库发生在 returnHome，此处只做合法性校验。

export function loadCargo(state: GameState, cargo: readonly CargoLoad[]): ActionResult {
  const total = cargo.reduce((sum, c) => sum + c.amount, 0);
  if (total > state.vehicle.capacity) {
    return { state, message: `载重超限：需要 ${total} 格，货舱只有 ${state.vehicle.capacity} 格。` };
  }
  return { state, message: `已装载 ${total} 格物资。` };
}

// —— 阶段：回仓库（returnHome）——
//
// 把本次外出的物资加入仓库、结算车辆损伤、消耗食物维持。
// 这是"本次外出收益落袋"的时点。载重合法性不在这里复查：
// 货舱流程的占格上限由 trunk 放置保证，抽象流程由 loadCargo 校验。

export function returnHome(state: GameState, cargo: readonly CargoLoad[]): ActionResult {
  let stock: ResourceStock = { ...state.stock };
  let total = 0;
  for (const c of cargo) {
    total += c.amount;
    stock = { ...stock, [c.resource]: stock[c.resource] + c.amount };
  }
  const log = [...state.log, `返回仓库，带回 ${total} 格物资。`];
  return { state: { ...state, stock, log }, message: `返回仓库，带回 ${total} 格物资。` };
}

/**
 * 货舱物品 → 入库清单：按物品定义的 resource 折算，同资源合并数量。
 * 供表现层在抵仓时把 TrunkState 交给 returnHome。
 */
export function cargoFromTrunk(
  trunk: TrunkState,
  defs: readonly TrunkItemDef[],
): CargoLoad[] {
  const totals = new Map<ResourceId, number>();
  for (const item of trunk.items) {
    const def = defs.find((d) => d.id === item.itemId);
    if (def === undefined) continue;
    totals.set(def.resource, (totals.get(def.resource) ?? 0) + item.amount);
  }
  // 注意：不要对 Map 用展开语法（[...map]）。Cocos 微信构建会把它降级成
  // [].concat(map)，得到 [Map] 而非条目数组（DECISIONS ADR-006），这里用 forEach。
  const cargo: CargoLoad[] = [];
  totals.forEach((amount, resource) => cargo.push({ resource, amount }));
  return cargo;
}

// —— 阶段：推进一天（advanceDay）——
//
// 结算每日食物消耗、危险度增长、检查结局，进入下一天。
// 这是唯一推进 day 的命令，保证「一天只结算一次」。

export function advanceDay(state: GameState): ActionResult {
  if (state.day >= GAME_DAYS) {
    return { state, message: '已是最后一天，游戏结束。' };
  }
  const foodCost = Math.min(state.stock.food, DAILY_FOOD_COST);
  let stock: ResourceStock = {
    ...state.stock,
    food: state.stock.food - foodCost,
  };
  // 世界危险度每日增长；食物不足时额外上升（默认值，PENDING_DECISIONS 标注）
  let danger = Math.min(MAX_DANGER, state.danger + DANGER_GROWTH_PER_DAY);
  let message = `第 ${state.day + 1} 天：食物消耗 ${foodCost}。`;
  if (state.stock.food < DAILY_FOOD_COST) {
    danger = Math.min(MAX_DANGER, danger + 1);
    message += ' 食物耗尽，危险度额外上升。';
  }
  const nextDay = state.day + 1;
  const ending = nextDay > FINAL_DAY_INDEX ? 'survived' : null;

  const next: GameState = {
    ...state,
    day: nextDay,
    stock,
    danger,
    log: [...state.log, message],
    ending,
  };
  return { state: next, message: message.trim() };
}

// —— 高维工具：跑完整一局（供测试/模拟用）——
//
// 用一个简单贪心策略自动打完 10 天，验证整条链路确定、可结算。
// 真正的玩家/AI 决策会替换这个策略；这里只证明规则层闭环成立。

export function runSimulation(state: GameState, rng: Rng, config: GameConfig): GameState {
  let current = state;
  for (let day = state.day; day <= GAME_DAYS && current.ending === null; day++) {
    const start = startTrip(current, 'suburb');
    if (start.message.includes('不足')) {
      current = advanceDay(start.state).state;
      continue;
    }
    current = start.state;
    const event = drawRoadEvent(rng, config);
    if (event !== null) {
      current = resolveEvent(current, event, 0, config).state;
    }
    const cargo: CargoLoad[] = [{ resource: 'food', amount: 2 }];
    current = returnHome(current, cargo).state;
    current = advanceDay(current).state;
  }
  return current;
}

// —— 辅助 ——

/** 能否出发：地点在路线上、燃油（里程模型）与弹药足够、风险在车辆探索距离内。 */
export function canAffordTrip(state: GameState, location: LocationId): boolean {
  const km = locationKm(location);
  if (km === null) {
    return false;
  }
  const def = findLocation(location);
  return state.stock.fuel >= legFuelCost(km)
    && state.stock.ammo >= TRIP_AMMO_COST
    && def.risk <= state.vehicle.range;
}
