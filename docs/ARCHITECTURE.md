# 项目架构与技术约束

> 本文是**代码结构、分层边界、存档、复用清单**的唯一权威出处。
> 游戏愿景与内容范围见 [GAME_SKELETON.md](GAME_SKELETON.md)；
> 为什么这么定（选型/兼容的决策过程）见 [DECISIONS.md](DECISIONS.md)；
> 待拍板的产品项见 [PENDING_DECISIONS.md](PENDING_DECISIONS.md)。

## 1. 三层边界（硬约束）

```text
assets/scripts/core/          纯 TypeScript 游戏规则
        │  不 import `cc`，不碰 `wx`，全部纯函数、确定性、可 node 直测
        ▼
assets/scripts/presentation/  Cocos 表现与交互
        │  节点、组件、输入、动画、布局；只演出，不改规则
        ▼
assets/scripts/platform/      平台适配
           存储 / 广告 / 登录 / 分享 / 生命周期；`wx` 只能在这里出现
```

- **规则层**不依赖 Cocos 或微信 API，随机必须走 [rng.ts](../assets/scripts/core/rng.ts)（同 seed + 同操作序列 → 同结果）。
- **表现层**不自行修改规则数据：点击/拖拽最终都转换成规则层命令（如货舱统一走 `placeItem`），再通过回调把新状态交回。
- **平台层**是唯一接触 `wx` 的地方，游戏通过适配接口（`StoragePort` 等）使用，不直接调微信 API。
- 边界由 `tools/verify-project.mjs` 在 `npm run verify` 时**静态强制**：core 出现 `from 'cc'` 或 `wx.` 即失败。

首版保持纯 2D、竖屏、单机；不引入 3D、物理引擎、骨骼动画、联网或第三方运行时，除非有明确玩法需要（见 [DECISIONS.md](DECISIONS.md) ADR-001）。

## 2. 文件清单与职责

### 规则层 `assets/scripts/core/`

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `rng.ts` | 可种子随机源（Mulberry32），规则层所有随机的唯一入口 | `createRng`, `Rng` |
| `constants.ts` | **唯一允许出现玩法数字的地方**；初始资源、车辆、危险度、油耗、道路事件概率等默认值 | `GAME_DAYS`, `STARTING_RESOURCES`, `VEHICLE_DEFAULT`, `FINAL_DAY_INDEX`, `LEG_FUEL_PER_10KM`, `ROAD_EVENT_CHANCE` … |
| `game.ts` | 玩法数据与装配：五种资源、六个地点、四种职业、事件表与后果结算 | `RESOURCES`, `LOCATIONS`, `PROFESSIONS`, `createGameConfig`, `pickEvent`, `applyOutcome` |
| `sim.ts` | 十日核心循环引擎：出发/道路事件/装车/返程/推进一天，全部纯函数；出发油耗用 route 里程模型。事件拆为「抽取」与「结算」两命令，供表现层先展示再等选择 | `createInitialGameState`, `startTrip`, `drawRoadEvent`, `resolveEvent`, `loadCargo`, `returnHome`, `cargoFromTrunk`, `advanceDay` |
| `scenario.ts` | GameState 的存档编解码（底层存储复用 platform） | `SAVE_KEY`, `encodeGameState`, `decodeGameState` |
| `trunk.ts` | 车辆货舱 4×3 占格/堆叠/移动/交换规则（[INVENTORY_DESIGN.md](INVENTORY_DESIGN.md)） | `createTrunkState`, `canPlace`, `placeItem`, `moveItem`, `removeItem`, `encode/decodeTrunkState` |
| `route.ts` | 切片 003：单线公路骨架、里程油耗、行程相位机（map/driving/atNode/returning） | `DEPOT_ROUTE`, `legFuelCost`, `locationKm`, `depart`, `arrive`, `departReturn`, `backToMap`, `encode/decodeTripState` |
| `loot.ts` | 切片 004：按地点倾向加权抽取候选物资；装舱语义全部复用 trunk | `rollNodeLoot`, `takeLoot`, `putBackLoot`, `buildLootWeights`, `encode/decodeLootState` |
| `prototype-state.ts` | 切片 001 的三槽后备箱探针，**已被 trunk.ts 取代**；现仅留作最小边界样本（被 verify 脚本与自身测试引用），表现层不再使用 | `createInitialState`, `placeItem` |

> 数据默认值集中在 `constants.ts`；`game.ts` 也承载地点/事件/职业等**结构化数据**。拍板待决策项时，优先只改这两处（见 [PENDING_DECISIONS.md](PENDING_DECISIONS.md)）。

### 表现层 `assets/scripts/presentation/`

| 文件 | 职责 |
| --- | --- |
| `PrototypeScene.ts` | 挂在 `Prototype.scene` 的主组件；货舱原型界面（4×3 网格 + 候选卡 + 清空），读写 `trunk.v1` |
| `TravelScene.ts` | 切片 003/004/005/006：地图选点、横轴行车卷轴演出、**行车途中道路事件面板**（draw→暂停卷轴→选择→resolve→恢复）、节点抵达面板（候选物资 + 装舱）、返程抵仓结算（returnHome + advanceDay）、十日 GameState 的载入/持久化与结局面板；与 PrototypeScene 同场景共存（Travel 覆盖其上）。行车段计时全部走 tween（scheduleOnce 不随 tween 暂停），事件弹出时整组 pause/resume |
| `TrunkGrid.ts` | 切片 004 抽出的可复用 4×3 货舱网格（绘制 + 点选放置 + 高亮/闪烁）；PrototypeScene 与 TravelScene 共用，规则全部来自 `core/trunk.ts`，通过 `onChange` 回传新状态 |

### 平台层 `assets/scripts/platform/`

| 文件 | 职责 |
| --- | --- |
| `storage.ts` | `StoragePort` 适配：微信 `wx.*StorageSync` / 浏览器 `localStorage` / 内存回退，三端同一接口 |

## 3. 存档键位

全部走 `platform/storage.ts`，规则层只负责编解码。新增存档时在此登记。

| 键 | 内容 | 编解码 | 读写方 |
| --- | --- | --- | --- |
| `wasteland-depot.save.v1` | 十日循环 GameState（sim） | `scenario.ts` | TravelScene（SLICE_005 起） |
| `wasteland-depot.trunk.v1` | 货舱原型布局（trunk） | `trunk.ts` | PrototypeScene |
| `wasteland-depot.trip.v1` | 行程相位（route） | `route.ts` | TravelScene |
| `wasteland-depot.loot.v1` | 节点候选物资会话（loot） | `loot.ts` | TravelScene |
| `wasteland-depot.trip-trunk.v1` | 节点装舱中的货舱（trunk） | `trunk.ts` | TravelScene |

非法/损坏数据一律回退到初始空态，不抛错中断。

## 4. 复用官方能力，不重复造轮子

开发新能力前先查官方文档（Cocos 手册 / 微信小游戏文档）；已有的只写适配层，确认没有才在规则层自实现（且不得依赖 `cc`/`wx`）。

**直接用官方 / Cocos / 微信（只做适配，不自实现）：**

| 能力 | 来源 |
| --- | --- |
| 本地存档 | `wx.setStorageSync` / `localStorage`（已有 `platform/storage.ts`） |
| 激励视频广告 | `wx.createRewardedVideoAd`（广告须玩家主动触发，底线见 [GAME_SKELETON.md](GAME_SKELETON.md) 第 11 节） |
| 分享 / 登录 / 排行榜关系链 | `wx.shareAppMessage` / 微信登录 / 开放数据域 |
| UI 列表、滚动、布局、按钮、进度条 | Cocos `Layout` / `ScrollView` / `Button` / `ProgressBar` |
| 轻量动画（按钮反馈、物品移动、格子高亮） | Cocos `Tween` / `Animation` |
| 触摸 / 拖拽输入 | Cocos 触摸事件（命中检测用官方事件，不重写输入层） |

**必须自己实现（官方确认没有）：**

- 货舱占格、堆叠、拖拽的**规则语义**（Cocos 只有列表示例，无背包组件）→ `core/trunk.ts`。
- 十日循环、事件系统、地点/资源/职业数值与结算 → `core/sim.ts`、`core/game.ts`。
- 可种子随机源 → `core/rng.ts`。
- 战利品加权抽取 → `core/loot.ts`（npm 现成 loot 库均无法接入确定性 Rng，调研结论见 [SLICE_004](SLICE_004_NODE_LOOT.md)）。

判断流程：需要能力 → 查官方文档 → 已有则只用适配层 → 没有才写规则层实现 → 拿不准先记待办，不在不确定时从头造。

## 5. 构建、测试与微信兼容

- 常用命令与环境前置见 [README.md](../README.md)；agent 工作守则见 `.agents/skills/wasteland-depot-dev/SKILL.md`。
- 验证链 `npm run verify`：doctor（环境）→ **typecheck**（`tsconfig.check.json` 对业务代码 + 引擎声明全量类型检查，`temp/declarations` 未生成时跳过）→ node 规则测试 → 静态护栏。编辑器自身编译不构成命令行闸门，详见 [DECISIONS.md](DECISIONS.md) ADR-007。
- 规则测试在 `tests/*.test.mjs`（node 原生 `--test`，直接 import `core/*.ts`），改规则必须同步加/改测试。
- 微信新运行时兼容（`window`/`global`/`rAF` 缺失等）由 `tools/patch-wechat-deprecated.mjs` 在每次 `build:wechat` 后自动打七个幂等补丁；背景与对照实验见 [DECISIONS.md](DECISIONS.md) ADR-002。
- **禁用 Map/Set 展开语法**：微信构建会把 `[...map]` 错译成 `[].concat(map)`（得到 `[Map]`），由 `tools/verify-project.mjs` 静态护栏强制；Map/Set 一律用 `forEach`。见 [DECISIONS.md](DECISIONS.md) ADR-006。
- 引擎模块裁剪：Spine / DragonBones / Box2D 等保持关闭，`animation` / `tween` 保留，由 verify 脚本强制。
