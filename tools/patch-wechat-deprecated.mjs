#!/usr/bin/env node
// 微信构建后补丁（全部幂等）。npm run build:wechat 末尾自动执行，无需手动运行。
//
// 背景：2026-09-02 起微信开发者工具模拟器运行时更新（灰度 3.17.1 与新 3.17.2
// 构建均如此）：不再预置 window / global / requestAnimationFrame 全局，并在
// GameGlobal 上以 getter-only 形式预置 window/navigator 等属性。Cocos 3.8.8
// 生成的小游戏模板依赖旧行为，启动链（game.js → web-adapter → first-screen →
// 引擎）逐层崩溃白屏。微信模板与 Cocos 适配层上游均未适配，因此在构建产物上
// 打补丁。每个补丁带独立标记，重复执行不会叠加。
//
// P1 game.js        废弃 API shim：wx.getSystemInfo(Sync) → 新 API 拼装
// P2 game.js        global / window 缺失时别名到 GameGlobal（getter-only 用 defineProperty）
// P3 game.js        window.devicePixelRatio 读取容错（缺失时退回 wx.getWindowInfo）
// P4 first-screen.js window / requestAnimationFrame 缺失时从 GameGlobal 取
// P5 web-adapter.js inject() devtools 分支：window 非对象时改走真机安全分支
// P6 web-adapter.js inject() else 分支：属性逐条赋值，只读属性跳过
// P7 web-adapter.js DOMParser 同时暴露到 globalThis（引擎 SAXParser 裸引用）

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';

const target = resolve(process.argv[2] ?? 'build/wechatgame');

/** 对产物文件应用补丁：已含 marker 则跳过；apply 返回 null 视为模板未匹配。 */
async function patchFile(relPath, marker, apply) {
  const p = join(target, relPath);
  try {
    await access(p, constants.R_OK | constants.W_OK);
  } catch {
    console.log(`[SKIP] ${relPath} 不存在`);
    return;
  }
  const src = await readFile(p, 'utf8');
  if (src.includes(marker)) {
    console.log(`[OK] ${relPath} 已处理（幂等跳过）`);
    return;
  }
  const out = apply(src);
  if (out === null) {
    console.warn(`[WARN] ${relPath} 未匹配到模板（上游可能已变更），未注入`);
    return;
  }
  await writeFile(p, out, 'utf8');
  console.log(`[OK] ${relPath} 已注入`);
}

// ---------- game.js ----------

// P1：废弃 API shim（详见 ccd4aee）
const SHIM = `/* __WD_SYS_SHIM__: 用新 API 兼容已废弃的 wx.getSystemInfo(Sync)（Cocos 3.8.8 适配层仍在调用） */
(function () {
  if (typeof wx === 'undefined' || !wx || typeof wx.getSystemInfoSync !== 'function') { return; }
  var newApiReady = typeof wx.getWindowInfo === 'function'
    && typeof wx.getDeviceInfo === 'function'
    && typeof wx.getAppBaseInfo === 'function';
  if (!newApiReady) { return; }
  function buildInfo() {
    var windowInfo = wx.getWindowInfo();
    var deviceInfo = wx.getDeviceInfo();
    var appBaseInfo = wx.getAppBaseInfo();
    var setting = (typeof wx.getSystemSetting === 'function') ? wx.getSystemSetting() : {};
    var info = {};
    var sources = [windowInfo, deviceInfo, appBaseInfo, setting];
    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      for (var k in src) { if (Object.prototype.hasOwnProperty.call(src, k)) { info[k] = src[k]; } }
    }
    if (info.pixelRatio === undefined && windowInfo.pixelRatio !== undefined) { info.pixelRatio = windowInfo.pixelRatio; }
    if (info.screenWidth === undefined && windowInfo.screenWidth !== undefined) { info.screenWidth = windowInfo.screenWidth; }
    if (info.screenHeight === undefined && windowInfo.screenHeight !== undefined) { info.screenHeight = windowInfo.screenHeight; }
    if (info.windowWidth === undefined && windowInfo.windowWidth !== undefined) { info.windowWidth = windowInfo.windowWidth; }
    if (info.windowHeight === undefined && windowInfo.windowHeight !== undefined) { info.windowHeight = windowInfo.windowHeight; }
    if (info.statusBarHeight === undefined && windowInfo.statusBarHeight !== undefined) { info.statusBarHeight = windowInfo.statusBarHeight; }
    if (info.safeArea === undefined && windowInfo.safeArea !== undefined) { info.safeArea = windowInfo.safeArea; }
    if (info.language === undefined && appBaseInfo.language !== undefined) { info.language = appBaseInfo.language; }
    if (info.version === undefined && appBaseInfo.SDKVersion !== undefined) { info.version = appBaseInfo.SDKVersion; }
    if (info.SDKVersion === undefined && appBaseInfo.SDKVersion !== undefined) { info.SDKVersion = appBaseInfo.SDKVersion; }
    if (info.platform === undefined && deviceInfo.platform !== undefined) { info.platform = deviceInfo.platform; }
    if (info.system === undefined && deviceInfo.system !== undefined) { info.system = deviceInfo.system; }
    if (info.benchmarkLevel === undefined && deviceInfo.benchmarkLevel !== undefined) { info.benchmarkLevel = deviceInfo.benchmarkLevel; }
    if (info.fontSizeSetting === undefined && appBaseInfo.fontSizeSetting !== undefined) { info.fontSizeSetting = appBaseInfo.fontSizeSetting; }
    return info;
  }
  wx.getSystemInfoSync = function () { return buildInfo(); };
  wx.getSystemInfo = function (object) {
    var info = buildInfo();
    if (object && typeof object.success === 'function') { object.success(info); }
    if (object && typeof object.complete === 'function') { object.complete(info); }
  };
})();
`;

// P2：global / window 别名
const GLOBAL_POLY = `/* __WD_GLOBAL_POLYFILL__: 新运行时不再预置 global/window，Cocos 模板与 SystemJS 需要它们 */
(function () {
  if (typeof GameGlobal === 'undefined') { return; }
  if (typeof global === 'undefined') { try { GameGlobal.global = GameGlobal; } catch (e) {} }
  if (typeof window === 'undefined' || window === null) {
    try { GameGlobal.window = GameGlobal; } catch (e) {
      try { Object.defineProperty(GameGlobal, 'window', { value: GameGlobal, configurable: true, writable: true, enumerable: true }); } catch (e2) {}
    }
  }
})();
`;

// P3：devicePixelRatio 容错
const DPR_FIND = 'if (canvas && window.devicePixelRatio >= 2)';
const DPR_REPLACE =
  "/* __WD_DPR_GUARD__ */ if (canvas && ((typeof window !== 'undefined' && window && window.devicePixelRatio) || (typeof wx !== 'undefined' && wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 0) >= 2)";

// P4：first-screen window / rAF 兜底
const FS_POLY = `/* __WD_FS_WINDOW__: 新运行时未预置 window/requestAnimationFrame，从 GameGlobal 取（canvas 为官方画布入口） */
var window = (typeof window !== 'undefined' && window) || (typeof GameGlobal !== 'undefined' ? GameGlobal : {});
if (typeof requestAnimationFrame === 'undefined' && typeof GameGlobal !== 'undefined' && typeof GameGlobal.requestAnimationFrame === 'function') {
  var requestAnimationFrame = GameGlobal.requestAnimationFrame.bind(GameGlobal);
}
`;

await patchFile('game.js', '__WD_SYS_SHIM__', (src) => SHIM + src);
await patchFile('game.js', '__WD_GLOBAL_POLYFILL__', (src) => GLOBAL_POLY + src);
await patchFile('game.js', '__WD_DPR_GUARD__', (src) =>
  src.includes(DPR_FIND) ? src.replace(DPR_FIND, DPR_REPLACE) : null);

await patchFile('first-screen.js', '__WD_FS_WINDOW__', (src) => FS_POLY + src);

// ---------- web-adapter.js ----------

// P5：devtools 分支加 window 对象守卫
await patchFile('web-adapter.js', '__WD_ADAPTER_GUARD__', (src) => {
  const FIND = "if (typeof __devtoolssubcontext === 'undefined' && platform === 'devtools') {";
  const REPLACE =
    "/* __WD_ADAPTER_GUARD__: window 未预置时改走真机安全分支，避免 defineProperty(on non-object) 崩溃 */\n" +
    "  if (typeof __devtoolssubcontext === 'undefined' && platform === 'devtools' && (typeof window === 'object' && window !== null)) {";
  return src.includes(FIND) ? src.replace(FIND, REPLACE) : null;
});

// P6：else 分支属性逐条赋值、只读跳过
await patchFile('web-adapter.js', '__WD_ADAPTER_GUARD2__', (src) => {
  const FIND = [
    '} else {',
    '    for (var _key4 in _window) {',
    '      global[_key4] = _window[_key4];',
    '    }',
    '    global.window = _window;',
    '    window = global;',
    '    window.top = window.parent = window;',
    '  }',
  ].join('\n');
  const REPLACE = [
    '} else {',
    '    /* __WD_ADAPTER_GUARD2__: 新运行时对 navigator/window 等为 getter-only，赋值失败跳过 */',
    '    for (var _key4 in _window) {',
    '      try { global[_key4] = _window[_key4]; } catch (e) {}',
    '    }',
    '    try { global.window = _window; } catch (e) {}',
    '    try { window = global; } catch (e) {}',
    '    try { window.top = window.parent = window; } catch (e) {}',
    '  }',
  ].join('\n');
  return src.includes(FIND) ? src.replace(FIND, REPLACE) : null;
});

// P7：DOMParser 暴露到 globalThis
await patchFile('web-adapter.js', '__WD_DOMPARSER_GLOBAL__', (src) => {
  const FIND = 'window.DOMParser = DOMParser;';
  const REPLACE =
    'window.DOMParser = DOMParser; /* __WD_DOMPARSER_GLOBAL__: 引擎 SAXParser 以裸标识符 new DOMParser() */\n' +
    "try { (typeof globalThis !== 'undefined' ? globalThis : GameGlobal).DOMParser = DOMParser; } catch (e) {}";
  return src.includes(FIND) ? src.replace(FIND, REPLACE) : null;
});
