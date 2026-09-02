// SLICE_004：可复用的 4×3 货舱网格组件。
//
// 从 PrototypeScene 的货舱渲染/交互逻辑抽取，供两处复用：
//   - PrototypeScene（原货舱原型，行为不变）
//   - TravelScene 的节点面板（SLICE_004 抵达节点拾取装舱）
//
// 本层只负责表现：网格绘制、点选放置、合法格高亮、错误闪烁。
// 规则全部来自 core/trunk.ts，本组件不持有存档、不决定「装完之后」的事，
// 通过 onChange 回调把新的 TrunkState 交回宿主。

import { Color, Graphics, Label, Node, UITransform } from 'cc';
import {
  TrunkState,
  PlacedItem,
  TrunkItemDef,
  TRUNK_COLS,
  TRUNK_ROWS,
  TRUNK_CAPACITY,
  canPlace,
  itemDef,
  placeItem,
  removeItem,
  sizeToCell,
  usedCells,
} from '../core/trunk.ts';

export const CELL_SIZE = 150;
export const CELL_GAP = 6;
export const GRID_LEFT = -330;
export const GRID_TOP = 300;
export const TRUNK_W = TRUNK_COLS * CELL_SIZE + (TRUNK_COLS - 1) * CELL_GAP;
export const TRUNK_H = TRUNK_ROWS * CELL_SIZE + (TRUNK_ROWS - 1) * CELL_GAP;

export const ITEM_COLORS: Record<string, Color> = {
  food: new Color(111, 158, 92, 255),
  medicine: new Color(151, 91, 94, 255),
  fuel: new Color(207, 149, 50, 255),
  material: new Color(120, 130, 150, 255),
  ammo: new Color(168, 142, 78, 255),
  survivor: new Color(140, 110, 160, 255),
};

const HIGHLIGHT = new Color(90, 210, 130, 120);
const ERROR_FLASH = new Color(220, 80, 80, 180);
const CELL_IDLE = new Color(38, 43, 40, 255);

export interface TrunkGridOptions {
  /** 缩放整个网格节点（节点面板里空间更紧）。 */
  readonly scale?: number;
  /** 初始货舱状态（存档载入用；缺省为空舱）。 */
  readonly initialState?: TrunkState;
  /** 空手点击已放置物品时整组移除（节点面板的「取回」交互；原型模式不开）。 */
  readonly removeOnTap?: boolean;
  /** 放置/移除成功后回调（reason 仅失败时有值；itemId 为本次涉及的物品）。 */
  readonly onChange?: (state: TrunkState, ok: boolean, reason?: string, itemId?: string) => void;
  /** removeOnTap 移除成功后回调，amount 为移除数量（候选卡按数还原用）。 */
  readonly onItemRemoved?: (itemId: string, amount: number) => void;
}

export class TrunkGrid {
  readonly root: Node;
  private readonly defs: readonly TrunkItemDef[];
  private readonly options: TrunkGridOptions;
  private readonly cellNodes: Node[] = [];
  private trunk: TrunkState;
  private selectedItem: string | null = null;

  constructor(parent: Node, defs: readonly TrunkItemDef[], options: TrunkGridOptions = {}) {
    this.defs = defs;
    this.options = options;
    this.trunk = this.options.initialState ?? createEmpty();
    this.root = new Node('TrunkGrid');
    this.root.setParent(parent);
    if (options.scale !== undefined && options.scale !== 1) {
      this.root.setScale(options.scale, options.scale, 1);
    }
    this.buildCells();
    this.refreshAll();
  }

  get state(): TrunkState {
    return this.trunk;
  }

  get selected(): string | null {
    return this.selectedItem;
  }

  get usedCellsCount(): number {
    return usedCells(this.trunk, this.defs);
  }

  /** 恢复到给定状态（存档载入/清空后调用）。 */
  setState(state: TrunkState): void {
    this.trunk = state;
    this.selectedItem = null;
    this.refreshAll();
  }

  /** 点选候选物资（宿主的候选卡点击转发到这里）。 */
  selectCandidate(itemId: string | null): void {
    this.selectedItem = this.selectedItem === itemId ? null : itemId;
    this.refreshHighlight();
  }

  private buildCells(): void {
    for (let y = 0; y < TRUNK_ROWS; y++) {
      for (let x = 0; x < TRUNK_COLS; x++) {
        const cell = new Node(`Cell-${x}-${y}`);
        cell.setParent(this.root);
        cell.setPosition(
          GRID_LEFT + x * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
          GRID_TOP - y * (CELL_SIZE + CELL_GAP) - CELL_SIZE / 2,
          0,
        );
        cell.addComponent(UITransform).setContentSize(CELL_SIZE, CELL_SIZE);
        const g = cell.addComponent(Graphics);
        this.paintCell(g, CELL_IDLE);
        cell.on(Node.EventType.TOUCH_END, () => this.onCellClick(cell));
        this.cellNodes.push(cell);
      }
    }
  }

  private onCellClick(cell: Node): void {
    const match = /Cell-(\d+)-(\d+)/.exec(cell.name);
    if (match === null) {
      return;
    }
    const x = Number(match[1]);
    const y = Number(match[2]);
    const idx = y * TRUNK_COLS + x;
    // 空手点击已放置物品 → 整组移除（取回交互）
    if (this.selectedItem === null && this.options.removeOnTap === true) {
      const occupant = this.trunk.grid[idx];
      if (occupant !== null) {
        const removed = removeItem(this.trunk, occupant);
        this.trunk = removed.state;
        this.options.onItemRemoved?.(occupant, removed.removed);
        this.options.onChange?.(this.trunk, true, undefined, occupant);
        this.refreshAll();
      }
      return;
    }
    if (this.selectedItem === null) {
      return;
    }
    const placedItemId = this.selectedItem;
    const result = placeItem(this.trunk, this.defs, placedItemId, x, y);
    if (result.ok) {
      this.trunk = result.state;
      this.selectedItem = null;
      this.options.onChange?.(this.trunk, true, undefined, placedItemId);
      this.refreshAll();
    } else {
      this.flashCell(cell);
      this.options.onChange?.(this.trunk, false, result.reason);
    }
  }

  private paintCell(g: Graphics, color: Color): void {
    g.clear();
    g.fillColor = color;
    g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, CELL_SIZE, CELL_SIZE, 10);
    g.fill();
  }

  /** 清空网格图形，重绘已放置物品。 */
  private refreshAll(): void {
    for (const cell of this.cellNodes) {
      const g = cell.getComponent(Graphics);
      if (g !== null) {
        this.paintCell(g, CELL_IDLE);
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
    this.refreshHighlight();
  }

  private drawItem(item: PlacedItem): void {
    const def = itemDef(this.defs, item.itemId);
    const [w, h] = sizeToCell(def.size);
    const cellNode = this.cellNodes[item.y * TRUNK_COLS + item.x] ?? null;
    if (cellNode === null) {
      return;
    }
    const g = cellNode.getComponent(Graphics);
    if (g === null) {
      return;
    }
    const width = CELL_SIZE * w + CELL_GAP * (w - 1);
    const height = CELL_SIZE * h + CELL_GAP * (h - 1);
    g.fillColor = ITEM_COLORS[def.id] ?? new Color(150, 150, 150, 255);
    g.roundRect(-CELL_SIZE / 2, -CELL_SIZE / 2, width, height, 10);
    g.fill();
    g.strokeColor = new Color(240, 228, 201, 255);
    g.lineWidth = 2;
    g.rect(-CELL_SIZE / 2, -CELL_SIZE / 2, width, height);
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

  private refreshHighlight(): void {
    for (const cell of this.cellNodes) {
      const match = /Cell-(\d+)-(\d+)/.exec(cell.name);
      const g = cell.getComponent(Graphics);
      if (match === null || g === null) {
        continue;
      }
      const x = Number(match[1]);
      const y = Number(match[2]);
      const idx = y * TRUNK_COLS + x;
      // 若格子上已有物品，不高亮
      if (this.trunk.grid[idx] !== null) {
        continue;
      }
      const on = this.selectedItem !== null && canPlace(this.trunk, this.defs, this.selectedItem, x, y);
      this.paintCell(g, on ? HIGHLIGHT : CELL_IDLE);
    }
  }

  private flashCell(cell: Node): void {
    const g = cell.getComponent(Graphics);
    if (g === null) {
      return;
    }
    this.paintCell(g, ERROR_FLASH);
    // 短暂展示错误色后恢复网格绘制
    const schedule = cell.scheduleOnce.bind(cell);
    schedule(() => {
      this.refreshAll();
    }, 0.3);
  }
}

function createEmpty(): TrunkState {
  return {
    version: 1,
    grid: Array.from({ length: TRUNK_CAPACITY }, () => null),
    items: [],
  };
}
