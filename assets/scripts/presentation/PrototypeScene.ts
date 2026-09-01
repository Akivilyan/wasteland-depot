import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  Label,
  Node,
  ResolutionPolicy,
  UITransform,
  Vec2,
  Vec3,
  view,
} from 'cc';
import {
  createInitialState,
  decodePrototypeState,
  encodePrototypeState,
  ItemId,
  ITEM_IDS,
  placeItem,
  PrototypeState,
  TRUNK_SLOT_COUNT,
} from '../core/prototype-state';
import { createStoragePort, StoragePort } from '../platform/storage';

const { ccclass } = _decorator;
const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1334;
const SAVE_KEY = 'wasteland-depot.prototype.v1';
const SLOT_X = [-210, 0, 210] as const;
const SLOT_Y = 90;

const ITEM_STYLE: Record<ItemId, { label: string; color: Color }> = {
  fuel: { label: '燃油', color: new Color(207, 149, 50, 255) },
  food: { label: '食物', color: new Color(111, 158, 92, 255) },
  medicine: { label: '药品', color: new Color(151, 91, 94, 255) },
};

@ccclass('PrototypeScene')
export class PrototypeScene extends Component {
  private readonly storage: StoragePort = createStoragePort();
  private readonly cards = new Map<ItemId, Node>();
  private readonly homePositions = new Map<ItemId, Vec3>();
  private state: PrototypeState = createInitialState();
  private trunk: Node | null = null;
  private statusLabel: Label | null = null;

  start(): void {
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.FIXED_WIDTH);
    this.node.getComponent(UITransform)?.setContentSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    this.state = decodePrototypeState(this.storage.get(SAVE_KEY));
    this.buildInterface();
    this.layoutCards();
    this.setStatus(`已载入 · ${this.storage.name}`);
  }

  private buildInterface(): void {
    this.createPanel('Background', 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, new Color(27, 31, 29, 255));
    this.createLabel('Title', '末班车：废土仓库', 0, 560, 48, new Color(225, 213, 183, 255));
    this.createLabel('Subtitle', '技术探路版 · 把物资拖进后备箱', 0, 505, 24, new Color(159, 166, 151, 255));

    this.trunk = this.createPanel('Trunk', 0, SLOT_Y, 650, 360, new Color(55, 62, 57, 255));
    const trunkGraphics = this.trunk.getComponent(Graphics);
    if (trunkGraphics !== null) {
      trunkGraphics.strokeColor = new Color(150, 139, 111, 255);
      trunkGraphics.lineWidth = 3;
      trunkGraphics.rect(-325, -180, 650, 360);
      trunkGraphics.moveTo(-108, -180);
      trunkGraphics.lineTo(-108, 180);
      trunkGraphics.moveTo(108, -180);
      trunkGraphics.lineTo(108, 180);
      trunkGraphics.stroke();
    }
    this.createLabel('TrunkTitle', '车辆后备箱 · 3 格载重', 0, 315, 28, new Color(225, 213, 183, 255));

    ITEM_IDS.forEach((item, index) => {
      const home = new Vec3(-240 + index * 240, -355, 0);
      this.homePositions.set(item, home);
      this.cards.set(item, this.createCard(item, home));
    });

    const reset = this.createPanel('Reset', 0, -555, 280, 72, new Color(92, 76, 60, 255));
    const resetLabel = this.createLabel('ResetText', '清空后备箱', 0, -555, 26, new Color(240, 228, 201, 255));
    resetLabel.node.setParent(reset);
    resetLabel.node.setPosition(0, 0, 0);
    reset.on(Node.EventType.TOUCH_END, () => {
      this.storage.remove(SAVE_KEY);
      this.state = createInitialState();
      this.layoutCards();
      this.setStatus('存档已清空');
    });

    this.statusLabel = this.createLabel('Status', '', 0, -635, 20, new Color(137, 151, 134, 255));
  }

  private createCard(item: ItemId, home: Vec3): Node {
    const style = ITEM_STYLE[item];
    const card = this.createPanel(`Item-${item}`, home.x, home.y, 190, 150, style.color);
    this.createLabel(`ItemLabel-${item}`, style.label, home.x, home.y + 8, 30, new Color(250, 244, 226, 255));
    const itemLabel = this.node.getChildByName(`ItemLabel-${item}`);
    itemLabel?.setParent(card);
    itemLabel?.setPosition(0, 8, 0);

    card.on(Node.EventType.TOUCH_START, () => {
      if (card.parent !== null) {
        card.setSiblingIndex(card.parent.children.length - 1);
      }
    });
    card.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => this.moveCard(card, event));
    card.on(Node.EventType.TOUCH_END, (event: EventTouch) => this.dropCard(item, event));
    card.on(Node.EventType.TOUCH_CANCEL, () => this.layoutCards());
    return card;
  }

  private moveCard(card: Node, event: EventTouch): void {
    const canvasTransform = this.node.getComponent(UITransform);
    if (canvasTransform === null) {
      return;
    }
    const location = event.getUILocation();
    const local = canvasTransform.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
    card.setPosition(local);
  }

  private dropCard(item: ItemId, event: EventTouch): void {
    const trunkTransform = this.trunk?.getComponent(UITransform);
    if (trunkTransform === null || trunkTransform === undefined) {
      this.layoutCards();
      return;
    }

    const location = event.getUILocation();
    if (!trunkTransform.getBoundingBoxToWorld().contains(new Vec2(location.x, location.y))) {
      this.state = this.removeFromTrunk(item);
      this.persist('物资已移出后备箱');
      return;
    }

    const canvasTransform = this.node.getComponent(UITransform);
    if (canvasTransform === null) {
      return;
    }
    const local = canvasTransform.convertToNodeSpaceAR(new Vec3(location.x, location.y, 0));
    const slot = Math.max(0, Math.min(TRUNK_SLOT_COUNT - 1, Math.floor((local.x + 325) / (650 / TRUNK_SLOT_COUNT))));
    this.state = placeItem(this.state, item, slot);
    this.persist(`${ITEM_STYLE[item].label}已放入第 ${slot + 1} 格`);
  }

  private removeFromTrunk(item: ItemId): PrototypeState {
    return {
      version: 1,
      trunkSlots: this.state.trunkSlots.map((current) => current === item ? null : current),
    };
  }

  private persist(message: string): void {
    this.storage.set(SAVE_KEY, encodePrototypeState(this.state));
    this.layoutCards();
    this.setStatus(`${message} · 已保存`);
  }

  private layoutCards(): void {
    ITEM_IDS.forEach((item) => {
      const card = this.cards.get(item);
      if (card === undefined) {
        return;
      }
      const slot = this.state.trunkSlots.indexOf(item);
      card.setPosition(slot >= 0 ? new Vec3(SLOT_X[slot] ?? 0, SLOT_Y, 0) : this.homePositions.get(item) ?? Vec3.ZERO);
    });
  }

  private createPanel(name: string, x: number, y: number, width: number, height: number, color: Color): Node {
    const panel = new Node(name);
    panel.setParent(this.node);
    panel.setPosition(x, y, 0);
    panel.addComponent(UITransform).setContentSize(width, height);
    const graphics = panel.addComponent(Graphics);
    graphics.fillColor = color;
    graphics.roundRect(-width / 2, -height / 2, width, height, 14);
    graphics.fill();
    return panel;
  }

  private createLabel(name: string, text: string, x: number, y: number, fontSize: number, color: Color): Label {
    const labelNode = new Node(name);
    labelNode.setParent(this.node);
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
