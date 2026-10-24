// 表现层 UI 辅助件（区域制界面共用）。
//
// 只做绘制与节点装配：圆角面板、文字、按钮、全屏底。规则数据一律
// 由调用方从 core 命令取得；本文件不 import 任何规则模块。

import { Color, Graphics, Label, Node, UITransform } from 'cc';

export const COLOR_TEXT = new Color(225, 213, 183, 255);
export const COLOR_DIM = new Color(159, 166, 151, 255);
export const COLOR_BG = new Color(27, 31, 29, 255);
export const COLOR_PANEL = new Color(47, 52, 49, 255);
export const COLOR_PANEL_DARK = new Color(38, 42, 40, 255);
export const COLOR_PRIMARY = new Color(90, 170, 110, 255);
export const COLOR_DANGER = new Color(190, 84, 70, 255);
export const COLOR_WARNING = new Color(207, 149, 50, 255);
export const COLOR_DISABLED = new Color(70, 74, 72, 255);

export const RESOURCE_COLORS: Record<string, Color> = {
  fuel: new Color(196, 141, 52, 255),
  food: new Color(126, 176, 88, 255),
  material: new Color(148, 148, 158, 255),
  medicine: new Color(210, 96, 116, 255),
  ammo: new Color(120, 150, 200, 255),
};

export function createLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: Color,
  width = 680,
): Label {
  const labelNode = new Node(name);
  labelNode.setParent(parent);
  labelNode.setPosition(x, y, 0);
  labelNode.addComponent(UITransform).setContentSize(width, Math.max(fontSize * 2, fontSize * 1.6));
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

/** 左对齐标签（列表行用）。 */
export function createRowLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: Color,
  width: number,
): Label {
  const label = createLabel(parent, name, text, x, y, fontSize, color, width);
  label.horizontalAlign = Label.HorizontalAlign.LEFT;
  return label;
}

export function createPanel(
  parent: Node,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color = COLOR_PANEL,
  radius = 14,
): Node {
  const panel = new Node(name);
  panel.setParent(parent);
  panel.setPosition(x, y, 0);
  panel.addComponent(UITransform).setContentSize(width, height);
  const g = panel.addComponent(Graphics);
  g.fillColor = color;
  g.roundRect(-width / 2, -height / 2, width, height, radius);
  g.fill();
  return panel;
}

export function createBackdrop(parent: Node, name: string, width: number, height: number, color = COLOR_BG): Node {
  const bg = new Node(name);
  bg.setParent(parent);
  bg.addComponent(UITransform).setContentSize(width, height);
  const g = bg.addComponent(Graphics);
  g.fillColor = color;
  g.rect(-width / 2, -height / 2, width, height);
  g.fill();
  return bg;
}

export interface ButtonOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  color?: Color;
  disabled?: boolean;
}

/** 触摸按钮：Node + UITransform 命中 + 圆角底 + 文本。 */
export function createButton(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  onClick: () => void,
  options: ButtonOptions = {},
): Node {
  const width = options.width ?? 300;
  const height = options.height ?? 84;
  const button = createPanel(
    parent,
    name,
    x,
    y,
    width,
    height,
    options.disabled === true ? COLOR_DISABLED : (options.color ?? COLOR_PRIMARY),
    12,
  );
  createLabel(button, `${name}Label`, text, 0, 0, options.fontSize ?? 26, COLOR_TEXT, width - 16);
  if (options.disabled !== true) {
    button.on(Node.EventType.TOUCH_END, () => onClick());
  }
  return button;
}

/** 水平血条（当前/上限），返回可更新节点。 */
export function createBar(
  parent: Node,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  ratio: number,
  fillColor: Color,
): { root: Node; setRatio: (next: number) => void } {
  const root = createPanel(parent, name, x, y, width, height, COLOR_PANEL_DARK, 6);
  const fill = new Node(`${name}Fill`);
  fill.setParent(root);
  fill.addComponent(UITransform);
  const g = fill.addComponent(Graphics);
  const draw = (r: number): void => {
    g.clear();
    const clamped = Math.max(0, Math.min(1, r));
    if (clamped <= 0) return;
    g.fillColor = fillColor;
    g.roundRect(-width / 2 + 3, -height / 2 + 3, (width - 6) * clamped, height - 6, 4);
    g.fill();
  };
  draw(ratio);
  return { root, setRatio: draw };
}
