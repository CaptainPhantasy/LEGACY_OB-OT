import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import(threeURL);
const { applyRoomLightmap, updateRoomRevelation } = await import('../dist/room-lightmap.js');

function fixture() {
  const room = new THREE.Group(), staticRoom = new THREE.Group();
  staticRoom.name = 'OldCuriosityShop';
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.castShadow = true;
  staticRoom.add(mesh); room.add(staticRoom);
  return { room, mesh };
}

async function apply(room, manifest) {
  const fetch = globalThis.fetch, loadAsync = THREE.TextureLoader.prototype.loadAsync;
  globalThis.fetch = async () => new Response(JSON.stringify(manifest));
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture({ width: 4096, height: 4096 });
  try {
    return await applyRoomLightmap(room, { capabilities: { getMaxAnisotropy: () => 8 }, shadowMap: {} });
  } finally {
    globalThis.fetch = fetch;
    THREE.TextureLoader.prototype.loadAsync = loadAsync;
  }
}

const manifest = { version: 1, node: 'OldCuriosityShop', resolution: 4096, illuminationScale: 1024, encoding: 'RGBM_SQRT' };

test('RGBM square lightmaps use raw RGBA and the exact squared multiplier decode', async () => {
  const { room, mesh } = fixture();
  await apply(room, manifest);
  assert.equal(mesh.material.lightMap.colorSpace, THREE.NoColorSpace);
  assert.equal(mesh.material.lightMap.premultiplyAlpha, false);
  assert.equal(mesh.material.lightMap.flipY, false);
  assert.equal(mesh.material.lightMapIntensity, 1024);
  assert.ok(Object.hasOwn(mesh.material.defines, 'ROOM_LIGHTMAP_RGBM_SQRT'));
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  mesh.material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /#ifdef ROOM_LIGHTMAP_RGBM_SQRT\s+vec3 roomDiffuseIllumination = pow\( roomLightmapSample\.rgb \* roomLightmapSample\.a, vec3\( 2\.0 \) \) \* lightMapIntensity;/);
  assert.match(shader.fragmentShader, /reflectedLight\.directDiffuse = vec3\( 0\.0 \)/);
  assert.match(shader.fragmentShader, /roomDiffuseIllumination \* roomMovingShadow \+ roomRevelationDiffuse/);
  updateRoomRevelation(room, 95);
  assert.equal(shader.uniforms.roomRevelationPower.value, 95);
});

test('legacy sRGB lightmaps remain supported and invalid encoding or range fails atomically', async () => {
  const { room, mesh } = fixture();
  await apply(room, { ...manifest, encoding: undefined, illuminationScale: 64 });
  assert.equal(mesh.material.lightMap.colorSpace, THREE.SRGBColorSpace);
  assert.equal(mesh.material.defines.ROOM_LIGHTMAP_RGBM_SQRT, undefined);
  for (const bad of [
    { ...manifest, encoding: undefined },
    { ...manifest, encoding: 'unknown' },
    { ...manifest, illuminationScale: 4097 },
    { ...manifest, illuminationScale: -1 },
  ]) {
    const failed = fixture(), original = failed.mesh.material;
    await assert.rejects(apply(failed.room, bad), /unexpected format/);
    assert.equal(failed.mesh.material, original);
    assert.equal(failed.mesh.castShadow, true);
  }
  await assert.doesNotReject(apply(fixture().room, { ...manifest, illuminationScale: 4096 }));
});

test('8-bit RGBM square retains the observed dark-room level and bright fixtures together', () => {
  // Quantize a reference encoding to the same RGBA8 storage used by the PNG.
  // This checks the concrete dynamic-range defect rather than shader syntax.
  const encode = rgb => {
    const root = rgb.map(value => Math.sqrt(value / 1024));
    const multiplier = Math.max(1 / 255, Math.ceil(Math.max(...root) * 255) / 255);
    return [...root.map(value => Math.round(value / multiplier * 255)), Math.round(multiplier * 255)];
  };
  const decode = rgba => rgba.slice(0, 3).map(value => (value / 255 * rgba[3] / 255) ** 2 * 1024);
  for (const linear of [[.0054, .0032, .001], [630, 200, 50]]) {
    const result = decode(encode(linear));
    result.forEach((value, i) => assert.ok(Math.abs(value - linear[i]) / linear[i] < .02,
      `${linear[i]} must survive quantization; decoded ${value}`));
  }
  const legacySmallestPositive = 64 * (1 / 255 / 12.92);
  assert.ok(legacySmallestPositive > .0054 * 3, 'Fixture must reproduce the old dark-level loss');
  const darkLevels = [.0001, .0003, .001, .003, .0054, .01].map(value => decode(encode([value, value, value]))[0]);
  assert.ok(darkLevels.every((value, i) => value > 0 && (i === 0 || value > darkLevels[i - 1])),
    'Dim contact-light gradients must remain positive and distinguishable');
});
