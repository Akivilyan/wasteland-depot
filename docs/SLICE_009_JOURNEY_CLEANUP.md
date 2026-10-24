# SLICE_009 横轴卷轴探索 + 旧模型清理

> 目标：探索屏从列表占位升级为横轴卷轴演出（SLICE_003 手感资产的区域制版本），
> 并删除旧十日模型全部文件（规则层五件 + 表现层三件 + 旧测试），代码库单一模型。

## 范围

- 新增 `presentation/RegionJourney.ts`：视差双滚动卷轴（中景剪影 + 近景路面）、车辆图形（颠簸 tween）、六区氛围色、跳过按钮；`playLeg(onDone, returning)` 播完回调，跳过同样继续流程。
- RegionalScene 探索屏改造：卷轴为底 + 悬浮操作排（货舱/推进/返程）；推进与返程先播卷轴再结算；货舱网格挪入弹层。
- 旧模型删除（git 历史与 SLICE_001~006 文档保留全部知识）：
  - core：`sim.ts`/`game.ts`/`route.ts`/`loot.ts`/`trunk.ts`/`prototype-state.ts`/`constants.ts`/`scenario.ts`（ALL_SAVE_KEYS 迁至 `state.ts`）
  - presentation：`PrototypeScene.ts`/`TravelScene.ts`/`TrunkGrid.ts`
  - tests：sim/game/route/loot/trunk/prototype-state/scenario 七个旧测试
  - `tools/doctor.sh`/`tools/verify-project.mjs` 引用同步（断言 RegionalScene uuid）

## 自动验证

- `npm run verify` 全绿：38 测试（区域制 31 + rng 7）、typecheck、场景断言、边界护栏（core 10 / presentation 3 文件）。
- 微信构建通过。

## 人工验收（CDP 冒烟）

- 全链：pickHero → buildMap ✓ → onTierConfirmed('food','outer') 建立探索（去程 day 1→2、不扣食油）✓ → onAdvance 触发卷轴（busy）→ 1.6s 后节点结算（day→3、food 10→8 扣 1 人×2、nodes=1、节点弹层打开）✓；
- CDP 采集 0 JS 错误（2 条 warning 为模拟器噪音）。
- 卷轴视觉/节奏手感待财哥人工过目（可跳过按钮已备）。

## 结果

PASS（2026-10-24）。
