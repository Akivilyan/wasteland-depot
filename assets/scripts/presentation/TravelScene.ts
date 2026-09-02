// SLICE_003 表现层：地图骨架 + 行车卷轴演出。
//
// 与 PrototypeScene 同场景协作：本组件挂在独立节点上，负责
// 地图选点（竖向骨架）与横轴行车演出；货舱 UI 由 PrototypeScene 负责。
// 数据全部来自 core/route.ts，本层只演出、不改规则。

import {
  _decorator,
  Color,
  Component,
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
import { createStoragePort, StoragePort } from '../platform/storage.ts';

const { ccclass } = _decorator;

const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

const SAVE_KEY = 'wasteland-depot.trip.v1';

// —— 地图骨架几何 ——
const MAP_TOP = 520;          // 最远节点 y
const MAP_BOTTOM = -420;      // 仓库 y
const MAP_ROAD_X = -80;       // 公路竖轴线 x
const NODE_X_OFFSET = 180;    // 节点牌相对公路的水平偏移
const NODE_ALT_X = -260;      // 节点牌交替侧偏移（避免文字出屏）

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

  private mapRoot: Node | null = null;
  private driveRoot: Node | null = null;
  private statusLabel: Label | null = null;
  private selectedNode: string | null = null;
  private nodeVisuals: Map<string, { ring: Node; plate: Node }> = new Map();
  private fuel = 12;
  private driveTween: Tween<Vec3> | null = null;
  private driveCtx: DriveContext | null = null;

  start(): void {
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.trip = decodeTripState(this.storage.get(SAVE_KEY));
    this.buildDriveLayer();
    this.buildMap();
    this.refreshStatus();
  }

  /** 由 PrototypeScene/外部同步当前燃油（出发合法性用）。 */
  setFuel(value: number): void {
    this.fuel = Math.max(0, Math.floor(value));
    this.refreshStatus();
  }

  /** 当前行程态（供外部读取）。 */
  get currentTrip(): TripState {
    return this.trip;
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

    this.createLabel(root, 'MapTitle', '路线图 · 选择目的地', 0, 620, 36, COLOR_TEXT);
    this.statusLabel = this.createLabel(root, 'MapStatus', '', 0, -620, 22, COLOR_DIM);
    this.createButton(root, 'BackDepot', '返回', 300, -620, () => this.finishTripVisualOnly());

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
    for (const node of DEPOT_ROUTE) {
      const t = node.km / minKm;
      const y = MAP_BOTTOM + t * (MAP_TOP - MAP_BOTTOM);
      this.createRouteNode(root, node, y);
    }
  }

  private createRouteNode(parent: Node, node: RouteNode, y: number): void {
    const isDepot = node.id === 'depot';
    const label = isDepot ? '仓库' : (LOCATIONS.find((l) => l.id === node.id)?.label ?? String(node.id));
    const sideX = MAP_ROAD_X + (node.km % 20 === 0 ? NODE_X_OFFSET : NODE_ALT_X);

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
    if (this.trip.phase !== 'map') return;
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
    if (this.statusLabel === null) return;
    const dest = this.selectedNode === null ? null : DEPOT_ROUTE.find((n) => n.id === this.selectedNode);
    if (this.trip.phase === 'map' && dest !== undefined && dest !== null && dest.id !== 'depot') {
      const cost = legFuelCost(dest.km);
      this.statusLabel.string = this.fuel >= cost
        ? `已选 ${this.tripDestinationLabel(dest.id)}（${dest.km}km，油 ${cost}）· 点「出发」`
        : `燃油不足：需 ${cost}，现有 ${this.fuel}`;
    } else {
      this.statusLabel.string = `油量 ${this.fuel} · 点选目的地出发`;
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
        this.createButton(this.mapRoot, 'GoBtn', '出发', 0, -620, () => this.onGo());
        this.goButton = this.mapRoot.getChildByName('GoBtn');
      }
    }
    if (this.goButton !== null) {
      this.goButton.active = this.trip.phase === 'map' && this.selectedNode !== null;
    }
  }

  private onGo(): void {
    if (this.trip.phase !== 'map' || this.selectedNode === null || this.selectedNode === 'depot') return;
    const result = depart(this.trip, this.selectedNode as never, this.fuel);
    if (result.fuelCost === 0) {
      if (this.statusLabel !== null && result.reason !== null) {
        this.statusLabel.string = result.reason;
      }
      return;
    }
    this.fuel -= result.fuelCost;
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

  // —— 抵达节点 ——

  private showNodeArrival(destLabel: string): void {
    if (this.mapRoot === null) return;
    this.mapRoot.active = true;
    const panel = new Node('ArrivalPanel');
    panel.setParent(this.node);
    panel.addComponent(UITransform).setContentSize(600, 400);
    panel.setPosition(0, 60, 0);
    const g = panel.addComponent(Graphics);
    g.fillColor = new Color(55, 62, 57, 255);
    g.roundRect(-300, -200, 600, 400, 16);
    g.fill();

    const text = new Node('ArrivalText');
    text.setParent(panel);
    text.addComponent(UITransform).setContentSize(560, 300);
    const tl = text.addComponent(Label);
    tl.string = `抵达 ${destLabel}\n\n（本切片只验证演出手感：\n节点交互将在下一切片接入货舱）`;
    tl.fontSize = 24;
    tl.lineHeight = 34;
    tl.color = COLOR_TEXT;
    tl.horizontalAlign = Label.HorizontalAlign.CENTER;
    tl.verticalAlign = Label.VerticalAlign.CENTER;

    this.createButton(panel, 'ReturnBtn', '返程', 0, -150, () => {
      panel.destroy();
      this.trip = departReturn(this.trip);
      this.persistTrip();
      this.startDrive({ destLabel, returning: true, onArrive: () => {
        this.trip = backToMap(this.trip);
        this.persistTrip();
        this.refreshStatus();
      } });
    });
  }

  private finishTripVisualOnly(): void {
    // 「返回」：放弃当前行程（仅演出态回地图；燃油不退——决策在规则层）
    if (this.trip.phase === 'map') return;
    this.trip = backToMap(this.trip);
    this.persistTrip();
    if (this.driveRoot !== null) {
      this.finishDrive();
    }
    this.refreshStatus();
  }

  // —— 公共 ——

  private persistTrip(): void {
    this.storage.set(SAVE_KEY, encodeTripState(this.trip));
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
