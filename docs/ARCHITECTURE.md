# 项目架构与技术约束

> 本文是**代码结构、分层边界、存档、复用清单**的唯一权威出处。
> 游戏愿景与内容范围见 [GAME_DESIGN.md](GAME_DESIGN.md)；
> 为什么这么定（选型/兼容的决策过程）见 [DECISIONS.md](DECISIONS.md)；
> 玩法数值与机制以 [GAME_DESIGN.md](GAME_DESIGN.md) 为唯一权威（单文档制，ADR-023）。

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
- **表现层**不自行修改规则数据：点击/拖拽最终都转换成规则层命令（如货舱统一走 `placeItem`），再通过回调把新状态交回。表现层不直接碰 `wx`（平台访问只走 platform 适配器）。
- **平台层**是唯一接触 `wx` 的地方，游戏通过适配接口（`StoragePort` 等）使用，不直接调微信 API。
- 边界由 `tools/verify-project.mjs` 在 `npm run verify` 时**静态强制，覆盖全部源文件**：core 任何文件出现 `from 'cc'` 或 `wx.` 即失败；presentation 任何文件出现 `wx.` 即失败。

首版保持纯 2D、竖屏、单机；不引入 3D、物理引擎、骨骼动画、联网或第三方运行时，除非有明确玩法需要（见 [DECISIONS.md](DECISIONS.md) ADR-001）。

## 2. 文件清单与职责

### 规则层 `assets/scripts/core/`

**区域制模型（现行，SLICE_007 起）**——机制常数唯一住 `config.ts`，结构化数据住 `regions.ts`/`hero.ts`/`events.ts`：

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `rng.ts` | 可种子随机源（Mulberry32），规则层所有随机的唯一入口（新旧模型共用） | `createRng`, `Rng` |
| `config.ts` | 区域制机制常数唯一集中地（GAME_DESIGN 全部数值） | `STOCK_CAP_BASE`, `FUEL_PER_NODE_DAY`, `WAVE_INTERVAL_DAYS`, `hpTierMultiplier` … |
| `regions.ts` | 六区域×三层、NPC 名册、节点流生成（5:2:2+保底）、搜刮/怪物掉落 | `REGIONS`, `NPCS`, `nextNodeRoll`, `rollScavenge`, `rollMonsterEncounter` |
| `hero.ts` | 主角四流派数据与掉落加成查询 | `HEROES`, `heroLootMultiplier` |
| `events.ts` | 区域随机事件池（V2 事件格式） | `EVENTS`, `pickEvent` |
| `hold.ts` | 货舱槽位模型：每格类型上限+同资源堆叠 | `loadResource`, `remainingCapacity`, `holdTotals` |
| `combat.ts` | 伤害管道（围墙→车→人）、守家波次构成、武器档案 | `applyDamagePipeline`, `waveComposition`, `weaponProfile` |
| `boss.ts` | boss 首杀掉落表（层地图+四零件绑定） | `layerBossDrop` |
| `state.ts` | GameState v2（长局）与存档编解码 | `GameState`, `RUN_SAVE_KEY`, `encodeGameState` |
| `run.ts` | **命令引擎唯一入口**：出发/节点/返程/日结/升级/修理/医疗/任务/招募/守家/终局 | `createNewGame`, `startExpedition`, `nextNode`, `endExpedition`, `applyExpeditionBattle`, `applyHomeBattle` … |

**旧十日模型已删除（SLICE_009，2026-10-24）**：sim/game/route/loot/trunk/prototype-state/constants(v1)/scenario 与表现层 PrototypeScene/TravelScene/TrunkGrid 一并退役；六切片验证的手感资产由区域制继承（占格→hold、卷轴→RegionJourney、事件面板→节点弹层、五资源账目→config）。历史知识见 git 与 SLICE_001~006 文档。

> **数据默认值集中**：区域制数值在 `config.ts`（+`regions.ts`/`events.ts` 结构化数据）；调参只改这三处 + 本文（数值真源见 [GAME_DESIGN.md](GAME_DESIGN.md)）。

### 表现层 `assets/scripts/presentation/`

| 文件 | 职责 |
| --- | --- |
| `RegionalScene.ts` | 挂在 `Prototype.scene` 的主场景组件（唯一挂载）：四选一 → 仓库 HUD → 大地图 → 三按钮层选择 → 探索（卷轴 + 节点弹层）→ 返程结算 → 终局画面；run.v2 存档读写、重开清 ALL_SAVE_KEYS；守家/终局暂为占位快速结算（SLICE_011 换实时战斗） |
| `RegionJourney.ts` | 横轴卷轴演出器：视差双滚动 + 车辆颠簸 + 六区氛围色 + 跳过；`playLeg(onDone, returning)`，跳过同样继续流程 |
| `ui-kit.ts` | 共用 UI 辅助：label/panel/button/bar/配色（表现层不写规则） |

### 平台层 `assets/scripts/platform/`

| 文件 | 职责 |
| --- | --- |
| `storage.ts` | `StoragePort` 适配：微信 `wx.*StorageSync` / 浏览器 `localStorage` / 内存回退，三端同一接口 |

## 3. 存档键位

全部走 `platform/storage.ts`，规则层只负责编解码。**键位的唯一登记处是 `core/state.ts` 的 `ALL_SAVE_KEYS`**（清档/迁移/排查工具遍历它，新增存档键必须在此登记）。

| 键 | 内容 | 编解码 | 读写方 |
| --- | --- | --- | --- |
| `wasteland-depot.run.v2` | 区域制长局 GameState（含探索会话） | `state.ts` | RegionalScene |
| v1 五键（save/trunk/trip/loot/trip-trunk） | 旧十日模型档位，**只剩清档语义** | 已随旧模型删除 | —（清档遍历 ALL_SAVE_KEYS） |

非法/损坏数据一律回退到初始空态，不抛错中断。探索会话内嵌 GameState（无半死相位）：载入后回到当前节点面板继续。

## 4. 复用官方能力，不重复造轮子

开发新能力前先查官方文档（Cocos 手册 / 微信小游戏文档）；已有的只写适配层，确认没有才在规则层自实现（且不得依赖 `cc`/`wx`）。

**直接用官方 / Cocos / 微信（只做适配，不自实现）：**

| 能力 | 来源 |
| --- | --- |
| 本地存档 | `wx.setStorageSync` / `localStorage`（已有 `platform/storage.ts`） |
| 激励视频广告 | `wx.createRewardedVideoAd`（广告须玩家主动触发，底线见 [GAME_DESIGN.md](GAME_DESIGN.md) §4；首版不做广告） |
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
