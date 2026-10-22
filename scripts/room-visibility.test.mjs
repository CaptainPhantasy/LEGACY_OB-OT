import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';

const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const {RoomVisibility,partitionRoomMesh}=await import('../dist/room-visibility.js');
const {RoomRadiance}=await import('../dist/room-radiance.js');
const {RoomAtmosphere}=await import('../dist/room-atmosphere.js');
const {ShopStorefront}=await import('../dist/shop-storefront.js');
const {GLTFLoader}=await import('../dist/vendor/loaders/GLTFLoader.js');

function triangles(mesh){return (mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;}
function fixture(){
  const room=new THREE.Group();room.name='OldCuriosityShop';
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,0,-8,1,0,-8,0,2,-8,-1,0,8,0,2,8,1,0,8,-12,0,-20,12,0,-20,0,2,-20],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(27).fill(.5),3));
  for(const name of ['uv','uv1','uv2'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(new Float32Array(18).fill(.25),2));
  geometry.setIndex([0,1,2,3,4,5,6,7,8]);geometry.addGroup(0,3,0);geometry.addGroup(3,6,1);
  const material=[new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),new THREE.MeshStandardMaterial({side:THREE.DoubleSide})];
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Shared shell';mesh.castShadow=true;room.add(mesh);room.updateMatrixWorld(true);
  return {room,mesh,geometry,material};
}
const cameraAt=(direction)=>{const camera=new THREE.PerspectiveCamera(55,1,.04,60);camera.position.set(0,1,0);camera.lookAt(new THREE.Vector3(...direction));camera.updateMatrixWorld();return camera;};

test('room partitioning preserves every triangle, material group and shared UV/normal array',()=>{
  const {mesh,geometry,material}=fixture(),chunks=partitionRoomMesh(mesh,4);
  assert.equal(chunks.length,3);assert.equal(chunks.reduce((n,c)=>n+triangles(c),0),3);
  const originalGroups=new Map([[0,[0,1,2]],[1,[3,4,5,6,7,8]]]);
  const received=new Map([[0,[]],[1,[]]]);
  for(const chunk of chunks){
    for(const name of Object.keys(geometry.attributes))assert.equal(chunk.geometry.attributes[name],geometry.attributes[name]);
    assert.equal(chunk.material,material);assert.equal(chunk.castShadow,true);
    for(const group of chunk.geometry.groups)for(let i=group.start;i<group.start+group.count;i++)received.get(group.materialIndex).push(chunk.geometry.index.getX(i));
  }
  for(const [index,values] of originalGroups)assert.deepEqual(received.get(index).sort((a,b)=>a-b),values);
  assert.deepEqual(Array.from(geometry.index.array),[0,1,2,3,4,5,6,7,8]);
  const broad=chunks.find(c=>Array.from(c.geometry.index.array).includes(6));
  assert.ok(broad.geometry.boundingBox.min.x<=-12&&broad.geometry.boundingBox.max.x>=12,'An entire crossing triangle remains inside its cell bounds');
});

test('camera turns cull on the same frame, retain edge-crossing surfaces and preserve shadow casters',()=>{
  const {room}=fixture(),visibility=new RoomVisibility(room,{cellSize:4,minTriangles:1}),camera=cameraAt([0,1,-8]);
  let result=visibility.update(camera);assert.equal(result.visibleChunks,2);assert.equal(result.visibleTriangles,2);
  const front=visibility.chunks.find(c=>c.geometry.boundingBox.min.z===8);assert.equal(front.userData.inView,false);assert.equal(front.visible,true);assert.equal(front.castShadow,true);
  camera.lookAt(new THREE.Vector3(0,1,8));result=visibility.update(camera);assert.equal(result.visibleChunks,1);
  assert.equal(front.userData.inView,true);
  camera.lookAt(new THREE.Vector3(0,1,-8));assert.equal(visibility.update(camera).visibleChunks,2,'No debounce delays a rapid return');
  assert.ok(visibility.chunks.every(c=>c.frustumCulled),'Renderer checks each cell independently for each camera');
});

test('partitioning excludes animated book parts and can restore originals without duplicated surfaces',()=>{
  const {room,mesh}=fixture();
  const hinge=new THREE.Group();hinge.name='BookCoverHinge';const cover=mesh.clone();hinge.add(cover);room.add(hinge);
  const visibility=new RoomVisibility(room,{cellSize:4,minTriangles:1});
  assert.equal(visibility.quarantine.length,1);assert.equal(mesh.parent,null);assert.equal(cover.parent,hinge);
  let count=0;room.traverse(o=>{if(o.isMesh)count+=triangles(o);});assert.equal(count,6);
  visibility.restore();assert.equal(mesh.parent,room);assert.equal(room.children[0],mesh);
  count=0;room.traverse(o=>{if(o.isMesh)count+=triangles(o);});assert.equal(count,6);
});

test('closing extinguishes practical lights and emissive bulbs without repeated scaling or lost book glow',()=>{
  const originalMatch=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  try{
    const renderer={shadowMap:{needsUpdate:false}},radiance=new RoomRadiance(new THREE.Scene(),renderer),room=new THREE.Group();
    const material=new THREE.MeshStandardMaterial({emissive:0xffcc88,emissiveIntensity:3,lightMapIntensity:8,envMapIntensity:.7});
    room.add(new THREE.Mesh(new THREE.BoxGeometry(),material));radiance.setShopLight(0,room);radiance.update(8,false,true);
    assert.ok(radiance.lamps.every(({light})=>light.intensity===0));assert.ok(radiance.shelfLights.every(light=>light.intensity===0));assert.equal(radiance.tableLight.intensity,0);
    assert.equal(material.emissiveIntensity,0);assert.equal(material.lightMapIntensity,8*.018);assert.equal(material.envMapIntensity,.7*.04);
    radiance.setShopLight(.3,room);const level=material.lightMapIntensity;radiance.setShopLight(.3,room);assert.equal(material.lightMapIntensity,level);
    radiance.setShopLight(1,room);assert.equal(material.lightMapIntensity,8);assert.equal(material.emissiveIntensity,3);assert.equal(material.envMapIntensity,.7);
    radiance.setDaylight(0);const night=radiance.daylight.intensity;radiance.setDaylight(1);assert.ok(night<radiance.daylight.intensity/10);
    assert.equal(renderer.shadowMap.needsUpdate,true);
    assert.throws(()=>radiance.setShopLight(NaN),TypeError);
  }finally{if(originalMatch===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=originalMatch;}
});

test('room reflection capture includes the actual storefront sky in its front-facing cube image',()=>{
  const originalMatch=globalThis.matchMedia;globalThis.matchMedia=()=>({matches:false});
  try{
    const scene=new THREE.Scene(),room=new THREE.Group(),front=new ShopStorefront(scene,null),cameras=[];
    scene.add(room);
    let renderTarget=null,activeFace=0,activeMip=0;
    // Keep real Three.js camera setup and PMREM orchestration; only the GPU
    // drawing calls are inert. Record the six cameras actually used by capture.
    const renderer={
      coordinateSystem:THREE.WebGLCoordinateSystem,extensions:{has:()=>false},shadowMap:{needsUpdate:false},xr:{enabled:false},autoClear:true,
      compile(){},getRenderTarget:()=>renderTarget,getActiveCubeFace:()=>activeFace,getActiveMipmapLevel:()=>activeMip,
      setRenderTarget(target,face=0,mip=0){renderTarget=target;activeFace=face;activeMip=mip;},
      render(object,camera){if(object===scene){scene.updateMatrixWorld(true);cameras.push(camera);}}
    };
    const radiance=new RoomRadiance(scene,renderer),air={points:new THREE.Object3D(),beams:[],bookRays:[]};
    radiance.capture(room,air);
    assert.equal(cameras.length,6);
    const camera=cameras.find(value=>value.getWorldDirection(new THREE.Vector3()).z>.99);
    assert.ok(camera,'capture renders a front-facing cube image');
    const sky=front.root.getObjectByName('Sky beyond Indiana street');assert.ok(sky);
    const origin=camera.getWorldPosition(new THREE.Vector3()),direction=camera.getWorldDirection(new THREE.Vector3());
    const hit=new THREE.Raycaster(origin,direction).intersectObject(sky,false)[0];
    assert.ok(hit&&hit.distance>24,'the actual sky surface lies beyond the former interior-only capture range');
    const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    assert.ok(frustum.containsPoint(hit.point),'the front sky surface must survive reflection-camera far-plane clipping');
    for(const face of cameras){assert.equal(face.near,.08);assert.equal(face.far,60);}
    assert.equal(air.points.visible,true,'capture restores the atmosphere after hiding it from reflections');
    radiance.environment.dispose();
  }finally{if(originalMatch===undefined)delete globalThis.matchMedia;else globalThis.matchMedia=originalMatch;}
});

test('dust and light shafts go dark with the shop, while offscreen dust skips physics',()=>{
  const oldRatio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;
  try{
    const atmosphere=new RoomAtmosphere(new THREE.Scene()),camera=cameraAt([0,1,-8]);
    atmosphere.setShopLight(0);assert.equal(atmosphere.material.uniforms.shopLight.value,0);assert.ok(atmosphere.beams.every(beam=>beam.material.uniforms.strength.value===0));
    atmosphere.open();atmosphere.update(.016,2,camera.position,false,camera);assert.ok(atmosphere.updatedMotes>0&&atmosphere.updatedMotes<atmosphere.count+atmosphere.burstCount);
    assert.ok(atmosphere.material.uniforms.revelation.value>0,'The deliberate book revelation remains independent of the shop lamps');
    atmosphere.setShopLight(1);assert.ok(atmosphere.beams.every(beam=>beam.material.uniforms.strength.value===.02));
  }finally{if(oldRatio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=oldRatio;}
});

test('Gentle movement keeps the closed book dark before and after its deliberate revelation',()=>{
  const oldRatio=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;
  try{
    const atmosphere=new RoomAtmosphere(new THREE.Scene()),camera=cameraAt([0,1,-8]);
    atmosphere.setShopLight(0);
    const check=expected=>{
      atmosphere.update(.016,2,camera.position,true,camera);
      assert.equal(atmosphere.material.uniforms.revelation.value,expected);
      assert.equal(atmosphere.material.uniforms.shopLight.value,0);
      assert.ok([...atmosphere.beams,...atmosphere.bookRays].every(beam=>beam.material.uniforms.strength.value===0));
      assert.equal(atmosphere.updatedMotes,0,'Gentle movement keeps airborne particles still');
    };
    check(0);
    atmosphere.open();check(.12);
    atmosphere.close();check(0);check(0);
  }finally{if(oldRatio===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=oldRatio;}
});

async function loadRoom(){
  const url=new URL('../dist/assets/bookstore-depth.gltf',import.meta.url),oldFetch=globalThis.fetch,oldSelf=globalThis.self,oldProgress=globalThis.ProgressEvent,oldLoad=THREE.TextureLoader.prototype.load;
  globalThis.self={URL};globalThis.ProgressEvent??=class extends Event{constructor(type,options={}){super(type);Object.assign(this,options);}};
  globalThis.fetch=async(input,options)=>{const file=new URL(input instanceof Request?input.url:input);if(file.protocol!=='file:'||!file.pathname.endsWith('.bin'))return oldFetch(input,options);const bytes=await readFile(file);return new Response(bytes,{headers:{'Content-Length':String(bytes.byteLength)}});};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){const texture=new THREE.Texture({width:1,height:1});queueMicrotask(()=>onLoad(texture));return texture;};
  try{return (await new GLTFLoader().parseAsync(await readFile(url,'utf8'),new URL('.',url).href)).scene;}
  finally{globalThis.fetch=oldFetch;THREE.TextureLoader.prototype.load=oldLoad;if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;if(oldProgress===undefined)delete globalThis.ProgressEvent;else globalThis.ProgressEvent=oldProgress;}
}

test('the real delivered room keeps every triangle and every shelf plaque ray after partitioning',async()=>{
  const room=await loadRoom(),layout=JSON.parse(await readFile(new URL('../dist/assets/rabbit-hole-layout.json',import.meta.url),'utf8'));
  room.updateMatrixWorld(true);let before=0;room.traverse(o=>{if(o.isMesh)before+=triangles(o);});
  const ray=new THREE.Raycaster(),samples=[];
  for(const item of layout.items){
    const low=item.labelBounds[0],high=item.labelBounds[1],target=new THREE.Vector3(...low.map((v,i)=>(v+high[i])/2));
    const origin=new THREE.Vector3(item.side<0?-1.1:1.1,1.4,target.z);
    ray.set(origin,target.clone().sub(origin).normalize());const hit=ray.intersectObject(room,true)[0];assert.ok(hit);samples.push({origin,target,distance:hit.distance});
  }
  const start=performance.now(),visibility=new RoomVisibility(room),buildMs=performance.now()-start;
  let after=0;room.traverse(o=>{if(o.isMesh)after+=triangles(o);});assert.equal(after,before);
  for(const {origin,target,distance} of samples){ray.set(origin,target.clone().sub(origin).normalize());const hit=ray.intersectObject(room,true)[0];assert.ok(Math.abs(hit.distance-distance)<1e-8,'The same nearest physical surface remains selectable');}
  const camera=cameraAt([0,1,-8]);camera.position.set(0,1.6,6.6);camera.lookAt(new THREE.Vector3(0,1.2,-5));const inward={...visibility.update(camera)};
  camera.lookAt(new THREE.Vector3(0,1.6,20));const outward={...visibility.update(camera)};
  assert.ok(outward.visibleTriangles<inward.visibleTriangles*.6,'Facing the street does not submit the rear room');
  assert.ok(visibility.chunks.length<650,'Cell count remains bounded for mobile traversal');
  console.log('Room visibility:',JSON.stringify({triangles:before,chunks:visibility.chunks.length,inward:inward.visibleTriangles,outward:outward.visibleTriangles,buildMs:Math.round(buildMs)}));
});
