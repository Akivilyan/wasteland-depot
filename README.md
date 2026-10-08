# 末班车：废土仓库

一款竖屏、纯 2D 的微信小游戏。玩家驾驶车辆外出搜集物资，在有限载荷中取舍，返回废弃仓库后分配资源、修复车辆并扩展下一次探索范围。核心乐趣是**有限载重下的取舍**，不是复杂战斗或内容堆量。

- 引擎：Cocos Creator 3.8.8（纯 2D、竖屏），TypeScript
- 平台：首发微信小游戏，PC 版延后
- Node.js 22+

## 快速开始

```bash
npm run doctor         # 环境体检（先跑这个排查环境问题）
npm run typecheck      # 全项目 TypeScript 类型检查（对引擎声明，tsconfig.check.json）
npm run verify         # 体检 + 类型检查 + 全部规则测试 + 边界/引擎模块静态校验
npm run build:web      # 构建 Web Mobile
npm run build:wechat   # 构建微信小游戏（构建后自动打兼容补丁）
npm run wechat:open    # 在微信开发者工具中打开
npm run wechat:preview # 生成真机预览二维码
```

本机路径可用 `COCOS_CREATOR_BIN`、`WECHAT_DEVTOOLS_CLI` 覆盖。Cocos 命令行构建需要 macOS 图形会话；微信 CLI 需先在开发者工具「设置 → 安全设置 → 服务端口」打开开关。类型检查依赖 Cocos 编辑器生成的 `temp/declarations`（编辑器打开过项目一次即可；未生成时 typecheck 自动跳过）。

测试：`npm test`（node 原生 `--test`，直接 import `assets/scripts/core/*.ts`，当前 76 个用例全绿）。

## 目录结构

```text
assets/scripts/
  core/           纯 TypeScript 游戏规则（不依赖 cc/wx，可 node 直测）
  presentation/   Cocos 表现与交互（场景、组件、输入、动画）
  platform/       平台适配（存储/广告/登录…，wx 只在这里出现）
assets/scenes/    Prototype.scene（竖屏主场景）
tests/            规则层测试（*.test.mjs）
tools/            构建、体检、校验、微信兼容补丁、CDP 回归脚本
docs/             设计与决策文档（见下）
```

每个 core/presentation 文件的职责、依赖方向、存档键位见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/GAME_SKELETON.md](docs/GAME_SKELETON.md) | 游戏愿景、核心循环、内容边界、广告底线、停车场（**游戏是什么**） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 三层边界、文件职责、存档键位、复用清单（**代码怎么组织**，权威出处） |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 已确认的技术/产品决策记录（ADR，**为什么这么定**） |
| [docs/VERIFY_CADENCE.md](docs/VERIFY_CADENCE.md) | 验证分层（T0~T3）与触发时机、阶段审核、任务卡规范、架构师/执行工分工（**何时跑哪层验证**，权威出处） |
| [docs/PENDING_DECISIONS.md](docs/PENDING_DECISIONS.md) | 待财哥/丧彪拍板的产品项与当前默认值 |
| [docs/INVENTORY_DESIGN.md](docs/INVENTORY_DESIGN.md) | 车辆货舱占格交互设计提案 |
| [docs/SLICE_00X_*.md](docs/) | 各开发切片的目标、范围、验证结果与人工验收状态 |

Agent 工作守则（命令、环境、回归方式）在 `.agents/skills/wasteland-depot-dev/SKILL.md`。

> 文档治理约定：每个文档一个职责、每条约束一个权威出处，新增约束先归位到下表对应文档（或新建 ADR），其余地方只链接不复制；切片文档是历史日志，活流程（如回归引导）必须独立成活文档。GDD 数值与机制的单一出处规则（ADR-015）：机制叙述只住 GAME_SKELETON、数值只住 PENDING D#（正文以「见 D#」指向）、ADR 只记「为什么」不复制现行数值（旧 ADR 历史数值不改，由后续 ADR 标 superseded）。例外：机制骨架常数（波次间隔、节点构成、倍率、门槛值等）允许在机制叙述中复述一次；成表的可调数值（伤害/耐久/成本/掉率等）仍只住 PENDING D#。

## 切片进度

每个切片独立可运行、只验证一个问题；**验证分层与触发时机见 [docs/VERIFY_CADENCE.md](docs/VERIFY_CADENCE.md)**（日常切片默认只跑 T0 `npm run verify`，模拟器回归与全项目审阅集中在阶段末）；自动验证与人工手感验收分开记录。

| 切片 | 内容 | 自动验证 | 人工验收 |
| --- | --- | --- | --- |
| [SLICE_001](docs/SLICE_001_TECH_PROBE.md) | 后备箱技术探路：竖屏拖拽 + 本地存档 + 双端构建闭环 | ✅ 通过 | ✅ 已通过（技术探针，非玩法手感） |
| [SLICE_002](docs/SLICE_002_TRUNK_UI.md) | 4×3 货舱交互：候选物资区 + 占格/堆叠 + 点选放置 | ✅ 47 测试 + Web/微信构建 | ✅ 已通过（2026-09-03 财哥批量验收） |
| [SLICE_003](docs/SLICE_003_MAP_SCROLL.md) | 地图骨架 + 横轴行车卷轴演出 | ✅ 54 测试 + 双端 + CDP 全链路 | ✅ 已通过（同上；卷轴时长等手感项待玩法密度上来后再评） |
| [SLICE_004](docs/SLICE_004_NODE_LOOT.md) | 抵达节点 → 候选物资 → 货舱取舍闭环 | ✅ 62 测试 + 双端 + CDP 全链路 | ✅ 已通过（同上） |
| [SLICE_005](docs/SLICE_005_GAME_LOOP.md) | 行程打通十日循环 GameState：扣油弹/入库/推进一天/危险度/结局重开 | ✅ 65 测试 + 双端 + 模拟器真实点击全链路 | ✅ 已通过（同上） |
| [SLICE_006](docs/SLICE_006_ROAD_EVENTS.md) | 道路事件接入行车途中：卷轴暂停 → 事件面板 → 选择后果落 GameState → 恢复；首次接入命令行类型检查（ADR-007） | ✅ 71 测试 + 类型检查 + 双端 + 模拟器真实点击两趟事件 | ✅ 已通过（同上） |

旧骨架（十日 × 六地点单线）的核心循环已全部打通。游戏设计已切换为**区域制长局模型**（[GAME_SKELETON.md](docs/GAME_SKELETON.md) 第三版，ADR-010~016）：十日循环 → 长局与波次、六地点单线 → 区域制与解锁、职业数据 → 主角天赋制、自动战斗 → 竖版定点实时射击（弹药实时消耗+撞线自毁潮水制）、失败线收敛为全员濒死。核心层参数化改造与区域制地图为下阶段工作；待拍板项见 [PENDING_DECISIONS.md](docs/PENDING_DECISIONS.md)。

> 2026-09-03 全项目评审修订（详见 [DECISIONS.md](docs/DECISIONS.md) ADR-008）：结局时机改为玩满第 10 天；幸存者求救事件救助后真实招募；damage 后果真实置车辆损坏；「重新开始」清全部存档键；三层边界静态护栏覆盖全部源文件；driving/returning 中断后回退地图。当前 76 测试。

> 人工验收方式见各切片文档「人工验收」节；微信端统一回归步骤见 [SLICE_002](docs/SLICE_002_TRUNK_UI.md) 的人工测试引导。
