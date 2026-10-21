import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

// Use the shipped renderer and loader. Image decoding is immaterial to this
// geometry/light interpolation regression, so only the image transport is stubbed.
const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({resolve(specifier,context,nextResolve){
  return specifier==='three'?{url:threeURL,shortCircuit:true}:nextResolve(specifier,context);
}});
const THREE=await import(threeURL);
const {GLTFLoader}=await import('../dist/vendor/loaders/GLTFLoader.js');
const {applyBakedLighting}=await import('../dist/room-lighting.js');

async function loadFixture(){
  const originalLoad=THREE.TextureLoader.prototype.load;
  const oldSelf=globalThis.self;
  globalThis.self={URL};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){
    const texture=new THREE.Texture();queueMicrotask(()=>onLoad(texture));return texture;
  };
  try{
    const bytes=await readFile(new URL('../dist/assets/bookstore.glb',import.meta.url));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    return gltf.scene;
  }finally{
    THREE.TextureLoader.prototype.load=originalLoad;
    if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
  }
}

test('coarse wall samples cannot paint false dark triangles with default room lighting',async()=>{
  const room=await loadFixture(), oldFetch=globalThis.fetch;
  const manifest=JSON.parse(await readFile(new URL('../dist/assets/room-irradiance.json',import.meta.url),'utf8'));
  const binary=await readFile(new URL('../dist/assets/room-irradiance.bin',import.meta.url));
  globalThis.fetch=async url=>{
    const name=new URL(url).pathname.split('/').pop();
    if(name==='room-irradiance.json')return new Response(JSON.stringify(manifest));
    if(name==='room-irradiance.bin')return new Response(binary);
    throw new Error(`Unexpected fixture fetch: ${name}`);
  };
  const moving=[];
  room.getObjectByName('BookCoverHinge').traverse(o=>{if(o.isMesh)moving.push([o,o.material]);});
  try{await applyBakedLighting(room);}finally{globalThis.fetch=oldFetch;}
  for(const [mesh,material]of moving){
    assert.equal(mesh.material,material,'Moving cover must retain its material');
    assert.equal(mesh.geometry.getAttribute('roomBakedLight'),undefined);
  }
  let plaster;
  room.getObjectByName('OldCuriosityShop').traverse(o=>{if(o.isMesh&&o.material.name==='Damp grey green plaster')plaster=o;});
  assert.ok(plaster,'Actual room wall fixture must exist');
  const g=plaster.geometry,p=g.getAttribute('position'),ao=g.getAttribute('roomBakedLight');
  const A=new THREE.Vector3(),B=new THREE.Vector3(),C=new THREE.Vector3();
  const ab=new THREE.Vector3(),ac=new THREE.Vector3();
  let worst=null;
  for(let i=0;i<g.index.count;i+=3){
    const ids=[g.index.getX(i),g.index.getX(i+1),g.index.getX(i+2)];
    A.fromBufferAttribute(p,ids[0]);B.fromBufferAttribute(p,ids[1]);C.fromBufferAttribute(p,ids[2]);
    const area=ab.subVectors(B,A).cross(ac.subVectors(C,A)).length()/2;
    const corners=ids.map(id=>ao.getX(id));
    const range=Math.max(...corners)-Math.min(...corners);
    if(area>20&&range>.5&&(!worst||range>worst.range))worst={area,corners,range};
  }
  assert.ok(worst,'Fixture must reproduce a >20 m² wall face with >0.5 corner-darkening variation');
  const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
  plaster.material.onBeforeCompile(shader,{});
  const strength=shader.uniforms.roomOcclusionStrength.value;
  // Reproduce the shader's mix at corners and across the triangle. With the
  // defective default strength=1 this is only ~0.32 at one corner and ~0.56 at
  // the center. The correction must leave incoming ambient light intact.
  const locations=[...worst.corners,worst.corners.reduce((a,b)=>a+b,0)/3];
  for(const value of locations)assert.equal(1+(value-1)*strength,1,'Default lighting must not darken coarse faces');
  assert.equal(shader.uniforms.roomBounceStrength.value,1,'Warm reflected light remains enabled');
  assert.equal(room.userData.bakedLighting.meshes,59);
});
