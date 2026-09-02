#!/usr/bin/env node
// 构建后补丁：为 Cocos 3.8.8 微信适配层替换已废弃的 wx.getSystemInfo(Sync)。
//
// 背景：Cocos 3.8 LTS 最终版（3.8.8）的 game.js / web-adapter.js 仍调用
// wx.getSystemInfoSync / wx.getSystemInfo，微信已废弃这两个 API，新版基础库
// 会在控制台报弃用错误。上游不再修复，因此在构建产物入口注入 shim：
// 用新 API（getWindowInfo/getDeviceInfo/getAppBaseInfo/getSystemSetting）
// 拼装出与旧 API 同构的对象，仅在原生旧 API 存在时才覆盖。
//
// 用法：node tools/patch-wechat-deprecated.mjs <wechatgame 目录>
// 幂等：重复执行不会叠加注入（以 __WD_SYS_SHIM__ 标记判断）。

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';

const MARKER = '__WD_SYS_SHIM__';

const SHIM = `/* ${MARKER}: 用新 API 兼容已废弃的 wx.getSystemInfo(Sync)（Cocos 3.8.8 适配层仍在调用） */
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
    // 旧字段在新 API 中已拆分/改名，这里补齐适配层常用字段
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
    if (info.bluetoothEnabled === undefined && setting.bluetoothEnabled !== undefined) { info.bluetoothEnabled = setting.bluetoothEnabled; }
    if (info.wifiEnabled === undefined && setting.wifiEnabled !== undefined) { info.wifiEnabled = setting.wifiEnabled; }
    if (info.locationEnabled === undefined && setting.locationEnabled !== undefined) { info.locationEnabled = setting.locationEnabled; }
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

const target = resolve(process.argv[2] ?? 'build/wechatgame');
const gameJsPath = join(target, 'game.js');

await access(gameJsPath, constants.R_OK | constants.W_OK);
const content = await readFile(gameJsPath, 'utf8');

if (content.includes(MARKER)) {
  console.log('[OK] shim 已存在，跳过（幂等）');
  process.exit(0);
}

await writeFile(gameJsPath, SHIM + content, 'utf8');
console.log(`[OK] 已注入废弃 API 兼容 shim → ${gameJsPath}`);
