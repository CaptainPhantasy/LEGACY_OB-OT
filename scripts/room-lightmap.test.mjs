import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import(threeURL);
const { GLTFLoader } = await import('../dist/vendor/loaders/GLTFLoader.js');
const { applyRoomLightmap, updateRoomRevelation } = await import('../dist/room-lightmap.js');
const manifestURL = new URL('../dist/assets/room-lightmap.json', import.meta.url);

async function withImageTransport(callback, resolution = 4096) {
  const originalLoad = THREE.TextureLoader.prototype.load, oldSelf = globalThis.self;
  globalThis.self = { URL };
  THREE.TextureLoader.prototype.load = function(_url, onLoad) {
    const texture = new THREE.Texture({ width: resolution, height: resolution });
    queueMicrotask(() => onLoad(texture));
    return texture;
  };
  try { return await callback(); }
  finally {
    THREE.TextureLoader.prototype.load = originalLoad;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
  }
}

async function loadRoom({ syntheticUV = false } = {}) {
  const bytes = await readFile(new URL('../dist/assets/bookstore-depth.glb', import.meta.url));
  const gltf = await withImageTransport(() => new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), ''));
  if (syntheticUV) gltf.scene.getObjectByName('OldCuriosityShop').traverse(mesh => {
    if (!mesh.isMesh) return;
    const count = mesh.geometry.getAttribute('position').count;
    // These coordinates test the loader/shader contract, not atlas coverage.
    const uv = new Float32Array(count * 2).fill(.5);
    mesh.geometry.setAttribute('uv2', new THREE.BufferAttribute(uv, 2));
  });
  gltf.scene.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = true; });
  return gltf.scene;
}

const renderer = () => ({ capabilities: { getMaxAnisotropy: () => 16 }, shadowMap: { needsUpdate: false } });
const testManifest = { version: 1, node: 'OldCuriosityShop', resolution: 4096, illuminationScale: 8 };
async function applyFixture(room, manifest = testManifest) {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).pathname.split('/').pop(), 'room-lightmap.json');
    return new Response(JSON.stringify(manifest));
  };
  try { return await withImageTransport(() => applyRoomLightmap(room, renderer()), manifest.resolution); }
  finally { globalThis.fetch = oldFetch; }
}

test('full diffuse lightmap replaces live diffuse and leaves the moving cover independent', async () => {
  const room = await loadRoom({ syntheticUV: true });
  const moving = [];
  room.getObjectByName('BookCoverHinge').traverse(mesh => { if (mesh.isMesh) moving.push([mesh, mesh.material]); });
  const result = await applyFixture(room);
  const revelationUniforms = [];
  assert.ok(result.meshes > 0);
  assert.equal(result.uvChannel, 2);
  for (const [mesh, material] of moving) {
    assert.equal(mesh.material, material, 'Moving cover material must remain live');
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.material.lightMap, null);
  }
  room.getObjectByName('OldCuriosityShop').traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.equal(mesh.castShadow, false, 'Baked surfaces must not cast a duplicate live shadow');
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      assert.equal(material.lightMap.channel, 2);
      assert.equal(material.lightMap.flipY, false);
      assert.equal(material.lightMap.colorSpace, THREE.SRGBColorSpace);
      assert.equal(material.lightMapIntensity, 8);
      const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
      material.onBeforeCompile(shader, {});
      assert.equal(shader.uniforms.roomMovingShadowStrength.value, .65);
      const source = shader.fragmentShader;
      const reset = source.indexOf('reflectedLight.directDiffuse = vec3( 0.0 );');
      assert.ok(reset > source.indexOf('#include <lights_fragment_end>'));
      assert.ok(reset < source.indexOf('vec3 totalDiffuse ='));
      assert.match(source, /reflectedLight\.indirectDiffuse = material\.diffuseColor \* \( roomDiffuseIllumination \* roomMovingShadow \+ roomRevelationDiffuse \)/);
      assert.match(source, /#include <shadowmask_pars_fragment>/);
      assert.doesNotMatch(source, /reflectedLight\.(?:directSpecular|indirectSpecular)\s*=/);
      assert.match(source, /totalSpecular \+ totalEmissiveRadiance/);
      assert.match(source, /if \( roomRevelationPower > 0\.0 \)/);
      assert.match(source, /getDistanceAttenuation\( max\( roomRevelationDistance, 0\.2 \), 12\.0, 1\.5 \)/);
      assert.match(source, /inverseTransformDirection\( geometryNormal, viewMatrix \)/);
      assert.match(shader.vertexShader, /modelMatrix \* vec4\( transformed, 1\.0 \)/);
      assert.equal(shader.uniforms.roomRevelationPower.value, 0);
      assert.ok(shader.uniforms.roomRevelationColor.value.equals(new THREE.Color(0xffd893)));
      assert.deepEqual(shader.uniforms.roomRevelationPosition.value.toArray(), [0, 1.45, -5]);
      revelationUniforms.push(shader.uniforms.roomRevelationPower);
    }
  });
  assert.ok(revelationUniforms.length > 1);
  assert.ok(revelationUniforms.every(uniform => uniform === revelationUniforms[0]),
    'Every static material must respond to the same reveal-light update');
  for (const [power, expected] of [[95, 95], [3, 3], [0, 0], [-1, 0], [NaN, 0]]) {
    updateRoomRevelation(room, power);
    assert.ok(revelationUniforms.every(uniform => uniform.value === expected));
  }
  assert.doesNotThrow(() => updateRoomRevelation(new THREE.Group(), 95), 'Live-light fallback needs no bake uniforms');
});

test('an invalid atlas fails before any room materials or shadow flags change', async () => {
  for (const defect of ['missing', 'nan', 'outside']) {
    const room = await loadRoom({ syntheticUV: true });
    const meshes = [];
    room.getObjectByName('OldCuriosityShop').traverse(mesh => { if (mesh.isMesh) meshes.push([mesh, mesh.material]); });
    const last = meshes.at(-1)[0];
    if (defect === 'missing') last.geometry.deleteAttribute('uv2');
    else last.geometry.getAttribute('uv2').setX(0, defect === 'nan' ? NaN : 1.1);
    await assert.rejects(applyFixture(room), /coordinates/);
    for (const [mesh, material] of meshes) {
      assert.equal(mesh.material, material);
      assert.equal(mesh.castShadow, true);
    }
    assert.equal(room.userData.roomLightmap, undefined);
  }
});

test('the shipped export has a finite atlas matching the published lightmap manifest',
  { skip: !existsSync(manifestURL) }, async () => {
    const manifest = JSON.parse(await readFile(manifestURL, 'utf8'));
    const bytes = await readFile(new URL('../dist/assets/room-lightmap.png', import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(bytes.readUInt32BE(16), manifest.resolution);
    assert.equal(bytes.readUInt32BE(20), manifest.resolution);
    // Actual exported UVs are checked here; no synthetic atlas is inserted.
    const room = await loadRoom();
    const result = await applyFixture(room, manifest);
    assert.ok(result.meshes > 0);
  });
