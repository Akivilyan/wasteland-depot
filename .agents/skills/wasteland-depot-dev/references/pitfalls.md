# 踩坑速查表（现象 → 原因 → 解法）

> 全部是本项目实际踩过并修复的坑（出处标注 ADR/commit）。SKILL.md 只留纪律，这里留细节。
> 权威分层：引擎/平台的一般事实（包大小、退出码口径、CLI 命令、广告 API 等）以用户级官方 skill（`cocos-creator-guide` / `wechat-minigame-guide`）为准，本表只收录本项目语境下的应用与修复；冲突时以官方当日抓取为准。
> 通用判断：环境/工具链类异常先联网检索社区/官方公告（ADR-005），别顺调用栈埋头深挖。

## 一、微信构建错译与运行时（最高危类）

| 现象 | 原因 | 解法 | 出处 |
| --- | --- | --- | --- |
| 规则层 Node 测试全绿，模拟器里数值变 `undefined`（如「带回 NaN 格物资」） | Cocos TS 降级编译把 `[...map]` 编成 `[].concat(map)`，得到 `[Map]` 而非条目数组 | `assets/scripts` 内禁用 Map/Set（含 `.keys()/.values()/.entries()`）展开；遍历用 `forEach`、收集用循环 push。`verify-project.mjs` 静态护栏强制；此类改动必须微信模拟器行为回归 | ADR-006 |
| 微信模拟器启动白屏，逐层崩溃 | 新运行时（灰度 3.17.x）不再预置 `window`/`global`/`requestAnimationFrame`，Cocos 3.8.8 模板硬依赖 | 改配置没用（对照实验实锤是纯代码依赖）。`tools/patch-wechat-deprecated.mjs` 七个幂等补丁随 `build:wechat` 自动打；Cocos 官方适配后可移除 | ADR-002 |
| 补丁后产物行为仍不对 | 上游模板变更导致补丁未匹配 | 每次构建后看补丁输出：`[WARN] 未匹配到模板` = 该补丁没打上，不是成功 | patch 脚本设计 |
| 代码用了废弃 API（wx.getSystemInfoSync）报弃用错 | Cocos 3.8.8 适配层仍在调旧 API | 补丁 P1 在产物注入 shim 拼装新 API，无需改业务代码 | ccd4aee |
| 开发者工具 GUI 重写 project.config.json | 手工拼配置被覆盖模式字段 | 兼容性对照实验用官方模板新建项目，不手工拼配置 | ADR-005 |

## 二、Cocos 引擎 API 陷阱（typecheck 闸门针对类）

| 现象 | 原因 | 解法 | 出处 |
| --- | --- | --- | --- |
| 真实触摸时抛 TypeError 中断派发链 | `EventTouch.preventSwallow` 在 Cocos 3.8 是**布尔属性**，当方法调用就炸；且错误被触摸回调静默吞掉 | 注册监听即默认吞事件的空回调；API 用法以 `cc.d.ts` 为准 | f986c07 |
| 高亮从未生效，潜伏两个切片 | `canPlace(state,def,x,y)` 被凭印象传成 5 参数 | 命令行类型检查闸门（ADR-007）；API 先查 `.d.ts` 再写 | ADR-007 |
| `Node.scheduleOnce` 报不存在 | scheduleOnce 是 `Component` 的方法，不是 `Node` 的 | 同上；引擎 API 面大，记忆不可靠，一律查声明 | ADR-007 |
| 真机上 tween 未停被误用 stop | `UIOpacity.stopAllActions` 误用 | 查 `.d.ts` 确认方法归属 | 4ef7ca9 |
| 编辑器里没报错，命令行构建/回归炸 | 编辑器按 `temp/tsconfig.cocos.json` 全量编译，但 CLI 构建不经过它；根 tsconfig 只含微信类型声明 | `npm run typecheck`（tsconfig.check.json 对业务代码+引擎声明全量检查）进 verify 链，必经 | ADR-007 |
| 多格物品（2×1）右半边被邻格盖住 | 物品色块画在锚点格节点上，被同层后渲染的邻格背景覆盖 | 统一在物品层绘制所有物品，保证渲染顺序 | f0c514a |
| 连续放置首件物品标签消失 | 同帧销毁复用节点 | 复用前确认节点生命周期；回归抓的 | 99f4cb5 |

## 三、模拟器回归链路（automator 对小游戏失效）

| 现象 | 原因 | 解法 | 出处 |
| --- | --- | --- | --- |
| automator（9420）/CDP 触摸注入对小游戏失效 | 见官方 wechat-minigame-guide §七（canvas 渲染无 DOM，选择器/合成事件无命中目标）——**事实以官方为准，勿重试** | 本项目现行链路：computer-use 系统级真实点击（驱动）+ `tools/cdp-eval.mjs`（断言）；操作细则以本项目 `references/minigame-regression.md` 为权威 | wechat-minigame-guide §七 + minigame-regression.md |
| cdp-eval 找不到 `cc` 全局 | 新运行时 cc 不在裸全局 | 用 `__gameContextWindow.cc`；组件用 `canvas.components.find(c => c.__classname__ === 'XXXScene')` 直调方法/读属性 | 同上 |
| CLI open 报「不存在此 AppID」(code 10) | appid 由构建配置注入，CLI open 对该路径不认 | 走 MCP `wechat_ide(open, cdp_enabled=true)` 拉起 9222，或 GUI 导入一次；不代表配置坏了 | 回归实证 |
| 纯 CDP 驱动即够回归 | 调组件方法 = 真实触摸回调链路 | `cdp-eval` 直调 TravelScene 运行时方法（onNodeTapped/onGo/onEventChoice/finishDrive/onReturnFromNode/restartGame）；注入存档 + `cc.director.loadScene('Prototype')` 重置起点；断言读 `travel.gameState`/`currentTrip.phase`。computer-use 真实点击只在验手感/命中测试时用 | 回归实证 |
| cdp-eval 多语句只执行第一条且无报错 | 内部拼成 `return a(); b()`，语法合法故不触发语句模式 | IIFE 包裹：`(function(){ a(); b(); return c() })()` | 同上 |
| 「激活→截图→点击」中途插了终端调用后拒发 | ZCode 抢回前台导致 stale frame | 三个动作连续执行，不插其他调用 | workflow 记忆 |
| 行车演出瞬间完成 | 模拟器窗口失焦时 Schedule/rAF 暂停/追赶 | 不是产品 bug；断言以组件状态为准，不以动画时钟为准 | skill 判读口径 |
| 控制台一堆报错（jsbridge not ready / getSystemInfo fail / HarmonyOS 提示 / Failed to set shading scale / webapi_getwxaasyncsecinfo） | 框架噪音 | 判据：调用栈落在我们文件（`assets/main/index.js`、场景/core 文件）= 我们的 bug 必修；全在 `WAGame.js`/`cc.js`/`devtools://` = 噪音。可疑时拉 full 日志（真错曾被噪音掩盖过） | 同上 |
| 点击无反应但代码看起来对 | 视口映射错 | 游戏视口 = webview 原点 + 缩放（390×844 视口，FIXED_WIDTH 750，缩放约 0.52）；用两个已知 UI 元素做两点校准反推原点 | 同上 |

## 四、环境与工具链

| 现象 | 原因 | 解法 | 出处 |
| --- | --- | --- | --- |
| Cocos 构建秒退、无日志 | 缺 macOS 图形会话（CLI 构建/gui 会话被沙箱限制），或沙箱拦 | 区分环境问题与项目缺陷；doctor 先行 | SKILL |
| 构建退出码 36 但产物正常 | 非 bug：官方口径 **36=构建成功**（32=参数不合法、34=构建出错，见 cocos-creator-guide §一） | `cocos-build.sh` 已按官方口径把 36 归零 | cocos-creator-guide §一 |
| typecheck 被跳过 | `temp/declarations` 未生成（编辑器从未打开过项目） | 全新克隆属正常跳过；需要时用 Cocos 编辑器打开一次项目生成，**不要删闸门** | tools/typecheck.sh |
| 所有 CLI 操作报 `CLI_TIMEOUT` | devtools 服务端口未开（官方 CLI 文档明示此前置） | `设置 → 安全设置 → 服务端口` 打开 | wechat-minigame-guide §六 |
| 微信预览二维码 | — | `npm run wechat:preview`，产物写 `artifacts/wechat-preview.png/.json` | tools/wechat-cli.sh |
| npm loot 库接不上确定性 Rng | 现成库都绑 Math.random | 战利品自实现 `core/loot.ts`（调研结论，不引依赖） | SLICE_004 |

## 五、流程与协作纪律（血泪总结）

| 坑 | 教训 | 规则 | 出处 |
| --- | --- | --- | --- |
| 逐切片全量回归，三天烧 270M 输入 tokens（99.7% 输入侧重发） | 小项目套大项目仪式 | T0 默认，T1~T3 按风险触发；会话调用数逼近 100 或上下文过 15 万即收口重开（成本 O(N²)） | ADR-009 |
| 「护栏只查了探针文件」但文档宣称全层强制 | 文档写得一样，差距只有故意注入违规才能发现 | 护栏断言范围必须与文档承诺一致；ADR-008 已改全目录扫描 | ADR-008 |
| 救助事件「救助」实际无效、结局第 9 天就触发 | 实现自洽但语义错了，测试绿不绿看不出来 | 规则语义以玩家视角复述一遍再对照实现 | ADR-008 |
| 凭印象写引擎 API，错误活到模拟器 | 高亮 bug 存在两个切片 | typecheck 闸门 + 查 `.d.ts` | ADR-007 |
| Node 测试测不出构建错译 | 两道闸门互补 | 涉 Map/Set 的规则实现必须模拟器行为回归 | ADR-006 |
| 一行 diff 的护栏改动也可能炸整个包 | 全局风险改动爆炸半径大 | 护栏/补丁/构建配置改动一律 T3 | ADR-009 |
