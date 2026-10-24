// 区域制货舱：槽位容量模型（GAME_DESIGN §5：初始 12 格，每格按类型设上限，
// 同资源堆叠至该上限；取舍按「格数紧张」而非「单位凑整」）。
//
// 与旧 trunk.ts 的形状占格是两套模型：这里一格 = 一种资源的堆叠位。
// 表现层仍可用 4×3 网格呈现，交互沿用「候选区 → 点选放置」手感。

import { SLOT_CAP } from './config.ts';
import type { ResourceId } from './regions.ts';

export interface HoldSlot {
  readonly resource: ResourceId;
  amount: number;
}

export interface HoldState {
  readonly slots: readonly HoldSlot[];
}

export const createHold = (): HoldState => ({ slots: [] });

/** 装舱容量：总格数 = 车辆储物格数（由 run.ts 传入）。 */
export function usedSlots(hold: HoldState): number {
  return hold.slots.length;
}

/** 某资源还能装多少单位（受每格上限与剩余空格约束）。 */
export function remainingCapacity(hold: HoldState, resource: ResourceId, totalSlots: number): number {
  const cap = SLOT_CAP[resource];
  let remaining = 0;
  for (const slot of hold.slots) {
    if (slot.resource === resource) {
      remaining += cap - slot.amount;
    }
  }
  remaining += Math.max(0, totalSlots - hold.slots.length) * cap;
  return remaining;
}

export interface LoadResult {
  readonly hold: HoldState;
  /** 实际装入的单位数（装不下的部分留在现场 = 取舍压力）。 */
  readonly loaded: number;
}

/** 尽力装入指定数量：先填同资源未满槽，再开新槽；满了即止。 */
export function loadResource(hold: HoldState, resource: ResourceId, amount: number, totalSlots: number): LoadResult {
  if (amount <= 0) return { hold, loaded: 0 };
  const cap = SLOT_CAP[resource];
  let pending = amount;
  const slots: HoldSlot[] = hold.slots.map((s) => ({ ...s }));

  for (const slot of slots) {
    if (slot.resource === resource && slot.amount < cap && pending > 0) {
      const take = Math.min(cap - slot.amount, pending);
      slot.amount += take;
      pending -= take;
    }
  }
  while (pending > 0 && slots.length < totalSlots) {
    const take = Math.min(cap, pending);
    slots.push({ resource, amount: take });
    pending -= take;
  }
  return { hold: { slots }, loaded: amount - pending };
}

/** 从舱内移除资源（战果结算不回退；预留给丢弃交互）。 */
export function unloadResource(hold: HoldState, resource: ResourceId, amount: number): HoldState {
  let pending = amount;
  // 先清空同资源槽（从后往前不影响语义，保持顺序稳定）
  const keep: HoldSlot[] = hold.slots.map((s) => ({ ...s }));
  for (let i = keep.length - 1; i >= 0 && pending > 0; i--) {
    const slot = keep[i];
    if (slot === undefined || slot.resource !== resource) continue;
    const take = Math.min(slot.amount, pending);
    slot.amount -= take;
    pending -= take;
  }
  const slots: HoldSlot[] = [];
  for (const slot of keep) {
    if (slot.amount > 0) slots.push(slot);
  }
  return { slots };
}

/** 舱内各资源汇总（抵仓入库用）。 */
export function holdTotals(hold: HoldState): { resource: ResourceId; amount: number }[] {
  const totals: { resource: ResourceId; amount: number }[] = [];
  for (const slot of hold.slots) {
    const existing = totals.find((t) => t.resource === slot.resource);
    if (existing === undefined) {
      totals.push({ resource: slot.resource, amount: slot.amount });
    } else {
      existing.amount += slot.amount;
    }
  }
  return totals;
}

// —— 序列化（存档透传用）——

export function encodeHold(hold: HoldState): string {
  return JSON.stringify(hold);
}

export function decodeHold(raw: string | null): HoldState {
  if (raw === null) return createHold();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return createHold();
    const candidate = parsed as Partial<HoldState>;
    if (!Array.isArray(candidate.slots)) return createHold();
    for (const slot of candidate.slots) {
      const s = slot as Partial<HoldSlot>;
      if (typeof s.resource !== 'string' || typeof s.amount !== 'number') return createHold();
    }
    return { slots: candidate.slots };
  } catch {
    return createHold();
  }
}
