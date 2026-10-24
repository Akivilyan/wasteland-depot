// 竖版实时战斗舞台（GAME_DESIGN §7/§10/§11——类《向僵尸开炮》）。
//
// 战车固定底部中央，怪物潮水式分波自上方涌入（中间密、两侧递减），
// 血薄量大、一两枪一个。机枪按住屏幕方向持续开火（实时扣弹药），
// 火箭弹从按钮拖放到目标点松手范围伤害。怪物推进到防线自毁，按
// 剩余生命等额扣损防线（输出即防御）——全部伤害经 core/combat.ts
// 的数值表结算，本组件只跑演出与命中判定。
//
// 三模式：explore（探索怪/dao boss）、home（守家，多一道围墙）、
// final（终局：无限弹药无限火箭）。

import {
  _decorator,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  UITransform,
  EventTouch,
  Vec2,
} from 'cc';
import {
  GUN_FIRE_RATE,
  GUN_AMMO_PER_SHOT,
  ROCKET_AMMO_PER_SHOT,
  GUN_DAMAGE,
  GUN_PIERCE,
  ROCKET_DAMAGE,
  ROCKET_RADIUS,
  MONSTER_HP,
  type MonsterSize,
} from '../core/config.ts';
import {
  weaponProfile,
  ramDamage,
  type WaveComposition,
} from '../core/combat.ts';
import type { MonsterEncounter } from '../core/regions.ts';

const { ccclass } = _decorator;

const W = 750;
const H = 1334;
const DEFENSE_Y = -430; // 防线（车头/墙顶）
const SPAWN_Y = H / 2 + 60;

interface Monster {
  x: number;
  y: number;
  hp: number;
  hpMax: number;
  speed: number;
  size: MonsterSize;
  isBoss: boolean;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  pierce: number;
}

interface Rocket {
  tx: number;
  ty: number;
  t: number; // 0..1 飞行进度
  damage: number;
  radius: number;
}

export type BattleMode = 'explore' | 'home' | 'final';

export interface BattleReport {
  victory: boolean;
  breachDamage: number;
  ammoSpent: number;
  killed: number;
  total: number;
}

export interface BattleStageOptions {
  mode: BattleMode;
  encounter: MonsterEncounter;
  weaponLevel: number;
  starkBonus: boolean;
  /** 当前弹药（final 模式忽略）。 */
  ammo: number;
  /** 火箭弹单场上限（final 模式无限）。 */
  rocketLimit: number;
  title: string;
  onEnd: (report: BattleReport) => void;
}

@ccclass('BattleStage')
export class BattleStage extends Component {
  private options: BattleStageOptions | null = null;
  private g: Graphics | null = null;
  private hudLabel: Label | null = null;
  private monsters: Monster[] = [];
  private bullets: Bullet[] = [];
  private rockets: Rocket[] = [];
  private aimX = 0;
  private aimY = 1;
  private firing = false;
  private gunTimer = 0;
  private time = 0;
  private spawnQueue: MonsterSize[] = [];
  private spawnTimer = 0;
  private spawnInterval = 0.18;
  private breachDamage = 0;
  private ammoSpent = 0;
  private killed = 0;
  private total = 0;
  private rocketsUsed = 0;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private ended = false;
  private ammo = 0;
  /** 分波投放：段索引与段间隔计时。 */
  private batchBreaks: number[] = [];
  private nextBreakAt = 0;

  /** 由 RegionalScene 调用完成装配（动态 addComponent 后立即可调）。 */
  setup(options: BattleStageOptions): void {
    this.options = options;
    this.ammo = options.ammo;
    this.node.addComponent(UITransform).setContentSize(W, H);
    const backdrop = new Node('BattleBg');
    backdrop.setParent(this.node);
    backdrop.addComponent(UITransform).setContentSize(W, H);
    const bgG = backdrop.addComponent(Graphics);
    bgG.fillColor = new Color(24, 26, 30, 255);
    bgG.rect(-W / 2, -H / 2, W, H);
    bgG.fill();

    const canvas = new Node('BattleCanvas');
    canvas.setParent(this.node);
    canvas.addComponent(UITransform).setContentSize(W, H);
    this.g = canvas.addComponent(Graphics);

    this.hudLabel = this.makeLabel('BattleHud', options.title, 0, H / 2 - 50, 26, new Color(225, 213, 183, 255));

    // 生成队列：按 encounter groups 展开，打乱顺序（中间密两侧递减在 x 采样时体现）
    for (const group of options.encounter.groups) {
      for (let i = 0; i < group.count; i++) {
        this.spawnQueue.push(group.size);
      }
    }
    // 打乱：小怪先行的稳定洗牌（确定性不需要——表现层随机可用 Math.random）
    for (let i = this.spawnQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = this.spawnQueue[i] as MonsterSize;
      this.spawnQueue[i] = this.spawnQueue[j] as MonsterSize;
      this.spawnQueue[j] = tmp;
    }
    this.total = this.spawnQueue.length;
    // 分 3~4 波涌入、波间喘息：在等比例位置埋“停顿位”
    const batches = Math.max(1, options.encounter.batches);
    this.batchBreaks = [];
    for (let b = 1; b < batches; b++) {
      this.batchBreaks.push(Math.floor((this.total * b) / batches));
    }
    this.nextBreakAt = this.batchBreaks.shift() ?? -1;
    this.spawnTimer = 0.6;
    this.bindInput(canvas);
    this.updateHud();
  }

  private makeLabel(name: string, text: string, x: number, y: number, size: number, color: Color): Label {
    const node = new Node(name);
    node.setParent(this.node);
    node.setPosition(x, y, 0);
    node.addComponent(UITransform).setContentSize(680, size * 2);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.color = color;
    return label;
  }

  private toLocal(event: EventTouch): Vec2 {
    const ui = event.getUILocation();
    return new Vec2(ui.x - W / 2, ui.y - H / 2);
  }

  private bindInput(canvas: Node): void {
    canvas.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      const p = this.toLocal(event);
      // 右下角火箭弹发射区（拖放起点）
      if (p.x > 180 && p.y < -380) {
        this.dragging = true;
        this.dragX = p.x;
        this.dragY = p.y;
        return;
      }
      this.firing = true;
      this.setAim(p.x, p.y);
    });
    canvas.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      const p = this.toLocal(event);
      if (this.dragging) {
        this.dragX = p.x;
        this.dragY = p.y;
      } else if (this.firing) {
        this.setAim(p.x, p.y);
      }
    });
    canvas.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
      const p = this.toLocal(event);
      if (this.dragging) {
        this.dragging = false;
        this.launchRocket(p.x, p.y);
      }
      this.firing = false;
    });
    canvas.on(Node.EventType.TOUCH_CANCEL, () => {
      this.dragging = false;
      this.firing = false;
    });
  }

  private setAim(x: number, y: number): void {
    const dy = y - DEFENSE_Y;
    if (Math.abs(dy) < 10 && Math.abs(x) < 10) return;
    const len = Math.sqrt(x * x + dy * dy);
    this.aimX = x / len;
    this.aimY = dy / len;
  }

  private launchRocket(tx: number, ty: number): void {
    const o = this.options;
    if (o === null || this.ended) return;
    if (o.mode !== 'final' && this.rocketsUsed >= o.rocketLimit) return;
    if (o.mode !== 'final' && this.ammoLeft() < ROCKET_AMMO_PER_SHOT) return;
    this.rocketsUsed++;
    if (o.mode !== 'final') {
      this.ammo -= ROCKET_AMMO_PER_SHOT;
      this.ammoSpent += ROCKET_AMMO_PER_SHOT;
    }
    const profile = weaponProfile(o.weaponLevel, o.starkBonus);
    this.rockets.push({
      tx,
      ty,
      t: 0,
      damage: profile.rocketDamagePerShot,
      radius: ROCKET_RADIUS[o.weaponLevel] as number,
    });
    this.updateHud();
  }

  private ammoLeft(): number {
    return this.options?.mode === 'final' ? 999999 : this.ammo;
  }

  private updateHud(): void {
    const o = this.options;
    if (o === null || this.hudLabel === null) return;
    const rocketNote = o.mode === 'final'
      ? '火箭 ∞'
      : `火箭 ${Math.max(0, o.rocketLimit - this.rocketsUsed)}`;
    const ammoNote = o.mode === 'final' ? '弹药 ∞' : `弹药 ${this.ammo}`;
    const remain = this.monsters.length + this.spawnQueue.length;
    this.hudLabel.string = `${o.title} · ${ammoNote} · ${rocketNote} · 剩余 ${remain}`;
  }

  override update(dt: number): void {
    if (this.ended || this.options === null) return;
    this.time += dt;
    this.stepSpawns(dt);
    this.stepGun(dt);
    this.stepBullets(dt);
    this.stepRockets(dt);
    this.stepMonsters(dt);
    this.draw();
    this.checkEnd();
  }

  private stepSpawns(dt: number): void {
    if (this.spawnQueue.length === 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    // 波间喘息：到达停顿位时歇 2.4 秒
    if (this.total - this.spawnQueue.length === this.nextBreakAt) {
      this.nextBreakAt = this.batchBreaks.shift() ?? -1;
      this.spawnTimer = 2.4;
      return;
    }
    this.spawnTimer = this.spawnInterval;
    const size = this.spawnQueue.shift() as MonsterSize;
    // 中间密两侧递减：x = 三角分布采样
    const u = Math.random() + Math.random() + Math.random(); // 0..3 近正态居中
    const x = ((u / 3) * 2 - 1) * (W / 2 - 60);
    const hp = (this.options?.encounter.hpBySize[size]) ?? MONSTER_HP[size];
    const speed = size === 'small' ? 150 + Math.random() * 30 : size === 'medium' ? 125 + Math.random() * 25 : 100 + Math.random() * 20;
    this.monsters.push({ x, y: SPAWN_Y, hp, hpMax: hp, speed, size, isBoss: false });
    this.updateHud();
  }

  private stepGun(dt: number): void {
    const o = this.options;
    if (o === null || !this.firing || this.ended) return;
    this.gunTimer += dt;
    const interval = 1 / GUN_FIRE_RATE;
    while (this.gunTimer >= interval) {
      this.gunTimer -= interval;
      if (this.ammoLeft() < GUN_AMMO_PER_SHOT) {
        this.firing = false; // 弹尽停火，不锁武器（松手重按可再试）
        return;
      }
      if (o.mode !== 'final') {
        this.ammo -= GUN_AMMO_PER_SHOT;
        this.ammoSpent += GUN_AMMO_PER_SHOT;
      }
      const profile = weaponProfile(o.weaponLevel, o.starkBonus);
      // 锥形散布：小角度抖动
      const spread = (Math.random() - 0.5) * 0.09;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const vx = this.aimX * cos - this.aimY * sin;
      const vy = this.aimX * sin + this.aimY * cos;
      this.bullets.push({
        x: 0,
        y: DEFENSE_Y + 40,
        vx: vx * 1300,
        vy: vy * 1300,
        damage: GUN_DAMAGE[o.weaponLevel] as number,
        pierce: GUN_PIERCE[o.weaponLevel] as number,
      });
      this.updateHud();
    }
  }

  private stepBullets(dt: number): void {
    const alive: Bullet[] = [];
    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (bullet.y > H / 2 + 40 || Math.abs(bullet.x) > W / 2 + 40) continue;
      let pierce = bullet.pierce;
      let damage = bullet.damage;
      const survivors: Monster[] = [];
      for (const monster of this.monsters) {
        if (pierce > 0 && damage > 0 && Math.abs(monster.x - bullet.x) < 34 && Math.abs(monster.y - bullet.y) < 34) {
          const hit = Math.min(monster.hp, damage);
          monster.hp -= hit;
          damage -= hit;
          pierce -= 1;
          if (monster.hp <= 0) {
            this.killed++;
            continue; // 怪死移除
          }
        }
        survivors.push(monster);
      }
      this.monsters = survivors;
      if (damage > 0 && pierce >= 0) {
        alive.push(bullet);
      }
    }
    this.bullets = alive;
  }

  private stepRockets(dt: number): void {
    const alive: Rocket[] = [];
    for (const rocket of this.rockets) {
      rocket.t += dt * 1.6;
      if (rocket.t >= 1) {
        // 落点范围伤害
        const survivors: Monster[] = [];
        for (const monster of this.monsters) {
          const dx = monster.x - rocket.tx;
          const dy = monster.y - rocket.ty;
          if (dx * dx + dy * dy <= rocket.radius * rocket.radius) {
            monster.hp -= rocket.damage;
            if (monster.hp <= 0) {
              this.killed++;
              continue;
            }
          }
          survivors.push(monster);
        }
        this.monsters = survivors;
        this.updateHud();
        continue;
      }
      alive.push(rocket);
    }
    this.rockets = alive;
  }

  private stepMonsters(dt: number): void {
    const survivors: Monster[] = [];
    for (const monster of this.monsters) {
      monster.y -= monster.speed * dt;
      if (monster.y <= DEFENSE_Y) {
        // 撞线自毁：按剩余生命等额扣损防线（输出即防御）
        this.breachDamage += ramDamage(monster.hp);
        continue;
      }
      survivors.push(monster);
    }
    this.monsters = survivors;
  }

  private checkEnd(): void {
    if (this.spawnQueue.length > 0 || this.monsters.length > 0) return;
    this.ended = true;
    const o = this.options as BattleStageOptions;
    // 结束口径：怪清空即收场；击杀过半才算守住战场（拿全额掉落由规则层按 victory 发放）
    const victory = this.killed * 2 >= this.total;
    o.onEnd({
      victory,
      breachDamage: this.breachDamage,
      ammoSpent: this.ammoSpent,
      killed: this.killed,
      total: this.total,
    });
  }

  // —— 绘制（每帧全量重绘，程序化 Graphics）——

  private draw(): void {
    const g = this.g;
    if (g === null) return;
    g.clear();

    // 防线（守家画墙、探索画车体横条）
    const o = this.options as BattleStageOptions;
    g.fillColor = o.mode === 'home' ? new Color(120, 104, 78, 255) : new Color(96, 88, 76, 255);
    g.rect(-W / 2, DEFENSE_Y - 26, W, 26);
    g.fill();
    if (o.mode === 'home') {
      g.fillColor = new Color(120, 104, 78, 255);
      g.rect(-W / 2, DEFENSE_Y, W, 16);
      g.fill();
    }

    // 战车（底部中央）
    g.fillColor = new Color(168, 122, 64, 255);
    g.roundRect(-70, DEFENSE_Y - 6, 140, 46, 8);
    g.fill();
    // 炮塔指向
    g.strokeColor = new Color(225, 213, 183, 255);
    g.lineWidth = 8;
    g.moveTo(0, DEFENSE_Y + 30);
    g.lineTo(this.aimX * 56, DEFENSE_Y + 30 + this.aimY * 56);
    g.stroke();

    // 怪物（色块 + 血量描边，boss 更大）
    for (const monster of this.monsters) {
      const r = monster.size === 'small' ? 16 : monster.size === 'medium' ? 24 : 34;
      const hpRatio = monster.hp / monster.hpMax;
      g.fillColor =
        monster.size === 'small'
          ? new Color(150, 90, 76, 255)
          : monster.size === 'medium'
            ? new Color(170, 96, 60, 255)
            : new Color(190, 70, 50, 255);
      g.circle(monster.x, monster.y, r);
      g.fill();
      if (hpRatio < 1) {
        g.fillColor = new Color(30, 30, 30, 200);
        g.rect(monster.x - r, monster.y + r + 6, r * 2, 6);
        g.fill();
        g.fillColor = new Color(220, 80, 60, 255);
        g.rect(monster.x - r, monster.y + r + 6, r * 2 * hpRatio, 6);
        g.fill();
      }
    }

    // 子弹
    g.fillColor = new Color(255, 230, 150, 255);
    for (const bullet of this.bullets) {
      g.circle(bullet.x, bullet.y, 5);
      g.fill();
    }

    // 火箭弹飞行轨迹与落点圈
    for (const rocket of this.rockets) {
      const x = rocket.tx * rocket.t;
      const y = (DEFENSE_Y + 60) + (rocket.ty - DEFENSE_Y - 60) * rocket.t;
      g.fillColor = new Color(255, 160, 90, 255);
      g.circle(x, y, 10);
      g.fill();
      g.strokeColor = new Color(255, 120, 80, 160);
      g.lineWidth = 3;
      g.circle(rocket.tx, rocket.ty, rocket.radius);
      g.stroke();
    }

    // 拖放中的目标圈
    if (this.dragging) {
      g.strokeColor = new Color(120, 200, 140, 200);
      g.lineWidth = 3;
      g.circle(this.dragX, this.dragY, 60);
      g.stroke();
    }

    // 火箭弹发射区（右下角）
    const rocketLeft = o.mode === 'final' ? 99 : Math.max(0, o.rocketLimit - this.rocketsUsed);
    g.fillColor = rocketLeft > 0 ? new Color(190, 84, 70, 255) : new Color(80, 84, 82, 255);
    g.roundRect(240, -H / 2 + 60, 100, 100, 12);
    g.fill();
    g.fillColor = new Color(225, 213, 183, 255);
    g.rect(284, -H / 2 + 130, 12, 24);
    g.fill();
  }
}
