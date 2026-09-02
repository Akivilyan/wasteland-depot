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
  PlacedItem,
  TRUNK_COLS,
  TRUNK_ROWS,
  TRUNK_CAPACITY,
  cellIndex,
  sizeToCell,
  itemDef,
  placeItem,
  removeItem,
  moveItem,
  firstFreeSpot,
  canPlace,
  usedCells,
  encodeTrunkState,
  decodeTrunkState,
  DEFAULT_ITEM_DEFS,
  TrunkItemDef,
} from '../core/trunk.ts';
import { createStoragePort, StoragePort } from '../platform/storage.ts';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;
const SAVE_KEY = 'wasteland-depot.trunk.v1';

// 货舱网格几何
const CELL_SIZE = 150;
const CELL_GAP = 6;
const GRID_LEFT = -330;
const GRID_TOP = 300;
const TRUNK_W = TRUNK_COLS * CELL_SIZE + (TRUNK_COLS - 1) * CELL_GAP;
const TRUNK_H = TRUNK_ROWS * CELL_SIZE + (TRUNK_ROWS - 1) * CELL_GAP;

const ITEM_COLORS: Record<string, Color> = {
  food: new Color(111, 158, 92, 255),
  medicine: new Color(151, 91, 94, 255),
  fuel: new Color(207, 149, 50, 255),
  material: new Color(120, 130, 150, 255),
  survivor: new Color(140, 110, 160, 255),
};

const HIGHLIGHT = new Color(90, 210, 130, 120);
const ERROR_FLASH = new Color(220, 80, 80, 180);

@ccclass('PrototypeScene')
export class PrototypeScene extends Component {
  private readonly storage: StoragePort = createStoragePort();
  private trunk: TrunkState = createTrunkState();
  private selectedItem: string | null = null;
  private cargoArea: Node | null = null;
  private statusLabel: Label | null = null;
  private capacityLabel: Label | null = null;
  private cellNodes: Node[] = [];

  start(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.trunk = decodeTrunkState(this.storage.get(SAVE_KEY));
    this.buildInterface();
    this.refreshAll();
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

    // 货舱面板
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

    // 网格
    for (let y = 0; y < TRUNK_ROWS; y++) {
      for (let x = 0; x < TRUNK_COLS; x++) {
        const cell = new Node(`Cell-${x}-${y}`);
        cell.setParent(trunkPanel);
        cell.setPosition(GRID_LEFT + x * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2, GRID_TOP - y * (CELL_SIZE + CELL_GAP) - CELL_SIZE / 2, 0);
        cell.addComponent(UITransform).setContentSize(CELL_SIZE, CELL_SIZE);
        const g = cell.addComponent(Graphics);
        g.fillColor = new Color(38, 43, 40, 255);
        g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
        g.fill();
        cell.on(Node.EventType.TOUCH_END, () => this.onCellClick(cell));
        this.cellNodes.push(cell);
      }
    }

    // 候选物资区（可横向滚动由表现层简化：放 4~5 张卡）
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

    // 候选物资：食物、药品、燃油、材料、幸存者
    const candidates = ['food', 'medicine', 'fuel', 'material', 'survivor'];
    candidates.forEach((id, i) => {
      const def = itemDef(DEFAULT_ITEM_DEFS, id);
      const x = -260 + i * 130;
      this.createCandidateCard(def, x, 0);
    });

    // 操作按钮
    this.createButton('Clear', '清空货舱', 0, -585, () => {
      this.trunk = createTrunkState();
      this.persist('货舱已清空');
    });

    this.statusLabel = this.createLabel('Status', '', 0, -660, 20, new Color(137, 151, 134, 255));
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
    // 点选候选物资
    card.on(Node.EventType.TOUCH_END, () => {
      this.selectCandidate(def.id);
    });
  }

  private selectCandidate(itemId: string): void {
    if (this.selectedItem === itemId) {
      this.selectedItem = null;
      this.setStatus('已取消选择');
    } else {
      this.selectedItem = itemId;
      this.setStatus(`已选择：${itemDef(DEFAULT_ITEM_DEFS, itemId).label}，点击货舱空位放置`);
    }
    this.refreshHighlight();
  }

  private onCellClick(cell: Node): void {
    const name = cell.name;
    const match = /Cell-(\d+)-(\d+)/.exec(name);
    if (match === null || this.selectedItem === null) {
      return;
    }
    const x = Number(match[1]);
    const y = Number(match[2]);
    const def = itemDef(DEFAULT_ITEM_DEFS, this.selectedItem);
    const result = placeItem(this.trunk, DEFAULT_ITEM_DEFS, this.selectedItem, x, y);
    if (result.ok) {
      this.trunk = result.state;
      this.selectedItem = null;
      this.persist(`${def.label}已装入货舱`);
    } else {
      this.flashCell(cell);
      this.setStatus(`${result.reason ?? '放置失败'}（${def.label}）`);
    }
  }

  private refreshAll(): void {
    this.refreshGrid();
    this.refreshCapacity();
    this.refreshHighlight();
  }

  /** 清空网格图形，重绘已放置物品。 */
  private refreshGrid(): void {
    for (const cell of this.cellNodes) {
      const g = cell.getComponent(Graphics);
      if (g !== null) {
        g.clear();
        g.fillColor = new Color(38, 43, 40, 255);
        g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
        g.fill();
      }
      const labelNode = cell.getChildByName('ItemLabel');
      if (labelNode !== null) {
        // destroy 是帧末延迟销毁；同帧 drawItem 会经 getChildByName 找回死节点复用，
        // 帧末被销毁导致标签消失。先立即脱离节点树再销毁。
        labelNode.removeFromParent();
        labelNode.destroy();
      }
    }
    for (const item of this.trunk.items) {
      this.drawItem(item);
    }
  }

  private drawItem(item: PlacedItem): void {
    const def = itemDef(DEFAULT_ITEM_DEFS, item.itemId);
    const [w, h] = sizeToCell(def.size);
    const cellNode = this.cellNodeAt(item.x, item.y);
    if (cellNode === null) return;
    const g = cellNode.getComponent(Graphics);
    if (g === null) return;
    g.fillColor = ITEM_COLORS[def.id] ?? new Color(150, 150, 150, 255);
    g.roundRect(
      -CELL_SIZE / 2,
      -CELL_SIZE / 2,
      CELL_SIZE * w + CELL_GAP * (w - 1),
      CELL_SIZE * h + CELL_GAP * (h - 1),
      10,
    );
    g.fill();
    g.strokeColor = new Color(240, 228, 201, 255);
    g.lineWidth = 2;
    g.rect(
      -CELL_SIZE / 2,
      -CELL_SIZE / 2,
      CELL_SIZE * w + CELL_GAP * (w - 1),
      CELL_SIZE * h + CELL_GAP * (h - 1),
    );
    g.stroke();
    // 物品标签放子节点（Graphics 与 Label 不能同节点）
    let labelNode = cellNode.getChildByName('ItemLabel');
    if (labelNode === null) {
      labelNode = new Node('ItemLabel');
      labelNode.setParent(cellNode);
      labelNode.addComponent(UITransform).setContentSize(CELL_SIZE, CELL_SIZE);
    }
    let label = labelNode.getComponent(Label);
    if (label === null) {
      label = labelNode.addComponent(Label);
    }
    label.string = def.label;
    label.fontSize = 22;
    label.lineHeight = 26;
    label.color = new Color(250, 244, 226, 255);
    label.horizontalAlign = Label.HorizontalAlign.CENTER;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    // 多格物品标签居中于整个形状
    labelNode.setPosition((w - 1) * (CELL_SIZE + CELL_GAP) / 2, -(h - 1) * (CELL_SIZE + CELL_GAP) / 2, 0);
  }

  private refreshCapacity(): void {
    const used = usedCells(this.trunk, DEFAULT_ITEM_DEFS);
    if (this.capacityLabel !== null) {
      this.capacityLabel.string = `已用 ${used} / ${TRUNK_CAPACITY} 格`;
    }
  }

  private refreshHighlight(): void {
    if (this.selectedItem === null) {
      for (const cell of this.cellNodes) {
        this.setCellHighlight(cell, false);
      }
      return;
    }
    const def = itemDef(DEFAULT_ITEM_DEFS, this.selectedItem);
    for (const cell of this.cellNodes) {
      const match = /Cell-(\d+)-(\d+)/.exec(cell.name);
      if (match === null) continue;
      const x = Number(match[1]);
      const y = Number(match[2]);
      const can = canPlace(this.trunk, def, x, y);
      this.setCellHighlight(cell, can);
    }
  }

  private setCellHighlight(cell: Node, on: boolean): void {
    const g = cell.getComponent(Graphics);
    if (g === null) return;
    const idx = this.cellNodeIndex(cell);
    // 若格子上已有物品，不高亮
    if (idx >= 0 && this.trunk.grid[idx] !== null) {
      return;
    }
    // Graphics 只渲染已发出的绘制指令，改色必须重绘才生效
    g.clear();
    g.fillColor = on ? HIGHLIGHT.clone() : new Color(38, 43, 40, 255);
    g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
    g.fill();
  }

  private flashCell(cell: Node): void {
    const g = cell.getComponent(Graphics);
    if (g === null) return;
    g.clear();
    g.fillColor = ERROR_FLASH.clone();
    g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
    g.fill();
    // 短暂展示错误色后恢复网格绘制
    this.scheduleOnce(() => {
      this.refreshGrid();
      this.refreshHighlight();
    }, 0.3);
  }

  private cellNodeAt(x: number, y: number): Node | null {
    const name = `Cell-${x}-${y}`;
    for (const cell of this.cellNodes) {
      if (cell.name === name) return cell;
    }
    return null;
  }

  private cellNodeIndex(cell: Node): number {
    return this.cellNodes.indexOf(cell);
  }

  private persist(message: string): void {
    this.storage.set(SAVE_KEY, encodeTrunkState(this.trunk));
    this.refreshAll();
    this.setStatus(`${message} · 已保存`);
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
