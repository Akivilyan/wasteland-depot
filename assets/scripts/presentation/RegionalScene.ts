// 区域制主场景（SLICE_008 起）：仓库 HUD → 大地图 → 层选择三按钮 → 探索（占位节点流）
// → 返程结算。规则数据全部经 core/run.ts 命令；本组件只装配 UI 与转发交互。
//
// 战斗（探索怪/守家/终局）在本切片为占位快速结算，SLICE_010/011 接入实时战斗；
// 横轴卷轴演出 SLICE_009 替换「探索占位面板」。

import {
  _decorator,
  Color,
  Component,
  Node,
  ResolutionPolicy,
  UITransform,
  view,
} from 'cc';
import { createRng, type Rng } from '../core/rng.ts';
import {
  REGIONS,
  RESOURCE_IDS,
  TIER_IDS,
  TIER_LABELS,
  NPCS,
  regionDef,
  resourceLabel,
  layerId,
  type RegionId,
  type ResourceId,
  type TierId,
} from '../core/regions.ts';
import { HEROES, heroDef, type HeroId } from '../core/hero.ts';
import {
  createNewGame,
  startExpedition,
  nextNode,
  takeScavenge,
  resolveEvent,
  meetNpc,
  applyExpeditionBattle,
  endExpedition,
  applyHomeBattle,
  applyFinalBattle,
  canStartExpedition,
  stockCap,
  nextWaveDay,
  vehicleDurabilityCap,
  wallHpCap,
  isLayerUnlocked,
  rocketBattleLimit,
  type NodeResult,
  type NodeEncounter,
} from '../core/run.ts';
import {
  type GameState,
  encodeGameState,
  decodeGameState,
  RUN_SAVE_KEY,
  ALL_SAVE_KEYS,
} from '../core/state.ts';
import { holdTotals } from '../core/hold.ts';
import { SLOT_CAP } from '../core/config.ts';
import { waveComposition } from '../core/combat.ts';
import { BattleStage, type BattleStageOptions, type BattleReport } from './BattleStage.ts';
import { createStoragePort, type StoragePort } from '../platform/storage.ts';
import { RegionJourney, REGION_PALETTES, DEFAULT_PALETTE } from './RegionJourney.ts';
import {
  COLOR_TEXT,
  COLOR_DIM,
  COLOR_DANGER,
  COLOR_WARNING,
  COLOR_DISABLED,
  COLOR_PRIMARY,
  COLOR_PANEL_DARK,
  RESOURCE_COLORS,
  createLabel,
  createRowLabel,
  createPanel,
  createBackdrop,
  createButton,
  createBar,
} from './ui-kit.ts';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;

/** 半透明遮罩色（弹层通用）。 */
const OVERLAY = new Color(20, 22, 21, 210);

@ccclass('RegionalScene')
export class RegionalScene extends Component {
  private readonly storage: StoragePort = createStoragePort();
  private state: GameState | null = null;
  private rng: Rng = createRng(20261024);
  private root: Node | null = null;
  private journey: RegionJourney | null = null;
  private toast: { label: ReturnType<typeof createLabel> } | null = null;
  /** 待继续的节点结果（节点弹层关闭后回到探索屏）。 */
  private pendingNode: NodeResult | null = null;

  override start(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const saved = decodeGameState(this.storage.get(RUN_SAVE_KEY));
    if (saved === null) {
      this.buildHeroPick();
    } else {
      this.state = saved;
      this.rng = createRng(saved.rngState);
      this.buildDepot();
    }
  }

  // —— 存档 ——

  private save(): void {
    if (this.state === null) return;
    this.storage.set(RUN_SAVE_KEY, encodeGameState(this.state));
  }

  private resetAll(): void {
    for (const key of ALL_SAVE_KEYS) {
      this.storage.remove(key);
    }
    this.state = null;
    this.buildHeroPick();
  }

  // —— 屏幕框架 ——

  private newScreen(name: string): Node {
    this.root?.destroy();
    this.journey = null;
    this.root = new Node(name);
    this.root.setParent(this.node);
    createBackdrop(this.root, `${name}Bg`, DESIGN_WIDTH, DESIGN_HEIGHT);
    return this.root;
  }

  private showToast(message: string): void {
    if (this.toast !== null && this.toast.label.node.isValid) {
      this.toast.label.string = message;
      return;
    }
    const host = this.root ?? this.node;
    const label = createLabel(host, 'Toast', message, 0, -DESIGN_HEIGHT / 2 + 120, 24, COLOR_WARNING);
    this.toast = { label };
  }

  // —— 主角四选一（序章完整包装在 SLICE_014）——

  private buildHeroPick(): void {
    const screen = this.newScreen('HeroPick');
    createLabel(screen, 'Title', '末班车：废土仓库', 0, 600, 44, COLOR_TEXT);
    createLabel(screen, 'Subtitle', '选择你的 AI 人格——车就是你', 0, 540, 24, COLOR_DIM);

    HEROES.forEach((hero, i) => {
      const y = 330 - i * 220;
      const card = createPanel(screen, `Hero${hero.id}`, 0, y, 660, 190);
      createLabel(card, 'Name', `${hero.nickname}`, 0, 62, 30, COLOR_TEXT, 620);
      createLabel(card, 'Route', hero.route, 0, 22, 20, COLOR_DIM, 620);
      createLabel(card, 'Talent', `天赋：${hero.talent}`, 0, -16, 20, COLOR_TEXT, 620);
      createLabel(card, 'Perk', `特长：${hero.perk}`, 0, -48, 20, COLOR_DIM, 620);
      card.on(Node.EventType.TOUCH_END, () => this.pickHero(hero.id));
    });
  }

  private pickHero(hero: HeroId): void {
    this.state = createNewGame(hero);
    this.rng = createRng(this.state.rngState);
    this.save();
    this.buildDepot();
  }

  // —— 仓库 HUD ——

  private buildDepot(): void {
    const state = this.state;
    if (state === null) return;
    const screen = this.newScreen('Depot');

    if (state.ending !== null) {
      this.buildEnding();
      return;
    }

    const waveCountdown = nextWaveDay(state) - state.day;
    createLabel(screen, 'DayHeader', `第 ${state.day} 天 · 下一波攻家还有 ${waveCountdown} 天`, 0, 610, 30, COLOR_TEXT);
    const partNote = state.finaleCountdown === null
      ? `信号零件 ${state.parts.length}/4`
      : `⚠ 抵抗军 ${state.finaleCountdown} 天后到达`;
    createLabel(screen, 'PartHeader', partNote, 0, 560, 24, state.finaleCountdown === null ? COLOR_DIM : COLOR_WARNING);

    // 资源五行
    RESOURCE_IDS.forEach((id, i) => {
      const y = 470 - i * 56;
      const swatch = createPanel(screen, `Swatch${id}`, -280, y, 22, 22, RESOURCE_COLORS[id], 4);
      createRowLabel(screen, `Res${id}`, `${resourceLabel(id)}　${state.stock[id]} / ${stockCap(state, id)}`, -244, y, 24, COLOR_TEXT, 400);
      const cap = stockCap(state, id);
      createRowLabel(screen, `Cap${id}`, `上限 ${cap}`, 220, y, 20, COLOR_DIM, 240);
    });

    // 乘员
    createLabel(screen, 'MemberTitle', `乘员（座位 ${state.members.length}/${state.vehicle.seats}）`, 0, 160, 24, COLOR_DIM);
    state.members.forEach((member, i) => {
      const y = 100 - i * 64;
      const status = member.dying ? '濒死·驻留' : `${member.hp}/${member.hpCap}`;
      createRowLabel(screen, `Member${member.id}Name`, member.name, -320, y, 22, member.dying ? COLOR_DANGER : COLOR_TEXT, 200);
      const bar = createBar(screen, `Member${member.id}Bar`, -60, y, 300, 26, member.hp / member.hpCap, member.dying ? COLOR_DANGER : COLOR_PRIMARY);
      createRowLabel(screen, `Member${member.id}Hp`, status, 260, y, 20, COLOR_DIM, 180);
    });

    // 载具与围墙
    createLabel(
      screen,
      'VehicleInfo',
      `战车耐久 ${state.vehicle.durability}/${vehicleDurabilityCap(state)} · 货舱 ${state.vehicle.slots} 格 · 围墙 ${state.wall.hp}/${wallHpCap(state)}`,
      0,
      -180,
      22,
      COLOR_DIM,
    );

    createButton(screen, 'DepartBtn', '出发探索', 0, -300, () => this.buildMap(), { width: 460, height: 96, fontSize: 32 });
    createButton(screen, 'ResetBtn', '重新开始', 0, -430, () => this.resetAll(), { width: 300, height: 72, fontSize: 24, color: COLOR_PANEL_DARK });

    // 待处理战斗（占位快速结算，SLICE_010/011 换实时战斗）
    if (state.homeBattlePending) {
      this.buildPendingBattleLayer('怪物攻家！', '迎战', () => this.startHomeBattle());
    } else if (state.finalePending) {
      this.buildPendingBattleLayer('最终决战——守住！', '迎战', () => this.startFinalBattle());
    }
  }

  private buildPendingBattleLayer(title: string, buttonText: string, onQuick: () => void): void {
    const state = this.state;
    if (state === null) return;
    const layer = createBackdrop(this.root as Node, 'BattleLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'BattlePanel', 0, 0, 600, 360);
    createLabel(panel, 'Title', title, 0, 110, 34, COLOR_WARNING);
    createLabel(panel, 'Note', '按住屏幕瞄准开火 · 右下角拖放火箭弹', 0, 40, 20, COLOR_DIM, 540);
    createButton(panel, 'QuickBtn', buttonText, 0, -70, onQuick, { width: 420, height: 90 });
  }

  // —— 大地图 ——

  private buildMap(): void {
    const state = this.state;
    if (state === null) return;
    const screen = this.newScreen('Map');
    createLabel(screen, 'MapTitle', '废土地图 · 点选区域', 0, 610, 32, COLOR_TEXT);

    // 市中心（中央）
    const center = createPanel(screen, 'Downtown', 0, 40, 300, 200, COLOR_PANEL_DARK);
    createLabel(center, 'Label', '市中心 · 通信基站', 0, 60, 26, COLOR_DIM, 280);
    createLabel(center, 'Parts', `信号零件 ${state.parts.length}/4${state.finaleCountdown !== null ? `\n抵抗军 ${state.finaleCountdown} 天后到达` : ''}`, 0, -20, 22, state.parts.length === 4 ? COLOR_WARNING : COLOR_DIM, 280);

    // 六区域（2 列 × 3 行）
    REGIONS.forEach((region, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = col === 0 ? -190 : 190;
      const y = 300 - row * 260;
      const unlockedTiers = TIER_IDS.filter((tier) => isLayerUnlocked(state, region.id, tier));
      const card = createPanel(screen, `Region${region.id}`, x, y, 330, 220);
      createLabel(card, 'Name', region.label, 0, 70, 30, COLOR_TEXT, 300);
      createLabel(card, 'Resource', region.mainResource === null ? '五资源均衡' : `主掉落：${resourceLabel(region.mainResource)}`, 0, 28, 20, COLOR_DIM, 300);
      createLabel(card, 'Tiers', `已解锁：${unlockedTiers.map((t) => TIER_LABELS[t]).join('/') || '—'}`, 0, -14, 20, COLOR_TEXT, 300);
      createLabel(card, 'Boss', `已斩 boss：${TIER_IDS.filter((t) => state.bossKilled.includes(layerId(region.id, t))).length}/3`, 0, -52, 18, COLOR_DIM, 300);
      card.on(Node.EventType.TOUCH_END, () => this.buildTierPick(region.id));
    });

    // 仓库角标
    const home = createPanel(screen, 'Home', -250, -520, 240, 110, COLOR_WARNING);
    createLabel(home, 'Label', '仓库（家）', 0, 0, 24, COLOR_TEXT, 220);

    createButton(screen, 'BackBtn', '返回仓库', 180, -520, () => this.buildDepot(), { width: 280, height: 80 });
  }

  // —— 层选择三按钮 ——

  private buildTierPick(region: RegionId): void {
    const state = this.state;
    if (state === null) return;
    const layer = createBackdrop(this.root as Node, 'TierLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'TierPanel', 0, 40, 620, 760);
    const def = regionDef(region);
    createLabel(panel, 'RegionName', def.label, 0, 300, 36, COLOR_TEXT);
    createLabel(panel, 'Blurb', def.blurb, 0, 248, 22, COLOR_DIM, 560);

    TIER_IDS.forEach((tier, i) => {
      const y = 120 - i * 160;
      const unlocked = isLayerUnlocked(state, region, tier);
      const bossKilled = state.bossKilled.includes(layerId(region, tier));
      const fuelNote = ['免油', '1 油/节点日', '2 油/节点日'][i] ?? '';
      const status = unlocked
        ? (bossKilled ? `${fuelNote} · boss 已斩` : `${fuelNote} · boss 未斩`)
        : `未解锁：击败${TIER_LABELS[tier === 'inner' ? 'outer' : 'inner']} boss 掉地图`;
      const blocked = unlocked ? canStartExpedition(state, region, tier) : '该层未解锁。';
      const button = createButton(
        panel,
        `Tier${tier}`,
        `${TIER_LABELS[tier]}　${status}`,
        0,
        y,
        () => this.onTierConfirmed(region, tier),
        {
          width: 540,
          height: 130,
          fontSize: 24,
          color: unlocked ? COLOR_PRIMARY : COLOR_DISABLED,
          disabled: !unlocked,
        },
      );
      if (unlocked && blocked !== null) {
        createLabel(button, 'BlockNote', blocked, 0, -40, 18, COLOR_WARNING, 500);
      }
    });

    createButton(panel, 'CancelBtn', '取消', 0, -320, () => layer.destroy(), { width: 300, height: 76, color: COLOR_PANEL_DARK });
  }

  private onTierConfirmed(region: RegionId, tier: TierId): void {
    const state = this.state;
    if (state === null) return;
    const result = startExpedition(state, region, tier, this.rng);
    this.state = result.state;
    this.save();
    if (result.state.expedition !== null) {
      this.buildExpedition();
    } else {
      // 出发被波次/终局拦下：回仓库处理战斗
      this.showToast(result.message);
      this.buildDepot();
    }
  }

  // —— 探索屏（横轴卷轴演出 SLICE_009 替换）——

  private buildExpedition(): void {
    const state = this.state;
    if (state === null || state.expedition === null) return;
    const expedition = state.expedition;
    const screen = this.newScreen('Expedition');
    const def = regionDef(expedition.region);

    // 横轴卷轴为底（SLICE_003 手感资产的区域制版本）
    this.journey = new RegionJourney(screen, REGION_PALETTES[expedition.region] ?? DEFAULT_PALETTE);
    this.journey.setInfo({
      title: `${def.label} · ${TIER_LABELS[expedition.tier]}层`,
      subtitle: `第 ${state.day} 天 · 本程第 ${expedition.nodesVisitedThisTrip} 个节点 · 燃油 ${state.stock.fuel}`,
    });

    // 悬浮操作排（在卷轴之上）
    createButton(screen, 'HoldBtn', '货舱', -250, -560, () => this.showHoldLayer(), { width: 200, height: 88, fontSize: 24 });
    createButton(screen, 'AdvanceBtn', '推进下一节点', 0, -560, () => this.onAdvance(), { width: 280, height: 96, fontSize: 26 });
    createButton(screen, 'ReturnBtn', '返程回仓', 250, -560, () => this.onReturnHome(), { width: 200, height: 88, fontSize: 24, color: COLOR_WARNING });

    if (expedition.forcedReturn) {
      const banner = createPanel(screen, 'ForcedBanner', 0, 460, 700, 64, COLOR_DANGER, 10);
      createLabel(banner, 'Label', '车辆打空 / 油尽——必须返程', 0, 0, 24, COLOR_TEXT, 660);
    }
  }

  /** 货舱弹层（网格只读查看 + 关闭）。 */
  private showHoldLayer(): void {
    const state = this.state;
    if (state === null || state.expedition === null) return;
    const expedition = state.expedition;
    const layer = createBackdrop(this.root as Node, 'HoldLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'HoldPanel', 0, 0, 680, 900);
    createLabel(panel, 'Title', `货舱（${expedition.hold.slots.length}/${state.vehicle.slots} 格）`, 0, 380, 30, COLOR_TEXT);
    const slots = state.vehicle.slots;
    const holdBySlot = new Map<number, { resource: ResourceId; amount: number }>();
    expedition.hold.slots.forEach((slot, i) => {
      holdBySlot.set(i, { resource: slot.resource, amount: slot.amount });
    });
    for (let i = 0; i < slots; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = -225 + col * 150;
      const y = 280 - row * 110;
      const entry = holdBySlot.get(i);
      if (entry === undefined) {
        createPanel(panel, `Slot${i}`, x, y, 138, 96, COLOR_PANEL_DARK, 8);
      } else {
        const cell = createPanel(panel, `Slot${i}`, x, y, 138, 96, RESOURCE_COLORS[entry.resource], 8);
        createLabel(cell, 'Res', resourceLabel(entry.resource), 0, 16, 18, COLOR_TEXT, 126);
        createLabel(cell, 'Amt', `${entry.amount}/${SLOT_CAP[entry.resource]}`, 0, -14, 22, COLOR_TEXT, 126);
      }
    }
    createButton(panel, 'CloseBtn', '关闭', 0, -400, () => layer.destroy(), { width: 280, height: 80, color: COLOR_PANEL_DARK });
  }

  private onAdvance(): void {
    const state = this.state;
    if (state === null || state.expedition === null) return;
    if (this.journey !== null && this.journey.isBusy) return;
    const runNode = (): void => this.resolveNextNode();
    if (this.journey !== null) {
      this.journey.playLeg(runNode, false);
    } else {
      runNode();
    }
  }

  private resolveNextNode(): void {
    const state = this.state;
    if (state === null || state.expedition === null) return;
    const result = nextNode(state, this.rng);
    this.state = result.state;
    this.rng = createRng(result.state.rngState);
    this.save();
    if (result.forcedReturn) {
      this.buildExpedition();
      this.showToast(result.message);
      return;
    }
    this.pendingNode = result;
    this.buildNodePanel(result);
  }

  // —— 节点结果弹层 ——

  private buildNodePanel(result: NodeResult): void {
    const encounter = result.encounter;
    if (encounter === null) {
      this.buildExpedition();
      return;
    }
    const layer = createBackdrop(this.root as Node, 'NodeLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'NodePanel', 0, 20, 640, 820);

    if (encounter.kind === 'scavenge') {
      createLabel(panel, 'Title', '搜刮点', 0, 320, 32, COLOR_TEXT);
      const label = resourceLabel(encounter.drop.resource);
      createLabel(panel, 'Text', `在${regionDef(this.state?.expedition?.region ?? 'food').label}发现 ${encounter.drop.amount} ${label}`, 0, 200, 30, COLOR_WARNING);
      createButton(panel, 'TakeBtn', '装舱', -140, -60, () => {
        this.applyAndBackToExpedition(() => takeScavenge(this.state as GameState, encounter.drop));
      }, { width: 240, height: 90 });
      createButton(panel, 'LeaveBtn', '留在现场', 140, -60, () => this.buildExpedition(), { width: 240, height: 90, color: COLOR_PANEL_DARK });
      return;
    }

    if (encounter.kind === 'event') {
      createLabel(panel, 'Title', `事件 · ${encounter.event.title}`, 0, 320, 30, COLOR_TEXT);
      createLabel(panel, 'Text', encounter.event.text, 0, 140, 26, COLOR_TEXT, 560);
      encounter.event.choices.forEach((choice, i) => {
        createButton(panel, `Choice${i}`, choice, 0, -30 - i * 110, () => {
          this.applyAndShowResult(() => resolveEvent(this.state as GameState, encounter.event.id, i));
        }, { width: 500, height: 92, fontSize: 24 });
      });
      return;
    }

    if (encounter.kind === 'monster' || encounter.kind === 'boss') {
      const isBoss = encounter.kind === 'boss';
      createLabel(panel, 'Title', isBoss ? 'BOSS 战（必战）' : '怪物关卡（可战可绕）', 0, 320, 32, isBoss ? COLOR_DANGER : COLOR_TEXT);
      const groups = encounter.encounter.groups
        .filter((g) => g.count > 0)
        .map((g) => `${g.size === 'small' ? '小' : g.size === 'medium' ? '中' : '大'}×${g.count}（生命 ${encounter.encounter.hpBySize[g.size]}）`)
        .join('　');
      createLabel(panel, 'Horde', `共 ${encounter.encounter.total} 只 · ${encounter.encounter.batches} 波`, 0, 220, 24, COLOR_TEXT, 560);
      createLabel(panel, 'Groups', groups, 0, 160, 22, COLOR_DIM, 560);
      const loot = encounter.encounter.lootPreview
        .map((d) => `${resourceLabel(d.resource)}×${d.amount}`)
        .join('、');
      createLabel(panel, 'Loot', `战利品：${loot}`, 0, 100, 24, COLOR_WARNING, 560);
      createLabel(panel, 'Ammo', `当前弹药 ${this.state?.stock.ammo ?? 0}（弹药不限制进入）`, 0, 40, 20, COLOR_DIM, 560);
      if (isBoss) {
        createButton(panel, 'FightBtn', '开战', 0, -120, () => this.startExpeditionBattle(true), { width: 420, height: 96, color: COLOR_DANGER });
      } else {
        createButton(panel, 'FightBtn', '开战', -140, -120, () => this.startExpeditionBattle(false), { width: 240, height: 96, color: COLOR_DANGER });
        createButton(panel, 'SkipBtn', '绕行', 140, -120, () => {
          this.buildExpedition();
          this.showToast('绕行怪物关卡，放弃掉落。');
        }, { width: 240, height: 96, color: COLOR_PANEL_DARK });
      }
      return;
    }

    // NPC 首遇
    createLabel(panel, 'Title', `结识 · ${npcName(encounter.npcId)}`, 0, 320, 32, COLOR_TEXT);
    createLabel(panel, 'Quest', `任务：带回 ${encounter.questAmount} ${resourceLabel(encounter.questResource)}`, 0, 180, 28, COLOR_WARNING);
    createLabel(panel, 'Note', '回仓库任务板交付，完成即可邀请入队（入队另付费）', 0, 110, 20, COLOR_DIM, 560);
    createButton(panel, 'MeetBtn', '记下任务', 0, -60, () => {
      this.applyAndBackToExpedition(() => meetNpc(this.state as GameState, encounter));
    }, { width: 420, height: 96 });
  }

  /** 应用命令 → 回探索屏（刷新）。 */
  private applyAndBackToExpedition(command: () => { state: GameState; message: string }): void {
    const result = command();
    this.state = result.state;
    this.save();
    this.buildExpedition();
    this.showToast(result.message);
  }

  /** 应用命令 → 弹层内显示结果 → 继续回探索屏。 */
  private applyAndShowResult(command: () => { state: GameState; message: string }): void {
    const result = command();
    this.state = result.state;
    this.save();
    const layer = this.root?.getChildByName('NodeLayer');
    layer?.destroy();
    const newLayer = createBackdrop(this.root as Node, 'NodeLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(newLayer, 'ResultPanel', 0, 20, 600, 380);
    createLabel(panel, 'Title', '结果', 0, 120, 30, COLOR_TEXT);
    createLabel(panel, 'Text', result.message, 0, 20, 26, COLOR_WARNING, 520);
    createButton(panel, 'ContinueBtn', '继续', 0, -110, () => this.buildExpedition(), { width: 320, height: 88 });
  }

  // —— 实时战斗（BattleStage，SLICE_010）——

  /** 通用：覆盖全屏建战斗层，装配 BattleStage。 */
  private runBattle(options: Omit<BattleStageOptions, 'onEnd'>, onEnd: (report: BattleReport) => void): void {
    const layer = new Node('BattleLayer');
    layer.setParent(this.node);
    layer.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const stage = layer.addComponent(BattleStage);
    stage.setup({ ...options, onEnd });
  }

  /** 探索怪物关卡 / boss 战。 */
  private startExpeditionBattle(isBoss: boolean): void {
    const state = this.state;
    const node = this.pendingNode;
    if (state === null || state.expedition === null || node === null) return;
    const encounter = node.encounter;
    if (encounter === null || (encounter.kind !== 'monster' && encounter.kind !== 'boss')) return;
    this.runBattle(
      {
        mode: 'explore',
        encounter: encounter.encounter,
        weaponLevel: state.weaponLevel,
        starkBonus: state.hero === 'stark',
        ammo: state.stock.ammo,
        rocketLimit: rocketBattleLimit(state),
        title: isBoss ? 'BOSS 战' : '怪物关卡',
      },
      (report) => this.settleExpeditionBattle(isBoss, report),
    );
  }

  private settleExpeditionBattle(isBoss: boolean, report: BattleReport): void {
    this.destroyBattleLayer();
    const result = applyExpeditionBattle(this.state as GameState, this.rng, isBoss, {
      victory: report.victory,
      breachDamage: report.breachDamage,
      ammoSpent: report.ammoSpent,
    });
    this.state = result.state;
    this.rng = createRng(result.state.rngState);
    this.save();
    this.buildExpedition();
    this.showToast(result.message);
  }

  /** 守家波次战（SLICE_011 口径：围墙→车→人管道）。 */
  private startHomeBattle(): void {
    const state = this.state;
    if (state === null) return;
    const wave = waveComposition(state.wavesPassed + 1);
    this.runBattle(
      {
        mode: 'home',
        encounter: { total: wave.total, batches: 4, groups: wave.groups, hpBySize: wave.hpBySize, lootPreview: [] },
        weaponLevel: state.weaponLevel,
        starkBonus: state.hero === 'stark',
        ammo: state.stock.ammo,
        rocketLimit: rocketBattleLimit(state),
        title: `第 ${state.wavesPassed + 1} 波攻家`,
      },
      (report) => {
        this.destroyBattleLayer();
        const result = applyHomeBattle(this.state as GameState, {
          victory: report.victory,
          breachDamage: report.breachDamage,
          ammoSpent: report.ammoSpent,
        });
        this.state = result.state;
        this.save();
        this.buildDepot();
        this.showToast(result.message);
      },
    );
  }

  /** 最终决战：无限弹药无限火箭，守住即胜利（§11）。 */
  private startFinalBattle(): void {
    const state = this.state;
    if (state === null) return;
    const wave = waveComposition(state.wavesPassed + 1);
    this.runBattle(
      {
        mode: 'final',
        encounter: { total: wave.total, batches: 4, groups: wave.groups, hpBySize: wave.hpBySize, lootPreview: [] },
        weaponLevel: state.weaponLevel,
        starkBonus: state.hero === 'stark',
        ammo: 0,
        rocketLimit: 99,
        title: '最终决战',
      },
      (report) => {
        this.destroyBattleLayer();
        const result = applyFinalBattle(this.state as GameState, {
          victory: report.victory,
          breachDamage: report.breachDamage,
        });
        this.state = result.state;
        this.save();
        this.buildDepot();
      },
    );
  }

  private destroyBattleLayer(): void {
    const layer = this.node.getChildByName('BattleLayer');
    layer?.destroy();
  }

  // —— 返程 ——

  private onReturnHome(): void {
    const state = this.state;
    if (state === null || state.expedition === null) return;
    if (this.journey !== null && this.journey.isBusy) return;
    const settle = (): void => this.settleReturn();
    if (this.journey !== null) {
      this.journey.playLeg(settle, true);
    } else {
      settle();
    }
  }

  private settleReturn(): void {
    const state = this.state;
    if (state === null) return;
    const result = endExpedition(state);
    this.state = result.state;
    this.rng = createRng(result.state.rngState);
    this.save();
    const layer = createBackdrop(this.root as Node, 'ReturnLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'ReturnPanel', 0, 20, 640, 480);
    createLabel(panel, 'Title', '返仓结算', 0, 170, 32, COLOR_TEXT);
    createLabel(panel, 'Text', result.message, 0, 40, 26, COLOR_WARNING, 560);
    createLabel(panel, 'Day', `第 ${result.state.day} 天`, 0, -60, 22, COLOR_DIM);
    createButton(panel, 'HomeBtn', '回仓库', 0, -160, () => this.buildDepot(), { width: 360, height: 92 });
  }

  // —— 结局 ——

  private buildEnding(): void {
    const state = this.state;
    if (state === null) return;
    const screen = this.newScreen('Ending');
    const victory = state.ending === 'victory';
    createLabel(screen, 'Title', victory ? '胜利！' : '失败', 0, 300, 64, victory ? COLOR_PRIMARY : COLOR_DANGER);
    createLabel(
      screen,
      'Text',
      victory
        ? `第 ${state.day} 天：抵抗军抵达仓库，人类抵抗部队获得胜利，并找到了这个还在抵抗的庇护所。`
        : `第 ${state.day} 天：全员濒死。废土又吞掉了一班车人。`,
      0,
      160,
      28,
      COLOR_TEXT,
    );
    createLabel(screen, 'Stat', `抵御波次 ${state.wavesDefended} · 零件 ${state.parts.length}/4 · 乘员 ${state.members.length}`, 0, 60, 22, COLOR_DIM);
    createButton(screen, 'RestartBtn', '重新开始', 0, -160, () => this.resetAll(), { width: 400, height: 96 });
  }
}

/** NPC 名查询（表驱动，避免表现层硬编码）。 */
function npcName(npcId: string): string {
  return NPCS.find((n) => n.id === npcId)?.name ?? npcId;
}
