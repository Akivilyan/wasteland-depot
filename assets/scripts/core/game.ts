// 规则层玩法数据与装配。
//
// 本层是纯 TypeScript 数据与规则函数，不 import `cc`，不碰 `wx`。
// 它描述「游戏是什么」：资源、地点、职业、事件。存哪些、怎么结算
// 由 sim.ts 驱动；UI、输入、存档底层由 presentation / platform 负责。

import type { Rng } from './rng.ts';
import { VEHICLE_DEFAULT } from './constants.ts';

// —— 五种资源（GAME_DESIGN）——

export const RESOURCE_IDS = ['fuel', 'food', 'material', 'medicine', 'ammo'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export interface ResourceDef {
  readonly id: ResourceId;
  readonly label: string;
  readonly usedFor: string;
}

export const RESOURCES: readonly ResourceDef[] = [
  { id: 'fuel', label: '燃油', usedFor: '决定可到达地点与返程余量' },
  { id: 'food', label: '食物', usedFor: '维持幸存者日常消耗' },
  { id: 'material', label: '材料', usedFor: '修复和升级仓库、车辆' },
  { id: 'medicine', label: '药品', usedFor: '治疗伤员和疾病' },
  { id: 'ammo', label: '弹药', usedFor: '处理危险事件' },
];

export type ResourceStock = Record<ResourceId, number>;

export const emptyStock = (): ResourceStock => ({
  fuel: 0,
  food: 0,
  material: 0,
  medicine: 0,
  ammo: 0,
});

// —— 六个地点（GAME_DESIGN，名单为默认值）——

export const LOCATION_IDS = [
  'ammo_factory',
  'hospital',
  'riverside',
  'farm',
  'garage',
  'suburb',
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

export interface LocationDef {
  readonly id: LocationId;
  readonly label: string;
  /** 该地点的资源倾向：到达后优先/较常获得哪些资源。 */
  readonly lean: readonly ResourceId[];
  /** 该地点的风险等级（0..1），影响事件伤害概率。 */
  readonly risk: number;
  /** 该地点奖励的确定性资源（兜底，保证探索总有回报）。 */
  readonly guaranteed: readonly ResourceId[];
  readonly blurb: string;
}

export const LOCATIONS: readonly LocationDef[] = [
  { id: 'ammo_factory', label: '兵工厂', lean: ['ammo', 'material'], risk: 0.7, guaranteed: ['ammo'], blurb: '弹药与军用材料，危险高。' },
  { id: 'hospital', label: '医院', lean: ['medicine'], risk: 0.5, guaranteed: ['medicine'], blurb: '药品与医疗物资。' },
  { id: 'riverside', label: '河边', lean: ['food', 'medicine'], risk: 0.3, guaranteed: ['food'], blurb: '水源与食物，相对安全。' },
  { id: 'farm', label: '牧场', lean: ['food'], risk: 0.4, guaranteed: ['food'], blurb: '食物稳定来源。' },
  { id: 'garage', label: '车库', lean: ['material', 'fuel'], risk: 0.5, guaranteed: ['material'], blurb: '零件与燃油。' },
  { id: 'suburb', label: '城郊', lean: ['food', 'material', 'medicine'], risk: 0.6, guaranteed: ['food'], blurb: '杂货与遗物，什么都有一点。' },
];

// —— 四种幸存者职业（GAME_DESIGN）——

export const PROFESSION_IDS = ['driver', 'mechanic', 'doctor', 'scout'] as const;
export type ProfessionId = (typeof PROFESSION_IDS)[number];

export interface ProfessionDef {
  readonly id: ProfessionId;
  readonly label: string;
  readonly blurb: string;
}

export const PROFESSIONS: readonly ProfessionDef[] = [
  { id: 'driver', label: '司机', blurb: '降低外出油耗' },
  { id: 'mechanic', label: '机械师', blurb: '降低维修/车辆升级消耗' },
  { id: 'doctor', label: '医生', blurb: '降低治疗所需药品' },
  { id: 'scout', label: '侦察员', blurb: '提前显示部分道路危险或资源情报' },
];

export interface Survivor {
  readonly id: number;
  readonly name: string;
  readonly profession: ProfessionId;
}

// —— 事件（GAME_DESIGN：信息→选择→即时或延迟后果）——

export const EVENT_KINDS = ['discovery', 'hazard', 'encounter', 'shelter'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type EventOutcome =
  | { readonly type: 'gain'; readonly resource: ResourceId; readonly amount: number }
  | { readonly type: 'lose'; readonly resource: ResourceId; readonly amount: number }
  | { readonly type: 'damage'; readonly amount: number }
  | { readonly type: 'reveal'; readonly location: LocationId }
  | { readonly type: 'recruit'; readonly profession: ProfessionId };

export interface GameEvent {
  readonly id: string;
  readonly kind: EventKind;
  readonly title: string;
  /** 展示给玩家的选项；AI 在测试中据此决策。 */
  readonly choices: readonly string[];
  /** 每个选项对应的后果（选择序号决定）。 */
  readonly outcomes: readonly EventOutcome[];
  /** 事件是否依赖车辆防护值（司机/防护可降低 damage）。 */
  readonly protectionSensitive?: boolean;
}

// —— 装配（工厂函数，保持纯函数可测）——

export interface GameConfig {
  readonly locationDefs: readonly LocationDef[];
  readonly professionDefs: readonly ProfessionDef[];
  readonly eventTable: readonly GameEvent[];
  readonly vehicle: typeof VEHICLE_DEFAULT;
}

export function createGameConfig(): GameConfig {
  return {
    locationDefs: LOCATIONS,
    professionDefs: PROFESSIONS,
    eventTable: buildEventTable(),
    vehicle: { ...VEHICLE_DEFAULT },
  };
}

// —— 事件表（默认 20~30 个事件的缩减可测集，GAME_DESIGN 标注）——

function buildEventTable(): readonly GameEvent[] {
  return [
    {
      id: 'roadblock',
      kind: 'hazard',
      title: '路障',
      choices: ['绕路（耗燃油）', '强闯（耗弹药）'],
      outcomes: [
        { type: 'lose', resource: 'fuel', amount: 2 },
        { type: 'lose', resource: 'ammo', amount: 2 },
      ],
    },
    {
      id: 'supply_cache',
      kind: 'discovery',
      title: '补给点',
      choices: ['搜刮（获得物资）', '放弃（保存体力）'],
      outcomes: [
        { type: 'gain', resource: 'food', amount: 3 },
        { type: 'lose', resource: 'food', amount: 0 },
      ],
    },
    {
      id: 'survivor_call',
      kind: 'encounter',
      title: '幸存者求救',
      choices: ['救助（加入据点）', '离开'],
      outcomes: [
        { type: 'recruit', profession: 'doctor' },
        { type: 'lose', resource: 'food', amount: 1 },
      ],
    },
    {
      id: 'ambush',
      kind: 'hazard',
      title: '埋伏',
      choices: ['反击（弹药与车损）', '加速逃离（耗燃油）'],
      outcomes: [
        { type: 'damage', amount: 2 },
        { type: 'lose', resource: 'fuel', amount: 3 },
      ],
      protectionSensitive: true,
    },
    {
      id: 'old_shelter',
      kind: 'shelter',
      title: '废弃掩体',
      choices: ['搜索（获得材料）', '休息（恢复）'],
      outcomes: [
        { type: 'gain', resource: 'material', amount: 2 },
        { type: 'lose', resource: 'medicine', amount: 0 },
      ],
    },
    {
      id: 'radar_contact',
      kind: 'discovery',
      title: '无线电信号',
      choices: ['追踪（获得情报）', '忽略'],
      outcomes: [
        { type: 'reveal', location: 'hospital' },
        { type: 'lose', resource: 'fuel', amount: 0 },
      ],
    },
  ];
}

// —— 装配辅助（供 sim 使用）——

export function resourceDef(id: ResourceId): ResourceDef {
  const def = RESOURCES.find((r) => r.id === id);
  if (def === undefined) {
    throw new RangeError(`Unknown resource: ${id}`);
  }
  return def;
}

export function locationDef(id: LocationId, config: GameConfig): LocationDef {
  const def = config.locationDefs.find((l) => l.id === id);
  if (def === undefined) {
    throw new RangeError(`Unknown location: ${id}`);
  }
  return def;
}

export function eventById(id: string, config: GameConfig): GameEvent {
  const event = config.eventTable.find((e) => e.id === id);
  if (event === undefined) {
    throw new RangeError(`Unknown event: ${id}`);
  }
  return event;
}

export function pickEvent(rng: Rng, config: GameConfig): GameEvent {
  return rng.pick(config.eventTable);
}

export function applyOutcome(
  stock: ResourceStock,
  outcome: EventOutcome,
  config: GameConfig,
): { stock: ResourceStock; message: string } {
  if (outcome.type === 'gain') {
    return {
      stock: { ...stock, [outcome.resource]: stock[outcome.resource] + outcome.amount },
      message: `获得 ${outcome.amount} ${resourceDef(outcome.resource).label}`,
    };
  }
  if (outcome.type === 'lose') {
    const actual = Math.min(stock[outcome.resource], outcome.amount);
    return {
      stock: { ...stock, [outcome.resource]: stock[outcome.resource] - actual },
      message: `失去 ${actual} ${resourceDef(outcome.resource).label}`,
    };
  }
  if (outcome.type === 'damage') {
    return { stock, message: `车辆受损 ${outcome.amount}` };
  }
  if (outcome.type === 'reveal') {
    return { stock, message: `发现新地点：${locationDef(outcome.location, config).label}` };
  }
  if (outcome.type === 'recruit') {
    const profession = PROFESSIONS.find((p) => p.id === outcome.profession);
    return { stock, message: `一名${profession?.label ?? outcome.profession}加入了据点` };
  }
  return { stock, message: '' };
}
