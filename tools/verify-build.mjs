import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const projectRoot = resolve(import.meta.dirname, '..');
const target = process.argv[2] ?? 'web';
const required = target === 'wechat'
  ? ['build/wechatgame/game.js', 'build/wechatgame/game.json', 'build/wechatgame/project.config.json']
  : ['build/web-mobile/index.html'];

for (const relativePath of required) {
  await access(resolve(projectRoot, relativePath), constants.R_OK);
  console.log(`[OK] ${relativePath}`);
}

if (target === 'wechat') {
  const outputRoot = resolve(projectRoot, 'build/wechatgame');
  const outputFiles = await readdir(outputRoot, { recursive: true });
  const wasmFiles = outputFiles.filter((path) => path.endsWith('.wasm'));
  if (wasmFiles.length > 0) {
    throw new Error(`Unexpected WASM artifacts in WeChat build: ${wasmFiles.join(', ')}`);
  }
  console.log('[OK] no unused WASM artifacts');
}
