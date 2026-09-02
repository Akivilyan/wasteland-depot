#!/usr/bin/env node
// 在微信开发者工具"小游戏运行时"上下文中执行 JS 表达式（CDP Runtime.evaluate）。
// 用法: node tools/cdp-eval.mjs '<expression>'
// 目标自动发现: url 含 gamePage.html（旧运行时）或 title 为"小游戏运行时"（新运行时）的 webview。
import { setTimeout as delay } from 'node:timers/promises';

const expr = process.argv[2];
if (!expr) {
  console.error('usage: node tools/cdp-eval.mjs "<expression>"');
  process.exit(2);
}

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find((t) => t.type === 'webview'
  && (t.url.includes('gamePage.html') || t.title.includes('小游戏运行时')));
if (!target) {
  console.error(JSON.stringify({ error: 'game target not found', targets: list.map((t) => t.url) }));
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', () => reject(new Error('ws connect failed')), { once: true });
});

const id = 1;
const payload = {
  id,
  method: 'Runtime.evaluate',
  params: {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  },
};
const resultPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('evaluate timeout (15s)')), 15000);
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id === id) {
      clearTimeout(timer);
      resolve(msg);
    }
  }, { once: true });
});
ws.send(JSON.stringify(payload));
const reply = await resultPromise;
ws.close();
if (reply.error) {
  console.error(JSON.stringify({ error: reply.error }));
  process.exit(1);
}
const { result, exceptionDetails } = reply.result;
if (exceptionDetails) {
  console.error(JSON.stringify({ exception: exceptionDetails }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result.value, null, 2));
