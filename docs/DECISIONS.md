# 决策记录（ADR）

本文按时间记录**已确认的技术与产品决策、理由和后果**，回答「为什么这么定」。

- 游戏是什么、内容范围与产品底线 → [GAME_SKELETON.md](GAME_SKELETON.md)
- 代码怎么组织、分层边界、文件职责、复用清单（当前事实）→ [ARCHITECTURE.md](ARCHITECTURE.md)
- 尚未拍板的产品项与默认值 → [PENDING_DECISIONS.md](PENDING_DECISIONS.md)

每条决策只写结论与理由，不复述别处已维护的清单。

---

## ADR-001：引擎与技术形态 —— 留在 Cocos 2D，纯 2D 竖屏单机

- 状态：已确认（2026-09-02 复评维持）
- **决定**：首版用 Cocos Creator 3.8.8 做纯 2D、竖屏、单机微信小游戏；保留 `Animation`/`Tween` 做轻量反馈，关闭 Spine、DragonBones、Box2D、音视频等未用模块；不引入 3D、物理引擎、骨骼动画、联网或第三方运行时。代码按 规则 / 表现 / 平台 三层隔离（边界与强制方式见 [ARCHITECTURE.md](ARCHITECTURE.md) 第 1 节）。
- **理由**：游戏真实形态是「横轴旅途 + 场景变化」的归家异途变种，正是 2D 引擎价值区。曾一度判断「原生 canvas 更好」，复评后认定那只在「纯静态 UI」假设下成立，已推翻。
- **备选**：微信原生（规则层零成本可迁，引擎彻底摆烂时启用）。**排除**：团结引擎（3D/重度方案，C# 重写成本不值）。
- **教训**：评估技术方案要以完整游戏形态为准，不能用当前已实现的小切片当依据。

## ADR-002：微信新运行时兼容 —— 构建后自动打补丁兜底

- 状态：已确认（2026-09-02）
- **背景**：2026-09-02 起微信开发者工具模拟器运行时灰度更新，不再预置 `window`/`global`/`requestAnimationFrame`，`GameGlobal` 部分属性 getter-only。Cocos 3.8.8 生成的小游戏模板硬依赖这些全局，启动链逐层崩溃白屏。配置文件（project.config.json / game.json / libVersion / enhance）差异均非原因——**纯代码依赖，改配置修不了**。
- **对照实验**：开发者工具原生「小游戏 + 纯 gl 模式」模板在同一模拟器 0 错误运行；Cocos 产物必白屏。社区普遍反馈「新版运行时 window 不再注入」，微信与 Cocos 当时均无官方公告/适配。
- **决定**：`tools/patch-wechat-deprecated.mjs` 七个幂等补丁随 `npm run build:wechat` 自动执行（废弃 API shim、global/window 别名、DPR 容错、首屏 window/rAF 兜底、adapter 双分支守卫、DOMParser 暴露 globalThis）。Cocos 官方适配后即可移除。
- **开发期建议**：开发者工具「设置 → 本地设置」锁定调试基础库版本，避免灰度运行时反复横跳。

## ADR-003：旅途表现 —— 地图骨架 + 卷轴演出折中

- 状态：已确认，用户拍板（2026-09-02）
- **决定**：2D 地图做策略层（选路线/节点、开迷雾、节点状态）；点出发切横轴行车卷轴做表现层（车移动、背景滚动、随里程触发节点事件）；到节点弹出事件/搜集/货舱界面（复用现有 UI）。首版只做一条路线 + 3~5 个节点验证手感。
- **理由 / 对标**：归家异途（Home Behind）——路上横卷、地图/营地静态界面。旅途表现（车动景变）是这个游戏的「脸」，纯静态地图撑不起体验；完整开放世界又超出首版范围，折中方案用最小成本验证手感，横轴素材日后按节点对复用、不白做。

## ADR-004：复用官方能力优先，只自写官方没有的玩法规则

- 状态：已确认（立项原则）
- **决定**：开发新能力前先查官方文档（Cocos 手册 / 微信小游戏文档）；官方/Cocos/微信已提供的（存储、广告、分享、登录、开放数据域、UI 布局组件、Tween/Animation、触摸事件）只写适配层，不重写；确认官方没有的才在规则层自写，且不得依赖 `cc`/`wx`。具体「直接用 vs 必须自写」清单见 [ARCHITECTURE.md](ARCHITECTURE.md) 第 4 节。
- **理由**：小程序包体积与维护成本敏感；自写部分集中在确定性、可测的玩法规则（货舱占格、十日循环、可种子随机、战利品抽取），这些官方确实没有。

## ADR-005：环境/兼容类异常先联网检索，对照实验用官方模板

- 状态：已确认，用户反馈确立（2026-09-02）
- **决定**：遇到环境/工具链类异常（非自己代码逻辑错误），先联网检索是否社区普遍现象、有无官方公告（WebFetch 超时国内站点时用 `arkcli +chat --tools web_search`），再决定跟官方方案还是自己兜底，不顺着调用栈埋头深挖。做兼容性对照实验时，用官方向导/官方模板新建项目，不手工拼 `project.config.json`（会被 GUI 覆盖模式字段）。
- **理由**：ADR-002 的白屏问题正是靠「先查社区 + 官方模板对照」快速定位为运行时变更，而非逐行追 Cocos 启动链。

## ADR-006：核心层禁用 Map/Set 展开语法 —— 微信构建会静默错译

- 状态：已确认（2026-09-03，SLICE_005 回归实证）
- **背景**：SLICE_005 微信模拟器回归发现「抵仓入库」把材料折算成 `undefined`（日志「带回 NaN 格物资」）。规则层 Node 测试全绿，只有构建产物行为错误。反编译 `build/wechatgame/assets/main/index.js` 实锤：Cocos 的 TS 降级编译把 `[...someMap]` 编成 `[].concat(someMap)`——`concat` 不展开 Map，得到 `[Map]` 而非条目数组；解构后字段全为 `undefined`。
- **决定**：`assets/scripts` 内禁止对 Map/Set（及 `.keys()/.values()/.entries()` 迭代器）使用数组展开；遍历用 `forEach`，收集用普通循环 push。数组与对象字面量展开不受影响（编译为 `concat`/`_extends`，语义正确）。该约束由 `tools/verify-project.mjs` 静态护栏强制。
- **教训**：规则层 Node 测试跑在真实 JS 引擎上，测不出构建错译——凡新增涉及 Map/Set 的规则实现，必须在微信模拟器里过一遍行为回归。

## ADR-007：命令行类型检查是验证链必经一环 —— 编辑器编译不构成 tsc 闸门

- 状态：已确认（2026-09-03，SLICE_006 复盘实证）
- **背景**：连续数个「用错 Cocos API」的 bug（`EventTouch.preventSwallow` 是布尔属性却当方法调用、`Node.scheduleOnce` 不存在——它是 `Component` 的方法、`canPlace(state,def,x,y)` 被传成 5 参数导致合法格高亮从未生效、`Node.setActive`/`Label.let()` 凭印象使用）都有同一特征：**凭印象写引擎 API，且命令行验证链里没有类型检查**。Cocos 编辑器内部会按 `temp/tsconfig.cocos.json` 全量编译，但只有编辑器打开项目时才发生；CLI 构建/回归不经过它，而根 `tsconfig.json` 的 `files` 只含微信类型声明、不含业务代码——直接 `tsc` 根本不检查 `assets/scripts`。这些错误因此一路活到模拟器，有的还被触摸回调静默吞掉（高亮 bug 存在了两个切片未被发现）。
- **决定**：新增 `tsconfig.check.json`（include 业务代码、target/lib ES2020、对引擎 `.d.ts` 全量检查）与 `tools/typecheck.sh`（`temp/declarations` 未生成时跳过），接入 `npm run verify`：doctor → **typecheck** → node 测试 → 静态护栏。
- **理由**：类型错误在本机秒级报出，成本远低于模拟器回归；引擎 API 表面大、记忆不可靠，tsc 对着官方声明做校验正是「先查手册」原则（ADR-004/ADR-005）的自动化版本。SLICE_006 首次接入即报出 15 处问题，含 2 个潜伏运行时 bug（canPlace 参数、scheduleOnce）。
- **注意**：tsc 只查类型不查行为，微信构建错译（ADR-006）类问题仍需模拟器行为回归；两道闸门互补。

## ADR-008：全项目评审修订 —— 语义对齐与护栏补全

- 状态：已确认（2026-09-03，全项目评审发现）
- **背景**：对代码/文档/测试/工具链做了一次全面评审，发现多处「文档承诺与实际执行不符」和「实现与语义不符」：① `verify-project.mjs` 的核心边界断言只读 `prototype-state.ts` 一个探针文件，core 其他 8 个文件引入 `cc`/`wx` 均不会被拦（文档却宣称全层强制）；② 结局判定 `nextDay > FINAL_DAY_INDEX(9)` 使第 9 天返仓即触发结局，与「存活到第 10 天结束」语义不符（实际只玩 9 天）；③ 幸存者求救事件的「救助」实际效果是亏 1 药品、`survivors` 永远为空——EventOutcome 类型无法表达招募；④ damage 后果不置 `vehicleDamaged`、事件表无任何 damage 条目使防护/`protectionSensitive` 全是空转；⑤ 「重新开始」漏清 `trunk.v1`；⑥ driving/returning 相位存档恢复是半死状态。
- **决定**（本次一并落地，规则改动附测试）：
  - 三层边界静态护栏改为**全目录扫描**：core 全部文件断言 `from 'cc'`/`wx.`，presentation 全部文件断言 `wx.`（平台访问只走 platform 适配器）。
  - `advanceDay` 结局改为 `nextDay > GAME_DAYS`（玩满第 10 天）；守卫对 day==10 且 ending==null 的存档兜底补 `survived`（`SURVIVED_ENDING` 导出），杜绝永久卡死；`FINAL_DAY_INDEX` 删除。
  - EventOutcome 新增 `recruit` 后果（救助 → 幸存者加入 `state.survivors`，职业取自事件表）；`survivor_call` 救助选项改用之；`ambush` 反击选项 damage 化并真实置 `vehicleDamaged`（防护减免路径从此有真实触发者）。
  - 存档键位单一登记处：`core/scenario.ts` 导出 `ALL_SAVE_KEYS`，「重新开始」遍历清档（含 PrototypeScene 的 `trunk.v1`）。
  - driving/returning 相位载入时回退地图（油弹为已付成本，不二次结算）；`atNode` 重建面板不变。
  - `LOOT_DRAW_MAX` 6→5（互斥抽取上限即物品种类数，6 不可达）；`DANGER_STEP` 替换 advanceDay 里的硬编码 +1，删除无消费者的 `DAILY_FUEL_IDLE_COST`；`canAffordTrip` 的 range 恒真检查保留但显式注明占位语义；route 死三元化简；表现层两处 `as never` 收紧为 `isLootItemId` 守卫；`engines` 收紧 `>=22.18`（node 直跑 .ts 依赖 22.18+ 默认开启的 type stripping）。
- **教训**：静态护栏的断言范围必须与文档承诺一致——「查了一个文件」和「查了整层」在文档里写出来是一样的，只有故意注入违规才能发现差距；规则语义（玩几天、救助有没有用）要以玩家视角复述一遍再对照实现，光看测试绿不绿发现不了「实现得很自洽但语义错了」的问题。

## ADR-009：验证节奏分层 —— 小项目不做大项目的仪式

- 状态：已确认（2026-09-04，用户拍板；**唯一权威出处为 [VERIFY_CADENCE.md](VERIFY_CADENCE.md)**）
- **背景**：2026-09-02~04 实测三场长会话累计约 270M 输入 tokens（本地 rollout 逐调用账目），99.7% 在输入侧重发上下文，成本随调用数 O(N²) 滚雪球；其中大量消耗来自「每个切片都做模拟器全流程回归」的节奏。同时 ADR-008 证明 3000 行级项目一次会话即可完成全项目审阅并抓出六类问题。结论：逐切片全量回归是小项目套用大项目仪式，验证应按风险分层、集中在阶段末。
- **决定**：T0（`npm run verify`，本机零成本）任何改动全跑；T1 定向回归只在改动触及存档读写/行为分支时跑所涉模块；T2 冒烟用于纯表现层改动；T3 全量回归 + 全项目审阅只在阶段收官、构建管线/存档 schema/护栏自身改动、发版前触发。阶段末由 glm-5.3（架构师）审阅、glm-5.3-flash 顶层新会话执行回归（子代理无 computer-use 且继承会话模型；glm-5.3 无图像输入）。`.agents/skills/wasteland-depot-dev/SKILL.md` 旧规则「表现层改动必须构建 Web 验证」废止。
- **教训**：静态审阅抓不到构建错译（ADR-006 类），故 T1/T3 触发条件按**风险面**（改了什么）而非日历；全局风险（护栏/补丁/构建配置）爆炸半径是整个包，一行 diff 也触发 T3。
