# SLICE_005：行程打通十日循环 GameState

> 状态：自动验证 ✅ 通过（2026-09-03，65 规则测试 + Web/微信构建 + 模拟器真实点击全链路）；人工验收 ⏳ 待财哥确认手感。
> 本切片把 SLICE_003/004 的「一次外出」从演出态接进 sim.ts 的权威 GameState：
> 出发扣真实油/弹药、抵仓入库、推进一天、危险度增长、存活结局与重开。

## 验证的问题

十日循环是否真正成立：地图上出发消耗的是据点真实库存（且与地图展示的里程油耗一致），带回来的货折算进 GameState，返程即推进一天并结算食物/危险度，第 10 天进入存活结局、可重开新局，全程存档可恢复。

## 范围（只做这些）

- 规则层：
  - `sim.startTrip` 出发油耗统一为 route.ts 里程模型（`legFuelCost`，即地图节点牌展示值：城郊 1 … 兵工厂 9），并拒绝不在 `DEPOT_ROUTE` 上的地点；弹药消耗沿用 `TRIP_AMMO_COST`。`vehicle.fuelCost` 保留为车辆属性，供司机职业/车辆升级未来消费。
  - `route.ts` 新增 `locationKm(id)`（不在路线上返回 null）。
  - `sim.returnHome` 移除「单位数 vs 格数」的载重复查——货舱流程的占格上限由 trunk 放置保证，抽象流程由 `loadCargo` 校验；新增 `cargoFromTrunk(trunk, defs)` 把货舱物品按物品定义的 resource 折算成入库清单。
  - `canAffordTrip` 对齐里程油耗 + 弹药 + 路线成员资格。
- 表现层 `TravelScene`：
  - 删除内部 `fuel`/`stock`/`setFuel()`/`stockSnapshot`；载入并持久化 `wasteland-depot.save.v1`（scenario 编解码，非法回退初始态）。
  - 出发：先 `sim.startTrip` 一次裁决（油+弹），再推进 route 相位机；抵仓：`returnHome` 入库 → `advanceDay`（食物消耗/危险度/结局）→ 回地图。
  - 地图标题显示 `第 X/10 天`；状态行显示 油/弹/食/危险度。
  - 结局面板（D1/D6 默认值：存活到第 10 天 = survived）：结局统计 + 「重新开始」清空全部存档并重载场景。
  - 「返回」中止行程 = 立即返仓：油弹不退、货舱照常入库、照常推进一天（清演出回调避免二次结算）。

## 不做（明确排除）

- 危险度影响具体结算（增长与展示已接，效果待 D5 拍板）。
- 道路事件（sim.choose）在行车途中触发 → SLICE_006。
- 幸存者/伤员入舱与招募（D4）。
- 多结局分支（D6）、最终目标变化（D1）。
- 素材图、多路线、迷雾。

## 实现文件

- 规则：`core/sim.ts`（startTrip/canAffordTrip/returnHome/cargoFromTrunk）、`core/route.ts`（locationKm）、`core/constants.ts`（fuelCost 语义注释）。
- 表现：`presentation/TravelScene.ts`（GameState 载入/持久化/结算/结局面板/重开）。
- 校验：`tools/verify-project.mjs`（新增 Map/Set 展开静态护栏，见下）。

## 验证结果

- `npm run verify`：65 用例全绿（新增：非路线地点拒绝、里程油耗、弹药不足、returnHome 单位数入库、cargoFromTrunk 折算）+ 静态边界与引擎模块校验通过。
- Web Mobile 构建 ✅；微信构建 ✅（构建后补丁七项幂等）。
- 微信模拟器回归（macOS 系统级真实点击 + CDP 读态断言，坐标由截图栅格两点校准）：
  - 基线：第 1 天 · 油 8 · 弹 6 · 食 8 · 危险 0。
  - 出发城郊：油 7、弹 5，`save.v1` 落盘（日志「出发前往 城郊（耗燃油 1、弹药 1）。」）。
  - 节点装舱：材料 2×1 色块正确画在货舱左上（多格渲染层级无回归）。
  - 返程结算：材料 4→5、食物 8-2=6、第 2 天、危险度 1，货舱/候选会话清空，地图标题「第 2/10 天」。
  - 结局路径：注入第 9 天存档 → 重启载入 → 打完最后一趟 → 第 10 天、`ending=survived`、结局面板渲染（结局·你活下来了 + 统计 + 重新开始）。
  - 重新开始：全部存档键清空，回到第 1 天初始态。
  - 控制台仅框架噪音（webapi_getwxaasyncsecinfo / HarmonyOS 提示 / shading scale，均为已归档条目），无我方代码报错。

## 验证中发现并修复（重要）

**微信构建错译 Map/Set 展开语法**（ADR-006）：Cocos 的 TS 降级编译把 `[...someMap]` 编成 `[].concat(someMap)`——concat 不展开 Map，得到 `[Map]` 而非条目数组。首轮回归中「抵仓入库」因此把材料折算成了 `{resource: undefined, amount: undefined}`（日志「带回 NaN 格物资」、stock 混入 `undefined` 键）。修复：

- `sim.cargoFromTrunk` 改用 `totals.forEach` 构造清单；`loot.weightedPick` 兜底路径的 `[...weights.keys()]` 同步清除（潜伏雷）。
- `tools/verify-project.mjs` 新增静态护栏：禁止对 Map/Set/`.keys()/.values()/.entries()` 用数组展开。
- 判读口径提醒：规则层 Node 测试跑在真实 JS 引擎上，**测不出这类构建错译**；凡涉及 Map/Set 的规则实现，必须在模拟器里过一遍行为回归。

另外：新运行时的 CDP `Input.dispatchTouchEvent` 与合成 DOM 事件均无法命中游戏（guest 无 DOM 监听、宿主 sendInputEvent 直穿渲染层）；本轮回归改用 macOS 系统级真实点击（computer-use）+ CDP 读态断言，链路最完整。`tools/cdp-eval.mjs` 的目标发现已兼容新旧两种运行时 URL。

## 人工验收

微信端手感：天数/危险度信息的可读性、结局面板观感、「重新开始」流程。打开/编译/看控制台步骤同 [SLICE_002 人工验收](SLICE_002_TRUNK_UI.md#人工验收微信小游戏端)。

## 后续

SLICE_006：道路事件接入行车途中——行车演出中按 `sim.choose`（game.ts 事件表）弹「信息 → 选择 → 后果」面板，后果落 GameState；事件池规模与清单属 D8 未拍板项，先用现有 6 个示例事件。
