import * as THREE from 'three';

// Cycles' diffuse bake excludes material colour and contains direct + indirect
// illumination. It replaces diffuse lighting; adding it to live diffuse lights
// would light the room twice. View-dependent reflections remain live.
function lightmappedMaterial(source, texture, scale, shadowStrength) {
  const material = source.clone();
  const previousCompile = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey.bind(source);
  material.lightMap = texture;
  material.lightMapIntensity = scale;
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(source, shader, renderer);
    const shadowAnchor = '#include <shadowmap_pars_fragment>';
    const diffuseAnchor = '#include <aomap_fragment>';
    if (!shader.fragmentShader.includes(shadowAnchor) || !shader.fragmentShader.includes(diffuseAnchor)) {
      throw new Error('The room lightmap does not match this renderer.');
    }
    shader.uniforms.roomMovingShadowStrength = { value: shadowStrength };
    shader.fragmentShader = shader.fragmentShader
      .replace(shadowAnchor, `${shadowAnchor}\n#include <shadowmask_pars_fragment>\nuniform float roomMovingShadowStrength;`)
      .replace(diffuseAnchor, `${diffuseAnchor}
        #ifdef USE_LIGHTMAP
          vec3 roomDiffuseIllumination = texture2D( lightMap, vLightMapUv ).rgb * lightMapIntensity;
          float roomMovingShadow = mix( 1.0, getShadowMask(), roomMovingShadowStrength );
          reflectedLight.directDiffuse = vec3( 0.0 );
          reflectedLight.indirectDiffuse = material.diffuseColor * roomDiffuseIllumination * roomMovingShadow;
        #endif
      `);
  };
  material.customProgramCacheKey = () => `${previousKey()}|room-uv-lightmap-v1`;
  material.userData.roomLightmap = true;
  material.needsUpdate = true;
  return material;
}

function validateManifest(manifest) {
  const { resolution, illuminationScale } = manifest;
  if (manifest.version !== 1 || manifest.node !== 'OldCuriosityShop' ||
      !Number.isInteger(resolution) || resolution < 256 || resolution > 8192 ||
      (resolution & (resolution - 1)) !== 0 ||
      !Number.isFinite(illuminationScale) || illuminationScale <= 0 || illuminationScale > 64) {
    throw new Error('The room lightmap has an unexpected format.');
  }
}

function staticMeshes(room, manifest) {
  const node = room.getObjectByName(manifest.node);
  if (!node) throw new Error('The room lightmap does not match this room.');
  const meshes = [];
  node.traverse(mesh => {
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv2');
    if (!position || !uv || uv.itemSize !== 2 || uv.count !== position.count) {
      throw new Error(`The room lightmap coordinates are missing from ${mesh.name}.`);
    }
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (!Number.isFinite(u) || !Number.isFinite(v) || u < -1e-5 || v < -1e-5 || u > 1.00001 || v > 1.00001) {
        throw new Error(`The room lightmap coordinates are invalid on ${mesh.name}.`);
      }
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.length || materials.some(material => !material?.isMeshStandardMaterial)) {
      throw new Error(`The room lightmap material is unsupported on ${mesh.name}.`);
    }
    meshes.push(mesh);
  });
  if (!meshes.length) throw new Error('The room lightmap has no matching surfaces.');
  return meshes;
}

export async function applyRoomLightmap(room, renderer, { movingShadowStrength = .65 } = {}) {
  if (!Number.isFinite(movingShadowStrength) || movingShadowStrength < 0 || movingShadowStrength > 1) {
    throw new Error('The moving book shadow strength must be between zero and one.');
  }
  const response = await fetch(new URL('./assets/room-lightmap.json', import.meta.url));
  if (!response.ok) throw new Error('The room lightmap could not load.');
  const manifest = await response.json();
  validateManifest(manifest);
  // Check all geometry before fetching the image or changing any materials.
  const meshes = staticMeshes(room, manifest);
  const texture = await new THREE.TextureLoader().loadAsync(new URL('./assets/room-lightmap.png', import.meta.url).href);
  if (texture.image.width !== manifest.resolution || texture.image.height !== manifest.resolution) {
    texture.dispose();
    throw new Error('The room lightmap image does not match its manifest.');
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.channel = 2;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  // Atlas islands have a finite three-pixel bleed. Global mipmaps would mix
  // distant islands with the unused black atlas and reintroduce dark seams.
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 1;
  texture.needsUpdate = true;

  const copies = new Map();
  const replacements = meshes.map(mesh => {
    const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const materials = source.map(material => {
      if (!copies.has(material)) copies.set(material,
        lightmappedMaterial(material, texture, manifest.illuminationScale, movingShadowStrength));
      return copies.get(material);
    });
    return [mesh, Array.isArray(mesh.material) ? materials : materials[0]];
  });
  for (const [mesh, material] of replacements) mesh.material = material;

  // Static shadows are already sampled in the bake. Its moving cover was
  // excluded, so only that cover casts an additional live shadow.
  room.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  room.getObjectByName('BookCoverHinge')?.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = true; });
  renderer.shadowMap.needsUpdate = true;
  const result = { meshes: meshes.length, materials: copies.size, resolution: manifest.resolution,
    illuminationScale: manifest.illuminationScale, uvChannel: 2 };
  room.userData.roomLightmap = result;
  return result;
}
