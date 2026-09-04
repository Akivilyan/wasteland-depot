// 存档序列化。
//
// 只做 GameState 的 encode/decode。存储底层复用已有 platform/storage.ts
// （微信同步存储 / 浏览器 localStorage），这里不重写存储，只定义
// 状态怎么变成字符串、怎么安全还原。

import type { GameState } from './sim.ts';
import { RESOURCE_IDS } from './game.ts';
import type { ResourceId } from './game.ts';

export const SAVE_KEY = 'wasteland-depot.save.v1';

/** 项目全部存档键位（ARCHITECTURE 第 3 节的单一出处）。
 *  「重新开始」清档、存档迁移、排查工具都以此遍历，避免新增键时漏清。 */
export const ALL_SAVE_KEYS: readonly string[] = [
  SAVE_KEY,
  'wasteland-depot.trunk.v1',
  'wasteland-depot.trip.v1',
  'wasteland-depot.loot.v1',
  'wasteland-depot.trip-trunk.v1',
];

export function encodeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function decodeGameState(raw: string | null): GameState | null {
  if (raw === null) {
    return null;
  }
  try {
    const candidate = JSON.parse(raw) as unknown;
    return isGameState(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const s = value as Partial<GameState>;
  if (s.version !== 1 || typeof s.day !== 'number') {
    return false;
  }
  if (typeof s.stock !== 'object' || s.stock === null) {
    return false;
  }
  const stock = s.stock as Record<string, unknown>;
  if (!RESOURCE_IDS.every((id) => typeof stock[id] === 'number')) {
    return false;
  }
  if (typeof s.vehicle !== 'object' || s.vehicle === null) {
    return false;
  }
  if (!Array.isArray(s.survivors) || !Array.isArray(s.explored) || !Array.isArray(s.log)) {
    return false;
  }
  return true;
}

export { RESOURCE_IDS };
export type { ResourceId };
