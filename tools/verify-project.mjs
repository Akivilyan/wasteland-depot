import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(projectRoot, path), 'utf8');

const [sceneText, scriptMetaText, coreText, platformText, engineSettingsText] = await Promise.all([
  read('assets/scenes/Prototype.scene'),
  read('assets/scripts/presentation/PrototypeScene.ts.meta'),
  read('assets/scripts/core/prototype-state.ts'),
  read('assets/scripts/platform/storage.ts'),
  read('settings/v2/packages/engine.json'),
]);

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
console.log('[OK] scene component UUID');
console.log('[OK] core layer dependency boundary');
console.log('[OK] platform storage adapter');
console.log('[OK] engine feature boundary');
