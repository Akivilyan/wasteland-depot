# SLICE_008 区域地图与层选择 UI

> 目标：区域制主场景组件落位（RegionalScene 替换旧 PrototypeScene/TravelScene 挂载），
> 打通「四选一 → 仓库 HUD → 大地图 → 三按钮层选择 → 出发 → 探索占位 → 返程结算 → 存档」全链路。

## 范围

- 新增 `presentation/ui-kit.ts`（共用 UI 辅助：label/panel/button/bar/配色）与 `presentation/RegionalScene.ts`（主场景组件）。
- 场景挂载切换：Prototype.scene 的 Canvas 组件从 PrototypeScene+TravelScene 换为 RegionalScene（手写 .meta + 压缩 uuid，压缩算法已对 TravelScene 实测校验）；`tools/verify-project.mjs` 场景断言同步。
- 探索节点流为占位面板（列表式推进/节点弹层/货舱网格），横轴卷轴演出 SLICE_009 替换；战斗为占位快速结算（必胜、固定弹药账），实时战斗 SLICE_010/011 接入。
- 存档：RUN_SAVE_KEY 自动读写；重开清 ALL_SAVE_KEYS。

## 关键拍板（丧彪定）

- 主场景直接换血而非三组件并存：游戏启动即区域制 UI；旧组件文件保留（退役中，SLICE_009 复用卷轴代码后删除）。
- 节点弹层形态：搜刮（装舱/留现场）、事件（文案+选择+结果页）、怪物（牌面明示数量/生命/掉落/弹药 + 绕行/开战）、boss（必战）、NPC（自动接任务）——「牌面即真相」落实在弹层文案。
- 守家/终局占位按钮挂在仓库屏 pending 遮罩，SLICE_011 换实时战斗。

## 自动验证

- `npm run verify` 全绿（107 测试、typecheck、场景断言 RegionalScene、边界护栏 5 个表现层文件）。
- 微信构建通过（web-adapter WARN 为已知上游模板变化，非本次引入）。

## 人工验收（模拟器冒烟，CDP 断言）

- RegionalScene 挂载 ✓、旧组件解除 ✓、HeroPick 屏渲染 ✓；
- pickHero('captain') → Depot 屏（day 1 / fuel 10 / 乘员 1）✓；
- CDP 采集 0 JS 错误（2 条 warning 为模拟器噪音）。
- 视觉/手感验收待切片 009 卷轴接入后一并人工过。

## 结果

PASS（2026-10-24）。
