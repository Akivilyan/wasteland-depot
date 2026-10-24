// 区域制长局模型——机制常数唯一集中地（GAME_DESIGN.md v9 定案值）。
//
// 本文件是区域制数值的唯一出处：调参只改这里（配合 regions.ts 的
// 结构化数据与 events.ts 的文案池），不散落到 run/combat。
// 全表整数、方便口算（GAME_DESIGN §13）。

import type { ResourceId } from './regions.ts';

// —— 天数与波次（GAME_DESIGN §3/§10）——

export const START_DAY = 1;
/** 每 20 天怪物攻家；首波在第 20 天日结触发（开局日 = 第 1 天）。 */
export const WAVE_INTERVAL_DAYS = 20;
/** 波次强度：怪物总数 = 基数 + 波次序号 × 步长（无封顶，战斗切片可再调曲线）。 */
export const WAVE_BASE_COUNT = 40;
export const WAVE_COUNT_STEP = 10;
/** 终局倒计时天数（集齐 4 零件当刻起算）。 */
export const FINALE_COUNTDOWN_DAYS = 10;

// —— 仓库储量（§5/§6）——

export const STOCK_CAP_BASE = 100;
export const STOCK_CAP_PER_LEVEL = 50;
export const STOCK_UPGRADE_COSTS = [30, 60, 90] as const; // 材料，3 级

// —— 围墙（§6/§10）——

export const WALL_HP_BASE = 200;
export const WALL_HP_LEVELS = [300, 400, 500] as const;
export const WALL_UPGRADE_COSTS = [40, 80, 120] as const; // 材料，走科技树

// —— 载具（§6/§7）——

export const VEHICLE_DURABILITY_BASE = 200;
export const VEHICLE_DURABILITY_LEVELS = [250, 300, 350] as const;
export const VEHICLE_DURABILITY_COSTS = [40, 80, 120] as const; // 材料，走科技树
export const STORAGE_SLOTS_BASE = 12;
export const SEATS_BASE = 2;
/** 储物 +1 格梯度成本（3、4 一档，5、6 高一档…；超出表尾按最后值 +20 递增）。 */
export const SLOT_LADDER = [20, 20, 40, 40, 60, 60] as const;
/** 载客 +1 人梯度成本（超出表尾按最后值 +20 递增）。 */
export const SEAT_LADDER = [40, 60, 80, 100] as const;
export const LADDER_TAIL_STEP = 20;

/** 储物格每格数量上限（分资源类型，同资源堆叠至该上限）。 */
export const SLOT_CAP: Record<ResourceId, number> = {
  food: 50,
  material: 50,
  medicine: 20,
  ammo: 100,
  fuel: 20,
};

// —— 修复（§5/§6：车墙统一单价）——

export const REPAIR_PER_MATERIAL = 10; // 1 材料 = 10 耐久

// —— 武器（§7：全游戏唯二攻击数值，无任何乘数）——

export const GUN_DAMAGE = [5, 10, 20] as const; // 每发，L1/L2/L3
export const GUN_FIRE_RATE = 2; // 发/秒
export const GUN_PIERCE = [1, 1, 2] as const; // 穿透目标数
export const GUN_AMMO_PER_SHOT = 1;
export const ROCKET_DAMAGE = [40, 70, 100] as const; // 每发
export const ROCKET_RADIUS = [100, 150, 200] as const; // 范围半径（表现层像素）
export const ROCKET_AMMO_PER_SHOT = 100;
export const ROCKET_BATTLE_LIMIT = [3, 4, 5] as const; // 单场上限（史塔克 +1）
export const WEAPON_UPGRADE_COSTS = [60, 120, 180] as const; // 材料，走科技树

// —— 怪物（§7：撞线自毁，唯一属性是生命值）——

export const MONSTER_HP = { small: 10, medium: 20, large: 40 } as const;
export type MonsterSize = keyof typeof MONSTER_HP;
/** boss = 同模型生命值 ×3。 */
export const BOSS_HP_MULTIPLIER = 3;
/** 探索关卡潮水量级区间与分波数。 */
export const HORDE_SIZE_MIN = 40;
export const HORDE_SIZE_MAX = 80;
export const HORDE_BATCHES = [3, 4] as const;

// —— 掉落（§7/§9）——

export const SCRAP_YIELD = [1, 2, 4] as const; // 外围/内部/核心搜刮基础份量
export const COMBAT_LOOT_MULTIPLIER = 2; // 战斗掉落 = 同层搜刮 ×2

// —— 油耗（§9：按节点日扣，车程与返程免费）——

export const FUEL_PER_NODE_DAY = [0, 1, 2] as const; // 外围/内部/核心

// —— NPC 与血量（§8）——

export const NPC_HP_BASE = 100;
export const NPC_HP_CAP_BASE = 100;
export const NPC_HP_HARD_CAP = 200;
export const STARTING_NPC_COUNT = 1; // 开局自带乘员
export const FOOD_PER_NPC_PER_DAY = 2;
export const STARVE_DAMAGE_PER_DAY = 2; // 断粮每人每天 -2 血（= 当日消耗量）
export const MEDICINE_HEAL = 10; // 1 药 = 10 血，只回血不提上限
/** 人类补完の剂（药神专有）：5 药 → 1 份，上限 +50、当前 +50。 */
export const SERUM_MEDICINE_COST = 5;
export const SERUM_CAP_BONUS = 50;

/** 探索掉落倍率三档（≤50 → 50%、>50 → 100%、>100 → 200%），逐人定档求和。 */
export function hpTierMultiplier(hp: number): number {
  if (hp > 100) return 2;
  if (hp > 50) return 1;
  return 0.5;
}

// —— 任务与招募（§8：两笔分开）——

export const QUEST_REQUIREMENT = [10, 20, 30] as const; // 外围/内部/核心
export const RECRUIT_RESOURCE_COST = 20; // 件对应资源
export const RECRUIT_FOOD_COST = 40; // 小当家专有替代价
export const PHARMACIST_RECRUIT_DISCOUNT = 0.75; // 药神：招募药品代价 -25%

// —— 保底必遇（§7/§8：boss 与 NPC 不走节点池随机）——

/** boss：该层累计推进到第 10 个节点必出（计数不因返程重置）。 */
export const BOSS_PITY_NODE = 10;
/** NPC：全局累计普通节点第 10/15/20 个必出，此后每 5 个一次。 */
export const NPC_PITY_NODES = [10, 15, 20] as const;
export const NPC_PITY_INTERVAL = 5;

// —— 开局资源（序章带回内容即开局库存，先给最小可开局值）——

export const STARTING_STOCK = {
  fuel: 10,
  food: 10,
  material: 5,
  medicine: 3,
  ammo: 30,
} as const;

// —— 信号零件（§11：4 件，唯一来源 = 特定核心层 boss 首杀）——

export const PART_IDS = ['transmitter', 'amplifier', 'regulator', 'antenna'] as const;
export type PartId = (typeof PART_IDS)[number];
