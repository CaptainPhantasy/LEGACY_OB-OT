import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import(threeURL);
const { GLTFLoader } = await import('../dist/vendor/loaders/GLTFLoader.js');
const { ShopStorefront, openOriginalEntrance, streetActorPose, STREET_VEHICLES, ENTRANCE_THRESHOLD, EXIT_POSITION } = await import('../dist/shop-storefront.js');

async function loadActualRoom() {
  const roomURL = new URL('../dist/assets/bookstore-depth.gltf', import.meta.url);
  const oldFetch = globalThis.fetch, oldSelf = globalThis.self, oldProgressEvent = globalThis.ProgressEvent;
  const oldLoad = THREE.TextureLoader.prototype.load;
  globalThis.self = { URL };
  globalThis.ProgressEvent ??= class extends Event { constructor(type, options={}) { super(type);Object.assign(this, options); } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'file:' || !url.pathname.endsWith('.bin')) return oldFetch(input, options);
    const bytes = await readFile(url);
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } });
  };
  THREE.TextureLoader.prototype.load = function(_url, onLoad) {
    const texture = new THREE.Texture({ width: 1, height: 1 });queueMicrotask(() => onLoad(texture));return texture;
  };
  try {
    const gltf = await new GLTFLoader().parseAsync(await readFile(roomURL, 'utf8'), new URL('.', roomURL).href);
    gltf.scene.updateMatrixWorld(true);return gltf.scene;
  } finally {
    globalThis.fetch = oldFetch;THREE.TextureLoader.prototype.load = oldLoad;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldProgressEvent === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = oldProgressEvent;
  }
}
function entranceRay(room,x=0,y=1.6) {
  room.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x,y,6.65), new THREE.Vector3(0,0,1),0,2).intersectObject(room,true);
}

test('actual glTF front trim is replaced without changing baked UV attributes, floor, or roof', async () => {
  const room = await loadActualRoom();
  assert.equal(entranceRay(room,0).length,0,'original dark entrance is an empty opening');
  const original = new Map();room.traverse(mesh=>{if(mesh.isMesh)original.set(mesh,mesh.geometry);});
  const downward = new THREE.Raycaster(new THREE.Vector3(0,1,6.9),new THREE.Vector3(0,-1,0),0,2);
  const beforeFloor = downward.intersectObject(room,true)[0];assert.ok(beforeFloor);
  const upward = new THREE.Raycaster(new THREE.Vector3(0,1.6,6.7),new THREE.Vector3(0,1,0),0,3);
  const beforeRoof = upward.intersectObject(room,true)[0];assert.ok(beforeRoof);
  const result = openOriginalEntrance(room);
  assert.equal(result.removedTriangles,216);assert.equal(result.changedMeshes,3);
  for (const x of [0,-1.9,1.9]) assert.equal(entranceRay(room,x).length,0,`clear doorway/window ray at x=${x}`);
  room.traverse(mesh=>{
    if (!mesh.isMesh) return;
    const source=original.get(mesh);
    for(const [key,attribute]of Object.entries(source.attributes))assert.equal(mesh.geometry.attributes[key],attribute,`preserve ${key}`);
    if(mesh.geometry!==source)assert.equal(mesh.userData.storefrontOriginalGeometry,source);
  });
  const afterFloor=downward.intersectObject(room,true)[0];assert.ok(afterFloor);
  assert.ok(beforeFloor.point.distanceTo(afterFloor.point)<1e-8,'floor remains at the original height');
  const afterRoof=upward.intersectObject(room,true)[0];assert.ok(afterRoof);
  assert.ok(beforeRoof.point.distanceTo(afterRoof.point)<1e-8,'roof remains at the original height');
  assert.deepEqual(openOriginalEntrance(room),{removedTriangles:0,changedMeshes:0},'replacement is idempotent');
});

test('glazed storefront has bounded recognizable actors, passable door, and real dynamic signs', () => {
  const scene=new THREE.Scene(),front=new ShopStorefront(scene,null);
  assert.equal(front.actors.length,11);
  assert.ok(front.actors.every(actor=>!actor.group.visible),'uninitialized actors cannot appear in room reflection capture');
  for(const kind of [...STREET_VEHICLES,'pedestrian','jogger','dog-walker'])assert.ok(front.actors.some(actor=>actor.kind===kind));
  assert.ok(front.glass.transparent && front.glass.opacity<.15 && !front.glass.depthWrite);
  assert.equal(front.openSign.parent,front.doorPivot);assert.equal(front.closedSign.parent,front.doorPivot);
  front.setClosed(true);assert.equal(front.openSign.visible,false);assert.equal(front.closedSign.visible,true);
  front.setClosed(false);assert.equal(front.openSign.visible,true);assert.equal(front.closedSign.visible,false);
  front.setDoorOpen(1);front.update({nowMs:0,dt:2,visible:true,gentle:true});
  assert.ok(Math.abs(front.doorPivot.rotation.y+1.35)<1e-8);
  front.setDoorOpen(0);front.update({nowMs:0,dt:1,visible:true,gentle:true});
  front.root.updateMatrixWorld(true);
  for(const x of [0,-1.9,1.9]){
    const hit=entranceRay(front.facade,x).filter(h=>!h.object.material.transparent);
    assert.equal(hit.length,0,`eye-height glass remains clear at x=${x}`);
  }
  assert.deepEqual(ENTRANCE_THRESHOLD,[0,1.6,6.65]);assert.deepEqual(EXIT_POSITION,[0,1.6,9.4]);
  assert.ok(front.stats.drawMeshes<240,`mobile mesh budget: ${front.stats.drawMeshes}`);
});

test('canvas door signs face both the room and sidewalk and switch together', () => {
  const previousDocument=globalThis.document,drawnText=[];
  globalThis.document={createElement(tag){
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext(type){
      assert.equal(type,'2d');
      return {fillRect(){},strokeRect(){},fillText(text){drawnText.push(text);}};
    }};
  }};
  try{
    const front=new ShopStorefront(new THREE.Scene(),null);
    front.root.updateMatrixWorld(true);
    const signs=[front.openSign,front.closedSign,front.openOutsideSign,front.closedOutsideSign];
    for(const [index,sign] of signs.entries()){
      assert.equal(sign.geometry.type,'PlaneGeometry','exercise the browser canvas path');
      assert.ok(sign.material.map?.isCanvasTexture,'lettering is a canvas texture');
      assert.equal(sign.parent,front.doorPivot,'batching preserves every stateful face');
      assert.equal(sign.userData.keepSeparate,true);
      const outward=index>=2?1:-1;
      const normal=new THREE.Vector3().fromBufferAttribute(sign.geometry.attributes.normal,0)
        .applyMatrix3(new THREE.Matrix3().getNormalMatrix(sign.matrixWorld)).normalize();
      assert.ok(normal.dot(new THREE.Vector3(0,0,outward))>.999,'front face points toward its reader');
      assert.ok(sign.position.z*outward>0,'face sits on the matching side of the door glass');
    }
    assert.equal(drawnText.filter(text=>text==='OPEN · UNTIL 8').length,2);
    assert.equal(drawnText.filter(text=>text==='CLOSED').length,2);
    for(const closed of [false,true,false]){
      front.setClosed(closed);
      assert.deepEqual(signs.map(sign=>sign.visible),[!closed,closed,!closed,closed]);
    }
  }finally{
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});

test('absolute street motion resumes without a reset and every requested traffic type passes', () => {
  for(const [index,kind]of [...STREET_VEHICLES,'pedestrian','jogger','dog-walker'].entries()){
    const when=1792699147000;
    assert.deepEqual(streetActorPose(kind,index,when),streetActorPose(kind,index,when));
    let crosses=false;
    for(let t=0;t<360000;t+=250){
      const p=streetActorPose(kind,index,when+t);
      if(p.active&&Math.abs(p.x)<2)crosses=true;
      if(p.active)assert.ok(Math.abs(p.x)<=80);
      assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.phase));
    }
    assert.ok(crosses,`${kind} crosses the storefront`);
  }
  const front=new ShopStorefront(new THREE.Scene(),null),beforeCount=front.root.children.length;
  front.update({nowMs:45000,dt:.016,visible:true});
  const oldPositions=front.actors.map(a=>a.group.position.clone());
  front.update({nowMs:147000,dt:100,visible:false});
  assert.equal(front.stats.animatedActors,0);assert.equal(front.root.visible,false);
  front.actors.forEach((a,i)=>assert.ok(a.group.position.equals(oldPositions[i]),'no hidden position animation'));
  front.update({nowMs:147000,dt:.016,visible:true});
  for(const a of front.actors){const p=streetActorPose(a.kind,a.index,147000);assert.equal(a.group.visible,p.active);if(p.active)assert.equal(a.group.position.x,p.x);}
  for(let t=0;t<20000;t+=127)front.update({nowMs:t,dt:.016,visible:true});
  assert.equal(front.actors.length,11);assert.equal(front.root.children.length,beforeCount,'no spawned object leaks');
});

test('padded doorway frustum culls street work without clipping the entrance or exterior view', () => {
  const front=new ShopStorefront(new THREE.Scene(),null),camera=new THREE.PerspectiveCamera(64,390/844,.04,60);
  camera.position.set(0,1.6,1);camera.lookAt(0,1.6,7.3);
  assert.equal(front.update({camera,nowMs:0,dt:.016}),true);
  camera.lookAt(0,1.6,-8);
  assert.equal(front.update({camera,nowMs:1,dt:.016}),false);
  camera.position.fromArray(EXIT_POSITION);camera.lookAt(0,1.6,4);
  assert.equal(front.update({camera,nowMs:2,dt:.016}),true,'outside view remains active when looking at the door');
  front.update({camera,nowMs:3,dt:.016,daylight:0,night:1});
  assert.equal(front.sun.intensity,0);assert.equal(front.skyMaterial.uniforms.daylight.value,0);
  assert.ok(front.windowMat.emissiveIntensity>.6);assert.ok(front.sun.userData.exteriorLight&&front.skyLight.userData.exteriorLight);
});
