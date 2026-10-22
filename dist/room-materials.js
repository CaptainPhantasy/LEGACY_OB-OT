import * as THREE from 'three';
import { loadPhotoSurfaceFamily } from './street-surfaces.js?scene=realism-1';

// Surface textures carry no painted lighting. The room's lamps, reflections and
// traced occlusion can therefore respond correctly as the visitor looks around.
const families = {
  wood: { tile: [.24, 1.6], bump: .0014, environment: .42 },
  mineral: { tile: [.6, .6], bump: .0032, environment: .22 },
  cloth: { tile: [.08, .08], bump: .00065, environment: .18 },
  paper: { tile: [.18, .18], bump: .0003, environment: .22 },
  leather: { tile: [.18, .18], bump: .0008, environment: .46 },
  metal: { tile: [.24, .24], bump: .00018, environment: .95 },
  glass: { tile: [.3, .3], bump: .00006, environment: 1.1 },
};

function familyFor(name) {
  if (/walnut|ebony|joinery/i.test(name)) return 'wood';
  if (/leather|rawhide/i.test(name)) return 'leather';
  if (/cloth|linen|canvas|rug|hemp|thread/i.test(name)) return 'cloth';
  if (/paper|leaf|page edges/i.test(name)) return 'paper';
  if (/brass|bronze|iron|copper|gilt|gold leaf|silver|steel|aluminium|display metal/i.test(name)) return 'metal';
  if (/plaster|stone|brick|pottery/i.test(name)) return 'mineral';
  if (/bottle|blown glass/i.test(name)) return 'glass';
  return null;
}

// Find each disconnected timber's long axis, including UV/normal seams. The
// glTF combines the whole shop by material, so mesh bounds alone would orient
// every drawer, beam and floorboard in the same direction.
function timberAxes(g, worldPositions) {
  const count = g.attributes.position.count;
  const parents = new Int32Array(count);
  for (let i = 0; i < count; i++) parents[i] = i;
  function root(i) { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; }
  function join(a, b) { a = root(a); b = root(b); if (a !== b) parents[b] = a; }
  const index = g.index, length = index ? index.count : count;
  for (let i = 0; i < length; i += 3) {
    const a = index ? index.getX(i) : i;
    join(a, index ? index.getX(i + 1) : i + 1);
    join(a, index ? index.getX(i + 2) : i + 2);
  }
  const seams = new Map();
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    const key = `${Math.round(worldPositions[j] * 20000)},${Math.round(worldPositions[j + 1] * 20000)},${Math.round(worldPositions[j + 2] * 20000)}`;
    const other = seams.get(key);
    if (other === undefined) seams.set(key, i); else join(i, other);
  }
  const bounds = new Map();
  for (let i = 0; i < count; i++) {
    const r = root(i), j = i * 3;
    let b = bounds.get(r);
    if (!b) { b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; bounds.set(r, b); }
    for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], worldPositions[j + a]); b[a + 3] = Math.max(b[a + 3], worldPositions[j + a]); }
  }
  const axes = new Map();
  for (const [r, b] of bounds) {
    const d = [b[3] - b[0], b[4] - b[1], b[5] - b[2]];
    axes.set(r, d[1] >= d[0] && d[1] >= d[2] ? 1 : d[0] >= d[2] ? 0 : 2);
  }
  const result = new Uint8Array(count);
  for (let i = 0; i < count; i++) result[i] = axes.get(root(i));
  return result;
}

// GLB meshes contain many small objects merged by material, and some handmade
// books have no usable UVs. Project in physical units instead of stretching a
// texture over each whole mesh. Existing UV0 is never touched: the cover's
// authored colour, normal maps and lettering remain exactly aligned. UV1 is
// reserved for repeating surface detail; UV2 remains available for unique
// baked lightmaps and must never be overwritten by this projection.
function addSurfaceUV(mesh, kind, tile) {
  const g = mesh.geometry, pos = g.attributes.position, normal = g.attributes.normal;
  if (!pos || !normal) return;
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  let woodAxes, worldPositions;
  if (kind === 'wood') {
    worldPositions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).toArray(worldPositions, i * 3);
    woodAxes = timberAxes(g, worldPositions);
  }
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = p.x; v = -p.z; }
    else if (ax >= az) { u = -p.z; v = p.y; }
    else { u = p.x; v = p.y; }
    if (woodAxes) {
      const grain = woodAxes[i], face = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
      if (grain !== face) {
        const across = 3 - grain - face;
        u = p.getComponent(across); v = p.getComponent(grain);
      }
    }
    uv[i * 2] = u / tile[0];
    uv[i * 2 + 1] = v / tile[1];
  }
  g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
}

function physicalGlass(source) {
  const material = new THREE.MeshPhysicalMaterial();
  if (source.isMeshPhysicalMaterial) material.copy(source);
  else THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  material.defines = { STANDARD: '', PHYSICAL: '' };
  // Respect physical settings authored in Blender, including lamp glass.
  // Unspecified old bottles retain their existing opaque, dusty appearance.
  if (!source.isMeshPhysicalMaterial) {
    material.clearcoat = .32;
    material.clearcoatRoughness = .28;
    material.ior = 1.48;
  }
  return material;
}

function woodFinish(source) {
  // The current floor, shelves and back table are rough timber. A shared
  // walnut material must not acquire a varnish simply because it is wood.
  return /varnish|lacquer|shellac|polished wood/i.test(source.name) ||
    source.userData?.surfaceFinish === 'finished' || source.roughness < .7;
}

function finishedWood(source) {
  const material = new THREE.MeshPhysicalMaterial();
  if (source.isMeshPhysicalMaterial) material.copy(source);
  else THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  material.defines = { STANDARD: '', PHYSICAL: '' };
  material.clearcoat = Math.max(source.clearcoat || 0, .22);
  material.clearcoatRoughness = .25;
  return material;
}

export async function enhanceMaterials(room, renderer) {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = {};
  await Promise.all(Object.entries(families).map(async ([name, family]) => {
    const loaded = await Promise.all([
      loader.loadAsync(`./assets/surfaces/${name}-color.webp`),
      loader.loadAsync(`./assets/surfaces/${name}-height.png`),
      loader.loadAsync(`./assets/surfaces/${name}-roughness.png?depth=1`),
    ]);
    for (const texture of loaded) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
      texture.channel = 1;
      texture.colorSpace = THREE.NoColorSpace;
    }
    loaded[0].colorSpace = THREE.SRGBColorSpace;
    textures[name] = { color: loaded[0], height: loaded[1], roughness: loaded[2] };
  }));

  // Photograph-derived normal detail adds irregular pores, worn grain and
  // plaster relief to the existing pigment and baked light. Preserve authored
  // normal maps (especially the book's cracks) and the dry timber roughness.
  // An unavailable extra map falls back to the delivered micro-height surface.
  let photoNormalFamilies = 0;
  await Promise.all([['wood', 'wood'], ['leather', 'leather'], ['mineral', 'plaster']].map(async ([kind, photo]) => {
    try {
      const maps = await loadPhotoSurfaceFamily(photo, renderer);
      textures[kind].normal = maps.normal;
      textures[kind].normalStrength = maps.spec.normal;
      photoNormalFamilies++;
    } catch { /* The existing local surface is a complete fallback. */ }
  }));

  room.updateMatrixWorld(true);
  const enhanced = new Map();
  const counts = {};
  room.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const kind = materials.map(m => familyFor(m.name)).find(Boolean);
    if (kind) addSurfaceUV(mesh, kind, families[kind].tile);
    const replacements = materials.map(original => {
      if (enhanced.has(original)) return enhanced.get(original);
      const type = familyFor(original.name);
      if (!type) return original;
      const isFinishedWood = type === 'wood' && woodFinish(original);
      const material = type === 'glass' ? physicalGlass(original) :
        isFinishedWood ? finishedWood(original) : original;
      const maps = textures[type], config = families[type];
      // Retain all authored colour maps, including the old leather cover.
      // The delivery GLB uses a neutral white texel to retain unused UV0.
      // That marker is not authored colour and must not suppress real detail.
      // Neutral silver models keep their authored metal color. The inherited
      // bronze/brass tile still supplies roughness and micro-surface detail.
      const neutralMetal = type === 'metal' && /silver|steel|aluminium/i.test(material.name);
      if (!material.map || material.userData.room_depth_placeholder_color) material.map = neutralMetal ? null : maps.color;
      if (material.map) material.map.anisotropy = anisotropy;
      if (material.normalMap) material.normalMap.anisotropy = anisotropy;
      else if (maps.normal) {
        material.normalMap = maps.normal;
        material.normalScale.setScalar(maps.normalStrength);
        material.userData.surfaceNormalSource = 'Poly Haven / CC0';
      } else { material.bumpMap = maps.height; material.bumpScale = config.bump; }
      material.roughnessMap = maps.roughness;
      // Both finishes retain varied roughness. Only an authored furniture
      // finish is allowed the lower range; dry boards remain .78–.97.
      material.roughness = isFinishedWood ? .68 : 1;
      if (isFinishedWood) material.clearcoatRoughnessMap = maps.roughness;
      material.envMapIntensity = config.environment;
      if (type === 'metal') {
        if (/brass|bronze/i.test(material.name)) material.metalness = .76;
        else if (/rust|patina/i.test(material.name)) material.metalness = .3;
      }
      // Ancient repairs remain dry and very worn; they never become varnished.
      if (/desiccated|rawhide/i.test(material.name)) material.envMapIntensity = .28;
      material.userData.surfaceFamily = type;
      if (type === 'wood') material.userData.surfaceFinish = isFinishedWood ? 'finished' : 'dry';
      material.needsUpdate = true;
      enhanced.set(original, material);
      counts[type] = (counts[type] || 0) + 1;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
  });
  return { materials: enhanced.size, families: counts, textureCount: 21,
    resolution: 512, photoNormalFamilies, photoNormalResolution: 1024 };
}
