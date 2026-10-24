// 战斗结算纯函数（GAME_DESIGN §7/§10）。
//
// 实时战斗的逐帧演出在表现层（切片 010）；本文件承担规则层职责：
// 伤害管道（围墙 → 战车耐久 → NPC 血量，顺序扣）、波次强度构成、
// 战果结算入口。怪物撞线自毁：伤害 = 剩余生命值，等额扣损防线。

import {
  MONSTER_HP,
  WAVE_BASE_COUNT,
  WAVE_COUNT_STEP,
  GUN_DAMAGE,
  GUN_PIERCE,
  ROCKET_DAMAGE,
  ROCKET_BATTLE_LIMIT,
  type MonsterSize,
} from './config.ts';
import type { MonsterGroup } from './regions.ts';

// —— 伤害管道（顺序扣，§7/§10）——

export interface DamagePipelineInput {
  /** 撞线伤害总量（守家=Σ怪物剩余生命；探索同模型无墙）。 */
  readonly damage: number;
  /** 守家战传入当前围墙耐久；探索战传 null（无墙从车起算）。 */
  readonly wallHp: number | null;
  readonly vehicleDurability: number;
  /** 队伍按顺序承伤（出行 NPC；车破后逐人扣）。 */
  readonly memberHps: readonly number[];
}

export interface DamagePipelineResult {
  readonly wallHpAfter: number;
  readonly vehicleDurabilityAfter: number;
  readonly memberHpsAfter: readonly number[];
  /** 车耐久是否被扣穿（本场结束、强制返仓）。 */
  readonly vehicleBroken: boolean;
}

/** 顺序扣血：墙 → 车 → 人（一个扣光再扣下一个）。 */
export function applyDamagePipeline(input: DamagePipelineInput): DamagePipelineResult {
  let remaining = input.damage;
  let wallHpAfter = input.wallHp ?? 0;
  if (input.wallHp !== null) {
    const absorbed = Math.min(wallHpAfter, remaining);
    wallHpAfter -= absorbed;
    remaining -= absorbed;
  }
  let vehicleDurabilityAfter = input.vehicleDurability;
  const absorbedByVehicle = Math.min(vehicleDurabilityAfter, remaining);
  vehicleDurabilityAfter -= absorbedByVehicle;
  remaining -= absorbedByVehicle;
  const memberHpsAfter = input.memberHps.map((hp) => {
    if (remaining <= 0) return hp;
    const absorbed = Math.min(hp, remaining);
    remaining -= absorbed;
    return hp - absorbed;
  });
  return {
    wallHpAfter,
    vehicleDurabilityAfter,
    memberHpsAfter,
    vehicleBroken: vehicleDurabilityAfter <= 0,
  };
}

// —— 守家波次构成（§10：强度 = 波次序号的递增函数，无封顶）——

export interface WaveComposition {
  readonly waveIndex: number; // 从 1 起（首波 = 第 20 天）
  readonly total: number;
  readonly groups: readonly MonsterGroup[];
  readonly hpBySize: Record<MonsterSize, number>;
}

/** 第 n 波：总数 = 40 + (n-1)×10；档位构成随波次抬升。 */
export function waveComposition(waveIndex: number): WaveComposition {
  const total = WAVE_BASE_COUNT + (waveIndex - 1) * WAVE_COUNT_STEP;
  // 前几波以小为主，之后逐波混入中大（整数权重）。
  const mediumShare = Math.min(4, 1 + Math.floor(waveIndex / 2));
  const largeShare = Math.max(0, Math.min(3, Math.floor((waveIndex - 3) / 2) + 1));
  const smallShare = Math.max(2, 10 - mediumShare - largeShare);
  const small = Math.round((total * smallShare) / 10);
  const medium = Math.round((total * mediumShare) / 10);
  const large = Math.max(0, total - small - medium);
  return {
    waveIndex,
    total,
    groups: [
      { size: 'small', count: small },
      { size: 'medium', count: medium },
      { size: 'large', count: large },
    ],
    hpBySize: { ...MONSTER_HP },
  };
}

// —— 武器数值查询（§7：全游戏唯二攻击数值，无乘数）——

export interface WeaponProfile {
  readonly gunDamagePerShot: number;
  readonly gunPierce: number;
  readonly rocketDamagePerShot: number;
  readonly rocketBattleLimit: number;
}

/** weaponLevel 0..2（L1/L2/L3）；starkBonus = 史塔克特长 +1 火箭弹上限。 */
export function weaponProfile(weaponLevel: number, starkBonus: boolean): WeaponProfile {
  const level = Math.min(2, Math.max(0, weaponLevel));
  return {
    gunDamagePerShot: GUN_DAMAGE[level] as number,
    gunPierce: GUN_PIERCE[level] as number,
    rocketDamagePerShot: ROCKET_DAMAGE[level] as number,
    rocketBattleLimit: (ROCKET_BATTLE_LIMIT[level] as number) + (starkBonus ? 1 : 0),
  };
}

// —— 撞线结算辅助（§7：输出即防御，打掉的每发都在减伤）——

/** 一只怪撞线的伤害 = 其剩余生命值（boss ×1，不叠加倍率）。 */
export function ramDamage(hpRemaining: number): number {
  return hpRemaining;
}
