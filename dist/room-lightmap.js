import * as THREE from 'three';

const revelationByRoom = new WeakMap();
const atlasRevision = 'curiosities-1';

function atlasURL(file) {
  const url = new URL(`./assets/${file}`, import.meta.url);
  url.searchParams.set('scene', atlasRevision);
  return url;
}

// The book's temporary reveal light is deliberately absent from the fixed bake.
// Share its power across static materials without recompiling their shaders.
export function updateRoomRevelation(room, power) {
  const uniforms = revelationByRoom.get(room);
  if (uniforms) uniforms.power.value = Number.isFinite(power) ? Math.max(0, power) : 0;
}

// Cycles' diffuse bake excludes material colour and contains direct + indirect
// illumination. It replaces diffuse lighting; adding it to live diffuse lights
// would light the room twice. View-dependent reflections remain live.
function lightmappedMaterial(source, texture, scale, shadowStrength, revelation, encoding) {
  const material = source.clone();
  const previousCompile = source.onBeforeCompile;
  const previousKey = source.customProgramCacheKey.bind(source);
  material.lightMap = texture;
  material.lightMapIntensity = scale;
  if (encoding === 'RGBM_SQRT') material.defines = { ...material.defines, ROOM_LIGHTMAP_RGBM_SQRT: '' };
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(source, shader, renderer);
    const shadowAnchor = '#include <shadowmap_pars_fragment>';
    const diffuseAnchor = '#include <aomap_fragment>';
    const positionAnchor = '#include <worldpos_vertex>';
    if (!shader.fragmentShader.includes(shadowAnchor) || !shader.fragmentShader.includes(diffuseAnchor) ||
        !shader.vertexShader.includes(positionAnchor)) {
      throw new Error('The room lightmap does not match this renderer.');
    }
    shader.uniforms.roomMovingShadowStrength = { value: shadowStrength };
    shader.uniforms.roomRevelationPower = revelation.power;
    shader.uniforms.roomRevelationColor = revelation.color;
    shader.uniforms.roomRevelationPosition = revelation.position;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoomWorldPosition;')
      .replace(positionAnchor, `${positionAnchor}\nvRoomWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace(shadowAnchor, `${shadowAnchor}
        #include <shadowmask_pars_fragment>
        varying vec3 vRoomWorldPosition;
        uniform float roomMovingShadowStrength;
        uniform float roomRevelationPower;
        uniform vec3 roomRevelationColor;
        uniform vec3 roomRevelationPosition;
      `)
      .replace(diffuseAnchor, `${diffuseAnchor}
        #ifdef USE_LIGHTMAP
          vec4 roomLightmapSample = texture2D( lightMap, vLightMapUv );
          #ifdef ROOM_LIGHTMAP_RGBM_SQRT
            vec3 roomDiffuseIllumination = pow( roomLightmapSample.rgb * roomLightmapSample.a, vec3( 2.0 ) ) * lightMapIntensity;
          #else
            vec3 roomDiffuseIllumination = roomLightmapSample.rgb * lightMapIntensity;
          #endif
          float roomMovingShadow = mix( 1.0, getShadowMask(), roomMovingShadowStrength );
          vec3 roomRevelationDiffuse = vec3( 0.0 );
          if ( roomRevelationPower > 0.0 ) {
            vec3 roomToRevelation = roomRevelationPosition - vRoomWorldPosition;
            float roomRevelationDistance = length( roomToRevelation );
            vec3 roomRevelationDirection = roomToRevelation / max( roomRevelationDistance, 0.0001 );
            vec3 roomWorldNormal = inverseTransformDirection( geometryNormal, viewMatrix );
            float roomRevelationCosine = saturate( dot( roomWorldNormal, roomRevelationDirection ) );
            float roomRevelationFalloff = getDistanceAttenuation( max( roomRevelationDistance, 0.2 ), 12.0, 1.5 );
            roomRevelationDiffuse = roomRevelationColor * roomRevelationPower * roomRevelationFalloff * roomRevelationCosine * RECIPROCAL_PI;
          }
          reflectedLight.directDiffuse = vec3( 0.0 );
          reflectedLight.indirectDiffuse = material.diffuseColor * ( roomDiffuseIllumination * roomMovingShadow + roomRevelationDiffuse );
        #endif
      `);
  };
  material.customProgramCacheKey = () => `${previousKey()}|room-uv-lightmap-v3|${encoding || 'SRGB'}`;
  material.userData.roomLightmap = true;
  material.needsUpdate = true;
  return material;
}

const atlasSources = {
  'room-lightmap.json': { node: 'OldCuriosityShop', file: 'room-lightmap.png' },
  'curiosity-lightmap.json': { node: 'CenterCuriosityShelf', file: 'curiosity-lightmap.png' }
};

function validateManifest(manifest, source) {
  if (!manifest || typeof manifest !== 'object') throw new Error('The room lightmap has an unexpected format.');
  const { resolution, illuminationScale, encoding } = manifest;
  const rgbm = encoding === 'RGBM_SQRT';
  const expected = atlasSources[source];
  if (manifest.version !== 1 || manifest.node !== expected.node ||
      (manifest.file !== expected.file && !(source === 'room-lightmap.json' && manifest.file === undefined)) ||
      (manifest.uv_channel !== undefined && manifest.uv_channel !== 2) ||
      (encoding !== undefined && !rgbm) ||
      !Number.isInteger(resolution) || resolution < 256 || resolution > 8192 ||
      (resolution & (resolution - 1)) !== 0 ||
      !Number.isFinite(illuminationScale) || illuminationScale <= 0 || illuminationScale > (rgbm ? 4096 : 64)) {
    throw new Error('The room lightmap has an unexpected format.');
  }
}

async function loadManifest(source) {
  const response = await fetch(atlasURL(source));
  if (!response.ok) throw new Error(`The room lightmap manifest ${source} could not load.`);
  const manifest = await response.json();
  validateManifest(manifest, source);
  const additional = manifest.additionalLightmaps ?? [];
  if (!Array.isArray(additional) ||
      (source !== 'room-lightmap.json' && additional.length) ||
      additional.some(name => name !== 'curiosity-lightmap.json') ||
      new Set(additional).size !== additional.length) {
    throw new Error('The additional room lightmaps have an unexpected format.');
  }
  return { manifest, source, file: atlasSources[source].file, additional };
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
  const primary = await loadManifest('room-lightmap.json');
  if (room.getObjectByName('CenterCuriosityShelf') && !primary.additional.includes('curiosity-lightmap.json')) {
    throw new Error('The center shelf lightmap is missing from the room manifest.');
  }
  const atlases = [primary, ...await Promise.all(primary.additional.map(loadManifest))];
  // Validate every atlas before changing the room. Shared materials need a
  // separate clone for each atlas, but no mesh may be claimed by two atlases.
  const claimed = new Set(), moving = new Set();
  room.getObjectByName('BookCoverHinge')?.traverse(mesh => { if (mesh.isMesh) moving.add(mesh); });
  for (const atlas of atlases) {
    atlas.meshes = staticMeshes(room, atlas.manifest);
    for (const mesh of atlas.meshes) {
      if (claimed.has(mesh) || moving.has(mesh)) throw new Error('The room lightmaps overlap or include the moving book.');
      claimed.add(mesh);
    }
  }
  const loaded = await Promise.allSettled(atlases.map(atlas =>
    new THREE.TextureLoader().loadAsync(atlasURL(atlas.file).href)));
  const textures = loaded.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failed = loaded.find(result => result.status === 'rejected');
  if (failed) {
    textures.forEach(texture => texture.dispose());
    throw failed.reason;
  }
  if (textures.some((texture, i) => texture.image?.width !== atlases[i].manifest.resolution ||
      texture.image?.height !== atlases[i].manifest.resolution)) {
    textures.forEach(texture => texture.dispose());
    throw new Error('A room lightmap image does not match its manifest.');
  }
  atlases.forEach((atlas, i) => {
    const texture = atlas.texture = textures[i];
    // RGBM's alpha is a numeric multiplier, not opacity or sRGB color.
    texture.colorSpace = atlas.manifest.encoding === 'RGBM_SQRT' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.premultiplyAlpha = false;
    texture.flipY = false;
    texture.channel = 2;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    // The finite three-pixel bleed cannot support global atlas mipmaps.
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
  });

  const revelation = {
    power: { value: 0 },
    color: { value: new THREE.Color(0xffd893) },
    position: { value: new THREE.Vector3(0, 1.45, -5) }
  };
  const replacements = [];
  try {
    for (const atlas of atlases) {
      const copies = atlas.copies = new Map();
      const { manifest, texture } = atlas;
      for (const mesh of atlas.meshes) {
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const materials = source.map(material => {
          if (!copies.has(material)) copies.set(material,
            lightmappedMaterial(material, texture, manifest.illuminationScale, movingShadowStrength, revelation, manifest.encoding));
          return copies.get(material);
        });
        replacements.push([mesh, Array.isArray(mesh.material) ? materials : materials[0]]);
      }
    }
  } catch (error) {
    textures.forEach(texture => texture.dispose());
    atlases.forEach(atlas => atlas.copies?.forEach(material => material.dispose()));
    throw error;
  }
  for (const [mesh, material] of replacements) mesh.material = material;
  revelationByRoom.set(room, revelation);

  // Static shadows are already sampled in the bake. Its moving cover was
  // excluded, so only that cover casts an additional live shadow.
  room.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  room.getObjectByName('BookCoverHinge')?.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = true; });
  renderer.shadowMap.needsUpdate = true;
  const result = { meshes: claimed.size, materials: atlases.reduce((count, atlas) => count + atlas.copies.size, 0),
    resolution: primary.manifest.resolution, illuminationScale: primary.manifest.illuminationScale, uvChannel: 2,
    atlases: atlases.map(atlas => ({ node: atlas.manifest.node, file: atlas.file, meshes: atlas.meshes.length,
      materials: atlas.copies.size, resolution: atlas.manifest.resolution, illuminationScale: atlas.manifest.illuminationScale })) };
  room.userData.roomLightmap = result;
  return result;
}
