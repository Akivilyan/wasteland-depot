// boss 首杀掉落表（GAME_DESIGN §9/§11）。
//
// 地图与信号零件的单一来源 = boss 首杀：
//   外围 boss → 该区内部层地图；内部 boss → 该区核心层地图；
//   核心 boss 中 4 个各绑一件信号零件（军工厂/工业园/制药厂/购物中心），
//   食品厂/炼油厂核心 boss 无特殊掉落。

import type { RegionId, TierId, LayerId, layerId } from './regions.ts';
import { layerId as makeLayerId } from './regions.ts';
import type { PartId } from './config.ts';

export type BossDrop =
  | { readonly kind: 'map'; readonly layer: LayerId; readonly label: string }
  | { readonly kind: 'part'; readonly part: PartId; readonly label: string };

const PART_LABELS: Record<PartId, string> = {
  transmitter: '信号发射器',
  amplifier: '功率放大器',
  regulator: '稳压电源',
  antenna: '天线阵列',
};

/** 核心 boss → 信号零件绑定（§11）。 */
const CORE_PART_BY_REGION: Partial<Record<RegionId, PartId>> = {
  arms: 'transmitter',
  industry: 'amplifier',
  pharma: 'regulator',
  mall: 'antenna',
};

const TIER_NEXT: Partial<Record<TierId, TierId>> = {
  outer: 'inner',
  inner: 'core',
};

export function layerBossDrop(region: RegionId, tier: TierId): BossDrop | null {
  if (tier === 'core') {
    const part = CORE_PART_BY_REGION[region];
    return part === undefined ? null : { kind: 'part', part, label: PART_LABELS[part] };
  }
  const next = TIER_NEXT[tier];
  if (next === undefined) return null;
  const layer = makeLayerId(region, next);
  return { kind: 'map', layer, label: `${regionLabel(region)}${tierLabel(next)}地图` };
}

function regionLabel(region: RegionId): string {
  const labels: Record<RegionId, string> = {
    food: '食品厂',
    oil: '炼油厂',
    pharma: '制药厂',
    arms: '军工厂',
    industry: '工业园',
    mall: '购物中心',
  };
  return labels[region];
}

function tierLabel(tier: TierId): string {
  const labels: Record<TierId, string> = { outer: '外围', inner: '内部', core: '核心' };
  return labels[tier];
}
