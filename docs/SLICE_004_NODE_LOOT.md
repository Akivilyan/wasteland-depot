# SLICE_004：抵达节点 → 候选物资 → 货舱取舍

> 状态：已实现并通过验证（2026-09-02）。规则层 62 测试全绿；Web Mobile 与微信构建均通过；
> 微信模拟器经 CDP 驱动走通全链路（选点 → 出发 → 卷轴 → 节点面板拾取/取回 → 返程 →
> 抵仓结算），油量守恒对账无误（8 − 3 + 1 = 9），CDP 报错仅框架噪音。手感待人工验收。

## 验证中发现的实现修正

- 候选卡重建沿用 `destroy()` 会在同帧内新旧两棵 `LootCards` 并存（帧末才真正销毁），
  `getChildByName` 命中旧树导致「装了卡还在」的假象。修正为与 PrototypeScene 同款手法：
  先 `removeFromParent()` 立即脱离再 `destroy()`。
- atNode 相位中途退出/重载，存档恢复路径会自动重建节点面板并还原
  loot/trunk 会话（已在模拟器验证）。

## 库调研结论（开工前完成，用户要求先查库）

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| npm `@0xcap/loot-table` | 不用 | 2022 年停更，依赖 uuid（小程序包体积敏感） |
| npm `lootalot` | 不用 | 内部固定 `Math.random`，无法注入项目确定性 `Rng`，破坏「同 seed 同结果」 |
| npm `@manticorp/ultraloot` | 不用 | 661KB 过重，功能远超需求 |
| npm 通用 grid/table 库（ag-grid 等） | 不用 | DOM 表格组件，与 Cocos 渲染模型无关 |
| Cocos 官方 `Layout`/`ScrollView`/`TableView` | 已有规范可用 | 但无现成背包占格组件（DECISIONS「必须自己实现」已确认） |
| 自研 `core/trunk.ts`（SLICE_002） | **复用** | 4×3 占格/堆叠/移动规则已就位，12 用例 |

**结论：不引入任何新依赖。** 战利品生成 = 现有 `rng.ts`（Mulberry32 可种子随机）+ 新的轻量 `core/loot.ts`（~150 行，加权抽取 + 地点倾向表）；拾取装舱 = 复用 `trunk.ts` 全部命令。

## 范围（只做这些）

- 规则层 `core/loot.ts`：
  - `LOOT_TABLES`：每个地点按 `lean/guaranteed`（game.ts 已有）配权重表，
    条目 = 货舱物品 id（复用 trunk 的 `DEFAULT_ITEM_DEFS`，补 `ammo` 定义）。
  - `rollNodeLoot(locationId, rng)`：种子化抽取 4~6 件候选物资（保证至少 1 件 guaranteed）。
  - `LootState` 存档编解码（`wasteland-depot.loot.v1`），非法回退空态。
- 表现层：
  - 抽取 `presentation/TrunkGrid.ts`：把 PrototypeScene 的 4×3 货舱网格
    （渲染 + 点选放置 + 高亮）抽成可复用组件；PrototypeScene 改为使用它，行为不变。
  - TravelScene 的 `showNodeArrival` 占位面板替换为**节点面板**：
    上半屏候选物资卡（由 rollNodeLoot 生成），下半屏复用 TrunkGrid，
    点选候选 → 放入货舱；「取回候选」按钮允许反悔；「返程」锁定带走的货。
  - 返程抵仓后，货舱物品结算进据点库存（本切片先计入 TravelScene 内部 fuel 数，
    GameState 打通留到切片 005）。
- PrototypeScene/TravelScene 共存关系保持不变（Travel 覆盖其上）。

## 不做（明确排除）

- 与 sim.ts GameState 的真实打通（出发扣油走真实库存、日推进、危险度）→ SLICE_005。
- 幸存者/伤员入舱（trunk 规则已预留 2×2）。
- 节点重复探索限制、迷雾、多路线。
- 素材图（继续 Graphics 程序化绘制）。
- 道路事件（sim.choose）在行车途中的触发。

## 验收

- `npm test`：loot.ts 新用例（权重分布、guaranteed 兜底、种子确定性、存档回退）
  + 原有 54 个全绿。
- Web Mobile 构建：全链路 地图 → 出发 → 卷轴 → 节点面板拾取装舱 → 返程 → 回地图，
  抵仓后油量/货舱状态正确。
- 微信模拟器 CDP 驱动走全链路，无游戏代码报错。

## 后续切片预告

- SLICE_005：GameState 打通——出发扣油/弹药、抵仓入库、advanceDay、危险度；
  把 TravelScene 的 `setFuel()` 注入替换为真实库存。
