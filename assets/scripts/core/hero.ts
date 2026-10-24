// 主角四流派（GAME_DESIGN §8：AI 机器人，人车合一，开局四选一）。
//
// 天赋语义由 run.ts 在对应结算点消费；本文件只承载数据。

export const HERO_IDS = ['cook', 'pharmacist', 'captain', 'stark'] as const;
export type HeroId = (typeof HERO_IDS)[number];

export interface HeroDef {
  readonly id: HeroId;
  readonly nickname: string;
  readonly route: string;
  /** 天赋（掉落/配方类，影响资源获取）。 */
  readonly talent: string;
  /** 身份特长（固定量，影响消耗/上限）。 */
  readonly perk: string;
  readonly blurb: string;
}

export const HEROES: readonly HeroDef[] = [
  {
    id: 'cook',
    nickname: '庇护所小当家',
    route: '食物 → 多招人',
    talent: '食物掉落 ×2（探索+战斗）',
    perk: '40 食物招募专有（替代 20 对应资源，不限 NPC）',
    blurb: '民以食为天，废土也一样。',
  },
  {
    id: 'pharmacist',
    nickname: '我就是药神',
    route: '药品 → 强化战士',
    talent: '专有配方「人类补完の剂」',
    perk: '招募药品代价 -25%',
    blurb: '药不能停，人不能倒。',
  },
  {
    id: 'captain',
    nickname: '废土队长',
    route: '材料 → 升级流',
    talent: '物资掉落 ×2（探索+战斗，全资源）',
    perk: '载具/围墙升级材料 -25%',
    blurb: '仓库就是阵地，一砖一瓦都算数。',
  },
  {
    id: 'stark',
    nickname: '我叫史塔克',
    route: '弹药 → 火力流',
    talent: '战斗事件物品掉落 ×2',
    perk: '火箭弹单场上限 +1',
    blurb: '暴力 if 解决一切问题。',
  },
];

export function heroDef(id: HeroId): HeroDef {
  const def = HEROES.find((h) => h.id === id);
  if (def === undefined) throw new RangeError(`Unknown hero: ${id}`);
  return def;
}

/** 流派掉落加成的统一查询点：mult = 场景 × 流派。
 *  cook：食物类 ×2；captain：全资源 ×2；stark：战斗掉落 ×2。 */
export function heroLootMultiplier(hero: HeroId, resource: string, scene: 'scavenge' | 'combat'): number {
  if (hero === 'captain') return 2;
  if (hero === 'cook' && resource === 'food') return 2;
  if (hero === 'stark' && scene === 'combat') return 2;
  return 1;
}
