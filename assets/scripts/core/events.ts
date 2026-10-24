// 区域随机事件池（GAME_DESIGN §9：文案池 20~30 个，本切片先落 12 个起步集，
// 内容填充切片扩满并调文案）。
//
// 事件后果类型 V2：资源增减 / 车辆耐久损伤 / 无事。NPC 招募不走事件
// （保底必遇制，见 regions.ts）；区域地图/零件只从 boss 首杀掉落。

import type { Rng } from './rng.ts';
import type { ResourceId } from './regions.ts';

export type EventOutcomeV2 =
  | { readonly type: 'gain'; readonly resource: ResourceId; readonly amount: number }
  | { readonly type: 'lose'; readonly resource: ResourceId; readonly amount: number }
  | { readonly type: 'vehicleDamage'; readonly amount: number }
  | { readonly type: 'nothing' };

export interface RegionEvent {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly choices: readonly string[];
  /** 每个选项对应的后果（选择序号决定）。 */
  readonly outcomes: readonly EventOutcomeV2[];
}

export const EVENTS: readonly RegionEvent[] = [
  {
    id: 'locked-van',
    title: '锁死的厢式货车',
    text: '一辆厢式货车横在路中间，车厢锁得死死的。撬开要花力气，也可能惊动什么。',
    choices: ['撬开车厢', '绕开走'],
    outcomes: [
      { type: 'gain', resource: 'material', amount: 3 },
      { type: 'nothing' },
    ],
  },
  {
    id: 'leaking-tank',
    title: '漏油的油罐',
    text: '路边油罐在滴滴答答地漏。接一点是一点，但味道大得能引来整条街的东西。',
    choices: ['动手接油', '不冒险'],
    outcomes: [
      { type: 'gain', resource: 'fuel', amount: 2 },
      { type: 'nothing' },
    ],
  },
  {
    id: 'collapsed-shelf',
    title: '倒塌的货架',
    text: '超市货架塌了一半，罐头滚得到处都是。慢慢挑，还是抓一把就跑？',
    choices: ['慢慢挑', '抓一把就走'],
    outcomes: [
      { type: 'gain', resource: 'food', amount: 3 },
      { type: 'gain', resource: 'food', amount: 1 },
    ],
  },
  {
    id: 'ambush-dogs',
    title: '野狗群',
    text: '一群野狗围着车打转。冲过去车身会挨几下咬痕，等着它们散开又要耗时间。',
    choices: ['直接冲过去', '按喇叭驱赶'],
    outcomes: [
      { type: 'vehicleDamage', amount: 15 },
      { type: 'lose', resource: 'fuel', amount: 1 },
    ],
  },
  {
    id: 'medical-vending',
    title: '卡住的售药机',
    text: '药店的自动售货机还剩半格货，玻璃裂了。砸开就能拿，动静不小。',
    choices: ['砸开', '算了'],
    outcomes: [
      { type: 'gain', resource: 'medicine', amount: 2 },
      { type: 'nothing' },
    ],
  },
  {
    id: 'ammo-crate',
    title: '弹药箱',
    text: '路障旁丢着一只军用弹药箱，锁已经锈开。箱子底下压着说不清是什么的东西。',
    choices: ['整箱搬走', '抽几盒就走'],
    outcomes: [
      { type: 'gain', resource: 'ammo', amount: 30 },
      { type: 'gain', resource: 'ammo', amount: 10 },
    ],
  },
  {
    id: 'broken-bridge',
    title: '断桥',
    text: '前面的桥断了一半。硬闯底盘要吃亏，绕路多烧一截油。',
    choices: ['硬闯', '绕路'],
    outcomes: [
      { type: 'vehicleDamage', amount: 20 },
      { type: 'lose', resource: 'fuel', amount: 2 },
    ],
  },
  {
    id: 'rain-barrel',
    title: '接雨水的桶阵',
    text: '有人在楼顶摆了一排接雨水的桶，桶底沉着不少存货。主人不知去向。',
    choices: ['取用一些', '不碰别人的东西'],
    outcomes: [
      { type: 'gain', resource: 'food', amount: 2 },
      { type: 'nothing' },
    ],
  },
  {
    id: 'swarm-rats',
    title: '鼠潮',
    text: '地沟里涌出一大片老鼠，顺着车底就往上爬。踩油门甩掉它们要烧点油。',
    choices: ['甩掉它们', '停车清理'],
    outcomes: [
      { type: 'lose', resource: 'fuel', amount: 1 },
      { type: 'vehicleDamage', amount: 10 },
    ],
  },
  {
    id: 'campfire-remains',
    title: '熄灭的篝火',
    text: '路口有一圈烧尽的篝火，灰还温着。边上留着半袋东西，像是有人打算回来取。',
    choices: ['拿走', '留给主人'],
    outcomes: [
      { type: 'gain', resource: 'food', amount: 2 },
      { type: 'nothing' },
    ],
  },
  {
    id: 'factory-siren',
    title: '还在响的警报器',
    text: '厂房顶上的警报器没日没夜地转。噪声引怪物，拆了它顺手能捡点线材。',
    choices: ['爬上去拆掉', '捂耳朵快点走'],
    outcomes: [
      { type: 'gain', resource: 'material', amount: 2 },
      { type: 'lose', resource: 'medicine', amount: 1 },
    ],
  },
  {
    id: 'gas-leak',
    title: '燃气泄漏',
    text: '空气里有股甜味——是燃气。划根火柴能清一片，也可能把自己送上天。点火驱散一下再过？',
    choices: ['点火驱散', '憋气快跑'],
    outcomes: [
      { type: 'vehicleDamage', amount: 10 },
      { type: 'lose', resource: 'food', amount: 1 },
    ],
  },
];

export function pickEvent(rng: Rng, excludeIds: readonly string[] = []): RegionEvent {
  const pool = EVENTS.filter((e) => !excludeIds.includes(e.id));
  return rng.pick(pool.length > 0 ? pool : EVENTS);
}

export function eventById(id: string): RegionEvent {
  const def = EVENTS.find((e) => e.id === id);
  if (def === undefined) throw new RangeError(`Unknown event: ${id}`);
  return def;
}
