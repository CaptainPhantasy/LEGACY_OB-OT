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
const { enhanceMaterials } = await import('../dist/room-materials.js');
const manifestURL = new URL('../dist/assets/room-lightmap.json', import.meta.url);
const roomURL = new URL('../dist/assets/bookstore-depth.gltf', import.meta.url);

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

async function withLocalBinaryTransport(callback) {
  const oldFetch = globalThis.fetch, oldProgressEvent = globalThis.ProgressEvent;
  const hadProgressEvent = Object.hasOwn(globalThis, 'ProgressEvent');
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    // Node fetch has no file: transport. Supply actual buffer bytes only;
    // other requests retain their normal behavior and images use the stub above.
    if (url.protocol !== 'file:' || !url.pathname.endsWith('.bin')) return oldFetch(input, options);
    const bytes = await readFile(url);
    return new Response(bytes, { status: 200, headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.byteLength),
    } });
  };
  if (typeof oldProgressEvent === 'undefined') {
    globalThis.ProgressEvent = class extends Event {
      constructor(type, { lengthComputable = false, loaded = 0, total = 0 } = {}) {
        super(type);
        Object.assign(this, { lengthComputable, loaded, total });
      }
    };
  }
  try { return await callback(); }
  finally {
    globalThis.fetch = oldFetch;
    if (hadProgressEvent) globalThis.ProgressEvent = oldProgressEvent;
    else delete globalThis.ProgressEvent;
  }
}

async function loadRoom({ syntheticUV = false } = {}) {
  const source = await readFile(roomURL, 'utf8');
  const gltf = await withImageTransport(() => withLocalBinaryTransport(() => new GLTFLoader().parseAsync(
    source, new URL('.', roomURL).href)));
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

async function exportedDocument() {
  const document = JSON.parse(await readFile(roomURL, 'utf8'));
  assert.equal(document.asset.version, '2.0');
  assert.ok(document.buffers.length > 0, 'The scene must retain its binary geometry and image data');
  for (const buffer of document.buffers) {
    assert.ok(typeof buffer.uri === 'string' && buffer.uri.endsWith('.bin') &&
      !buffer.uri.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(buffer.uri),
    'Binary scene chunks must use relative file paths');
    const bytes = await readFile(new URL(buffer.uri, roomURL));
    assert.equal(bytes.length, buffer.byteLength, `${buffer.uri}: binary chunk length mismatch`);
    assert.ok(bytes.length <= 8 * 1024 * 1024, `${buffer.uri}: chunk exceeds the delivery size bound`);
  }
  for (const view of document.bufferViews) {
    const buffer = document.buffers[view.buffer];
    assert.ok(buffer && (view.byteOffset || 0) >= 0 && view.byteLength > 0 &&
      (view.byteOffset || 0) + view.byteLength <= buffer.byteLength,
    'Every material and geometry buffer view must remain within its declared chunk');
  }
  return document;
}

function assertLinearFactor(actual, expected, label) {
  assert.equal(actual?.length, expected.length, `${label}: missing linear factor`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Number.isFinite(actual[i]) && Math.abs(actual[i] - expected[i]) <= 1e-6,
      `${label}: channel ${i} is ${actual[i]}, expected ${expected[i]}`);
  }
}

function snapshotUV(attribute) {
  assert.ok(attribute, 'Final export must retain the requested UV attribute');
  assert.equal(attribute.itemSize, 2);
  const values = new Float32Array(attribute.count * 2);
  for (let i = 0; i < attribute.count; i++) {
    values[i * 2] = attribute.getX(i);
    values[i * 2 + 1] = attribute.getY(i);
  }
  return Buffer.from(values.buffer);
}

test('the actual glTF retains valid binary chunks and all linear material factors instead of white defaults', async () => {
  const document = await exportedDocument();
  assert.equal(document.materials.length, 65, 'Keep every static and articulated material');
  for (const material of document.materials) {
    const pbr = material.pbrMetallicRoughness;
    assert.ok(pbr && Object.hasOwn(pbr, 'baseColorFactor'),
      `${material.name}: an explicit baseColorFactor is required, including authored white`);
    assert.equal(pbr.baseColorFactor.length, 4);
    assert.ok(pbr.baseColorFactor.every(value => Number.isFinite(value) && value >= 0 && value <= 1),
      `${material.name}: baseColorFactor must contain finite linear RGBA values`);
  }
  for (const [name, expected] of [
    ['Book cloth 05', [.22, .11, .055, 1]],
    ['Antique paper', [.51, .4, .255, 1]],
  ]) {
    const materials = document.materials.filter(material => material.extras?.original_material_name === name);
    assert.ok(materials.length > 0, `Missing exported ${name}`);
    for (const material of materials) {
      assertLinearFactor(material.pbrMetallicRoughness.baseColorFactor, expected, material.name);
      assert.equal(material.extras.room_depth_placeholder_color, true,
        `${material.name}: the neutral UV-retention image must be marked as a placeholder`);
    }
  }
});

test('final exported extras replace only placeholder maps and preserve color, original UVs, lightmap UVs and dry timber', async () => {
  // Decode the real glTF and exercise the real material enhancer. Only image
  // transport is mocked; this checks asset integration, not GPU appearance.
  const room = await loadRoom();
  const staticMeshes = new Set();
  room.getObjectByName('OldCuriosityShop').traverse(mesh => { if (mesh.isMesh) staticMeshes.add(mesh); });
  const meshes = [];
  room.traverse(mesh => {
    if (!mesh.isMesh) return;
    const uv0 = mesh.geometry.getAttribute('uv');
    const uv2 = mesh.geometry.getAttribute('uv2');
    if (staticMeshes.has(mesh)) assert.ok(uv2, `${mesh.name}: static lightmap UV2 is missing`);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshes.push({ mesh, uv0, uv2, uv0Bytes: snapshotUV(uv0), uv2Bytes: uv2 ? snapshotUV(uv2) : null,
      materials: materials.map(material => ({
        name: material.name, color: material.color.toArray(), map: material.map,
        placeholder: material.userData.room_depth_placeholder_color,
        sourceName: material.userData.original_material_name,
      })) });
  });
  assert.ok(meshes.length > 0);
  await withImageTransport(() => enhanceMaterials(room, renderer()), 512);
  let replaced = 0, authored = 0, dryWood = 0, checkedCloth = 0, checkedPaper = 0;
  for (const before of meshes) {
    const { mesh } = before;
    assert.equal(mesh.geometry.getAttribute('uv'), before.uv0, `${mesh.name}: UV0 attribute replaced`);
    assert.equal(mesh.geometry.getAttribute('uv2'), before.uv2, `${mesh.name}: UV2 attribute replaced`);
    assert.ok(snapshotUV(before.uv0).equals(before.uv0Bytes), `${mesh.name}: authored UV0 changed`);
    if (before.uv2Bytes) assert.ok(snapshotUV(before.uv2).equals(before.uv2Bytes), `${mesh.name}: baked UV2 changed`);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    assert.equal(materials.length, before.materials.length);
    for (let i = 0; i < materials.length; i++) {
      const material = materials[i], original = before.materials[i];
      assert.deepEqual(material.color.toArray(), original.color, `${original.name}: linear factor changed`);
      assert.equal(material.userData.original_material_name, original.sourceName);
      assert.equal(material.userData.room_depth_placeholder_color, original.placeholder);
      if (original.placeholder && material.userData.surfaceFamily) {
        assert.ok(original.map, `${original.name}: the export must contain its neutral UV-retention image`);
        assert.notEqual(material.map, original.map, `${original.name}: white placeholder suppressed surface color`);
        assert.equal(material.map.channel, 1);
        assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
        replaced++;
      } else if (original.map && !original.placeholder) {
        assert.equal(material.map, original.map, `${original.name}: authored image replaced`);
        authored++;
      }
      if (/walnut|ebony|joinery/i.test(original.sourceName || original.name)) {
        assert.equal(material.userData.surfaceFinish, 'dry', `${original.name}: dry timber gained varnish`);
        assert.equal(material.roughness, 1);
        assert.equal(material.clearcoat || 0, 0);
        assert.ok(material.roughnessMap, `${original.name}: dry timber lost roughness variation`);
        assert.equal(material.roughnessMap.channel, 1);
        assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
        dryWood++;
      }
      if (original.sourceName === 'Book cloth 05') {
        assertLinearFactor(material.color.toArray(), [.22, .11, .055], original.name);
        checkedCloth++;
      }
      if (original.sourceName === 'Antique paper') {
        assertLinearFactor(material.color.toArray(), [.51, .4, .255], original.name);
        checkedPaper++;
      }
    }
  }
  assert.ok(replaced > 0, 'Final asset did not exercise placeholder replacement');
  assert.ok(authored > 0, 'Final asset did not exercise authored-map preservation');
  assert.ok(dryWood >= 10, 'Final asset did not retain all walnut and ebony timber variants');
  assert.ok(checkedCloth > 0 && checkedPaper > 0, 'Known linear color factors were not loaded');
});

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
