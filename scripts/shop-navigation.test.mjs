import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {RoomMovement,createRoomCollision,ROOM_BOUNDS,BODY_RADIUS} from '../dist/room-movement.js';
import {ROOM_POSES,sampleRoomPath} from '../dist/room-path.js';
import {curiosities} from '../dist/curiosities.js';
import {SHOP_HIDE_POSITION,appendPath} from '../dist/shop-navigation.js';

const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const {GLTFLoader}=await import('../dist/vendor/loaders/GLTFLoader.js');
const {ShopStorefront,ENTRANCE_THRESHOLD,EXIT_POSITION}=await import('../dist/shop-storefront.js');

let actualPromise;
async function loadActual(){
  const url=new URL('../dist/assets/bookstore-depth.gltf',import.meta.url),oldFetch=globalThis.fetch,oldSelf=globalThis.self,oldProgress=globalThis.ProgressEvent,oldLoad=THREE.TextureLoader.prototype.load;
  globalThis.self={URL};globalThis.ProgressEvent??=class extends Event{constructor(type,options={}){super(type);Object.assign(this,options);}};
  globalThis.fetch=async(input,options)=>{const file=new URL(input instanceof Request?input.url:input);if(file.protocol!=='file:'||!file.pathname.endsWith('.bin'))return oldFetch(input,options);const bytes=await readFile(file);return new Response(bytes,{headers:{'Content-Length':String(bytes.byteLength)}});};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){const texture=new THREE.Texture({width:1,height:1});queueMicrotask(()=>onLoad(texture));return texture;};
  try{
    const room=(await new GLTFLoader().parseAsync(await readFile(url,'utf8'),new URL('.',url).href)).scene;
    const scene=new THREE.Scene();scene.add(room);const front=new ShopStorefront(scene,room);
    const collision=createRoomCollision(room);
    return {room,scene,front,collision,movement:new RoomMovement(collision)};
  }finally{globalThis.fetch=oldFetch;THREE.TextureLoader.prototype.load=oldLoad;if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;if(oldProgress===undefined)delete globalThis.ProgressEvent;else globalThis.ProgressEvent=oldProgress;}
}
const actual=()=>actualPromise??=loadActual();
const allStops=()=>[...Object.entries(ROOM_POSES),...curiosities.map(c=>[c.id,c.pose])];

test('every authored visit can reach both the actual hiding place and entrance without crossing furniture',async()=>{
  const {collision,movement}=await actual();
  for(const target of [SHOP_HIDE_POSITION,ENTRANCE_THRESHOLD]){
    assert.ok(collision.isFree(target[0],target[2]),'the complete walking body fits at '+target);
    for(const [name,pose]of allStops()){
      const route=movement.planPath(pose[0],target);
      assert.deepEqual(route.points[0],pose[0]);assert.deepEqual(route.points.at(-1),target);
      for(let i=1;i<route.points.length;i++)assert.ok(collision.lineFree(route.points[i-1],route.points[i]),name+' has a continuously clear route');
      for(let i=0;i<=160;i++){const point=sampleRoomPath(route,i/160);assert.ok(collision.isFree(point[0],point[2]),name+' stays clear throughout the transition');}
      const returnRoute=movement.planPath(target,pose[0]);
      for(let i=1;i<returnRoute.points.length;i++)assert.ok(collision.lineFree(returnRoute.points[i-1],returnRoute.points[i]),name+' remains reachable after hiding');
    }
  }
});

test('the reading table conceals the crouched visitor from the owner and both front corners',async()=>{
  const {room}=await actual();room.updateMatrixWorld(true);
  const originalRoom=room.getObjectByName('OldCuriosityShop');assert.ok(originalRoom);
  const ray=new THREE.Raycaster();
  // Test the head and both shoulders, not only a center-eye ray. The owner can
  // look in from either corner or the actual voice position. The open center
  // display is excluded, so its sparse objects cannot create a false pass.
  for(const owner of [[-2.3,1.65,4.7],[2.3,1.65,4.7],[0,1.65,6.65],[2.4,1.6,6.1]]){
    for(const [x,y]of [[0,.98],[-BODY_RADIUS,.72],[BODY_RADIUS,.72]]){
      const origin=new THREE.Vector3(...owner),target=new THREE.Vector3(x,y,SHOP_HIDE_POSITION[2]);
      const direction=target.clone().sub(origin);ray.set(origin,direction.clone().normalize());ray.far=direction.length();
      const occluder=ray.intersectObject(originalRoom,true).find(hit=>{
        const material=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material;
        return !material.transparent&&material.opacity>=.95;
      });
      assert.ok(occluder,'solid room geometry blocks owner '+owner+' from crouched body '+target.toArray());
      assert.ok(occluder.distance<direction.length()-.02);
    }
  }
});

test('the open door and structural frame admit the full body from threshold to sidewalk',async()=>{
  const {room,front}=await actual();
  front.setDoorOpen(1);front.update({nowMs:0,dt:2,visible:true,gentle:true});
  // Only fixed facade plus its open hinge belongs in an exit collision check;
  // street traffic is outside this guided centerline corridor.
  const geometryRoot=new THREE.Group();geometryRoot.add(room.clone(true),front.facade.clone(true));
  const exterior=createRoomCollision(geometryRoot,{bounds:{...ROOM_BOUNDS,maxZ:9.8}});
  assert.ok(exterior.lineFree(ENTRANCE_THRESHOLD,EXIT_POSITION),'the swept .22 m body clears the entire open doorway');
  for(let i=0;i<=280;i++){
    const z=ENTRANCE_THRESHOLD[2]+(EXIT_POSITION[2]-ENTRANCE_THRESHOLD[2])*i/280;
    assert.ok(exterior.isFree(0,z),'clear exit centerline at z='+z);
  }
  // A closed door remains a physical obstruction, proving the check includes
  // the real glass/wood door and does not silently omit its geometry.
  front.setDoorOpen(0);front.update({nowMs:0,dt:2,visible:true,gentle:true});
  const closedRoot=new THREE.Group();closedRoot.add(front.facade.clone(true));
  const closed=createRoomCollision(closedRoot,{bounds:{...ROOM_BOUNDS,maxZ:9.8}});
  assert.equal(closed.lineFree(ENTRANCE_THRESHOLD,EXIT_POSITION),false);
});

test('exit path appending preserves routes and travels continuously to the street',async()=>{
  const {movement}=await actual();
  for(const [,pose]of allStops()){
    const interior=movement.planPath(pose[0],ENTRANCE_THRESHOLD),source=JSON.stringify(interior);
    const full=appendPath(interior,EXIT_POSITION);
    assert.equal(JSON.stringify(interior),source,'the original route remains unchanged');
    assert.deepEqual(full.points.at(-2),ENTRANCE_THRESHOLD);assert.deepEqual(full.points.at(-1),EXIT_POSITION);
    assert.ok(Math.abs(full.length-interior.length-2.75)<1e-8);
    assert.deepEqual(sampleRoomPath(full,1),EXIT_POSITION);
    const atThreshold=sampleRoomPath(full,interior.length/full.length);
    assert.ok(Math.hypot(...atThreshold.map((value,axis)=>value-ENTRANCE_THRESHOLD[axis]))<1e-8);
  }
  assert.throws(()=>appendPath({points:[]},EXIT_POSITION),TypeError);
  assert.throws(()=>appendPath({points:[[0,1,0]]},[NaN,1,0]),TypeError);
});
