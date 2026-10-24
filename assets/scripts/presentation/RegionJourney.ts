// 区域探索横轴卷轴演出器（GAME_DESIGN §9：横轴区域场景）。
//
// 从旧 TravelScene 的行车卷轴（SLICE_003 手感资产）提取：视差双滚动层
// （中景废墟剪影 + 近景路面）、车辆图形、标题/跳过。区域制探索屏以本
// 演出器为底，节点推进 = 播一段卷轴；规则推进仍由 core/run.ts 决定，
// 这里只负责「看起来在路上」。

import { Color, Graphics, Node, Tween, UITransform, Vec3, tween } from 'cc';
import { COLOR_DIM, COLOR_TEXT, createLabel, createButton } from './ui-kit.ts';

export const DESIGN_WIDTH = 750;
export const DESIGN_HEIGHT = 1334;
const SKY_BOTTOM = -80;
const ROAD_LINE_Y = -430;
const LEG_DURATION = 1.6;

/** 区域氛围色（天空 / 地面 / 剪影），六区各异提升辨识度。 */
export interface JourneyPalette {
  sky: Color;
  ground: Color;
  silhouette: Color;
  road: Color;
}

export const DEFAULT_PALETTE: JourneyPalette = {
  sky: new Color(64, 70, 66, 255),
  ground: new Color(46, 50, 46, 255),
  silhouette: new Color(56, 60, 56, 255),
  road: new Color(58, 60, 62, 255),
};

export const REGION_PALETTES: Record<string, JourneyPalette> = {
  food: { sky: new Color(74, 88, 62, 255), ground: new Color(46, 54, 40, 255), silhouette: new Color(58, 70, 50, 255), road: new Color(58, 60, 55, 255) },
  oil: { sky: new Color(88, 78, 58, 255), ground: new Color(52, 46, 38, 255), silhouette: new Color(66, 58, 44, 255), road: new Color(60, 56, 50, 255) },
  pharma: { sky: new Color(64, 80, 84, 255), ground: new Color(40, 50, 52, 255), silhouette: new Color(52, 66, 68, 255), road: new Color(55, 60, 62, 255) },
  arms: { sky: new Color(66, 70, 78, 255), ground: new Color(42, 44, 50, 255), silhouette: new Color(54, 58, 64, 255), road: new Color(58, 58, 62, 255) },
  industry: { sky: new Color(72, 70, 66, 255), ground: new Color(46, 45, 43, 255), silhouette: new Color(58, 57, 54, 255), road: new Color(60, 59, 57, 255) },
  mall: { sky: new Color(78, 66, 82, 255), ground: new Color(48, 42, 52, 255), silhouette: new Color(62, 52, 66, 255), road: new Color(62, 56, 64, 255) },
};

export interface JourneyInfo {
  title: string;
  subtitle: string;
}

export class RegionJourney {
  readonly root: Node;
  private readonly mid: Node;
  private readonly near: Node;
  private readonly car: Node;
  private readonly titleLabel: ReturnType<typeof createLabel>;
  private readonly subtitleLabel: ReturnType<typeof createLabel>;
  private readonly skipButton: Node;
  private tweens: Tween<Node>[] = [];
  private busy = false;
  private onLegDone: (() => void) | null = null;

  constructor(parent: Node, palette: JourneyPalette) {
    const root = new Node('JourneyRoot');
    root.setParent(parent);
    root.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.root = root;

    // 远景天空 + 暮色带
    const sky = new Node('Sky');
    sky.setParent(root);
    sky.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const skyG = sky.addComponent(Graphics);
    skyG.fillColor = palette.sky;
    skyG.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    skyG.fill();
    skyG.fillColor = new Color(palette.ground.r, palette.ground.g + 10, palette.ground.b, 255);
    skyG.rect(-DESIGN_WIDTH / 2, SKY_BOTTOM - 70, DESIGN_WIDTH, 100);
    skyG.fill();

    // 中景废墟剪影（滚动层，三屏宽）
    const mid = new Node('MidScroll');
    mid.setParent(root);
    mid.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const midG = mid.addComponent(Graphics);
    midG.fillColor = palette.silhouette;
    for (let x = -DESIGN_WIDTH; x <= DESIGN_WIDTH * 2; x += 170) {
      const h = 70 + ((Math.abs(x) / 37) % 100);
      midG.rect(x, SKY_BOTTOM - 60, 92, h);
      midG.fill();
    }
    this.mid = mid;

    // 近景路面（滚动层，视差更快）
    const near = new Node('NearScroll');
    near.setParent(root);
    near.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const nearG = near.addComponent(Graphics);
    nearG.fillColor = palette.ground;
    nearG.rect(-DESIGN_WIDTH, -DESIGN_HEIGHT / 2, DESIGN_WIDTH * 3, SKY_BOTTOM - 60 + DESIGN_HEIGHT / 2);
    nearG.fill();
    nearG.fillColor = palette.road;
    nearG.rect(-DESIGN_WIDTH, ROAD_LINE_Y - 90, DESIGN_WIDTH * 3, 180);
    nearG.fill();
    nearG.fillColor = new Color(200, 190, 160, 255);
    for (let x = -DESIGN_WIDTH; x <= DESIGN_WIDTH * 2; x += 120) {
      nearG.rect(x, ROAD_LINE_Y - 6, 60, 12);
      nearG.fill();
    }
    this.near = near;

    // 末班车（近景固定，车身细节用色块拼）
    const car = new Node('Car');
    car.setParent(root);
    car.setPosition(-40, ROAD_LINE_Y - 10, 0);
    car.addComponent(UITransform).setContentSize(240, 110);
    const carG = car.addComponent(Graphics);
    carG.fillColor = new Color(168, 122, 64, 255);
    carG.roundRect(-110, -30, 220, 60, 10);
    carG.fill();
    carG.fillColor = new Color(150, 106, 54, 255);
    carG.roundRect(-70, 20, 150, 46, 12);
    carG.fill();
    carG.fillColor = new Color(96, 112, 120, 255);
    carG.rect(-50, 32, 50, 28);
    carG.fill();
    carG.rect(10, 32, 50, 28);
    carG.fill();
    carG.fillColor = new Color(30, 30, 30, 255);
    carG.circle(-70, -34, 20);
    carG.fill();
    carG.circle(70, -34, 20);
    carG.fill();
    this.car = car;

    // 信息条与跳过
    this.titleLabel = createLabel(root, 'JourneyTitle', '', 0, 600, 34, COLOR_TEXT);
    this.subtitleLabel = createLabel(root, 'JourneySubtitle', '', 0, 546, 24, COLOR_DIM);
    this.skipButton = createButton(root, 'JourneySkip', '跳过', 290, 600, () => this.skip(), { width: 160, height: 64, fontSize: 22, color: new Color(38, 42, 40, 255) });
    this.skipButton.active = false;
  }

  setInfo(info: JourneyInfo): void {
    this.titleLabel.string = info.title;
    this.subtitleLabel.string = info.subtitle;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** 播放一段行进（去程推进/返程），结束后回调（跳过演出同样继续流程）。 */
  playLeg(onDone: () => void, returning = false): void {
    if (this.busy) return;
    this.busy = true;
    this.skipButton.active = true;
    this.onLegDone = onDone;
    const totalShift = DESIGN_WIDTH * 2;
    // 返程反向滚动：层从终点位置推回起点。
    this.mid.setPosition(returning ? -totalShift : 0, 0, 0);
    this.near.setPosition(returning ? -totalShift * 1.35 : 0, 0, 0);
    const midShift = returning ? totalShift : -totalShift;
    const nearShift = returning ? totalShift * 1.35 : -totalShift * 1.35;
    this.tweens = [
      tween(this.mid).by(LEG_DURATION, { position: new Vec3(midShift, 0, 0) }).start(),
      tween(this.near).by(LEG_DURATION, { position: new Vec3(nearShift, 0, 0) }).start(),
      // 车身轻微上下颠簸，强化「在路上」
      tween(this.car)
        .repeatForever(tween(this.car).to(0.32, { position: new Vec3(-40, ROAD_LINE_Y - 2, 0) }).to(0.32, { position: new Vec3(-40, ROAD_LINE_Y - 12, 0) }))
        .start(),
      tween(this.root).delay(LEG_DURATION).call(() => this.stopLeg(true)).start(),
    ];
  }

  skip(): void {
    if (!this.busy) return;
    this.stopLeg(true);
  }

  private stopLeg(callDone: boolean): void {
    for (const t of this.tweens) {
      t.stop();
    }
    this.tweens = [];
    Tween.stopAllByTarget(this.car);
    this.car.setPosition(-40, ROAD_LINE_Y - 10, 0);
    this.skipButton.active = false;
    this.busy = false;
    if (callDone && this.onLegDone !== null) {
      const callback = this.onLegDone;
      this.onLegDone = null;
      callback();
    }
  }

  destroy(): void {
    this.stopLeg(false);
    this.root.destroy();
  }
}
