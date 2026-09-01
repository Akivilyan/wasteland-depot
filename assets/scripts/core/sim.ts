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

export function startTrip(state: GameState, location: LocationId): ActionResult {
  const def = findLocation(location);
  const fuelCost = state.vehicle.fuelCost;
  if (state.stock.fuel < fuelCost) {
    return { state, message: '燃油不足，无法出发。' };
  }
  if (state.stock.ammo < TRIP_AMMO_COST) {
    return { state, message: '弹药不足，无法出发。' };
  }

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

// —— 阶段：道路事件（choose）——
//
// 出发后玩家按序遇到事件，用 choose 选一项。choose 不会改变 day，
// 只是推进本次外出的子步骤。防护（车辆保护）可降低 damage 后果。

export function choose(state: GameState, choiceIndex: number, rng: Rng, config: GameConfig): ActionResult {
  const event = pickEvent(rng, config);
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
  const next: GameState = {
    ...state,
    stock,
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
// 这是"本次外出收益落袋"的时点。

export function returnHome(state: GameState, cargo: readonly CargoLoad[]): ActionResult {
  const total = cargo.reduce((sum, c) => sum + c.amount, 0);
  if (total > state.vehicle.capacity) {
    return { state, message: '载重超限，无法回程。' };
  }
  let stock: ResourceStock = { ...state.stock };
  for (const c of cargo) {
    stock = { ...stock, [c.resource]: stock[c.resource] + c.amount };
  }
  const log = [...state.log, `返回仓库，带回 ${total} 格物资。`];
  return { state: { ...state, stock, log }, message: `返回仓库，带回 ${total} 格物资。` };
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
    current = choose(current, 0, rng, config).state;
    const cargo: CargoLoad[] = [{ resource: 'food', amount: 2 }];
    current = returnHome(current, cargo).state;
    current = advanceDay(current).state;
  }
  return current;
}

// —— 辅助 ——

export function canAffordTrip(state: GameState, location: LocationId): boolean {
  const def = findLocation(location);
  return state.stock.fuel >= state.vehicle.fuelCost
    && state.stock.ammo >= TRIP_AMMO_COST
    && def.risk <= state.vehicle.range;
}
