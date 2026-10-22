// Export the real runtime geometry for BlenderProc inspection and light baking.
// No replacement showcase geometry is created. Outputs stay in the supplied
// working directory; the source assets and authored book remain untouched.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

const project = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || '../realism-scene-input');
const includeRoom = process.argv.includes('--include-room');
await mkdir(path.join(output, 'textures'), { recursive: true });
const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : next(specifier, context);
} });
const THREE = await import(threeURL);
globalThis.self = { URL };
globalThis.ProgressEvent = class extends Event { constructor(type, props) { super(type); Object.assign(this, props); } };
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const value = input instanceof Request ? input.url : String(input);
  if (value.startsWith('file:')) return new Response(await readFile(new URL(value)));
  return originalFetch(input, options);
};
THREE.TextureLoader.prototype.load = function(url, onLoad, _progress, onError) {
  const texture = new THREE.Texture();
  Promise.resolve().then(async () => {
    let source;
    if (/^(blob:|data:)/.test(String(url))) {
      const bytes = Buffer.from(await (await originalFetch(url)).arrayBuffer());
      const hash = createHash('sha256').update(bytes).digest('hex');
      const extension = bytes[0] === 0x89 ? 'png' : 'jpg';
      source = path.join(output, 'textures', `${hash}.${extension}`);
      await writeFile(source, bytes);
    } else {
      source = String(url).startsWith('file:') ? fileURLToPath(new URL(url)) :
        path.resolve(project, 'dist', String(url).split('?')[0]);
    }
    texture.image = { src: source, width: 1024, height: 1024 };
    texture.userData.sourcePath = source;
    onLoad?.(texture);
  }).catch(error => onError?.(error));
  return texture;
};

const { ShopStorefront } = await import('../dist/shop-storefront.js');
const { applyStreetSurfaces } = await import('../dist/street-surfaces.js');
const { solarLight } = await import('../dist/shop-time.js');
const { animateStreetActor } = await import('../dist/street-actors.js');
const scene = new THREE.Scene();
const renderer = { capabilities: { getMaxAnisotropy: () => 8 }, shadowMap: { needsUpdate: false } };
let room;
if (includeRoom) {
  const { GLTFLoader } = await import('../dist/vendor/loaders/GLTFLoader.js');
  const { enhanceMaterials } = await import('../dist/room-materials.js');
  const { RoomRadiance } = await import('../dist/room-radiance.js');
  const url = new URL('../dist/assets/bookstore-depth.gltf', import.meta.url);
  room = (await new GLTFLoader().parseAsync(await readFile(url, 'utf8'), new URL('.', url).href)).scene;
  scene.add(room); await enhanceMaterials(room, renderer);
  // Export the runtime practical fixtures too. Cycles computes their diffuse
  // transport directly; the browser's existing diffuse bake is not multiplied
  // into a second offline light solve.
  new RoomRadiance(scene, renderer);
}
const storefront = new ShopStorefront(scene, room);
await applyStreetSurfaces(storefront.root, renderer);
const now = Date.parse('2026-06-21T17:47:00Z'), sunlight = solarLight(now);
storefront.update({ nowMs: now, dt: 0, ...sunlight, visible: true, gentle: false });
// Inspection poses place each actual rig in view; they do not change runtime
// scheduling. Both static-only bake membership and these poses are recorded.
const actorPlacement = [
  [-2, 13.7], [7, 17.1], [-17, 17.1], [23, 13.7], [-30, 13.7],
  [0, 10.45], [4, 20.5], [-4, 10.45], [9, 20.5], [-10, 20.5], [15, 10.45],
];
for (const [i, actor] of storefront.actors.entries()) {
  const [x, z] = actorPlacement[i % actorPlacement.length];
  actor.group.visible = true;
  actor.group.position.set(x, actor.group.userData.actorRig?.type === 'vehicle' ? -.04 : 0, z);
  actor.group.rotation.y = i % 2 ? Math.PI : 0;
  animateStreetActor(actor, { x, z, speed: 1, direction: i % 2 ? -1 : 1, phase: .7 + i }, { nowMs: now, gentle: false });
}
scene.updateMatrixWorld(true);
const geometries = {}, materials = {}, meshes = [], lights = [];
const actorNodes = new Set();
for (const actor of storefront.actors) actor.group.traverse(node => actorNodes.add(node));
const mapNames = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'emissiveMap'];
function materialId(material) {
  if (materials[material.uuid]) return material.uuid;
  const maps = {};
  for (const key of mapNames) {
    const t = material[key];
    if (t?.image?.src) maps[key] = { path: t.userData.sourcePath || t.image.src,
      channel: t.channel, flipY: t.flipY, rotation: t.rotation, repeat: t.repeat.toArray(), offset: t.offset.toArray(), center: t.center.toArray() };
  }
  materials[material.uuid] = { name: material.name, color: material.color?.toArray() || [1, 1, 1],
    roughness: material.roughness ?? 1, metalness: material.metalness || 0,
    emissive: material.emissive?.toArray() || [0, 0, 0], emissiveIntensity: material.emissiveIntensity || 0,
    opacity: material.opacity, transparent: material.transparent, transmission: material.transmission || 0,
    ior: material.ior || 1.5, clearcoat: material.clearcoat || 0,
    normalScale: material.normalScale?.toArray(), bumpScale: material.bumpScale,
    side: material.side, maps, userData: { streetSurface: material.userData?.streetSurface } };
  return material.uuid;
}
scene.traverse(node => {
  if (node.isLight) {
    lights.push({ name: node.name, type: node.type, color: node.color.toArray(), intensity: node.intensity,
      position: node.getWorldPosition(new THREE.Vector3()).toArray(), target: node.target?.getWorldPosition(new THREE.Vector3()).toArray(),
      angle: node.angle, penumbra: node.penumbra, distance: node.distance,
      exterior: Boolean(node.userData.exteriorLight),
      nightIntensity: storefront.streetLights.find(entry => entry.light === node)?.power });
  }
  if (!node.isMesh || node.material?.isShaderMaterial) return;
  const g = node.geometry;
  if (!geometries[g.uuid]) {
    const attribute = name => g.attributes[name] ? Array.from(g.attributes[name].array) : undefined;
    geometries[g.uuid] = { positions: attribute('position'), normals: attribute('normal'),
      uv: attribute('uv'), uv1: attribute('uv1'), uv2: attribute('uv2'),
      indices: g.index ? Array.from(g.index.array) : null, groups: g.groups };
  }
  const material = Array.isArray(node.material) ? node.material.map(materialId) : materialId(node.material);
  const add = (matrixWorld, suffix = '') => meshes.push({ name: node.name + suffix, geometry: g.uuid,
    material, matrixWorld: matrixWorld.toArray(), visible: node.visible, actor: actorNodes.has(node), text: node.userData.text || null });
  if (node.isInstancedMesh) {
    const m = new THREE.Matrix4();
    for (let i = 0; i < node.count; i++) { node.getMatrixAt(i, m); add(new THREE.Matrix4().multiplyMatrices(node.matrixWorld, m), ` instance ${i}`); }
  } else add(node.matrixWorld);
});
const document = { schema: 1, source: 'Actual Legacy runtime geometry', axes: 'right-handed, Y-up, east/up/south',
  inspectionTime: new Date(now).toISOString(), includeRoom, geometries, materials, meshes, lights,
  sunDirection: sunlight.sunDirection,
  groundAO: { bounds: [-40, 40, 7.5, 23.5], width: 2048, height: 512, excludeActors: true },
  cameras: [{ name: 'street-from-door', position: [0, 1.65, 8.5], target: [0, 2.8, 22.5] },
    { name: 'city-block', position: [9, 2.5, 10], target: [-3, 2, 19] },
    { name: 'shop-through-glass', position: [1.8, 1.65, 5.7], target: [0, 2, 22.5] }] };
const destination = path.join(output, 'scene.json');
await writeFile(destination, JSON.stringify(document));
console.log(JSON.stringify({ destination, geometries: Object.keys(geometries).length,
  materials: Object.keys(materials).length, meshes: meshes.length, includeRoom }));
