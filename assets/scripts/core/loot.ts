// SLICE_004：抵达节点后的战利品规则层。
//
// 纯 TypeScript，不 import `cc`，不碰 `wx`。玩家抵达地点后，本模块
// 按地点倾向（game.ts LOCATIONS 的 guaranteed/lean）加权抽出「候选物资」；
// 装舱的占格/堆叠/移动语义全部复用 trunk.ts，本模块只管「抽什么」。
//
// 随机必须经由可种子 Rng（rng.ts），保证「同 seed + 同地点 → 同战利品」。
// 权重数值是 GAME_DESIGN 默认值，集中在此，拍板后只改这里。
//
// 库调研结论（docs/SLICE_004_NODE_LOOT.md）：npm 现成 loot 库均依赖
// Math.random 或过重/停更，无法接入确定性 Rng，故自实现这一最小子集。

import type { Rng } from './rng.ts';
import { LOCATION_IDS, LOCATIONS } from './game.ts';
import type { LocationId } from './game.ts';

/** 节点可掉落的货舱物品 id（与 trunk.DEFAULT_ITEM_DEFS 对应；幸存者不进战利品）。 */
export const LOOT_ITEM_IDS = ['food', 'medicine', 'fuel', 'material', 'ammo'] as const;
export type LootItemId = (typeof LOOT_ITEM_IDS)[number];

/** 抽取数量上下限（含两端）。上限 5 = 物品种类数：抽取互斥（每类至多一张候选卡），
 *  数值不可能超过 LOOT_ITEM_IDS.length，写 6 只是不可达的空头数字。 */
export const LOOT_DRAW_MIN = 4;
export const LOOT_DRAW_MAX = 5;

// 权重默认值：guaranteed > lean > 其它资源。
const WEIGHT_GUARANTEED = 6;
const WEIGHT_LEAN = 4;
const WEIGHT_OTHER = 1;

export interface LootRoll {
  readonly itemId: LootItemId;
  /** true 表示已被玩家装进货舱（候选卡不可再点）。 */
  readonly taken: boolean;
}

export interface LootState {
  readonly version: 1;
  readonly location: LocationId;
  /** 抽取用的随机种子，便于复盘与重放。 */
  readonly seed: number;
  readonly rolls: readonly LootRoll[];
}

export function isLootItemId(id: string): id is LootItemId {
  return (LOOT_ITEM_IDS as readonly string[]).includes(id);
}

/** 单地点权重表：资源 id 即货舱物品 id（food/medicine/fuel/material/ammo）。 */
export function buildLootWeights(location: LocationId): Map<LootItemId, number> {
  const def = LOCATIONS.find((l) => l.id === location);
  if (def === undefined) {
    throw new RangeError(`Unknown location: ${location}`);
  }
  const weights = new Map<LootItemId, number>();
  for (const itemId of LOOT_ITEM_IDS) {
    const weight = def.guaranteed.includes(itemId)
      ? WEIGHT_GUARANTEED
      : def.lean.includes(itemId)
        ? WEIGHT_LEAN
        : WEIGHT_OTHER;
    weights.set(itemId, weight);
  }
  return weights;
}

function weightedPick(weights: Map<LootItemId, number>, rng: Rng): LootItemId {
  let total = 0;
  for (const w of weights.values()) {
    total += w;
  }
  let roll = rng.next() * total;
  for (const [id, w] of weights) {
    roll -= w;
    if (roll < 0) {
      return id;
    }
  }
  // 浮点兜底：理论上到不了这里（不要对 Map.keys() 用展开语法，见 ADR-006）
  let last: LootItemId | undefined;
  weights.forEach((_w, id) => {
    last = id;
  });
  if (last === undefined) {
    throw new RangeError('weightedPick: empty pool');
  }
  return last;
}

/** 抵达节点时抽取候选物资：4~6 件、互不重复、至少 1 件 guaranteed。 */
export function rollNodeLoot(location: LocationId, rng: Rng, seed = 0): LootState {
  const def = LOCATIONS.find((l) => l.id === location);
  if (def === undefined) {
    throw new RangeError(`Unknown location: ${location}`);
  }
  const weights = buildLootWeights(location);
  const picked: LootItemId[] = [];
  const count = rng.int(LOOT_DRAW_MIN, LOOT_DRAW_MAX);
  for (let i = 0; i < count && weights.size > 0; i++) {
    const id = weightedPick(weights, rng);
    picked.push(id);
    weights.delete(id);
  }
  // guaranteed 兜底：一件都没抽到时，随机替换其中一件
  const guaranteedItems = def.guaranteed.filter(isLootItemId);
  if (picked.length > 0 && guaranteedItems.length > 0
    && !picked.some((id) => guaranteedItems.includes(id))) {
    const replaceAt = rng.int(0, picked.length - 1);
    picked[replaceAt] = rng.pick(guaranteedItems);
  }
  return {
    version: 1,
    location,
    seed,
    rolls: picked.map((itemId) => ({ itemId, taken: false })),
  };
}

/** 未被带走的候选（候选卡渲染用）。 */
export function remainingLoot(state: LootState): readonly LootRoll[] {
  return state.rolls.filter((r) => !r.taken);
}

/** 装舱时把该物品的一张候选卡标记为已带走。 */
export function takeLoot(state: LootState, itemId: LootItemId): { state: LootState; ok: boolean } {
  const index = state.rolls.findIndex((r) => r.itemId === itemId && !r.taken);
  if (index < 0) {
    return { state, ok: false };
  }
  const rolls = state.rolls.map((r, i) => (i === index ? { ...r, taken: true } : r));
  return { state: { ...state, rolls }, ok: true };
}

/** 取回：把已带走的至多 count 张候选卡还原（removeItem 返回整组数量时按数还原）。 */
export function putBackLoot(
  state: LootState,
  itemId: LootItemId,
  count: number,
): { state: LootState; returned: number } {
  let left = Math.max(0, Math.floor(count));
  let returned = 0;
  const rolls = state.rolls.map((r) => {
    if (r.itemId === itemId && r.taken && left > 0) {
      left -= 1;
      returned += 1;
      return { ...r, taken: false };
    }
    return r;
  });
  return { state: { ...state, rolls }, returned };
}

// —— 存档 ——

export function encodeLootState(state: LootState): string {
  return JSON.stringify(state);
}

/** 从存档恢复；非法数据返回 null（无战利品会话，表现层据此忽略）。 */
export function decodeLootState(raw: string | null | undefined): LootState | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (obj['version'] !== 1 || !LOCATION_IDS.includes(obj['location'] as never)) {
      return null;
    }
    if (typeof obj['seed'] !== 'number' || !Number.isFinite(obj['seed'])) {
      return null;
    }
    if (!Array.isArray(obj['rolls'])) {
      return null;
    }
    const rolls: LootRoll[] = [];
    for (const entry of obj['rolls']) {
      if (typeof entry !== 'object' || entry === null) {
        return null;
      }
      const e = entry as Record<string, unknown>;
      if (typeof e['itemId'] !== 'string' || !isLootItemId(e['itemId'])
        || typeof e['taken'] !== 'boolean') {
        return null;
      }
      rolls.push({ itemId: e['itemId'], taken: e['taken'] });
    }
    return {
      version: 1,
      location: obj['location'] as LocationId,
      seed: obj['seed'],
      rolls,
    };
  } catch {
    return null;
  }
}
