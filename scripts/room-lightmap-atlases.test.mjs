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
  const room = new THREE.Group();
  const original = new THREE.MeshStandardMaterial({ color: new THREE.Color(.22, .11, .055), roughness: .86 });
  original.name = 'Book cloth 05 / delivery';
  original.userData = { original_material_name: 'Book cloth 05', room_depth_placeholder_color: true };
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('uv2', geometry.getAttribute('uv').clone());
  function group(name, count) {
    const node = new THREE.Group(); node.name = name; room.add(node);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry.clone(), original); mesh.castShadow = true; node.add(mesh);
    }
    return node;
  }
  const main = group('OldCuriosityShop', 2), shelf = group('CenterCuriosityShelf', 2), hinge = group('BookCoverHinge', 1);
  return { room, main, shelf, hinge, original };
}

function manifests() {
  const shared = { version: 1, uv_channel: 2, encoding: 'RGBM_SQRT' };
  return {
    'room-lightmap.json': { ...shared, node: 'OldCuriosityShop', file: 'room-lightmap.png', resolution: 4096,
      illuminationScale: 1024, additionalLightmaps: ['curiosity-lightmap.json'] },
    'curiosity-lightmap.json': { ...shared, node: 'CenterCuriosityShelf', file: 'curiosity-lightmap.png',
      resolution: 2048, illuminationScale: 32 }
  };
}

async function withTransport(callback, documents = manifests(), failImage = null, wrongSize = false) {
  const originalFetch = globalThis.fetch, originalLoad = THREE.TextureLoader.prototype.loadAsync;
  const images = [], disposed = new Set(), requests = [];
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('scene'), 'curiosities-1');
    const name = new URL(url).pathname.split('/').pop(); requests.push(name);
    return documents[name] ? new Response(JSON.stringify(documents[name])) : new Response('', { status: 404 });
  };
  THREE.TextureLoader.prototype.loadAsync = async url => {
    assert.equal(new URL(url).searchParams.get('scene'), 'curiosities-1');
    const name = new URL(url).pathname.split('/').pop(); requests.push(name);
    if (name === failImage) throw new Error('fixture image unavailable');
    const document = Object.values(documents).find(item => item.file === name);
    assert.ok(document, `Unexpected image request ${name}`);
    const size = wrongSize && name === 'curiosity-lightmap.png' ? 1024 : document.resolution;
    const image = new THREE.Texture({ width: size, height: size });
    image.addEventListener('dispose', () => disposed.add(image)); images.push(image);
    return image;
  };
  try { return await callback({ images, disposed, requests }); }
  finally { globalThis.fetch = originalFetch; THREE.TextureLoader.prototype.loadAsync = originalLoad; }
}

const renderer = () => ({ capabilities: { getMaxAnisotropy: () => 8 }, shadowMap: { needsUpdate: false } });
function shaderFor(material) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, {});
  return shader;
}
function unchanged(f) {
  for (const node of [f.main, f.shelf, f.hinge]) for (const mesh of node.children) {
    assert.equal(mesh.material, f.original, 'A failed atlas must not leave partially replaced materials');
    assert.equal(mesh.castShadow, true, 'A failed atlas must retain the live-light fallback');
  }
  assert.equal(f.room.userData.roomLightmap, undefined);
}

test('separate atlases clone shared materials independently and share the live revelation', async () => {
  const f = fixture(), r = renderer();
  const result = await withTransport(() => applyRoomLightmap(f.room, r));
  assert.equal(result.meshes, 4); assert.equal(result.materials, 2);
  assert.deepEqual(result.atlases.map(atlas => [atlas.node, atlas.resolution]),
    [['OldCuriosityShop', 4096], ['CenterCuriosityShelf', 2048]]);
  const main = f.main.children[0].material, shelf = f.shelf.children[0].material;
  assert.notEqual(main, shelf); assert.notEqual(main.lightMap, shelf.lightMap);
  assert.equal(f.main.children[1].material, main); assert.equal(f.shelf.children[1].material, shelf);
  assert.equal(main.lightMapIntensity, 1024); assert.equal(shelf.lightMapIntensity, 32);
  for (const material of [main, shelf]) {
    assert.equal(material.name, f.original.name);
    assert.deepEqual(material.userData.original_material_name, f.original.userData.original_material_name);
    assert.deepEqual(material.color.toArray(), f.original.color.toArray());
    assert.equal(material.roughness, f.original.roughness);
    assert.equal(material.lightMap.channel, 2); assert.equal(material.lightMap.flipY, false);
    assert.equal(material.lightMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.lightMap.generateMipmaps, false);
  }
  const shaders = [shaderFor(main), shaderFor(shelf)];
  assert.equal(shaders[0].uniforms.roomRevelationPower, shaders[1].uniforms.roomRevelationPower);
  for (const power of [95, 3, 0]) {
    updateRoomRevelation(f.room, power);
    shaders.forEach(shader => assert.equal(shader.uniforms.roomRevelationPower.value, power));
  }
  for (const node of [f.main, f.shelf]) node.children.forEach(mesh => assert.equal(mesh.castShadow, false));
  assert.equal(f.hinge.children[0].material, f.original);
  assert.equal(f.hinge.children[0].castShadow, true); assert.equal(f.original.lightMap, null);
  assert.equal(r.shadowMap.needsUpdate, true);
});

test('invalid second-atlas geometry leaves both atlases and the hero cover unchanged', async () => {
  for (const defect of ['missing UV', 'out of bounds', 'overlapping nodes', 'moving book']) {
    const f = fixture();
    if (defect === 'missing UV') f.shelf.children[0].geometry.deleteAttribute('uv2');
    if (defect === 'out of bounds') f.shelf.children[0].geometry.getAttribute('uv2').setX(0, 1.1);
    if (defect === 'overlapping nodes') f.main.add(f.shelf);
    if (defect === 'moving book') f.shelf.add(f.hinge);
    await withTransport(async ({ requests }) => {
      await assert.rejects(applyRoomLightmap(f.room, renderer()), /coordinates|overlap|moving book/);
      assert.equal(requests.filter(name => name.endsWith('.png')).length, 0);
    });
    // Traverse only meshes because two cases intentionally nest the nodes.
    f.room.traverse(mesh => { if (mesh.isMesh) { assert.equal(mesh.material, f.original); assert.equal(mesh.castShadow, true); } });
    assert.equal(f.room.userData.roomLightmap, undefined);
  }
});

test('failed or incorrectly sized second images dispose loaded textures without partial application', async () => {
  for (const failure of ['unavailable', 'wrong dimensions']) {
    const f = fixture();
    await withTransport(async ({ images, disposed }) => {
      await assert.rejects(applyRoomLightmap(f.room, renderer()), /unavailable|does not match/);
      unchanged(f);
      assert.ok(images.length >= 1);
      assert.equal(disposed.size, images.length, 'Every loaded texture must be released on failure');
    }, manifests(), failure === 'unavailable' ? 'curiosity-lightmap.png' : null, failure === 'wrong dimensions');
  }
});

test('atlas routing permits only the known node/file pair and a single nonrecursive shelf manifest', async () => {
  const cases = [
    docs => { delete docs['curiosity-lightmap.json']; },
    docs => { docs['room-lightmap.json'].additionalLightmaps = []; },
    docs => { docs['room-lightmap.json'].additionalLightmaps.push('curiosity-lightmap.json'); },
    docs => { docs['room-lightmap.json'].additionalLightmaps = ['https://invalid.example/atlas.json']; },
    docs => { docs['curiosity-lightmap.json'].node = 'OldCuriosityShop'; },
    docs => { docs['curiosity-lightmap.json'].file = 'room-lightmap.png'; },
    docs => { docs['curiosity-lightmap.json'].uv_channel = 1; },
    docs => { docs['curiosity-lightmap.json'].additionalLightmaps = ['curiosity-lightmap.json']; },
  ];
  for (const mutate of cases) {
    const f = fixture(), docs = manifests(); mutate(docs);
    await withTransport(async ({ requests }) => {
      await assert.rejects(applyRoomLightmap(f.room, renderer()), /format|could not load|missing/);
      unchanged(f);
      assert.equal(requests.filter(name => name.endsWith('.png')).length, 0);
    }, docs);
  }
});
