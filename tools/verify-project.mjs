import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(projectRoot, path), 'utf8');

const [sceneText, scriptMetaText, coreText, platformText, engineSettingsText, scriptTexts] = await Promise.all([
  read('assets/scenes/Prototype.scene'),
  read('assets/scripts/presentation/PrototypeScene.ts.meta'),
  read('assets/scripts/core/prototype-state.ts'),
  read('assets/scripts/platform/storage.ts'),
  read('settings/v2/packages/engine.json'),
  readDirTs('assets/scripts'),
]);

async function readDirTs(dir) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(resolve(projectRoot, dir), { recursive: true });
  return Promise.all(
    entries.filter((e) => e.endsWith('.ts')).map((e) => read(`${dir}/${e}`)),
  );
}

const scene = JSON.parse(sceneText);
const scriptMeta = JSON.parse(scriptMetaText);
assert.equal(scriptMeta.uuid, '6b9c302e-2c38-4bd9-a582-d9450af15460');
assert.ok(scene.some((entry) => entry.__type__ === '6b9c3AuLDhL2aWC2UUK8VRg'), 'PrototypeScene component is not attached');
assert.doesNotMatch(coreText, /from ['"]cc['"]|\bwx\s*\./, 'core layer depends on Cocos or WeChat');
assert.match(platformText, /createStoragePort/, 'platform storage adapter is missing');
const engineSettings = JSON.parse(engineSettingsText);
const includedModules = engineSettings.modules.configs.defaultConfig.includeModules;
for (const forbiddenModule of ['dragon-bones', 'physics-2d-box2d', 'spine-3.8']) {
  assert.ok(!includedModules.includes(forbiddenModule), `unused engine module enabled: ${forbiddenModule}`);
}
for (const requiredModule of ['animation', 'tween']) {
  assert.ok(includedModules.includes(requiredModule), `required lightweight animation module missing: ${requiredModule}`);
}
// Cocos 微信构建把 [...map] 降级成 [].concat(map)（得到 [Map] 而非条目，ADR-006）。
// 展开语法只允许用于数组与对象字面量；Map/Set 一律用 forEach。
const mapLikeSpread = /\[\s*\.\.\.\s*(?:new\s+(?:Map|Set)\b|[A-Za-z_$][\w$]*(?:Keys|Values|Entries)\(\))/;
for (const text of scriptTexts) {
  assert.doesNotMatch(text, mapLikeSpread, 'Map/Set spread will be mis-compiled by the WeChat build (ADR-006)');
}
console.log('[OK] scene component UUID');
console.log('[OK] core layer dependency boundary');
console.log('[OK] platform storage adapter');
console.log('[OK] engine feature boundary');
console.log('[OK] no Map/Set spread (ADR-006 wechat build pitfall)');
