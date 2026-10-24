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
  emptyStock,
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
  prologueTake,
  finishPrologue,
  prologueAdvance,
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
  upgradeStockCap,
  upgradeWallHp,
  upgradeVehicleDurability,
  upgradeWeapon,
  buySlot,
  buySeat,
  repair,
  healMember,
  useSerum,
  submitQuest,
  recruitNpc,
  ladderCost,
  upgradeCost,
  isRecruited,
  type CmdResult,
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
import { holdTotals, remainingCapacity, type HoldState } from '../core/hold.ts';
import {
  SLOT_CAP,
  GUN_DAMAGE,
  ROCKET_DAMAGE,
  STOCK_CAP_BASE,
  STOCK_CAP_PER_LEVEL,
  STOCK_UPGRADE_COSTS,
  WALL_HP_LEVELS,
  WALL_UPGRADE_COSTS,
  VEHICLE_DURABILITY_LEVELS,
  VEHICLE_DURABILITY_COSTS,
  WEAPON_UPGRADE_COSTS,
  SLOT_LADDER,
  SEAT_LADDER,
  STORAGE_SLOTS_BASE,
  SEATS_BASE,
  REPAIR_PER_MATERIAL,
  RECRUIT_RESOURCE_COST,
  RECRUIT_FOOD_COST,
} from '../core/config.ts';
import { waveComposition } from '../core/combat.ts';
import { BattleStage, type BattleStageOptions, type BattleReport } from './BattleStage.ts';
import { createStoragePort, type StoragePort } from '../platform/storage.ts';
import { RegionJourney, REGION_PALETTES, DEFAULT_PALETTE, PROLOGUE_PALETTE } from './RegionJourney.ts';
import {
  COLOR_TEXT,
  COLOR_DIM,
  COLOR_DANGER,
  COLOR_WARNING,
  COLOR_DISABLED,
  COLOR_PRIMARY,
  COLOR_PANEL,
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
  /** 序章本站已装舱的物品下标（弹层重建保持牌面；跨站清空）。 */
  private prologueTaken: number[] = [];

  override start(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const saved = decodeGameState(this.storage.get(RUN_SAVE_KEY));
    if (saved === null) {
      this.buildHeroPick();
    } else {
      this.state = saved;
      this.rng = createRng(saved.rngState);
      if (saved.prologueHold !== null && saved.prologueHold !== undefined) {
        this.buildPrologue();
      } else {
        this.buildDepot();
      }
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
    // 旧 Toast 可能随 newScreen 销毁：跨帧后 label.node 被置 null，须先判空再验 isValid。
    const existing = this.toast?.label;
    if (existing !== undefined && existing !== null && existing.node !== null && existing.node.isValid) {
      existing.string = message;
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
    // 序章口径（§12）：开局库存 = 路上带回的物资，先空舱出发。
    this.state = createNewGame(hero, 20261024, emptyStock());
    this.rng = createRng(this.state.rngState);
    this.save();
    this.buildPrologue();
  }

  // —— 序章（§12：驶向仓库的路上拾取 + 一次装不下的取舍）——

  private buildPrologue(): void {
    const state = this.state;
    if (state === null || state.prologueHold === null) return;
    const screen = this.newScreen('Prologue');
    this.journey = new RegionJourney(screen, PROLOGUE_PALETTE);
    const step = state.prologueStep ?? 0;
    this.journey.setInfo({
      title: '末班车启动 · 序章',
      subtitle: step === 0
        ? '开往你的仓库——路上能捡点什么，就带点什么'
        : `驶向仓库 · 已过 ${step} 处（货舱 ${state.prologueHold.slots.length}/${state.vehicle.slots} 格）`,
    });

    createButton(screen, 'HoldBtn', '货舱', -150, -560, () => this.showPrologueHold(), { width: 200, height: 88, fontSize: 24 });
    const nextLabel = step >= PROLOGUE_STOPS.length ? '抵达仓库' : '赶路';
    createButton(screen, 'DriveBtn', nextLabel, 150, -560, () => this.prologueDrive(), { width: 280, height: 96, fontSize: 26 });
  }

  /** 赶路：播一段卷轴 → 开下一站（或抵仓结算）。 */
  private prologueDrive(): void {
    const state = this.state;
    if (state === null || this.journey === null || this.journey.isBusy) return;
    const step = state.prologueStep ?? 0;
    const arrive = (): void => this.afterPrologueLeg(step);
    this.journey.playLeg(arrive, false);
  }

  private afterPrologueLeg(step: number): void {
    const state = this.state;
    if (state === null) return;
    if (step >= PROLOGUE_STOPS.length) {
      this.settlePrologue();
      return;
    }
    this.state = prologueAdvance(state);
    this.save();
    this.showPrologueStop(step);
  }

  /** 站点弹层：逐件装舱（格数即取舍），最后一站物资超量必丢。 */
  private showPrologueStop(index: number): void {
    const state = this.state;
    if (state === null || state.prologueHold === null) return;
    const stop = PROLOGUE_STOPS[index];
    if (stop === undefined) {
      this.settlePrologue();
      return;
    }
    this.prologueScreen()?.destroy();
    const layer = createBackdrop(this.root as Node, 'PrologueStopLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'StopPanel', 0, 20, 660, 900);
    createLabel(panel, 'Title', stop.title, 0, 380, 32, COLOR_TEXT);
    createLabel(panel, 'Text', stop.text, 0, 300, 22, COLOR_DIM, 580);
    createLabel(panel, 'HoldNote', `货舱 ${state.prologueHold.slots.length}/${state.vehicle.slots} 格`, 0, 240, 20, COLOR_DIM, 560);

    const taken = this.prologueTaken;
    stop.drops.forEach((drop, i) => {
      const y = 200 - i * 76;
      const swatch = createPanel(panel, `Drop${i}Swatch`, -250, y, 18, 18, RESOURCE_COLORS[drop.resource], 4);
      const room = remainingCapacity(state.prologueHold as HoldState, drop.resource, state.vehicle.slots);
      const isTaken = taken.includes(i);
      const canLoad = !isTaken && room > 0;
      createRowLabel(panel, `Drop${i}Label`, `${resourceLabel(drop.resource)} ×${drop.amount}`, -220, y, 24, canLoad ? COLOR_TEXT : COLOR_DISABLED, 260);
      createButton(
        panel,
        `Drop${i}Btn`,
        isTaken ? '已装舱' : room <= 0 ? '装不下' : '装舱',
        150,
        y,
        () => {
          const result = prologueTake(this.state as GameState, drop.resource, drop.amount);
          this.state = result.state;
          this.prologueTaken = [...taken, i];
          this.save();
          this.showPrologueStop(index); // 重建弹层刷新牌面
          this.showToast(result.message);
        },
        { width: 190, height: 64, fontSize: 22, disabled: !canLoad },
      );
    });

    const last = index === PROLOGUE_STOPS.length - 1;
    createButton(panel, 'GoBtn', last ? '装好了，回仓库' : '继续赶路', 0, -400, () => {
      this.prologueTaken = [];
      layer.destroy();
      this.prologueDrive();
    }, { width: 400, height: 88 });
  }

  private prologueScreen(): Node | null {
    return this.root?.getChildByName('PrologueStopLayer') ?? null;
  }

  /** 抵仓：货舱转仓库（溢出作废）→ 结算面板 → 进仓库主屏。 */
  private settlePrologue(): void {
    const state = this.state;
    if (state === null) return;
    const result = finishPrologue(state);
    this.state = result.state;
    this.save();
    this.journey?.destroy();
    this.journey = null;
    const screen = this.newScreen('PrologueArrival');
    createLabel(screen, 'Title', '抵达仓库', 0, 420, 44, COLOR_TEXT);
    createLabel(screen, 'Text', result.message, 0, 280, 26, COLOR_WARNING, 620);
    createLabel(screen, 'Note', '带回的内容就是开局资源。接下来：修整仓库，出发探索。', 0, 180, 22, COLOR_DIM, 620);
    createButton(screen, 'EnterBtn', '开始经营', 0, 20, () => this.buildDepot(), { width: 400, height: 96 });
  }

  /** 序章货舱查看（复用探索货舱布局，只读）。 */
  private showPrologueHold(): void {
    const state = this.state;
    if (state === null || state.prologueHold === null) return;
    const hold = state.prologueHold;
    const layer = createBackdrop(this.root as Node, 'PrologueHoldLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'HoldPanel', 0, 0, 680, 900);
    createLabel(panel, 'Title', `货舱（${hold.slots.length}/${state.vehicle.slots} 格）`, 0, 380, 30, COLOR_TEXT);
    for (let i = 0; i < state.vehicle.slots; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = -225 + col * 150;
      const y = 280 - row * 110;
      const slot = hold.slots[i];
      if (slot === undefined) {
        createPanel(panel, `Slot${i}`, x, y, 138, 96, COLOR_PANEL_DARK, 8);
      } else {
        const cell = createPanel(panel, `Slot${i}`, x, y, 138, 96, RESOURCE_COLORS[slot.resource], 8);
        createLabel(cell, 'Res', resourceLabel(slot.resource), 0, 16, 18, COLOR_TEXT, 126);
        createLabel(cell, 'Amt', `${slot.amount}/${SLOT_CAP[slot.resource]}`, 0, -14, 22, COLOR_TEXT, 126);
      }
    }
    createButton(panel, 'CloseBtn', '关闭', 0, -400, () => layer.destroy(), { width: 280, height: 80, color: COLOR_PANEL_DARK });
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
    // §10 波次明牌：提前一天预告强度。
    const waveNote = waveCountdown === 1
      ? `明日波次攻家：约 ${waveComposition(state.wavesPassed + 1).total} 只`
      : `下一波攻家还有 ${waveCountdown} 天`;
    createLabel(screen, 'DayHeader', `第 ${state.day} 天 · ${waveNote}`, 0, 610, 30, waveCountdown === 1 ? COLOR_WARNING : COLOR_TEXT);
    // 信号强度条（§11 软结局提示：4 零件各 20%，集齐即满、同步终局触发，牌面即真相）。
    const signalRatio = state.parts.length / 4;
    const inCountdown = state.finaleCountdown !== null;
    createLabel(screen, 'PartHeader', inCountdown ? `⚠ 抵抗军 ${state.finaleCountdown} 天后到达` : '抵抗军信号强度', 0, 574, 20, inCountdown ? COLOR_WARNING : COLOR_DIM);
    createBar(screen, 'SignalBar', 0, 540, 420, 22, signalRatio, inCountdown ? COLOR_WARNING : COLOR_PRIMARY);
    if (!inCountdown) {
      createLabel(screen, 'SignalNote', `${state.parts.length}/4 零件 · 集齐自动修复基站`, 0, 508, 18, COLOR_DIM);
    } else if (state.finaleCountdown === 0) {
      createLabel(screen, 'SignalNote', '信号已发出——最后的机会，守住最终决战！', 0, 508, 18, COLOR_WARNING);
    }

    // 资源五行
    RESOURCE_IDS.forEach((id, i) => {
      const y = 470 - i * 56;
      const swatch = createPanel(screen, `Swatch${id}`, -280, y, 22, 22, RESOURCE_COLORS[id], 4);
      createRowLabel(screen, `Res${id}`, `${resourceLabel(id)}　${state.stock[id]} / ${stockCap(state, id)}`, -244, y, 24, COLOR_TEXT, 400);
      const cap = stockCap(state, id);
      createRowLabel(screen, `Cap${id}`, `上限 ${cap}`, 220, y, 20, COLOR_DIM, 240);
    });

    // 乘员（主屏最多 5 行，完整列表在医疗面板）
    createLabel(screen, 'MemberTitle', `乘员（座位 ${state.members.length}/${state.vehicle.seats}）`, 0, 180, 24, COLOR_DIM);
    const shownMembers = state.members.slice(0, 5);
    shownMembers.forEach((member, i) => {
      const y = 120 - i * 60;
      const status = member.dying ? '濒死·驻留' : `${member.hp}/${member.hpCap}`;
      createRowLabel(screen, `Member${member.id}Name`, member.name, -320, y, 22, member.dying ? COLOR_DANGER : COLOR_TEXT, 200);
      const bar = createBar(screen, `Member${member.id}Bar`, -60, y, 300, 24, member.hp / member.hpCap, member.dying ? COLOR_DANGER : COLOR_PRIMARY);
      createRowLabel(screen, `Member${member.id}Hp`, status, 260, y, 20, COLOR_DIM, 180);
    });
    if (state.members.length > shownMembers.length) {
      createLabel(screen, 'MemberMore', `…另有 ${state.members.length - shownMembers.length} 人（医疗面板查看）`, 0, -180, 18, COLOR_DIM);
    }

    // 载具与围墙
    createLabel(
      screen,
      'VehicleInfo',
      `战车耐久 ${state.vehicle.durability}/${vehicleDurabilityCap(state)} · 货舱 ${state.vehicle.slots} 格 · 围墙 ${state.wall.hp}/${wallHpCap(state)}`,
      0,
      -235,
      22,
      COLOR_DIM,
    );

    // 仓库功能入口（GDD §6：全部操作 ≤2 跳）——有待办时按钮变色（牌面即真相）
    const hasDying = state.members.some((m) => m.dying);
    const questNpcIds = Object.keys(state.npcQuests);
    const hasDeliverable = questNpcIds.some(
      (id) => !state.npcQuestsDone.includes(id) && state.stock[state.npcQuests[id]!.resource] >= state.npcQuests[id]!.amount,
    );
    const hasRecruitable = state.npcQuestsDone.some((id) => !isRecruited(state, id));
    const entries: Array<{ name: string; text: string; color: Color; onClick: () => void }> = [
      { name: 'UpgradeBtn', text: '升级', color: COLOR_PRIMARY, onClick: () => this.buildUpgradeLayer() },
      {
        name: 'RepairBtn',
        text: '维修',
        color: state.vehicle.durability < vehicleDurabilityCap(state) || state.wall.hp < wallHpCap(state) ? COLOR_WARNING : COLOR_PRIMARY,
        onClick: () => this.buildRepairLayer(),
      },
      { name: 'MedicBtn', text: '医疗', color: hasDying ? COLOR_DANGER : COLOR_PRIMARY, onClick: () => this.buildMedicLayer() },
      { name: 'QuestBtn', text: '任务板', color: hasDeliverable || hasRecruitable ? COLOR_WARNING : COLOR_PRIMARY, onClick: () => this.buildQuestLayer() },
    ];
    entries.forEach((entry, i) => {
      const x = -261 + i * 174;
      createButton(screen, entry.name, entry.text, x, -320, entry.onClick, { width: 166, height: 84, fontSize: 26, color: entry.color });
    });

    createButton(screen, 'DepartBtn', '出发探索', 0, -440, () => this.buildMap(), { width: 460, height: 96, fontSize: 32 });
    createButton(screen, 'ResetBtn', '重新开始', 0, -555, () => this.resetAll(), { width: 300, height: 72, fontSize: 24, color: COLOR_PANEL_DARK });

    // 待处理战斗（占位快速结算，SLICE_010/011 换实时战斗）
    if (state.homeBattlePending) {
      this.buildPendingBattleLayer('怪物攻家！', '迎战', () => this.startHomeBattle());
    } else if (state.finalePending) {
      this.buildPendingBattleLayer('最终决战——守住！', '迎战', () => this.startFinalBattle(), '最后的机会：无限弹药无限火箭已解锁，守住即胜利');
    }
  }

  // —— 仓库功能面板（升级/维修/医疗/任务板，GDD §6）——

  /** 弹层骨架：遮罩 + 面板 + 标题 + 关闭；返回内容面板（调用方往里填行）。 */
  private openLayer(layerName: string, title: string, width: number, height: number): Node {
    const layer = createBackdrop(this.root as Node, layerName, DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, `${layerName}Panel`, 0, 0, width, height);
    createLabel(panel, 'Title', title, 0, height / 2 - 60, 30, COLOR_TEXT);
    createButton(panel, 'CloseBtn', '关闭', 0, -height / 2 + 60, () => layer.destroy(), { width: 240, height: 72, fontSize: 24, color: COLOR_PANEL_DARK });
    return panel;
  }

  /** 面板内执行仓库命令：存档 → 刷新主屏 → 重开面板（数据牌面更新）→ toast。 */
  private applyInLayer(command: () => CmdResult, reopen: () => void): void {
    const result = command();
    this.state = result.state;
    this.save();
    this.buildDepot();
    reopen();
    this.showToast(result.message);
  }

  /** 升级面板：科技树四线（储量/围墙/载具耐久/武器）+ 储物/载客扩容（§6）。 */
  private buildUpgradeLayer(): void {
    const state = this.state;
    if (state === null) return;
    const panel = this.openLayer('UpgradeLayer', '升级（材料施工）', 680, 1080);
    createLabel(panel, 'Stock', `材料库存 ${state.stock.material}`, 0, 420, 22, COLOR_DIM);

    const rows: Array<{
      name: string;
      status: string;
      effect: string;
      cost: number | null;
      maxed: boolean;
      run: () => CmdResult;
    }> = [
      {
        name: '储量',
        status: `Lv.${state.stockUpgradeLevel}/3`,
        effect: `每种资源上限 ${STOCK_CAP_BASE + STOCK_CAP_PER_LEVEL * state.stockUpgradeLevel} → ${STOCK_CAP_BASE + STOCK_CAP_PER_LEVEL * (state.stockUpgradeLevel + 1)}`,
        cost: state.stockUpgradeLevel < STOCK_UPGRADE_COSTS.length ? STOCK_UPGRADE_COSTS[state.stockUpgradeLevel] as number : null,
        maxed: state.stockUpgradeLevel >= STOCK_UPGRADE_COSTS.length,
        run: () => upgradeStockCap(this.state as GameState),
      },
      {
        name: '围墙',
        status: `Lv.${state.wall.level}/3`,
        effect: `耐久上限 ${wallHpCap(state)} → ${state.wall.level < WALL_UPGRADE_COSTS.length ? (WALL_HP_LEVELS[state.wall.level] as number) : wallHpCap(state)}（差值自动补满）`,
        cost: state.wall.level < WALL_UPGRADE_COSTS.length ? upgradeCost(state, WALL_UPGRADE_COSTS[state.wall.level] as number) : null,
        maxed: state.wall.level >= WALL_UPGRADE_COSTS.length,
        run: () => upgradeWallHp(this.state as GameState),
      },
      {
        name: '载具耐久',
        status: `Lv.${state.vehicle.durabilityLevel}/3`,
        effect: `上限 ${vehicleDurabilityCap(state)} → ${state.vehicle.durabilityLevel < VEHICLE_DURABILITY_COSTS.length ? (VEHICLE_DURABILITY_LEVELS[state.vehicle.durabilityLevel] as number) : vehicleDurabilityCap(state)}`,
        cost: state.vehicle.durabilityLevel < VEHICLE_DURABILITY_COSTS.length ? upgradeCost(state, VEHICLE_DURABILITY_COSTS[state.vehicle.durabilityLevel] as number) : null,
        maxed: state.vehicle.durabilityLevel >= VEHICLE_DURABILITY_COSTS.length,
        run: () => upgradeVehicleDurability(this.state as GameState),
      },
      {
        name: '武器',
        status: `L${state.weaponLevel + 1}（共 L3）`,
        effect: `机枪 ${GUN_DAMAGE[state.weaponLevel]} → ${GUN_DAMAGE[Math.min(GUN_DAMAGE.length - 1, state.weaponLevel + 1)]}/发 · 火箭 ${ROCKET_DAMAGE[state.weaponLevel]} → ${ROCKET_DAMAGE[Math.min(ROCKET_DAMAGE.length - 1, state.weaponLevel + 1)]}/发`,
        cost: state.weaponLevel < WEAPON_UPGRADE_COSTS.length ? WEAPON_UPGRADE_COSTS[state.weaponLevel] as number : null,
        maxed: state.weaponLevel >= WEAPON_UPGRADE_COSTS.length,
        run: () => upgradeWeapon(this.state as GameState),
      },
      {
        name: '储物 +1 格',
        status: `现 ${state.vehicle.slots} 格`,
        effect: '货舱扩容，无档位上限',
        cost: upgradeCost(state, ladderCost(SLOT_LADDER, state.vehicle.slots - STORAGE_SLOTS_BASE)),
        maxed: false,
        run: () => buySlot(this.state as GameState),
      },
      {
        name: '载客 +1 座',
        status: `现 ${state.vehicle.seats} 座（${state.members.length} 人）`,
        effect: '成员总数上限，无档位上限',
        cost: upgradeCost(state, ladderCost(SEAT_LADDER, state.vehicle.seats - SEATS_BASE)),
        maxed: false,
        run: () => buySeat(this.state as GameState),
      },
    ];

    rows.forEach((row, i) => {
      const y = 320 - i * 132;
      const card = createPanel(panel, `UpgradeRow${i}`, 0, y, 620, 116);
      createLabel(card, 'Name', `${row.name}　${row.status}`, 0, 34, 24, COLOR_TEXT, 580);
      createLabel(card, 'Effect', row.effect, 0, 2, 19, COLOR_DIM, 580);
      if (row.maxed) {
        createLabel(card, 'Maxed', '已满级', 0, -32, 20, COLOR_DISABLED, 200);
      } else {
        const affordable = (row.cost as number) <= state.stock.material;
        createButton(
          card,
          `Upgrade${i}Btn`,
          `升级（${row.cost} 材料）`,
          130,
          -32,
          () => this.applyInLayer(row.run, () => this.buildUpgradeLayer()),
          { width: 240, height: 52, fontSize: 20, disabled: !affordable },
        );
        if (!affordable) {
          createLabel(card, `Upgrade${i}Note`, '材料不足', -140, -32, 18, COLOR_WARNING, 200);
        }
      }
    });
  }

  /** 维修面板：修车/修墙统一价 1 材料 = 10 耐久（§6）。 */
  private buildRepairLayer(): void {
    const state = this.state;
    if (state === null) return;
    const panel = this.openLayer('RepairLayer', '维修（1 材料 = 10 耐久）', 660, 640);
    createLabel(panel, 'Stock', `材料库存 ${state.stock.material}`, 0, 210, 22, COLOR_DIM);

    const targets: Array<{ name: string; target: 'vehicle' | 'wall'; current: number; cap: number }> = [
      { name: '战车耐久', target: 'vehicle', current: state.vehicle.durability, cap: vehicleDurabilityCap(state) },
      { name: '围墙', target: 'wall', current: state.wall.hp, cap: wallHpCap(state) },
    ];
    targets.forEach((t, i) => {
      const y = 90 - i * 190;
      const card = createPanel(panel, `RepairRow${i}`, 0, y, 580, 160);
      createLabel(card, 'Name', `${t.name}　${t.current} / ${t.cap}`, 0, 52, 26, COLOR_TEXT, 540);
      const missing = t.cap - t.current;
      const fullCost = Math.ceil(missing / REPAIR_PER_MATERIAL);
      const canFix = missing > 0 && state.stock.material >= 1;
      const canFull = missing > 0 && state.stock.material >= fullCost;
      createButton(
        card,
        `Fix10Btn${i}`,
        `修 ${REPAIR_PER_MATERIAL} 点（1 材料）`,
        -135,
        -34,
        () => this.applyInLayer(() => repair(this.state as GameState, t.target, 1), () => this.buildRepairLayer()),
        { width: 240, height: 60, fontSize: 20, disabled: !canFix },
      );
      createButton(
        card,
        `FixFullBtn${i}`,
        missing > 0 ? `修满（${fullCost} 材料）` : '已满',
        135,
        -34,
        () => this.applyInLayer(() => repair(this.state as GameState, t.target, 999), () => this.buildRepairLayer()),
        { width: 240, height: 60, fontSize: 20, disabled: !canFull },
      );
    });
  }

  /** 医疗面板：吃药回血（1 药 = 10 血）+ 药神补剂（§5/§8）。 */
  private buildMedicLayer(): void {
    const state = this.state;
    if (state === null) return;
    const panel = this.openLayer('MedicLayer', '医疗', 680, 1080);
    const isPharmacist = state.hero === 'pharmacist';
    createLabel(
      panel,
      'Stock',
      isPharmacist ? `药品 ${state.stock.medicine} · 1 药 = 10 血；补剂：5 药 → 上限 +50、当前 +50` : `药品 ${state.stock.medicine} · 1 药 = 10 血（只回血不提上限）`,
      0,
      420,
      20,
      COLOR_DIM,
      620,
    );

    const shown = state.members.slice(0, 7);
    shown.forEach((member, i) => {
      const y = 330 - i * 104;
      const card = createPanel(panel, `MedicRow${i}`, 0, y, 620, 92, member.dying ? COLOR_PANEL_DARK : COLOR_PANEL);
      createLabel(card, 'Name', member.dying ? `${member.name}（濒死·驻留）` : member.name, -180, 26, 22, member.dying ? COLOR_DANGER : COLOR_TEXT, 220);
      createLabel(card, 'Hp', `${member.hp}/${member.hpCap}`, 218, 26, 20, COLOR_DIM, 120);
      createBar(card, 'Bar', -110, -18, 210, 22, member.hp / member.hpCap, member.dying ? COLOR_DANGER : COLOR_PRIMARY);
      createButton(
        card,
        'HealBtn',
        '吃药',
        75,
        -18,
        () => this.applyInLayer(() => healMember(this.state as GameState, member.id), () => this.buildMedicLayer()),
        { width: 110, height: 52, fontSize: 20, disabled: member.hp >= member.hpCap || state.stock.medicine < 1 },
      );
      if (isPharmacist) {
        createButton(
          card,
          'SerumBtn',
          '补剂',
          205,
          -18,
          () => this.applyInLayer(() => useSerum(this.state as GameState, member.id), () => this.buildMedicLayer()),
          { width: 110, height: 52, fontSize: 20, color: COLOR_WARNING, disabled: member.hpCap >= 200 || state.stock.medicine < 5 },
        );
      }
    });
    if (state.members.length > shown.length) {
      createLabel(panel, 'More', `…另有 ${state.members.length - shown.length} 人未显示`, 0, -440, 18, COLOR_DIM);
    }
  }

  /** 任务板：交付任务解锁信任，另付一笔邀请入队（§8 两笔分开）。 */
  private buildQuestLayer(): void {
    const state = this.state;
    if (state === null) return;
    const panel = this.openLayer('QuestLayer', '任务板', 680, 1080);
    createLabel(panel, 'Hint', `交付任务取得信任 → 另付一笔邀请入队（座位 ${state.vehicle.seats}，现 ${state.members.length} 人）`, 0, 420, 20, COLOR_DIM, 620);

    const npcIds = Object.keys(state.npcQuests);
    if (npcIds.length === 0) {
      createLabel(panel, 'Empty', '还没有结识任何 NPC——探索中首遇 NPC 即接下任务。', 0, 100, 24, COLOR_DIM, 580);
      return;
    }
    npcIds.forEach((npcId, i) => {
      const y = 320 - i * 150;
      const quest = state.npcQuests[npcId]!;
      const name = npcName(npcId);
      const card = createPanel(panel, `QuestRow${i}`, 0, y, 620, 130);
      if (isRecruited(state, npcId)) {
        createLabel(card, 'Name', `${name}　已入队`, 0, 40, 24, COLOR_TEXT, 580);
        createLabel(card, 'Note', `任务：${quest.amount} ${resourceLabel(quest.resource)}（已交付）`, 0, -8, 20, COLOR_DIM, 580);
        return;
      }
      if (state.npcQuestsDone.includes(npcId)) {
        createLabel(card, 'Name', `${name}　信任已取得`, 0, 40, 24, COLOR_TEXT, 580);
        const pharmacistDiscount = state.hero === 'pharmacist' && quest.resource === 'medicine';
        const recruitCost = pharmacistDiscount ? 15 : RECRUIT_RESOURCE_COST;
        createLabel(card, 'Note', `邀请入队另付费：${recruitCost} ${resourceLabel(quest.resource)}`, 0, -8, 20, COLOR_DIM, 580);
        const canPay = state.stock[quest.resource] >= recruitCost && state.members.length < state.vehicle.seats;
        createButton(
          card,
          'RecruitBtn',
          `邀请（${recruitCost} ${resourceLabel(quest.resource)}）`,
          state.hero === 'cook' ? -140 : 0,
          -44,
          () => this.applyInLayer(() => recruitNpc(this.state as GameState, npcId, 'resource'), () => this.buildQuestLayer()),
          { width: 260, height: 56, fontSize: 20, disabled: !canPay },
        );
        if (state.hero === 'cook') {
          const canPayFood = state.stock.food >= RECRUIT_FOOD_COST && state.members.length < state.vehicle.seats;
          createButton(
            card,
            'RecruitFoodBtn',
            `或 ${RECRUIT_FOOD_COST} 食物`,
            140,
            -44,
            () => this.applyInLayer(() => recruitNpc(this.state as GameState, npcId, 'food'), () => this.buildQuestLayer()),
            { width: 220, height: 56, fontSize: 20, disabled: !canPayFood },
          );
        }
        return;
      }
      createLabel(card, 'Name', name, 0, 40, 24, COLOR_TEXT, 580);
      createLabel(card, 'Note', `需要 ${quest.amount} ${resourceLabel(quest.resource)}（库存 ${state.stock[quest.resource]}）`, 0, -8, 20, COLOR_DIM, 580);
      const canSubmit = state.stock[quest.resource] >= quest.amount;
      createButton(
        card,
        'SubmitBtn',
        canSubmit ? `交付（扣 ${quest.amount} ${resourceLabel(quest.resource)}）` : `${quest.amount - state.stock[quest.resource]} 份不足`,
        0,
        -44,
        () => this.applyInLayer(() => submitQuest(this.state as GameState, npcId), () => this.buildQuestLayer()),
        { width: 360, height: 56, fontSize: 20, disabled: !canSubmit },
      );
    });
  }

  private buildPendingBattleLayer(title: string, buttonText: string, onQuick: () => void, note = '按住屏幕瞄准开火 · 右下角拖放火箭弹'): void {
    const state = this.state;
    if (state === null) return;
    const layer = createBackdrop(this.root as Node, 'BattleLayer', DESIGN_WIDTH, DESIGN_HEIGHT, OVERLAY);
    const panel = createPanel(layer, 'BattlePanel', 0, 0, 600, 360);
    createLabel(panel, 'Title', title, 0, 110, 34, COLOR_WARNING);
    createLabel(panel, 'Note', note, 0, 40, 20, COLOR_DIM, 540);
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

/** 序章站点剧本（§12：前 3 站教学装舱，末站物资超格——取舍即核心体验第一课）。
 *  容量账：前 3 站约 7 格，末站 8 件、仅剩约 5 格——必丢 3 件。 */
interface PrologueStop {
  readonly title: string;
  readonly text: string;
  readonly drops: ReadonlyArray<{ resource: ResourceId; amount: number }>;
}

const PROLOGUE_STOPS: readonly PrologueStop[] = [
  {
    title: '路边超市废墟',
    text: '货架倒了，罐头滚了一地。能带走的都是你的。',
    drops: [{ resource: 'food', amount: 60 }],
  },
  {
    title: '抛锚的油罐车',
    text: '油箱还剩小半箱，车身钢板也能拆下来。',
    drops: [
      { resource: 'fuel', amount: 30 },
      { resource: 'material', amount: 40 },
    ],
  },
  {
    title: '社区诊所残骸',
    text: '药房抽屉没被翻干净，柜台底下还压着一箱弹盒。',
    drops: [
      { resource: 'medicine', amount: 20 },
      { resource: 'ammo', amount: 80 },
    ],
  },
  {
    title: '幸存者营地遗址',
    text: '物资堆还剩不少——但货舱就那么大。装什么、丢什么，从今天起就是你的日常。',
    drops: [
      { resource: 'food', amount: 50 },
      { resource: 'food', amount: 50 },
      { resource: 'material', amount: 50 },
      { resource: 'material', amount: 50 },
      { resource: 'ammo', amount: 100 },
      { resource: 'ammo', amount: 100 },
      { resource: 'medicine', amount: 20 },
      { resource: 'fuel', amount: 20 },
    ],
  },
];
