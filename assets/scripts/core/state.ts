// 区域制长局 GameState v2 与存档编解码（GAME_DESIGN §3~§11）。
//
// 一局长局 = 一份可序列化 GameState。探索会话（Expedition）内嵌在
// 状态里，中断即存档、恢复即回到当前节点，不存在半死相位。
// 随机源状态（rngState）随档保存，同档恢复后随机序列可复现。

import type { RegionId, TierId, LayerId, ResourceId, ResourceStock } from './regions.ts';
import type { HeroId } from './hero.ts';
import type { HoldState } from './hold.ts';
import type { PartId } from './config.ts';

import { NPC_HP_BASE, NPC_HP_CAP_BASE } from './config.ts';

export interface NpcMember {
  readonly id: number;
  readonly name: string;
  /** 当前血量（0 = 濒死线）。 */
  hp: number;
  /** 血量上限（补剂可推、硬顶 200）。 */
  hpCap: number;
  /** 濒死（不死）：驻留仓库，拉出濒死线前不能再出发。 */
  dying: boolean;
}

export interface Expedition {
  readonly region: RegionId;
  readonly tier: TierId;
  readonly hold: HoldState;
  /** 本次出发已推进节点数（含 boss/NPC 节点）。 */
  nodesVisitedThisTrip: number;
  /** 近期事件 id（去重用，最多留 6 个）。 */
  recentEventIds: string[];
  /** 车辆打空：必须返程，不能再推进节点。 */
  forcedReturn: boolean;
}

export interface GameState {
  readonly version: 2;
  /** 从 1 开始，无硬上限。 */
  day: number;
  hero: HeroId | null;
  stock: ResourceStock;
  /** 储量升级 0..3（每资源上限 = 100 + 50×level）。 */
  stockUpgradeLevel: number;
  vehicle: {
    /** 当前耐久。 */
    durability: number;
    /** 耐久科技 0..3（上限 = 200/250/300/350）。 */
    durabilityLevel: number;
    /** 储物格数（初始 12，+ 号按钮扩）。 */
    slots: number;
    /** 载客量（初始 2，+ 号按钮扩；成员总数上限）。 */
    seats: number;
  };
  /** 武器等级 0..2（L1/L2/L3）。 */
  weaponLevel: number;
  wall: {
    hp: number;
    /** 围墙升级 0..3（上限 = 200/300/400/500）。 */
    level: number;
  };
  /** 乘员（含开局自带 1 名；濒死者驻留仓库）。 */
  members: NpcMember[];
  /** 已首遇（=已接任务）的野外 NPC id。 */
  npcMet: string[];
  /** 进行中的任务：npcId → 需求。 */
  npcQuests: Record<string, { resource: ResourceId; amount: number }>;
  /** 已在任务板提交完成的 npcId。 */
  npcQuestsDone: string[];
  /** 额外解锁的层（外围六区默认开放，不列于此）。 */
  unlockedLayers: LayerId[];
  /** 已击杀 boss 的层。 */
  bossKilled: LayerId[];
  /** 每层累计节点数（boss 保底计数，跨次出发累计，不因返程重置）。 */
  layerNodeCount: Record<string, number>;
  /** 全局累计普通节点数（NPC 保底计数）。 */
  globalNodeCount: number;
  /** 已集齐信号零件。 */
  parts: PartId[];
  /** 已发生（抵御或缺席）的波次数。 */
  wavesPassed: number;
  /** 实际守住过的波次数。 */
  wavesDefended: number;
  /** 终局倒计时：null = 未触发；>0 = 剩余天数；0 = 最终战待开（finalePending）。 */
  finaleCountdown: number | null;
  /** 最终战已触发待开（在仓即开；在途顺延至返仓）。 */
  finalePending: boolean;
  ending: 'victory' | 'defeat' | null;
  expedition: Expedition | null;
  /** 序章货舱（序章拾取用；抵仓结算后置 null，非序章恒为 null）。 */
  prologueHold: HoldState | null;
  /** 序章站点进度（0..4；表现层流程用，抵仓后无意义）。旧档缺失视为 0。 */
  prologueStep: number;
  /** 守家战待开（波次日结时人在仓库）。 */
  homeBattlePending: boolean;
  rngState: number;
  log: string[];
}

export const RUN_SAVE_KEY = 'wasteland-depot.run.v2';

/** 项目全部存档键位（ARCHITECTURE 第 3 节的单一出处）。
 *  「重新开始」清档、存档迁移、排查工具都以此遍历，避免新增键时漏清。
 *  v1 五键是旧十日模型的档位：只剩清档语义，编解码已随旧模型退役。 */
export const ALL_SAVE_KEYS: readonly string[] = [
  RUN_SAVE_KEY,
  'wasteland-depot.save.v1',
  'wasteland-depot.trunk.v1',
  'wasteland-depot.trip.v1',
  'wasteland-depot.loot.v1',
  'wasteland-depot.trip-trunk.v1',
];

export function encodeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function decodeGameState(raw: string | null): GameState | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isGameState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isGameState(value: unknown): value is GameState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<GameState>;
  if (s.version !== 2 || typeof s.day !== 'number' || !Array.isArray(s.members)) return false;
  if (typeof s.stock !== 'object' || s.stock === null) return false;
  const stock = s.stock as Partial<ResourceStock>;
  for (const key of ['fuel', 'food', 'material', 'medicine', 'ammo'] as const) {
    if (typeof stock[key] !== 'number') return false;
  }
  if (typeof s.vehicle !== 'object' || s.vehicle === null) return false;
  const vehicle = s.vehicle as Partial<GameState['vehicle']>;
  for (const key of ['durability', 'durabilityLevel', 'slots', 'seats'] as const) {
    if (typeof vehicle[key] !== 'number') return false;
  }
  if (typeof s.wall !== 'object' || s.wall === null) return false;
  const wall = s.wall as Partial<GameState['wall']>;
  if (typeof wall.hp !== 'number' || typeof wall.level !== 'number') return false;
  // 损坏档防御：expedition 形状异常一律拒收，回退空态（ARCHITECTURE §3）。
  if (s.expedition !== null && s.expedition !== undefined) {
    const e = s.expedition as Partial<Expedition>;
    if (typeof e.region !== 'string' || typeof e.tier !== 'string') return false;
    if (typeof e.hold !== 'object' || e.hold === null || !Array.isArray(e.hold.slots)) return false;
  }
  return true;
}

/** 新乘员的默认属性（开局自带与招募同基类，血量 100/上限 100）。 */
export function createMember(id: number, name: string): NpcMember {
  return { id, name, hp: NPC_HP_BASE, hpCap: NPC_HP_CAP_BASE, dying: false };
}

