// 车辆货舱占格规则（INVENTORY_DESIGN.md）。
//
// 纯 TypeScript，不 import `cc`，不碰 `wx`。Cocos/微信没有现成背包
// 占格组件，这是官方确认没有、必须自己实现的规则语义。
//
// 货舱固定 4 列 × 3 行（12 格）。物品按尺寸占格：
//   - 消耗品（食物/药品）：1×1，可堆叠
//   - 燃油/材料：2×1
//   - 幸存者/伤员：2×2（阶段 2 先不加入，规则预留）
//
// 所有命令都是纯函数：返回新 TrunkState，不修改入参。

import type { ResourceId } from './game.ts';
import { RESOURCE_IDS } from './game.ts';

// —— 类型 ——

export const TRUNK_COLS = 4;
export const TRUNK_ROWS = 3;
export const TRUNK_CAPACITY = TRUNK_COLS * TRUNK_ROWS; // 12

export type ItemSize = '1x1' | '2x1' | '2x2';

export interface TrunkItemDef {
  readonly id: string;
  readonly resource: ResourceId;
  readonly label: string;
  readonly size: ItemSize;
  /** 可堆叠的最大数量；1 表示不可堆叠。 */
  readonly maxStack: number;
}

export interface PlacedItem {
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
}

export interface TrunkState {
  readonly version: 1;
  readonly grid: readonly (string | null)[];
  readonly items: readonly PlacedItem[];
}

export interface PlaceResult {
  readonly state: TrunkState;
  readonly ok: boolean;
  readonly reason?: string;
}

// —— 默认物品表（阶段 2：食物/药品/燃油/材料，均不堆叠简化） ——

export const DEFAULT_ITEM_DEFS: readonly TrunkItemDef[] = [
  { id: 'food', resource: 'food', label: '食物', size: '1x1', maxStack: 5 },
  { id: 'medicine', resource: 'medicine', label: '药品', size: '1x1', maxStack: 3 },
  { id: 'fuel', resource: 'fuel', label: '燃油', size: '2x1', maxStack: 3 },
  { id: 'material', resource: 'material', label: '材料', size: '2x1', maxStack: 3 },
  { id: 'ammo', resource: 'ammo', label: '弹药', size: '1x1', maxStack: 5 },
  { id: 'survivor', resource: 'medicine', label: '幸存者', size: '2x2', maxStack: 1 },
];

export function createTrunkState(): TrunkState {
  return {
    version: 1,
    grid: Array.from({ length: TRUNK_CAPACITY }, () => null),
    items: [],
  };
}

// —— 索引换算 ——

export function cellIndex(x: number, y: number): number {
  if (x < 0 || x >= TRUNK_COLS || y < 0 || y >= TRUNK_ROWS) {
    throw new RangeError(`cell out of bounds: (${x}, ${y})`);
  }
  return y * TRUNK_COLS + x;
}

export function cellCoords(index: number): { x: number; y: number } {
  if (index < 0 || index >= TRUNK_CAPACITY) {
    throw new RangeError(`cell index out of bounds: ${index}`);
  }
  return { x: index % TRUNK_COLS, y: Math.floor(index / TRUNK_COLS) };
}

// —— 辅助 ——

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < TRUNK_COLS && y >= 0 && y < TRUNK_ROWS;
}

function isCellFree(state: TrunkState, x: number, y: number): boolean {
  return state.grid[cellIndex(x, y)] === null;
}

function occupy(prev: readonly (string | null)[], itemId: string, x: number, y: number, size: ItemSize): readonly (string | null)[] {
  const grid = [...prev];
  const [w, h] = sizeToCell(size);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      grid[cellIndex(x + dx, y + dy)] = itemId;
    }
  }
  return grid;
}

function clear(prev: readonly (string | null)[], itemId: string): readonly (string | null)[] {
  return prev.map((c) => (c === itemId ? null : c));
}

export function sizeToCell(size: ItemSize): readonly [number, number] {
  switch (size) {
    case '1x1': return [1, 1];
    case '2x1': return [2, 1];
    case '2x2': return [2, 2];
  }
}

export function itemDef(defs: readonly TrunkItemDef[], id: string): TrunkItemDef {
  const def = defs.find((d) => d.id === id);
  if (def === undefined) {
    throw new RangeError(`Unknown item: ${id}`);
  }
  return def;
}

// —— 核心命令 ——

/** 检查 (x,y) 能否容纳一个 size 物品（不越界、不重叠）。 */
export function canPlace(state: TrunkState, def: TrunkItemDef, x: number, y: number): boolean {
  const [w, h] = sizeToCell(def.size);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (!inBounds(cx, cy) || !isCellFree(state, cx, cy)) {
        return false;
      }
    }
  }
  return true;
}

/** 找第一个能放下 def 的位置；找不到返回 null。 */
export function firstFreeSpot(state: TrunkState, def: TrunkItemDef): { x: number; y: number } | null {
  for (let y = 0; y < TRUNK_ROWS; y++) {
    for (let x = 0; x < TRUNK_COLS; x++) {
      if (canPlace(state, def, x, y)) {
        return { x, y };
      }
    }
  }
  return null;
}

/** 在 (x,y) 放置一个物品（左上角锚点）。失败返回原因。 */
export function placeItem(
  state: TrunkState,
  defs: readonly TrunkItemDef[],
  itemId: string,
  x: number,
  y: number,
): PlaceResult {
  const def = itemDef(defs, itemId);
  // 先尝试堆叠：同物品已存在且未满 → 叠数量，不占新格子
  const existing = state.items.find((it) => it.itemId === itemId);
  if (existing !== undefined && existing.amount < def.maxStack) {
    const items = state.items.map((it) =>
      it.itemId === itemId ? { ...it, amount: it.amount + 1 } : it,
    );
    return { state: { version: 1, grid: state.grid, items }, ok: true };
  }
  if (!inBounds(x, y)) {
    return { state, ok: false, reason: '超出货舱边界' };
  }
  if (!canPlace(state, def, x, y)) {
    return { state, ok: false, reason: '该位置被占用或空间不足' };
  }
  const placed: PlacedItem = { itemId, x, y, amount: 1 };
  const items = [...state.items, placed];
  const grid = occupy(state.grid, itemId, x, y, def.size);
  return { state: { version: 1, grid, items }, ok: true };
}

/** 移除指定 itemId（整组移除，返回移除的数量）。 */
export function removeItem(state: TrunkState, itemId: string): { state: TrunkState; removed: number } {
  const existing = state.items.find((it) => it.itemId === itemId);
  if (existing === undefined) {
    return { state, removed: 0 };
  }
  const items = state.items.filter((it) => it.itemId !== itemId);
  const grid = clear(state.grid, itemId);
  return { state: { version: 1, grid, items }, removed: existing.amount };
}

/** 把物品移到新位置（整体移动）。失败返回原因。 */
export function moveItem(
  state: TrunkState,
  defs: readonly TrunkItemDef[],
  itemId: string,
  x: number,
  y: number,
): PlaceResult {
  const existing = state.items.find((it) => it.itemId === itemId);
  if (existing === undefined) {
    return { state, ok: false, reason: '物品不在货舱中' };
  }
  const def = itemDef(defs, itemId);
  // 目标位置需避开自己当前占用的格子
  const temp = clear(state.grid, itemId);
  const tempState: TrunkState = { ...state, grid: temp };
  if (!canPlace(tempState, def, x, y)) {
    return { state, ok: false, reason: '目标位置被占用或空间不足' };
  }
  const grid = occupy(temp, itemId, x, y, def.size);
  const items = state.items.map((it) => (it.itemId === itemId ? { ...it, x, y } : it));
  return { state: { version: 1, grid, items }, ok: true };
}

/** 已用格数。 */
export function usedCells(state: TrunkState, defs: readonly TrunkItemDef[]): number {
  return state.items.reduce((sum, it) => {
    const [w, h] = sizeToCell(itemDef(defs, it.itemId).size);
    return sum + w * h;
  }, 0);
}

// —— 序列化 ——

export function encodeTrunkState(state: TrunkState): string {
  return JSON.stringify(state);
}

export function decodeTrunkState(raw: string | null): TrunkState {
  if (raw === null) {
    return createTrunkState();
  }
  try {
    const candidate = JSON.parse(raw) as unknown;
    return isTrunkState(candidate) ? candidate : createTrunkState();
  } catch {
    return createTrunkState();
  }
}

function isTrunkState(value: unknown): value is TrunkState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const s = value as Partial<TrunkState>;
  if (s.version !== 1) {
    return false;
  }
  if (!Array.isArray(s.grid) || s.grid.length !== TRUNK_CAPACITY) {
    return false;
  }
  if (!Array.isArray(s.items)) {
    return false;
  }
  return s.items.every((it) =>
    typeof it?.itemId === 'string'
    && typeof it.x === 'number' && typeof it.y === 'number'
    && typeof it.amount === 'number'
    && (it.x === null || it.x === 0 || it.x > 0) // x/y 数值
  );
}

export { RESOURCE_IDS };
