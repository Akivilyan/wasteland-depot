// SLICE_003：地图骨架 + 行车演出 的规则层（DECISIONS「表现层方向」）。
//
// 纯 TypeScript，不 import `cc`，不碰 `wx`。只描述「一条公路骨架」：
// 仓库 + 5 个地点沿一条单线公路分布（里程 km），玩家选节点出发，
// 行车段由表现层播放横轴卷轴，抵达后进入节点交互，返程回地图。
//
// 首版只做一条路线（GAME_SKELETON 12 节探路验证范围）；路线结构、
// 地点名单属 PENDING_DECISIONS D2 未确认项，数值全部集中在这里和
// constants.ts，拍板后改数据即可。

import type { LocationId } from './game.ts';
import { LEG_FUEL_PER_10KM } from './constants.ts';

/** 节点在单线公路上的位置：仓库为 0，地点按 km 递增。 */
export interface RouteNode {
  readonly id: LocationId | 'depot';
  /** 距仓库里程（km），仓库为 0。 */
  readonly km: number;
}

/** 首版唯一路线：仓库 → 城郊 → 牧场 → 医院 → 车库 → 兵工厂。
 *  兵工厂最远且 risk 最高（game.ts LOCATIONS），符合"越远越险"的直觉。 */
export const DEPOT_ROUTE: readonly RouteNode[] = [
  { id: 'depot', km: 0 },
  { id: 'suburb', km: 10 },
  { id: 'farm', km: 25 },
  { id: 'hospital', km: 45 },
  { id: 'garage', km: 65 },
  { id: 'ammo_factory', km: 90 },
];

/** 单程油耗：里程换算燃油（每 10km 1 点，向上取整，最低 1）。 */
export function legFuelCost(km: number): number {
  if (!Number.isFinite(km) || km <= 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(km / 10 * LEG_FUEL_PER_10KM));
}

export type TripPhase = 'map' | 'driving' | 'atNode' | 'returning';

/** 一次外出的完整状态（可序列化，表现层据此驱动演出）。 */
export interface TripState {
  readonly version: 1;
  readonly phase: TripPhase;
  /** 本次目的地（atNode/returning 时有意义）。 */
  readonly destination: LocationId | null;
  /** 已消耗的燃油（出发时结算）。 */
  readonly fuelSpent: number;
}

export function createTripState(): TripState {
  return { version: 1, phase: 'map', destination: null, fuelSpent: 0 };
}

/** 路线上是否有该节点（含仓库）。 */
export function routeHasNode(id: string): boolean {
  return DEPOT_ROUTE.some((n) => n.id === id);
}

/** 该节点距仓库的里程；不在路线上返回 null（仓库为 0）。 */
export function locationKm(id: string): number | null {
  const node = DEPOT_ROUTE.find((n) => n.id === id);
  return node === undefined ? null : node.km;
}

export interface DepartResult {
  readonly state: TripState;
  /** 需要扣减的燃油；0 表示不能出发。 */
  readonly fuelCost: number;
  /** 不能出发的原因（fuelCost 为 0 时有值）。 */
  readonly reason: string | null;
}

/**
 * 从仓库出发前往目的地。合法性在这里裁决：
 * 目的地必须在路线上、燃油足够。燃油结算一次，行车/返程不再扣。
 */
export function depart(state: TripState, destination: LocationId, fuel: number): DepartResult {
  if (state.phase !== 'map') {
    return { state, fuelCost: 0, reason: '当前不在地图阶段。' };
  }
  if (!routeHasNode(destination) || destination === 'depot') {
    return { state, fuelCost: 0, reason: '目的地不在路线图上。' };
  }
  const node = DEPOT_ROUTE.find((n) => n.id === destination);
  const cost = legFuelCost(node === undefined ? 0 : node.km);
  if (fuel < cost) {
    return { state, fuelCost: 0, reason: `燃油不足：前往该地需要 ${cost} 燃油。` };
  }
  return {
    state: { version: 1, phase: 'driving', destination, fuelSpent: cost },
    fuelCost: cost,
    reason: null,
  };
}

/** 抵达目的地（表现层在行车演出结束时调用）。 */
export function arrive(state: TripState): TripState {
  if (state.phase !== 'driving' || state.destination === null) {
    return state;
  }
  return { ...state, phase: 'atNode' };
}

/** 返程：节点交互结束，演出回仓库（燃油已在出发时扣）。 */
export function departReturn(state: TripState): TripState {
  if (state.phase !== 'atNode') {
    return state;
  }
  return { ...state, phase: 'returning' };
}

/** 回到地图（返程演出结束/中途放弃时调用，重置为待出发）。 */
export function backToMap(state: TripState): TripState {
  return createTripState();
}

// —— 存档 ——

export function encodeTripState(state: TripState): string {
  return JSON.stringify(state);
}

/** 从存档恢复；非法数据回退到初始态（与 trunk.decodeTrunkState 同策略）。 */
export function decodeTripState(raw: string | null | undefined): TripState {
  if (raw === null || raw === undefined || raw === '') {
    return createTripState();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return createTripState();
    }
    const obj = parsed as Record<string, unknown>;
    const phase = obj['phase'];
    if (phase !== 'map' && phase !== 'driving' && phase !== 'atNode' && phase !== 'returning') {
      return createTripState();
    }
    const destination = obj['destination'];
    if (destination !== null && typeof destination !== 'string') {
      return createTripState();
    }
    const fuelSpent = typeof obj['fuelSpent'] === 'number' && Number.isFinite(obj['fuelSpent'])
      ? obj['fuelSpent']
      : 0;
    return {
      version: 1,
      phase,
      destination: destination as LocationId | null,
      fuelSpent,
    };
  } catch {
    return createTripState();
  }
}
