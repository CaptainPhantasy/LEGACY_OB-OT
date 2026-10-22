import * as THREE from 'three';

// Relightable photographs from Poly Haven, bundled locally under CC0. The
// source URLs, conversion settings and content hashes live beside the maps.
// Values are metres, so road grit and brick courses do not grow with a mesh.
export const PHOTO_SURFACES = Object.freeze({
  brick: { tile: [2.5, 2.5], normal: .8, color: true },
  asphalt: { tile: [3, 3], normal: .72, color: true },
  concrete: { tile: [3, 3], normal: .7, color: true },
  plaster: { tile: [2, 2], normal: .65, color: true },
  wood: { tile: [.45, 1.8], normal: .48, color: true, rotation: Math.PI / 2 },
  leather: { tile: [.45, .45], normal: .55, color: false },
});
const photoCache = new Map();
const detailCache = new Map();

function configure(texture, renderer, color = false, rotation = 0) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.channel = 1;
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  if (rotation) { texture.center.set(.5, .5); texture.rotation = rotation; }
  return texture;
}

export function loadPhotoSurfaceFamily(kind, renderer) {
  const spec = PHOTO_SURFACES[kind];
  if (!spec) return Promise.reject(new TypeError(`Unknown photo surface: ${kind}`));
  if (!photoCache.has(kind)) {
    const loader = new THREE.TextureLoader();
    const load = (suffix, color = false) => loader.loadAsync(`./assets/street-surfaces/${kind}-${suffix}.webp`)
      .then(texture => configure(texture, renderer, color, spec.rotation || 0));
    const pending = Promise.all([spec.color ? load('diff', true) : null, load('nor_gl'), load('rough')])
      .then(([color, normal, roughness]) => ({ color, normal, roughness, spec }))
      .catch(error => { photoCache.delete(kind); throw error; });
    photoCache.set(kind, pending);
  }
  return photoCache.get(kind);
}

function loadDetailFamily(kind, renderer) {
  if (!detailCache.has(kind)) {
    const loader = new THREE.TextureLoader();
    const pending = Promise.all(['height.png', 'roughness.png?depth=1'].map(suffix =>
      loader.loadAsync(`./assets/surfaces/${kind}-${suffix}`).then(t => configure(t, renderer))))
      .then(([height, roughness]) => ({ height, roughness }))
      .catch(error => { detailCache.delete(kind); throw error; });
    detailCache.set(kind, pending);
  }
  return detailCache.get(kind);
}

export function streetSurfaceFamily(material) {
  if (!material?.isMeshStandardMaterial || material.map || material.transparent || material.opacity < 1) return null;
  if (material.userData?.streetSurface === false) return null;
  if (material.userData?.streetSurface) {
    const aliases = { stone: 'concrete', bark: 'wood', steel: 'metal', awning: 'cloth' };
    return aliases[material.userData.streetSurface] || material.userData.streetSurface;
  }
  const name = material.name || '';
  // Labels, vehicle paint and windows retain their own authored appearance.
  if (/sign|window|glass|lens|headlamp|tail.?light|brake|vehicle.*paint|car.*paint|bus.*paint|truck.*paint|skin|hair|road (?:paint|yellow)|leaf|leaves|foliage/i.test(name)) return null;
  if (/asphalt|tarmac|road patch/i.test(name)) return 'asphalt';
  if (/masonry|brick/i.test(name)) return 'brick';
  if (/plaster|stucco/i.test(name)) return 'plaster';
  if (/concrete|limestone|stone|mortar|pavement|curb/i.test(name)) return 'concrete';
  if (/walnut|timber|wood|bark|moulding|bench slat/i.test(name)) return 'wood';
  if (/canvas|awning|canopy|coat|trouser|shirt|cloth|fabric/i.test(name)) return 'cloth';
  if (/brass|iron|steel|aluminium|chrome|metal/i.test(name)) return 'metal';
  return null;
}

// Called only after decorative geometry has been batched. Clone because a
// Builder primitive may still be shared by articulated limbs or other parts.
// UV0 and UV2 are retained byte-for-byte; repeating detail uses only UV1.
export function prepareStreetSurfaceUV(mesh, kind) {
  const source = mesh.geometry, position = source?.attributes.position, normal = source?.attributes.normal;
  if (!position || !normal) return false;
  const tile = PHOTO_SURFACES[kind]?.tile || (kind === 'cloth' ? [.08, .08] : [.24, .24]);
  const geometry = source.clone(), uv = new Float32Array(position.count * 2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = p.x; v = -p.z; }
    else if (ax >= az) { u = -p.z; v = p.y; }
    else { u = p.x; v = p.y; }
    uv[i * 2] = u / tile[0]; uv[i * 2 + 1] = v / tile[1];
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  mesh.geometry = geometry;
  mesh.userData.streetSurfaceUV = kind;
  return true;
}

export async function applyStreetSurfaces(root, renderer) {
  const materials = new Map(), meshes = [];
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      const kind = streetSurfaceFamily(material);
      if (kind) { materials.set(material, kind); meshes.push({ mesh, kind }); }
    }
  });
  const types = [...new Set(materials.values())], loaded = new Map(), failures = [];
  await Promise.all(types.map(async kind => {
    try { loaded.set(kind, await (PHOTO_SURFACES[kind] ? loadPhotoSurfaceFamily(kind, renderer) : loadDetailFamily(kind, renderer))); }
    catch { failures.push(kind); }
  }));
  const projected = new Set();
  for (const { mesh, kind } of meshes) {
    if (!loaded.has(kind) || projected.has(mesh)) continue;
    prepareStreetSurfaceUV(mesh, kind); projected.add(mesh);
  }
  let count = 0;
  for (const [material, kind] of materials) {
    const maps = loaded.get(kind); if (!maps) continue;
    if (maps.color) {
      material.map = maps.color;
      // Photographs already contain pigment. Preserve only a restrained tint
      // of the architectural palette rather than multiplying two dark colors.
      material.color.lerp(new THREE.Color(1, 1, 1), kind === 'wood' ? .55 : .82);
    }
    if (maps.normal) {
      material.normalMap = maps.normal;
      material.normalScale.setScalar(maps.spec.normal);
    } else {
      material.bumpMap = maps.height;
      material.bumpScale = kind === 'cloth' ? .0006 : .00022;
    }
    material.roughnessMap = maps.roughness;
    // Preserve an intentionally matte paint/cloth finish, with real wear.
    material.roughness = kind === 'metal' ? Math.max(.6, material.roughness) : 1;
    material.userData.streetSurface = kind;
    material.userData.surfaceSource = PHOTO_SURFACES[kind] ? 'Poly Haven / CC0' : 'Original procedural microdetail';
    material.needsUpdate = true; count++;
  }
  return { materials: count, meshes: projected.size, families: [...loaded.keys()], failures };
}

export const STREET_GROUND_AO_BOUNDS = Object.freeze({ minX: -40, maxX: 40, minZ: 7.5, maxZ: 23.5 });

// This is the actual static street's offline traced occlusion, not a painted
// fake shadow. The image's top row is z=7.5; bottom is z=23.5. White border
// pixels and clamp wrapping keep regions outside the baked block unoccluded.
export async function applyStreetGroundAO(root, renderer) {
  const texture = await new THREE.TextureLoader().loadAsync('./assets/street-surfaces/ground-ao.webp');
  texture.colorSpace = THREE.NoColorSpace;
  texture.channel = 2;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const bounds = STREET_GROUND_AO_BOUNDS, p = new THREE.Vector3(), n = new THREE.Vector3();
  const materials = new Map(); let meshes = 0;
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isMesh || mesh.geometry.attributes.uv2) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const eligible = list.some(m => ['asphalt', 'concrete'].includes(m.userData?.streetSurface || streetSurfaceFamily(m)));
    if (!eligible || list.some(m => m.lightMap)) return;
    const source = mesh.geometry, position = source.attributes.position, normal = source.attributes.normal;
    if (!position || !normal) return;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const uv = new Float32Array(position.count * 2); let topVertices = 0;
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      if (n.y > .7 && p.y < .4) {
        // Keep out-of-bounds coordinates linear: a large road's vertices may
        // lie beyond the bake while the middle of its triangles remains in it.
        uv[i * 2] = (p.x - bounds.minX) / (bounds.maxX - bounds.minX);
        uv[i * 2 + 1] = (bounds.maxZ - p.z) / (bounds.maxZ - bounds.minZ);
        topVertices++;
      } else { uv[i * 2] = -10; uv[i * 2 + 1] = -10; }
    }
    if (!topVertices) return;
    mesh.geometry = source.clone();
    mesh.geometry.setAttribute('uv2', new THREE.BufferAttribute(uv, 2));
    mesh.userData.streetGroundAO = true; meshes++;
    // Some decorative walls share their material with a pavement batch. Keep
    // their existing UV2/lightmap and material untouched: only ground receiver
    // meshes use this AO variant, shared among matching receiver batches.
    const receiverMaterials = list.map(material => {
      if (!material.isMeshStandardMaterial) return material;
      if (!materials.has(material)) {
        const receiver = material.clone();
        receiver.onBeforeCompile = material.onBeforeCompile;
        receiver.customProgramCacheKey = material.customProgramCacheKey;
        receiver.aoMap = texture; receiver.aoMapIntensity = .8;
        receiver.needsUpdate = true;
        materials.set(material, receiver);
      }
      return materials.get(material);
    });
    mesh.material = Array.isArray(mesh.material) ? receiverMaterials : receiverMaterials[0];
  });
  return { texture, meshes, materials: materials.size, bounds };
}
