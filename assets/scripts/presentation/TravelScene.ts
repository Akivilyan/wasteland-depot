// SLICE_003/004/005 表现层：地图骨架 + 行车卷轴 + 节点拾取 + 十日循环打通。
//
// 与 PrototypeScene 同场景协作：本组件挂在独立节点上，负责
// 地图选点（竖向骨架）、横轴行车演出、节点抵达面板与抵仓结算；
// 货舱原型 UI 由 PrototypeScene 负责。数据全部来自 core（route/sim/loot），
// 本层只演出、不改规则：出发扣费走 sim.startTrip，抵仓走 returnHome+advanceDay，
// 十日 GameState（wasteland-depot.save.v1）由本场景持久化。

import {
  _decorator,
  Color,
  Component,
  director,
  Graphics,
  Label,
  Node,
  Tween,
  UIOpacity,
  UITransform,
  Vec3,
  tween,
} from 'cc';
import {
  DEPOT_ROUTE,
  RouteNode,
  TripState,
  createTripState,
  depart,
  arrive,
  departReturn,
  backToMap,
  legFuelCost,
  encodeTripState,
  decodeTripState,
} from '../core/route.ts';
import { LOCATIONS } from '../core/game.ts';
import {
  createInitialGameState,
  startTrip,
  returnHome,
  cargoFromTrunk,
  advanceDay,
} from '../core/sim.ts';
import type { GameState } from '../core/sim.ts';
import { SAVE_KEY as GAME_SAVE_KEY, encodeGameState, decodeGameState } from '../core/scenario.ts';
import { GAME_DAYS } from '../core/constants.ts';
import type { LootState } from '../core/loot.ts';
import {
  rollNodeLoot,
  takeLoot,
  putBackLoot,
  remainingLoot,
  encodeLootState,
  decodeLootState,
} from '../core/loot.ts';
import {
  createTrunkState,
  TrunkState,
  firstFreeSpot,
  placeItem,
  itemDef,
  sizeToCell,
  encodeTrunkState,
  decodeTrunkState,
  DEFAULT_ITEM_DEFS,
} from '../core/trunk.ts';
import { createRng } from '../core/rng.ts';
import { createStoragePort, StoragePort } from '../platform/storage.ts';
import { TrunkGrid, ITEM_COLORS } from './TrunkGrid.ts';

const { ccclass } = _decorator;

const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

const SAVE_KEY = 'wasteland-depot.trip.v1';
const LOOT_SAVE_KEY = 'wasteland-depot.loot.v1';
const TRUNK_SAVE_KEY = 'wasteland-depot.trip-trunk.v1';

// —— 地图骨架几何 ——
const MAP_TOP = 520;          // 最远节点 y
const MAP_BOTTOM = -420;      // 仓库 y
const MAP_ROAD_X = -80;       // 公路竖轴线 x
const NODE_X_OFFSET = 180;    // 节点牌相对公路的水平偏移
const NODE_ALT_X = -140;      // 节点牌另一侧偏移（须保证牌左缘 ≥ -375 出屏界）
const STATUS_Y = -580;        // 状态文字行（按钮上方，避免互相遮挡）
const BTN_Y = -664;           // 底部按钮行

const COLOR_ROAD = new Color(96, 92, 82, 255);
const COLOR_NODE_IDLE = new Color(70, 78, 72, 255);
const COLOR_NODE_SELECT = new Color(90, 210, 130, 255);
const COLOR_NODE_DONE = new Color(120, 130, 150, 255);
const COLOR_DEPOT = new Color(207, 149, 50, 255);
const COLOR_TEXT = new Color(225, 213, 183, 255);
const COLOR_DIM = new Color(159, 166, 151, 255);

// —— 行车卷轴几何 ——
const DRIVE_SPEED = 620;      // px/s 卷轴滚动速度
const DRIVE_DURATION = 4.2;   // 单程演出时长（秒）
const SKY_BOTTOM = 320;       // 天空底部 y（天空占上部）
const ROAD_LINE_Y = -160;     // 路面中线 y

const COLOR_SKY = new Color(64, 70, 66, 255);
const COLOR_SKY_DUSK = new Color(96, 74, 58, 255);
const COLOR_GROUND = new Color(46, 50, 46, 255);
const COLOR_ASPHALT = new Color(58, 60, 62, 255);
const COLOR_LANE = new Color(200, 190, 160, 255);
const COLOR_SIGN = new Color(112, 110, 96, 255);

interface DriveContext {
  readonly destLabel: string;
  readonly returning: boolean;
  readonly onArrive: () => void;
}

@ccclass('TravelScene')
export class TravelScene extends Component {
  private readonly storage: StoragePort = createStoragePort();
  private trip: TripState = createTripState();
  private loot: LootState | null = null;
  private nodeTrunk: TrunkState = createTrunkState();
  /** 十日循环权威状态（SLICE_005 起由本场景读写并持久化）。 */
  private game: GameState = createInitialGameState();

  private mapRoot: Node | null = null;
  private driveRoot: Node | null = null;
  private statusLabel: Label | null = null;
  private selectedNode: string | null = null;
  private nodeVisuals: Map<string, { ring: Node; plate: Node }> = new Map();
  private driveTween: Tween<Vec3> | null = null;
  private driveCtx: DriveContext | null = null;
  /** 节点面板（候选物资 + 货舱）运行期节点；返程时销毁。 */
  private nodePanel: Node | null = null;
  private nodeGrid: TrunkGrid | null = null;
  private nodeLootCards: Map<string, Node> = new Map();
  private nodeStatus: Label | null = null;

  start(): void {
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.trip = decodeTripState(this.storage.get(SAVE_KEY));
    this.loot = decodeLootState(this.storage.get(LOOT_SAVE_KEY));
    this.nodeTrunk = decodeTrunkState(this.storage.get(TRUNK_SAVE_KEY));
    this.game = decodeGameState(this.storage.get(GAME_SAVE_KEY)) ?? createInitialGameState();
    this.buildDriveLayer();
    this.buildMap();
    this.refreshStatus();
    // 恢复到 atNode 相位时重建节点面板
    if (this.trip.phase === 'atNode' && this.trip.destination !== null) {
      this.showNodeArrival(this.tripDestinationLabel(this.trip.destination));
    } else if (this.game.ending !== null) {
      this.showEndingPanel();
    }
  }

  /** 当前行程态（供外部读取）。 */
  get currentTrip(): TripState {
    return this.trip;
  }

  /** 十日循环状态快照（存档/结算后的权威值，供调试与回归读取）。 */
  get gameState(): GameState {
    return this.game;
  }

  // —— 地图骨架 ——

  private buildMap(): void {
    const root = new Node('MapRoot');
    root.setParent(this.node);
    this.mapRoot = root;

    const bg = new Node('MapBg');
    bg.setParent(root);
    bg.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const bgG = bg.addComponent(Graphics);
    bgG.fillColor = new Color(27, 31, 29, 255);
    bgG.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    bgG.fill();
    // 拦截触摸，防止点穿到下面的货舱 UI。
    // Cocos 3.8：节点注册触摸监听后命中即默认吞掉事件（EventTouch.preventSwallow
    // 是布尔属性，非方法——调它会在真实触摸时抛 TypeError 并中断派发链）。
    const swallow = (): void => undefined;
    bg.on(Node.EventType.TOUCH_END, swallow);
    bg.on(Node.EventType.TOUCH_START, swallow);
    bg.on(Node.EventType.TOUCH_MOVE, swallow);

    this.createLabel(root, 'MapTitle', '', 0, 620, 36, COLOR_TEXT);
    this.statusLabel = this.createLabel(root, 'MapStatus', '', 0, STATUS_Y, 22, COLOR_DIM);
    this.createButton(root, 'BackDepot', '返回', 300, BTN_Y, () => this.finishTripVisualOnly());

    // 公路主干（竖线 + 端点箭头感）
    const road = new Node('RoadLine');
    road.setParent(root);
    road.addComponent(UITransform).setContentSize(20, MAP_TOP - MAP_BOTTOM + 120);
    const roadG = road.addComponent(Graphics);
    roadG.lineWidth = 10;
    roadG.strokeColor = COLOR_ROAD;
    roadG.moveTo(MAP_ROAD_X, MAP_TOP + 40);
    roadG.lineTo(MAP_ROAD_X, MAP_BOTTOM - 60);
    roadG.stroke();
    // 中线虚线感：短横杠
    roadG.lineWidth = 4;
    roadG.strokeColor = new Color(150, 145, 125, 255);
    for (let y = MAP_TOP; y > MAP_BOTTOM; y -= 70) {
      roadG.moveTo(MAP_ROAD_X - 12, y);
      roadG.lineTo(MAP_ROAD_X + 12, y - 24);
      roadG.stroke();
    }

    // 节点：仓库在底部，地点沿线上分布
    const minKm = DEPOT_ROUTE[DEPOT_ROUTE.length - 1].km;
    DEPOT_ROUTE.forEach((node, idx) => {
      const t = node.km / minKm;
      const y = MAP_BOTTOM + t * (MAP_TOP - MAP_BOTTOM);
      this.createRouteNode(root, node, y, idx);
    });
  }

  private createRouteNode(parent: Node, node: RouteNode, y: number, idx: number): void {
    const isDepot = node.id === 'depot';
    const label = isDepot ? '仓库' : (LOCATIONS.find((l) => l.id === node.id)?.label ?? String(node.id));
    // 按索引左右交替摆放；偏移从公路线起算，保证牌身完整在屏内（左缘 ≥ -360）
    const sideX = MAP_ROAD_X + (idx % 2 === 0 ? NODE_X_OFFSET : NODE_ALT_X);

    const plate = new Node(`Node-${node.id}`);
    plate.setParent(parent);
    plate.setPosition(sideX, y, 0);
    plate.addComponent(UITransform).setContentSize(220, 74);
    const g = plate.addComponent(Graphics);
    g.fillColor = isDepot ? COLOR_DEPOT : COLOR_NODE_IDLE;
    g.roundRect(-110, -37, 220, 74, 12);
    g.fill();

    const labelNode = new Node(`NodeLabel-${node.id}`);
    labelNode.setParent(plate);
    labelNode.addComponent(UITransform).setContentSize(210, 70);
    const lbl = labelNode.addComponent(Label);
    lbl.string = isDepot ? `${label}` : `${label}\n${node.km}km · 油${legFuelCost(node.km)}`;
    lbl.fontSize = isDepot ? 26 : 22;
    lbl.lineHeight = isDepot ? 30 : 26;
    lbl.color = new Color(250, 244, 226, 255);
    lbl.horizontalAlign = Label.HorizontalAlign.CENTER;
    lbl.verticalAlign = Label.VerticalAlign.CENTER;

    // 选中环（呼吸）
    const ring = new Node(`Ring-${node.id}`);
    ring.setParent(parent);
    ring.setPosition(sideX, y, 0);
    ring.addComponent(UITransform).setContentSize(250, 100);
    const rg = ring.addComponent(Graphics);
    rg.lineWidth = 5;
    rg.strokeColor = COLOR_NODE_SELECT;
    rg.roundRect(-118, -44, 236, 88, 14);
    rg.stroke();
    ring.addComponent(UIOpacity).opacity = 0;

    if (!isDepot) {
      plate.on(Node.EventType.TOUCH_END, () => this.onNodeTapped(node.id));
    }
    this.nodeVisuals.set(node.id, { ring, plate });
  }

  private onNodeTapped(id: string): void {
    if (this.trip.phase !== 'map' || this.game.ending !== null) return;
    this.selectedNode = id;
    this.refreshStatus();
    this.refreshRings();
  }

  private refreshRings(): void {
    for (const [id, visual] of this.nodeVisuals) {
      const op = visual.ring.getComponent(UIOpacity);
      if (op === null) continue;
      // Tween.stopAllByTarget 清掉呼吸动画；stopAllActions 是 Node 的方法，UIOpacity 上没有
      Tween.stopAllByTarget(op);
      if (this.selectedNode === id && this.trip.phase === 'map') {
        op.opacity = 255;
        tween(op).repeatForever(
          tween<UIOpacity>().to(0.6, { opacity: 90 }).to(0.6, { opacity: 255 }),
        ).start();
      } else {
        op.opacity = 0;
      }
    }
  }

  private refreshStatus(): void {
    // 标题带十日进度
    const title = this.mapRoot?.getChildByName('MapTitle')?.getComponent(Label);
    if (title !== undefined && title !== null) {
      title.string = `路线图 · 第 ${this.game.day}/${GAME_DAYS} 天`;
    }
    if (this.statusLabel === null) return;
    const dest = this.selectedNode === null ? null : DEPOT_ROUTE.find((n) => n.id === this.selectedNode);
    if (this.trip.phase === 'map' && dest !== undefined && dest !== null && dest.id !== 'depot') {
      const cost = legFuelCost(dest.km);
      this.statusLabel.string = this.game.stock.fuel >= cost
        ? `已选 ${this.tripDestinationLabel(dest.id)}（${dest.km}km，油 ${cost}）· 点「出发」`
        : `燃油不足：需 ${cost}，现有 ${this.game.stock.fuel}`;
    } else {
      this.statusLabel.string = `油 ${this.game.stock.fuel} · 弹 ${this.game.stock.ammo} · 食 ${this.game.stock.food} · 危险度 ${this.game.danger} · 点选目的地出发`;
    }
    this.refreshGoButton();
  }

  private tripDestinationLabel(id: string): string {
    return LOCATIONS.find((l) => l.id === id)?.label ?? id;
  }

  private goButton: Node | null = null;

  private refreshGoButton(): void {
    if (this.goButton === null) {
      this.goButton = this.mapRoot?.getChildByName('GoBtn') ?? null;
      if (this.goButton === null && this.mapRoot !== null) {
        this.createButton(this.mapRoot, 'GoBtn', '出发', 0, BTN_Y, () => this.onGo());
        this.goButton = this.mapRoot.getChildByName('GoBtn');
      }
    }
    if (this.goButton !== null) {
      this.goButton.active = this.trip.phase === 'map' && this.selectedNode !== null;
    }
  }

  private onGo(): void {
    if (this.trip.phase !== 'map' || this.selectedNode === null || this.selectedNode === 'depot') return;
    if (this.game.ending !== null) return;
    const destination = this.selectedNode;
    const fuelBefore = this.game.stock.fuel;
    // 出发扣费在规则层一次裁决：里程油耗 + 弹药，失败提示并停留在地图
    const pay = startTrip(this.game, destination as never);
    if (pay.state === this.game) {
      if (this.statusLabel !== null) {
        this.statusLabel.string = pay.message;
      }
      return;
    }
    this.game = pay.state;
    this.persistGame();
    // 行程相位机沿用同一油耗模型（用扣费前油量校验，此处必然通过）
    const result = depart(this.trip, destination as never, fuelBefore);
    if (result.fuelCost === 0) {
      if (this.statusLabel !== null && result.reason !== null) {
        this.statusLabel.string = result.reason;
      }
      return;
    }
    this.trip = result.state;
    this.selectedNode = null;
    this.refreshRings();
    this.persistTrip();
    const destLabel = this.tripDestinationLabel(this.trip.destination ?? '');
    this.startDrive({ destLabel, returning: false, onArrive: () => {
      this.trip = arrive(this.trip);
      this.persistTrip();
      this.showNodeArrival(destLabel);
    } });
  }

  // —— 行车卷轴演出 ——

  private buildDriveLayer(): void {
    const root = new Node('DriveRoot');
    root.setParent(this.node);
    root.active = false;
    root.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);

    // 三层：远景天空、中景地物（滚动）、近景路面（滚动）
    const sky = new Node('Sky');
    sky.setParent(root);
    sky.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const skyG = sky.addComponent(Graphics);
    const gradient = skyG.fillColor = COLOR_SKY;
    skyG.fillColor = gradient;
    skyG.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    skyG.fill();
    // 地平线暮色带
    skyG.fillColor = COLOR_SKY_DUSK;
    skyG.rect(-DESIGN_WIDTH / 2, SKY_BOTTOM - 60, DESIGN_WIDTH, 90);
    skyG.fill();

    // 中景废墟剪影（滚动层）：周期性摆放方块群，滚动 2 屏宽
    const mid = new Node('MidScroll');
    mid.setParent(root);
    mid.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const midG = mid.addComponent(Graphics);
    midG.fillColor = new Color(56, 60, 56, 255);
    for (let x = -DESIGN_WIDTH; x <= DESIGN_WIDTH * 2; x += 170) {
      const h = 60 + ((Math.abs(x) / 37) % 90);
      midG.rect(x, SKY_BOTTOM - 60, 90, h);
      midG.fill();
    }

    // 近景路面（滚动层）
    const near = new Node('NearScroll');
    near.setParent(root);
    near.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const nearG = near.addComponent(Graphics);
    nearG.fillColor = COLOR_GROUND;
    nearG.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, SKY_BOTTOM - 60 - (-DESIGN_HEIGHT / 2));
    nearG.fill();
    nearG.fillColor = COLOR_ASPHALT;
    nearG.rect(-DESIGN_WIDTH / 2, ROAD_LINE_Y - 90, DESIGN_WIDTH, 180);
    nearG.fill();
    // 车道虚线
    nearG.fillColor = COLOR_LANE;
    for (let x = -DESIGN_WIDTH; x <= DESIGN_WIDTH * 2; x += 120) {
      nearG.rect(x, ROAD_LINE_Y - 6, 60, 12);
      nearG.fill();
    }
    // 路牌（滚动：从右往左经过）
    nearG.fillColor = COLOR_SIGN;
    nearG.rect(DESIGN_WIDTH * 1.2, ROAD_LINE_Y + 100, 14, 120);
    nearG.fill();
    nearG.fillColor = new Color(122, 128, 108, 255);
    nearG.rect(DESIGN_WIDTH * 1.2 - 100, ROAD_LINE_Y + 200, 220, 70);
    nearG.fill();

    // 演出标题与跳过按钮
    this.createLabel(root, 'DriveTitle', '', 0, 470, 30, COLOR_TEXT);
    this.createButton(root, 'SkipBtn', '跳过', 300, 600, () => this.skipDrive());

    this.driveRoot = root;
  }

  private startDrive(ctx: DriveContext): void {
    if (this.driveRoot === null || this.mapRoot === null) return;
    this.mapRoot.active = false;
    this.driveRoot.active = true;
    this.driveCtx = ctx;
    const title = this.driveRoot.getChildByName('DriveTitle');
    const titleLbl = title?.getComponent(Label);
    if (titleLbl !== undefined && titleLbl !== null) {
      titleLbl.string = ctx.returning ? `返程 · 驶回仓库` : `出发 · 前往${ctx.destLabel}`;
    }
    const mid = this.driveRoot.getChildByName('MidScroll');
    const near = this.driveRoot.getChildByName('NearScroll');
    if (mid === null || near === null) return;
    const totalShift = DESIGN_WIDTH * 2;
    this.driveTween = tween(mid)
      .by(DRIVE_DURATION, { position: new Vec3(-totalShift, 0, 0) })
      .start();
    tween(near)
      .by(DRIVE_DURATION, { position: new Vec3(-totalShift * 1.35, 0, 0) })
      .start();
    this.scheduleOnce(() => this.finishDrive(), DRIVE_DURATION);
  }

  private skipDrive(): void {
    if (this.driveRoot === null || !this.driveRoot.active) return;
    this.finishDrive();
  }

  private finishDrive(): void {
    if (this.driveRoot === null) return;
    this.unschedule(this.finishDriveCallback);
    if (this.driveTween !== null) {
      this.driveTween.stop();
      this.driveTween = null;
    }
    const mid = this.driveRoot.getChildByName('MidScroll');
    const near = this.driveRoot.getChildByName('NearScroll');
    mid?.setPosition(0, 0, 0);
    near?.setPosition(0, 0, 0);
    const ctx = this.driveCtx;
    this.driveCtx = null;
    this.driveRoot.active = false;
    this.mapRoot!.active = true;
    ctx?.onArrive();
  }

  private readonly finishDriveCallback = (): void => this.finishDrive();

  // —— 抵达节点（SLICE_004：候选物资 → 货舱取舍）——

  private showNodeArrival(destLabel: string): void {
    if (this.mapRoot === null) return;
    this.mapRoot.active = true;
    this.closeNodePanel();

    // 战利品会话：恢复或新抽（seed 用时间戳，表现层一次性会话不要求可重放）
    if (this.loot === null || this.loot.location !== this.trip.destination) {
      const seed = Date.now() % 2147483647;
      this.loot = rollNodeLoot(this.trip.destination as never, createRng(seed), seed);
      this.persistLoot();
    }

    const panel = new Node('NodePanel');
    panel.setParent(this.node);
    panel.addComponent(UITransform).setContentSize(700, 1180);
    panel.setPosition(0, 0, 0);
    const g = panel.addComponent(Graphics);
    g.fillColor = new Color(55, 62, 57, 255);
    g.roundRect(-350, -590, 700, 1180, 16);
    g.fill();
    // 拦截触摸，防止点穿地图（注册监听即默认吞掉，空回调即可，见 buildMap 内注释）
    for (const evt of [Node.EventType.TOUCH_START, Node.EventType.TOUCH_MOVE, Node.EventType.TOUCH_END]) {
      panel.on(evt, (): void => undefined);
    }
    this.nodePanel = panel;

    this.createLabel(panel, 'NodeTitle', `抵达 · ${destLabel}`, 0, 540, 30, COLOR_TEXT);
    this.createLabel(panel, 'NodeHint', '点候选卡装入货舱 · 点已装物品取回 · 装不下就只能放弃', 0, 496, 18, COLOR_DIM);
    this.nodeStatus = this.createLabel(panel, 'NodeStatus', '', 0, -500, 20, COLOR_DIM);

    // —— 候选物资卡（未带走的）——
    const cardsRoot = new Node('LootCards');
    cardsRoot.setParent(panel);
    cardsRoot.setPosition(0, 380, 0);
    this.nodeLootCards = new Map();
    const remaining = remainingLoot(this.loot);
    remaining.forEach((roll, i) => {
      const card = this.createLootCard(cardsRoot, roll.itemId, i, remaining.length);
      this.nodeLootCards.set(roll.itemId, card);
    });
    if (remaining.length === 0) {
      this.createLabel(cardsRoot, 'NoLoot', '候选物资已全部处理', 0, 0, 22, COLOR_DIM);
    }

    // —— 货舱网格（复用 TrunkGrid，缩小放置）——
    const gridHost = new Node('GridHost');
    gridHost.setParent(panel);
    gridHost.setPosition(0, -20, 0);
    this.nodeGrid = new TrunkGrid(gridHost, DEFAULT_ITEM_DEFS, {
      scale: 0.62,
      initialState: this.nodeTrunk,
      removeOnTap: true,
      onChange: (state, ok, reason) => {
        if (ok) {
          this.nodeTrunk = state;
          this.persistNodeTrunk();
          if (this.nodeStatus !== null) {
            this.nodeStatus.string = '已装载';
          }
        } else if (this.nodeStatus !== null && reason !== undefined) {
          this.nodeStatus.string = reason;
        }
      },
      onItemRemoved: (itemId, amount) => {
        // 整组取回 → 候选卡还原（loot 与货舱一一对应：一件候选 = 一件货舱物品）
        if (this.loot !== null) {
          const back = putBackLoot(this.loot, itemId as never, amount);
          this.loot = back.state;
          this.persistLoot();
          this.rebuildLootCards();
        }
      },
    });

    this.createButton(panel, 'ReturnBtn', '返程', 0, -560, () => this.onReturnFromNode(destLabel));
    this.refreshLootCardDim();
  }

  private createLootCard(parent: Node, itemId: string, index: number, total: number): Node {
    const def = itemDef(DEFAULT_ITEM_DEFS, itemId);
    const card = new Node(`Loot-${itemId}`);
    card.setParent(parent);
    const spacing = 128;
    const x = (index - (total - 1) / 2) * spacing;
    card.setPosition(x, 0, 0);
    card.addComponent(UITransform).setContentSize(110, 110);
    const g = card.addComponent(Graphics);
    g.fillColor = ITEM_COLORS[itemId] ?? new Color(150, 150, 150, 255);
    g.roundRect(-55, -55, 110, 110, 12);
    g.fill();
    const labelNode = new Node(`LootLabel-${itemId}`);
    labelNode.setParent(card);
    labelNode.addComponent(UITransform).setContentSize(110, 110);
    const label = labelNode.addComponent(Label);
    label.string = `${def.label}\n${def.size}`;
    label.fontSize = 20;
    label.lineHeight = 24;
    label.color = new Color(250, 244, 226, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    card.on(Node.EventType.TOUCH_END, () => this.onLootCardTapped(itemId));
    return card;
  }

  private onLootCardTapped(itemId: string): void {
    if (this.loot === null || this.nodeGrid === null) return;
    // 已选中的货舱物品类型 → 选中态即「准备装入」：直接找第一个空位自动放置
    const spot = firstFreeSpot(this.nodeGrid.state, itemDef(DEFAULT_ITEM_DEFS, itemId));
    if (spot === null) {
      if (this.nodeStatus !== null) {
        this.nodeStatus.string = '货舱放不下了';
      }
      return;
    }
    const result = placeItem(this.nodeGrid.state, DEFAULT_ITEM_DEFS, itemId, spot.x, spot.y);
    if (!result.ok) {
      if (this.nodeStatus !== null && result.reason !== undefined) {
        this.nodeStatus.string = result.reason;
      }
      return;
    }
    const taken = takeLoot(this.loot, itemId as never);
    if (!taken.ok) {
      // 理论不可达：卡存在才能点
      return;
    }
    this.loot = taken.state;
    this.nodeTrunk = result.state;
    this.nodeGrid.setState(this.nodeTrunk);
    this.persistLoot();
    this.persistNodeTrunk();
    if (this.nodeStatus !== null) {
      const def = itemDef(DEFAULT_ITEM_DEFS, itemId);
      this.nodeStatus.string = `${def.label}已装入货舱`;
    }
    this.rebuildLootCards();
  }

  /** 重建候选卡（装舱后移除该卡，取回后恢复）。 */
  private rebuildLootCards(): void {
    if (this.nodePanel === null) return;
    const cardsRoot = this.nodePanel.getChildByName('LootCards');
    if (cardsRoot !== null) {
      // destroy 是帧末生效；先立即脱离节点树，避免同帧新旧两棵候选卡并存
      cardsRoot.removeFromParent();
      cardsRoot.destroy();
    }
    if (this.loot === null) return;
    const fresh = new Node('LootCards');
    fresh.setParent(this.nodePanel);
    fresh.setPosition(0, 380, 0);
    this.nodeLootCards = new Map();
    const remaining = remainingLoot(this.loot);
    remaining.forEach((roll, i) => {
      const card = this.createLootCard(fresh, roll.itemId, i, remaining.length);
      this.nodeLootCards.set(roll.itemId, card);
    });
    if (remaining.length === 0) {
      this.createLabel(fresh, 'NoLoot', '候选物资已全部处理', 0, 0, 22, COLOR_DIM);
    }
  }

  /** 已不在候选区的物品卡置灰（防御性：重建时保证一致性）。 */
  private refreshLootCardDim(): void {
    if (this.loot === null) return;
    for (const [itemId, card] of this.nodeLootCards) {
      const stillThere = this.loot.rolls.some((r) => r.itemId === itemId && !r.taken);
      card.active = stillThere;
    }
  }

  private closeNodePanel(): void {
    if (this.nodePanel !== null) {
      this.nodePanel.destroy();
      this.nodePanel = null;
    }
    this.nodeGrid = null;
    this.nodeLootCards = new Map();
    this.nodeStatus = null;
  }

  private onReturnFromNode(destLabel: string): void {
    this.closeNodePanel();
    this.trip = departReturn(this.trip);
    this.persistTrip();
    this.startDrive({ destLabel, returning: true, onArrive: () => {
      this.settleReturn();
    } });
  }

  /** 抵仓结算：货舱入库 → 推进一天（危险度/食物/结局）→ 回地图待发。 */
  private settleReturn(): void {
    const cargo = cargoFromTrunk(this.nodeTrunk, DEFAULT_ITEM_DEFS);
    this.game = returnHome(this.game, cargo).state;
    this.nodeTrunk = createTrunkState();
    this.storage.remove(TRUNK_SAVE_KEY);
    const advanced = advanceDay(this.game);
    this.game = advanced.state;
    this.persistGame();
    this.trip = backToMap(this.trip);
    this.loot = null;
    this.storage.remove(LOOT_SAVE_KEY);
    this.persistTrip();
    if (this.game.ending !== null) {
      this.showEndingPanel();
    } else {
      if (this.statusLabel !== null) {
        this.statusLabel.string = advanced.message;
      }
      this.refreshStatus();
    }
  }

  private finishTripVisualOnly(): void {
    // 「返回」：中止当前行程立即返仓——油弹不退、货舱照常入库、照常推进一天。
    if (this.trip.phase === 'map') return;
    this.closeNodePanel();
    // 先清演出回调，避免 finishDrive 触发 onArrive 造成二次结算
    this.driveCtx = null;
    this.settleReturn();
    if (this.driveRoot !== null) {
      this.finishDrive();
    }
  }

  // —— 结局面板（D1/D6 默认值：存活到第 10 天）——

  private showEndingPanel(): void {
    if (this.mapRoot === null) return;
    this.mapRoot.getChildByName('EndingPanel')?.destroy();
    const panel = new Node('EndingPanel');
    panel.setParent(this.node);
    panel.addComponent(UITransform).setContentSize(700, 900);
    panel.setPosition(0, 0, 0);
    const g = panel.addComponent(Graphics);
    g.fillColor = new Color(48, 44, 38, 255);
    g.roundRect(-350, -450, 700, 900, 16);
    g.fill();
    for (const evt of [Node.EventType.TOUCH_START, Node.EventType.TOUCH_MOVE, Node.EventType.TOUCH_END]) {
      panel.on(evt, (): void => undefined);
    }

    const stock = this.game.stock;
    this.createLabel(panel, 'EndingTitle', '结局 · 你活下来了', 0, 340, 40, COLOR_TEXT);
    this.createLabel(
      panel,
      'EndingStats',
      `存活到第 ${GAME_DAYS} 天\n危险度 ${this.game.danger}\n`
        + `燃油 ${stock.fuel} · 食物 ${stock.food} · 材料 ${stock.material}\n`
        + `药品 ${stock.medicine} · 弹药 ${stock.ammo}`,
      0,
      80,
      26,
      COLOR_TEXT,
    );
    this.createLabel(panel, 'EndingNote', '最终目标与多结局待拍板（PENDING_DECISIONS D1/D6）', 0, -120, 18, COLOR_DIM);
    this.createButton(panel, 'RestartBtn', '重新开始', 0, -300, () => this.restartGame());
  }

  /** 清空全部本地存档并重载场景，开新的一局。 */
  private restartGame(): void {
    this.storage.remove(GAME_SAVE_KEY);
    this.storage.remove(SAVE_KEY);
    this.storage.remove(LOOT_SAVE_KEY);
    this.storage.remove(TRUNK_SAVE_KEY);
    const sceneName = director.getScene()?.name ?? 'Prototype';
    director.loadScene(sceneName);
  }

  // —— 公共 ——

  private persistTrip(): void {
    this.storage.set(SAVE_KEY, encodeTripState(this.trip));
  }

  private persistGame(): void {
    this.storage.set(GAME_SAVE_KEY, encodeGameState(this.game));
  }

  private persistLoot(): void {
    if (this.loot !== null) {
      this.storage.set(LOOT_SAVE_KEY, encodeLootState(this.loot));
    }
  }

  private persistNodeTrunk(): void {
    this.storage.set(TRUNK_SAVE_KEY, encodeTrunkState(this.nodeTrunk));
  }

  private createLabel(parent: Node, name: string, text: string, x: number, y: number, fontSize: number, color: Color): Label {
    const labelNode = new Node(name);
    labelNode.setParent(parent);
    labelNode.setPosition(x, y, 0);
    labelNode.addComponent(UITransform).setContentSize(680, Math.max(60, fontSize * 1.5));
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.ceil(fontSize * 1.25);
    label.color = color;
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
  }

  private createButton(parent: Node, name: string, text: string, x: number, y: number, onClick: () => void): void {
    const btn = new Node(name);
    btn.setParent(parent);
    btn.setPosition(x, y, 0);
    btn.addComponent(UITransform).setContentSize(220, 64);
    const g = btn.addComponent(Graphics);
    g.fillColor = new Color(92, 76, 60, 255);
    g.roundRect(-110, -32, 220, 64, 12);
    g.fill();
    const labelNode = new Node(`${name}Label`);
    labelNode.setParent(btn);
    labelNode.addComponent(UITransform).setContentSize(220, 64);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = 24;
    label.lineHeight = 28;
    label.color = new Color(240, 228, 201, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    btn.on(Node.EventType.TOUCH_END, onClick);
  }
}
