# Canvas 小游戏回归链路（历史实证记录）

> 本文是历史实证记录（失效实验、坐标校准细节）。**权威出处已于 2026-09-14 迁至项目侧**：
> [wasteland-depot-dev/references/minigame-regression.md](../../wasteland-depot-dev/references/minigame-regression.md)；
> MCP skill 主文件只留指路卡。更新时改项目侧那份，本文件不再维护。

适用：Cocos 导出的微信**小游戏**（canvas 渲染、无 DOM）。普通小程序 DOM 页面仍走 automator 正常流程，不在此列。

## 失效事实（勿重试）

- **wechat_automator（9420 端口）对小游戏不可用**：TCP 可监听但 WS 永远握手失败（verified=false 无限重试）。根因：小游戏运行时**没有 DOM**——Cocos 启动后拿唯一 WebGL canvas surface 把整个场景（含 cc.Button/Sprite/Label）逐像素画出，`cc.Button` 只是引擎内部对象，屏幕上是矩形像素而非系统按钮；automator 的 CSS 选择器/合成 DOM 事件没有目标可命中。
- **CDP 注入触摸对新运行时失效（2026-09-03 实测）**：`Input.dispatchTouchEvent`、宿主 `webview.sendInputEvent`、合成 DOM TouchEvent 全部无法命中游戏——guest 无 DOM 监听、引擎回调在 wx shim 内部不可达、游戏跑在 `__gameContextWindow` 子 context（webview URL 形如 `.../game/s0/...`，无 `gamePage.html`）。

## 现行回归链路：系统级真实点击 + CDP 读态断言

1. **驱动**：computer-use 做 macOS 系统级鼠标点击（OS → 模拟器窗口 → canvas → Cocos 命中测试），与真人手指同通路，必然驱动游戏。
   - 先用 `list_windows`/截图定位模拟器窗口；游戏视口坐标 = webview 原点 + 游戏内映射（390×844 视口，FIXED_WIDTH 750，缩放约 0.52）。用两个已知 UI 元素做两点校准反推视口原点。
   - 「激活 → 截图 → 点击」必须连续执行，中间插终端调用会让 ZCode 抢回前台导致 stale frame 拒发。
   - 坐标一律取最新截图栅格像素。
2. **断言**：`node tools/cdp-eval.mjs '<expr>'` 通过 CDP 9222 在 JS 运行时直读游戏状态，不依赖截图。
   - cc 在新运行时不在裸全局：`__gameContextWindow.cc` 取引擎。
   - 找场景组件：`canvas.components.find(c => c.__classname__ === 'PrototypeScene')`，可直接调 `selectCandidate`/`onCellClick` 等方法、读 Graphics fillColor / Label string / storage 断言表现层。
   - 多语句用 IIFE 包裹：`(function(){ a(); b(); return c() })()`（裸写多条只生效第一条）。
   - 目标发现按标题「小游戏运行时」兼容新旧两种 webview 形态。

## 报错噪音判读口径

用户贴来的模拟器 Console 报错（jsbridge not ready / getSystemInfo fail、HarmonyOS 基础库提示、`Failed to set shading scale`、`webapi_getwxaasyncsecinfo:fail`）经实测多为框架噪音，游戏实际正常（`Success to load scene` 为铁证）。

- **判据**：调用栈落在我们的文件（`assets/main/index.js`、PrototypeScene/TravelScene/trunk/route）就是我们的 bug，必须修；全在 `WAGame.js`/`cc.js`/`devtools://` 就是框架/引擎自身噪音。
- 用户报「编译有报错」先用 cdp-eval.mjs 实时验证游戏状态再下结论，别直接开修；但注意反例：preventSwallow 一次真错曾被噪音掩盖，full 采集才看到——可疑时拉 full 日志。
- 模拟器 devtools 的 Schedule/rAF 在窗口失焦时会暂停/追赶，行车演出可能瞬间完成——不是产品 bug，断言以组件状态为准。
- compile 构建后会自动重连 automator；「✖ Preview」status 不影响编译成功。
