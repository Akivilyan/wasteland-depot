# 末班车：废土仓库

一款竖屏、纯 2D 的微信小游戏。玩家驾驶车辆外出搜集物资，在有限载荷中取舍，返回废弃仓库后分配资源、修复车辆并扩展下一次探索范围。核心乐趣是**有限载重下的取舍**，不是复杂战斗或内容堆量。

- 引擎：Cocos Creator 3.8.8（纯 2D、竖屏），TypeScript
- 平台：首发微信小游戏，PC 版延后
- Node.js 22+

## 快速开始

```bash
npm run doctor         # 环境体检（先跑这个排查环境问题）
npm run verify         # 体检 + 全部规则测试 + 边界/引擎模块静态校验
npm run build:web      # 构建 Web Mobile
npm run build:wechat   # 构建微信小游戏（构建后自动打兼容补丁）
npm run wechat:open    # 在微信开发者工具中打开
npm run wechat:preview # 生成真机预览二维码
```

本机路径可用 `COCOS_CREATOR_BIN`、`WECHAT_DEVTOOLS_CLI` 覆盖。Cocos 命令行构建需要 macOS 图形会话；微信 CLI 需先在开发者工具「设置 → 安全设置 → 服务端口」打开开关。

测试：`npm test`（node 原生 `--test`，直接 import `assets/scripts/core/*.ts`，当前 62 个用例全绿）。

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
| [docs/PENDING_DECISIONS.md](docs/PENDING_DECISIONS.md) | 待财哥/丧彪拍板的产品项与当前默认值 |
| [docs/INVENTORY_DESIGN.md](docs/INVENTORY_DESIGN.md) | 车辆货舱占格交互设计提案 |
| [docs/SLICE_00X_*.md](docs/) | 各开发切片的目标、范围、验证结果与人工验收状态 |

Agent 工作守则（命令、环境、回归方式）在 `.agents/skills/wasteland-depot-dev/SKILL.md`。

## 切片进度

每个切片独立可运行、只验证一个问题；自动验证（规则测试 + Web/微信构建）与人工手感验收分开记录。

| 切片 | 内容 | 自动验证 | 人工验收 |
| --- | --- | --- | --- |
| [SLICE_001](docs/SLICE_001_TECH_PROBE.md) | 后备箱技术探路：竖屏拖拽 + 本地存档 + 双端构建闭环 | ✅ 通过 | ✅ 已通过（技术探针，非玩法手感） |
| [SLICE_002](docs/SLICE_002_TRUNK_UI.md) | 4×3 货舱交互：候选物资区 + 占格/堆叠 + 点选放置 | ✅ 47 测试 + Web/微信构建 | ⏳ 待人工（微信端手感） |
| [SLICE_003](docs/SLICE_003_MAP_SCROLL.md) | 地图骨架 + 横轴行车卷轴演出 | ✅ 54 测试 + 双端 + CDP 全链路 | ⏳ 待人工（手感） |
| [SLICE_004](docs/SLICE_004_NODE_LOOT.md) | 抵达节点 → 候选物资 → 货舱取舍闭环 | ✅ 62 测试 + 双端 + CDP 全链路 | ⏳ 待人工（手感） |

下一切片：**SLICE_005** 把行程与十日循环 GameState 打通（出发扣真实油/弹药、抵仓入库、推进一天、危险度），替换 TravelScene 里的 `setFuel()` 注入。

> 人工验收方式见各切片文档「人工验收」节；微信端统一回归步骤见 [SLICE_002](docs/SLICE_002_TRUNK_UI.md) 的人工测试引导。
