import {
  _decorator,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  ResolutionPolicy,
  UITransform,
  view,
} from 'cc';
import {
  createTrunkState,
  TrunkState,
  itemDef,
  TRUNK_CAPACITY,
  encodeTrunkState,
  decodeTrunkState,
  DEFAULT_ITEM_DEFS,
  TrunkItemDef,
} from '../core/trunk.ts';
import { createStoragePort, StoragePort } from '../platform/storage.ts';
import {
  TrunkGrid,
  ITEM_COLORS,
  TRUNK_W,
  TRUNK_H,
} from './TrunkGrid.ts';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;
const SAVE_KEY = 'wasteland-depot.trunk.v1';

@ccclass('PrototypeScene')
export class PrototypeScene extends Component {
  private readonly storage: StoragePort = createStoragePort();
  private trunk: TrunkState = createTrunkState();
  private grid: TrunkGrid | null = null;
  private statusLabel: Label | null = null;
  private capacityLabel: Label | null = null;

  start(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.trunk = decodeTrunkState(this.storage.get(SAVE_KEY));
    this.buildInterface();
    this.setStatus(`已载入 · ${this.storage.name}`);
  }

  private buildInterface(): void {
    const bg = new Node('Background');
    bg.setParent(this.node);
    bg.addComponent(UITransform).setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    const bgGraphics = bg.addComponent(Graphics);
    bgGraphics.fillColor = new Color(27, 31, 29, 255);
    bgGraphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    bgGraphics.fill();

    this.createLabel('Title', '末班车：废土仓库', 0, 590, 44, new Color(225, 213, 183, 255));
    this.createLabel('Subtitle', '货舱 · 点选物资再点格子放置', 0, 540, 22, new Color(159, 166, 151, 255));

    // 货舱面板（网格渲染与交互由可复用 TrunkGrid 承担）
    const trunkPanel = new Node('Trunk');
    trunkPanel.setParent(this.node);
    trunkPanel.setPosition(0, 150, 0);
    this.createPanelBackground(trunkPanel, TRUNK_W + 40, TRUNK_H + 90, new Color(55, 62, 57, 255));

    this.capacityLabel = this.createLabel(
      'Capacity',
      '',
      0,
      TRUNK_H / 2 + 55,
      22,
      new Color(225, 213, 183, 255),
      trunkPanel,
    );

    this.grid = new TrunkGrid(trunkPanel, DEFAULT_ITEM_DEFS, {
      initialState: this.trunk,
      onChange: (state, ok, reason) => this.onGridChange(state, ok, reason),
    });
    // 候选物资区（可横向滚动由表现层简化：放 5 张卡）
    this.cargoArea = new Node('CargoArea');
    this.cargoArea.setParent(this.node);
    this.cargoArea.setPosition(0, -400, 0);
    const cargoBg = new Node('CargoBg');
    cargoBg.setParent(this.cargoArea);
    cargoBg.addComponent(UITransform).setContentSize(720, 160);
    const cg = cargoBg.addComponent(Graphics);
    cg.fillColor = new Color(47, 52, 49, 255);
    cg.roundRect(-360, -80, 720, 160, 14);
    cg.fill();

    // 候选物资：食物、药品、燃油、材料、弹药
    const candidates = ['food', 'medicine', 'fuel', 'material', 'ammo'];
    candidates.forEach((id, i) => {
      const def = itemDef(DEFAULT_ITEM_DEFS, id);
      const x = -260 + i * 130;
      this.createCandidateCard(def, x, 0);
    });

    // 操作按钮
    this.createButton('Clear', '清空货舱', 0, -585, () => {
      this.trunk = createTrunkState();
      this.grid?.setState(this.trunk);
      this.persist('货舱已清空');
    });

    this.statusLabel = this.createLabel('Status', '', 0, -660, 20, new Color(137, 151, 134, 255));
  }

  private cargoArea: Node | null = null;

  private onGridChange(state: TrunkState, ok: boolean, reason?: string, itemId?: string): void {
    if (ok) {
      this.trunk = state;
      const label = itemId !== undefined
        ? itemDef(DEFAULT_ITEM_DEFS, itemId).label
        : '物资';
      this.persist(`${label}已装入货舱`);
    } else {
      this.setStatus(`${reason ?? '放置失败'}`);
    }
  }

  private createCandidateCard(def: TrunkItemDef, x: number, y: number): void {
    if (this.cargoArea === null) return;
    const card = new Node(`Cargo-${def.id}`);
    card.setParent(this.cargoArea);
    card.setPosition(x, y, 0);
    card.addComponent(UITransform).setContentSize(100, 100);
    // Graphics 与 Label 不能同节点（Cocos 禁止挂两个渲染组件），文字放子节点
    const g = card.addComponent(Graphics);
    g.fillColor = ITEM_COLORS[def.id] ?? new Color(150, 150, 150, 255);
    g.roundRect(-50, -50, 100, 100, 10);
    g.fill();
    const labelNode = new Node(`CargoLabel-${def.id}`);
    labelNode.setParent(card);
    labelNode.addComponent(UITransform).setContentSize(100, 100);
    const label = labelNode.addComponent(Label);
    label.string = def.label;
    label.fontSize = 20;
    label.lineHeight = 24;
    label.color = new Color(250, 244, 226, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    // 点选候选物资 → 转发给 TrunkGrid
    card.on(Node.EventType.TOUCH_END, () => {
      this.grid?.selectCandidate(def.id);
      const selected = this.grid?.selected ?? null;
      if (selected !== null) {
        this.setStatus(`已选择：${def.label}，点击货舱空位放置`);
      } else {
        this.setStatus('已取消选择');
      }
    });
  }

  private persist(message: string): void {
    this.storage.set(SAVE_KEY, encodeTrunkState(this.trunk));
    this.refreshCapacity();
    this.setStatus(`${message} · 已保存`);
  }

  private refreshCapacity(): void {
    const used = this.grid?.usedCellsCount ?? 0;
    if (this.capacityLabel !== null) {
      this.capacityLabel.string = `已用 ${used} / ${TRUNK_CAPACITY} 格`;
    }
  }

  private createPanelBackground(parent: Node, w: number, h: number, color: Color): void {
    const panel = new Node('Panel');
    panel.setParent(parent);
    panel.setPosition(0, 0, -1);
    panel.addComponent(UITransform).setContentSize(w, h);
    const g = panel.addComponent(Graphics);
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, 14);
    g.fill();
  }

  private createButton(name: string, text: string, x: number, y: number, onClick: () => void): void {
    const btn = new Node(name);
    btn.setParent(this.node);
    btn.setPosition(x, y, 0);
    btn.addComponent(UITransform).setContentSize(260, 60);
    const g = btn.addComponent(Graphics);
    g.fillColor = new Color(92, 76, 60, 255);
    g.roundRect(-130, -30, 260, 60, 12);
    g.fill();
    // 按钮文字放子节点（Graphics 与 Label 不能同节点）
    const labelNode = new Node(`${name}Label`);
    labelNode.setParent(btn);
    labelNode.addComponent(UITransform).setContentSize(260, 60);
    const label = labelNode.addComponent(Label);
    label.string = text;
    label.fontSize = 24;
    label.lineHeight = 28;
    label.color = new Color(240, 228, 201, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    btn.on(Node.EventType.TOUCH_END, onClick);
  }

  private createLabel(
    name: string,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    color: Color,
    parent?: Node,
  ): Label {
    const target = parent ?? this.node;
    const labelNode = new Node(name);
    labelNode.setParent(target);
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

  private setStatus(message: string): void {
    if (this.statusLabel !== null) {
      this.statusLabel.string = message;
    }
  }
}
