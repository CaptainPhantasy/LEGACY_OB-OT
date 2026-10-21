import * as THREE from 'three';

/**
 * Load the room's offline ray-traced contact occlusion and single diffuse bounce.
 * The bake never touches moving book geometry. Dynamic lights and shadows remain
 * live; this data only changes indirect illumination. No runtime ray tracing is claimed.
 */
export async function applyBakedLighting(room, { bounceStrength = 1, occlusionStrength = 1 } = {}) {
  const [manifestResponse, dataResponse] = await Promise.all([
    fetch(new URL('./assets/room-irradiance.json', import.meta.url)),
    fetch(new URL('./assets/room-irradiance.bin', import.meta.url))
  ]);
  if (!manifestResponse.ok || !dataResponse.ok) throw new Error('The baked room light could not load.');
  const [manifest, buffer] = await Promise.all([manifestResponse.json(), dataResponse.arrayBuffer()]);
  if (manifest.version !== 1 || buffer.byteLength !== manifest.byteLength) throw new Error('The baked room light has an unexpected format.');
  const staticRoom = room.getObjectByName(manifest.node);
  if (!staticRoom) throw new Error('The baked room light does not match this room.');
  const meshes = [];
  staticRoom.traverse(object => { if (object.isMesh) meshes.push(object); });
  const matches = manifest.records.map(record => {
    const mesh = meshes.find(object => !Array.isArray(object.material) &&
      object.material.name === record.material && object.geometry.getAttribute('position')?.count === record.count);
    if (!mesh || record.byteOffset < 0 || record.byteOffset + record.count * 4 > buffer.byteLength) {
      throw new Error(`The baked light does not match material ${record.material}.`);
    }
    return [record, mesh];
  });
  // Validate the entire file before changing any material. Never silently apply a partial bake.
  if (new Set(matches.map(([, mesh]) => mesh)).size !== matches.length) throw new Error('The baked light contains duplicate mesh mappings.');
  const materialCopies = new Map();
  for (const [record, mesh] of matches) {
    mesh.geometry.setAttribute('roomBakedLight', new THREE.BufferAttribute(
      new Uint8Array(buffer, record.byteOffset, record.count * 4), 4, true));
    const source = mesh.material;
    if (!source.isMeshStandardMaterial) continue;
    if (!materialCopies.has(source)) {
      const material = source.clone();
      const previousCompile = source.onBeforeCompile;
      const previousKey = source.customProgramCacheKey.bind(source);
      material.onBeforeCompile = (shader, renderer) => {
        previousCompile.call(source, shader, renderer);
        shader.uniforms.roomBounceStrength = { value: bounceStrength };
        shader.uniforms.roomOcclusionStrength = { value: occlusionStrength };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 roomBakedLight;\nvarying vec4 vRoomBakedLight;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoomBakedLight = roomBakedLight;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vRoomBakedLight;\nuniform float roomBounceStrength;\nuniform float roomOcclusionStrength;')
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
            float roomAO = mix(1.0, vRoomBakedLight.x, roomOcclusionStrength);
            reflectedLight.indirectDiffuse *= roomAO;
            reflectedLight.indirectSpecular *= sqrt(roomAO);
            vec3 roomBounce = vRoomBakedLight.yzw * vRoomBakedLight.yzw * 0.5;
            reflectedLight.indirectDiffuse += material.diffuseColor * roomBounce * roomBounceStrength;
          `);
      };
      material.customProgramCacheKey = () => `${previousKey()}|room-baked-light-v1`;
      material.needsUpdate = true;
      materialCopies.set(source, material);
    }
    mesh.material = materialCopies.get(source);
  }
  const result = { meshes: matches.length, vertices: manifest.vertexCount,
    aoSamples: manifest.aoSamples, bounceSamples: manifest.bounceSamples, bytes: buffer.byteLength };
  room.userData.bakedLighting = result;
  return result;
}
