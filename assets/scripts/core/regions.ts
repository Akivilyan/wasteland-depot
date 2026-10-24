// 区域制世界数据：五资源、六区域×三层、NPC 名册、节点流生成（GAME_DESIGN §5/§8/§9）。
//
// 纯数据 + 纯函数，不 import cc/wx；随机全部走 rng.ts。
// 结构化数据（区域清单、NPC、掉落倾向）在此；机制常数在 config.ts。

import type { Rng } from './rng.ts';
import {
  SCRAP_YIELD,
  COMBAT_LOOT_MULTIPLIER,
  HORDE_SIZE_MIN,
  HORDE_SIZE_MAX,
  HORDE_BATCHES,
  MONSTER_HP,
  BOSS_PITY_NODE,
  type MonsterSize,
} from './config.ts';

// —— 五种资源（§5）——

export const RESOURCE_IDS = ['fuel', 'food', 'material', 'medicine', 'ammo'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export interface ResourceDef {
  readonly id: ResourceId;
  readonly label: string;
}

export const RESOURCES: readonly ResourceDef[] = [
  { id: 'fuel', label: '燃油' },
  { id: 'food', label: '食物' },
  { id: 'material', label: '材料' },
  { id: 'medicine', label: '药品' },
  { id: 'ammo', label: '弹药' },
];

export type ResourceStock = Record<ResourceId, number>;

export const emptyStock = (): ResourceStock => ({
  fuel: 0,
  food: 0,
  material: 0,
  medicine: 0,
  ammo: 0,
});

export function resourceLabel(id: ResourceId): string {
  return RESOURCES.find((r) => r.id === id)?.label ?? id;
}

// —— 六区域 × 三层（§9：六区同构）——

export const REGION_IDS = ['food', 'oil', 'pharma', 'arms', 'industry', 'mall'] as const;
export type RegionId = (typeof REGION_IDS)[number];

export const TIER_IDS = ['outer', 'inner', 'core'] as const;
export type TierId = (typeof TIER_IDS)[number];
export const TIER_LABELS: Record<TierId, string> = {
  outer: '外围',
  inner: '内部',
  core: '核心',
};

export interface RegionDef {
  readonly id: RegionId;
  readonly label: string;
  /** 搜刮主掉落；null = 购物中心（五资源均衡随机）。 */
  readonly mainResource: ResourceId | null;
  readonly blurb: string;
}

export const REGIONS: readonly RegionDef[] = [
  { id: 'food', label: '食品厂', mainResource: 'food', blurb: '食物单一资源区' },
  { id: 'oil', label: '炼油厂', mainResource: 'fuel', blurb: '燃油单一资源区' },
  { id: 'pharma', label: '制药厂', mainResource: 'medicine', blurb: '药品单一资源区' },
  { id: 'arms', label: '军工厂', mainResource: 'ammo', blurb: '弹药单一资源区' },
  { id: 'industry', label: '工业园', mainResource: 'material', blurb: '材料单一资源区' },
  { id: 'mall', label: '购物中心', mainResource: null, blurb: '五资源均衡综合区' },
];

/** 层的完整坐标（解锁与 boss 击杀按此记录，如 'food.inner'）。 */
export type LayerId = `${RegionId}.${TierId}`;

export const layerId = (region: RegionId, tier: TierId): LayerId => `${region}.${tier}`;


export function regionDef(id: RegionId): RegionDef {
  const def = REGIONS.find((r) => r.id === id);
  if (def === undefined) throw new RangeError(`Unknown region: ${id}`);
  return def;
}

// —— 层深索引（数组下标即梯度：外围=0、内部=1、核心=2）——

export const tierIndex = (tier: TierId): number => TIER_IDS.indexOf(tier);

// —— NPC 名册（每区域 2 个，§8）——

export interface NpcDef {
  /** 全局唯一 id（区域前缀 + 序号）。 */
  readonly id: string;
  readonly name: string;
  readonly region: RegionId;
  /** 任务需求资源；null = 购物中心 NPC（绑定一种随机资源，接任务时落定）。 */
  readonly questResource: ResourceId | null;
  readonly blurb: string;
}

export const NPCS: readonly NpcDef[] = [
  { id: 'food-1', name: '罐头厂老周', region: 'food', questResource: 'food', blurb: '守着罐头生产线不肯走的老技师。' },
  { id: 'food-2', name: '试吃员小鹿', region: 'food', questResource: 'food', blurb: '声称尝遍所有保质期外食品的姑娘。' },
  { id: 'oil-1', name: '泵站老墨', region: 'oil', questResource: 'fuel', blurb: '石油工人，嗓门比泵机还响。' },
  { id: 'oil-2', name: '油桶姐', region: 'oil', questResource: 'fuel', blurb: '能闻出油桶里还剩几滴的行家。' },
  { id: 'pharma-1', name: '白大褂温蒂', region: 'pharma', questResource: 'medicine', blurb: '无证 but 无敌的战地医生。' },
  { id: 'pharma-2', name: '药剂师阿苦', region: 'pharma', questResource: 'medicine', blurb: '药理倒背如流，就是嘴毒。' },
  { id: 'arms-1', name: '军械长老', region: 'arms', questResource: 'ammo', blurb: '谁敢乱碰引信他跟谁急。' },
  { id: 'arms-2', name: '双枪梅根', region: 'arms', questResource: 'ammo', blurb: '枪法没见过，弹链编得极漂亮。' },
  { id: 'industry-1', name: '车间铁姨', region: 'industry', questResource: 'material', blurb: '扳手从不离手的老师傅。' },
  { id: 'industry-2', name: '电焊小马', region: 'industry', questResource: 'material', blurb: '面罩后面永远在笑。' },
  { id: 'mall-1', name: '柜台阿珍', region: 'mall', questResource: null, blurb: '记得购物中心每一家店的折扣规律。' },
  { id: 'mall-2', name: '顶层老康', region: 'mall', questResource: null, blurb: '在电影院顶层住了八年的放映员。' },
];

export function npcsInRegion(region: RegionId): readonly NpcDef[] {
  return NPCS.filter((n) => n.region === region);
}

export function npcDef(id: string): NpcDef {
  const def = NPCS.find((n) => n.id === id);
  if (def === undefined) throw new RangeError(`Unknown npc: ${id}`);
  return def;
}

// —— 节点流生成（§9：5:2:2 随机 + 保底必遇，节点数不设上限）——

export const NODE_KINDS = ['scavenge', 'event', 'monster'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** 保底节点（boss / NPC 首遇）不占普通节点池。 */
export type SpecialNode = { readonly kind: 'boss' } | { readonly kind: 'npc'; readonly npcId: string };

export type NodeRoll = { readonly kind: NodeKind } | SpecialNode;

/** 按层深权重 5:2:2 随机一个普通节点。 */
export function rollNodeKind(rng: Rng): NodeKind {
  const roll = rng.next() * 9;
  if (roll < 5) return 'scavenge';
  if (roll < 7) return 'event';
  return 'monster';
}

/**
 * 决定下一个节点：boss 保底（该层累计第 BOSS_PITY_NODE 个且 boss 未杀）优先，
 * 其次 NPC 保底（全局普通节点计数命中且该区有未首遇 NPC），否则 5:2:2 随机。
 * 返回 { roll, isSpecial }；special 不计入普通节点计数（由调用方控制）。
 */
export function nextNodeRoll(
  rng: Rng,
  layer: LayerId,
  layerNodeCount: number, // 该层已累计普通节点数（下一次是第 layerNodeCount+1 个）
  globalNodeCount: number, // 全局已累计普通节点数
  bossKilledHere: boolean,
  unmetNpcInRegion: readonly string[],
): NodeRoll {
  const nextCount = layerNodeCount + 1;
  if (nextCount >= BOSS_PITY_NODE && !bossKilledHere) {
    return { kind: 'boss' };
  }
  if (unmetNpcInRegion.length > 0 && isNpcPityNode(globalNodeCount + 1)) {
    const npcId = unmetNpcInRegion[0] ?? null;
    if (npcId !== null) return { kind: 'npc', npcId };
  }
  return { kind: rollNodeKind(rng) };
}

/** 第 n 个普通节点是否命中 NPC 保底（10/15/20，此后每 5 个一次）。 */
export function isNpcPityNode(n: number): boolean {
  if (n === 10 || n === 15 || n === 20) return true;
  return n > 20 && (n - 20) % 5 === 0;
}

// —— 搜刮掉落（§9：外围 1 / 内部 2 / 核心 4；购物中心任意资源）——

export interface LootDrop {
  readonly resource: ResourceId;
  readonly amount: number;
}

/**
 * 一次搜刮的候选掉落：基础份量 × 倍率（逐人血量档位之和 + 流派加成），
 * 至少 1 份；燃油不参与倍率。购物中心均匀随机一种资源。
 */
export function rollScavenge(
  rng: Rng,
  region: RegionId,
  tier: TierId,
  multiplier: number,
): LootDrop {
  const def = regionDef(region);
  const base = SCRAP_YIELD[tierIndex(tier)] as number;
  const resource: ResourceId =
    def.mainResource ?? (RESOURCE_IDS[rng.int(0, RESOURCE_IDS.length - 1)] as ResourceId);
  const fuelExempt = resource === 'fuel';
  const scaled = fuelExempt ? base : Math.max(1, Math.round(base * multiplier));
  return { resource, amount: scaled };
}

// —— 怪物关卡（§7：潮水制，血薄量大）——

export interface MonsterGroup {
  readonly size: MonsterSize;
  readonly count: number;
}

export interface MonsterEncounter {
  readonly total: number;
  readonly batches: number;
  readonly groups: readonly MonsterGroup[];
  /** 每只生命值按档位；前置弹框直接明示数量/生命/掉落（牌面即真相）。 */
  readonly hpBySize: Record<MonsterSize, number>;
  readonly lootPreview: LootDrop[];
}

/** 探索怪物关卡：40~80 只、3~4 波；档位构成随层深抬升。 */
export function rollMonsterEncounter(
  rng: Rng,
  region: RegionId,
  tier: TierId,
): MonsterEncounter {
  const total = rng.int(HORDE_SIZE_MIN, HORDE_SIZE_MAX);
  const batches = rng.pick(HORDE_BATCHES);
  const depth = tierIndex(tier);
  // 档位构成：外围以小为主，核心混中大（整数权重，口算友好）。
  const weights: Record<MonsterSize, number> =
    depth === 0
      ? { small: 8, medium: 2, large: 0 }
      : depth === 1
        ? { small: 6, medium: 3, large: 1 }
        : { small: 4, medium: 4, large: 2 };
  const small = Math.round((total * weights.small) / 10);
  const medium = Math.round((total * weights.medium) / 10);
  const large = Math.max(0, total - small - medium);
  const groups: MonsterGroup[] = [
    { size: 'small', count: small },
    { size: 'medium', count: medium },
    { size: 'large', count: large },
  ];
  const def = regionDef(region);
  const base = (SCRAP_YIELD[depth] as number) * COMBAT_LOOT_MULTIPLIER;
  const lootResource: ResourceId =
    def.mainResource ?? (RESOURCE_IDS[rng.int(0, RESOURCE_IDS.length - 1)] as ResourceId);
  return {
    total,
    batches,
    groups,
    hpBySize: { ...MONSTER_HP },
    lootPreview: [{ resource: lootResource, amount: base }],
  };
}

/** boss 关：大号 + 压阵潮水（生命值 ×3，撞线按剩余生命 ×1）。
 *  boss 掉落 = 地图/零件（run.ts bossLootFor），不发资源——preview 置空，牌面即真相。 */
export function bossEncounter(tier: TierId, _region: RegionId): MonsterEncounter {
  const bossHp: Record<MonsterSize, number> = {
    small: MONSTER_HP.small * 3,
    medium: MONSTER_HP.medium * 3,
    large: MONSTER_HP.large * 3,
  };
  return {
    total: 100,
    batches: 4,
    groups: [
      { size: 'small', count: 60 },
      { size: 'medium', count: 30 },
      { size: 'large', count: 10 },
    ],
    hpBySize: bossHp,
    lootPreview: [],
  };
}
