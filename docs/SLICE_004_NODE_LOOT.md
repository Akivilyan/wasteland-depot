# SLICE_004：抵达节点 → 候选物资 → 货舱取舍

> 状态：自动验证 ✅ 通过（2026-09-02，规则测试 + Web/微信构建 + CDP 全链路）；人工验收 ⏳ 待财哥确认手感。
> 本切片把「一次外出」真正闭环：选点 → 出发 → 卷轴 → 节点拾取装舱 → 返程 → 抵仓结算。

## 验证的问题

抵达地点后的战利品与装舱取舍是否成立：按地点倾向抽出候选物资，玩家在 4×3 货舱里取舍后返程，带回的货折算进库存，且整条链路确定性可复现。

## 范围（只做这些）

- 规则层 `core/loot.ts`：
  - `LOOT_TABLES`：每个地点按 `lean/guaranteed`（game.ts 已有）配权重表，条目 = 货舱物品 id（复用 trunk 的 `DEFAULT_ITEM_DEFS`，补 `ammo` 定义）。
  - `rollNodeLoot(locationId, rng)`：种子化抽取 4~6 件候选（保证至少 1 件 guaranteed）。
  - `LootState` 存档编解码（`wasteland-depot.loot.v1`），非法回退空态。
- 表现层：
  - 抽出 `presentation/TrunkGrid.ts`：把 PrototypeScene 的 4×3 货舱网格（渲染 + 点选放置 + 高亮）抽成可复用组件；PrototypeScene 改为使用它，行为不变。
  - TravelScene 的抵达占位面板替换为**节点面板**：上半屏候选物资卡（rollNodeLoot 生成），下半屏复用 TrunkGrid；点选候选 → 放入货舱，「取回候选」可反悔，「返程」锁定带走的货。
  - 返程抵仓后货舱物品结算进据点库存（本切片先计入 TravelScene 内部 fuel 数，GameState 打通留到 SLICE_005）。
- PrototypeScene / TravelScene 共存关系不变（Travel 覆盖其上）。

## 不做（明确排除）

- 与 sim.ts GameState 的真实打通（出发扣真实油、抵仓入库、advanceDay、危险度）→ SLICE_005。
- 幸存者/伤员入舱（trunk 规则已预留 2×2）。
- 节点重复探索限制、迷雾、多路线。
- 素材图（继续 Graphics 程序化绘制）。
- 道路事件（sim.choose）在行车途中触发。

## 实现文件

- 规则：`core/loot.ts`（加权抽取 + 地点倾向 + 存档），复用 `core/trunk.ts` 全部装舱命令。
- 表现：`presentation/TrunkGrid.ts`（新增可复用网格）、`presentation/TravelScene.ts`（节点面板 + 抵仓结算）。

## 库调研结论（开工前先查库）

| 候选 | 结论 | 原因 |
| --- | --- | --- |
| npm `@0xcap/loot-table` | 不用 | 2022 年停更，依赖 uuid（小程序包体积敏感） |
| npm `lootalot` | 不用 | 内部固定 `Math.random`，无法注入确定性 `Rng`，破坏同 seed 同结果 |
| npm `@manticorp/ultraloot` | 不用 | 661KB 过重，功能远超需求 |
| npm 通用 grid/table 库（ag-grid 等） | 不用 | DOM 表格组件，与 Cocos 渲染模型无关 |
| Cocos 官方 `Layout`/`ScrollView`/`TableView` | 已有规范可用 | 但无现成背包占格组件（见 [ARCHITECTURE.md](ARCHITECTURE.md) 复用清单） |
| 自研 `core/trunk.ts`（SLICE_002） | **复用** | 4×3 占格/堆叠/移动规则已就位 |

**结论：不引入任何新依赖。** 战利品生成 = 现有 `rng.ts`（Mulberry32）+ 新的轻量 `core/loot.ts`（加权抽取 + 地点倾向表）；拾取装舱 = 复用 `trunk.ts`。

## 验证结果

- `npm test`：loot.ts 新用例（权重分布、guaranteed 兜底、种子确定性、存档回退）+ 原有用例全绿（当前 62）。
- Web Mobile 构建：全链路 地图 → 出发 → 卷轴 → 节点面板拾取装舱 → 返程 → 回地图，抵仓后油量/货舱状态正确。
- 微信模拟器 CDP 驱动走通全链路，油量守恒对账无误（8 − 3 + 1 = 9），CDP 报错仅框架噪音。

### 验证中发现并修复

- 候选卡重建沿用 `destroy()` 会在同帧内新旧两棵 `LootCards` 并存（帧末才真正销毁），`getChildByName` 命中旧树导致「装了卡还在」的假象。改为先 `removeFromParent()` 立即脱离再 `destroy()`（与 PrototypeScene 同款手法）。
- atNode 相位中途退出/重载，存档恢复会自动重建节点面板并还原 loot/trunk 会话（模拟器已验证）。

## 人工验收

手感（节点面板布局、候选→装舱→取回的操作流畅度、抵仓结算反馈）待财哥在微信端确认；打开/编译/看控制台步骤同 [SLICE_002 人工验收](SLICE_002_TRUNK_UI.md#人工验收微信小游戏端)。

## 后续

SLICE_005：GameState 打通——出发扣油/弹药、抵仓入库、advanceDay、危险度；把 TravelScene 的 `setFuel()` 注入替换为真实库存。
