import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {RoomMovement,createRoomCollision,WALK_SPEED,FAST_WALK_SPEED} from '../dist/room-movement.js';
import {ROOM_POSES,sampleRoomPath} from '../dist/room-path.js';
import {curiosities} from '../dist/curiosities.js';
const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,nextResolve){return specifier==='three'?{url:threeURL,shortCircuit:true}:nextResolve(specifier,context);}});
const THREE=await import(threeURL);
const {GLTFLoader}=await import('../dist/vendor/loaders/GLTFLoader.js');
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,a+' should equal '+b);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
function advance(controller,position,yaw,input,seconds=1,rate=60){
  let p=position.slice();for(let i=0;i<seconds*rate;i++)p=controller.step(p,yaw,input,1/rate);return p;
}

test('free walking follows the view, including backwards and sideways, without changing eye height',()=>{
  const movement=new RoomMovement(),start=[0,1.12,5.3];
  const forward=advance(movement,start,0,{forward:1},.5),back=advance(movement,start,0,{forward:-1},.5);
  near(forward[2],start[2]-WALK_SPEED*.5);near(back[2],start[2]+WALK_SPEED*.5);
  const right=advance(movement,start,Math.PI/2,{right:1},.5);
  near(right[0],0);near(right[2],start[2]+WALK_SPEED*.5);
  for(const point of [forward,back,right])near(point[1],start[1]);
});

test('diagonal movement and frame rates preserve walking speed; sprint is bounded',()=>{
  const movement=new RoomMovement(),start=[0,1.6,5.3];
  const straight=advance(movement,start,Math.PI/2,{forward:1},.5);
  const diagonal=advance(movement,start,0,{forward:1,right:1},.5);
  near(distance(straight,start),distance(diagonal,start));
  const slow=advance(movement,start,Math.PI/2,{forward:1},.5,30);
  assert.ok(distance(straight,slow)<1e-8);
  const sprint=advance(movement,start,Math.PI/2,{forward:1,sprint:true},.5);
  near(distance(sprint,start),FAST_WALK_SPEED*.5);
});

test('tab resume, invalid inputs, and attempted furniture crossings cannot teleport through the room',()=>{
  const movement=new RoomMovement(),start=[0,1.6,5.3];
  const resumed=movement.step(start,0,{forward:1,sprint:true},10000);
  assert.ok(distance(resumed,start)<=FAST_WALK_SPEED*.1+1e-8);
  assert.throws(()=>movement.step(start,0,{forward:1},-1),TypeError);
  assert.throws(()=>movement.step([NaN,1,0],0,{},.01),TypeError);
  const stopped=advance(movement,[1.1,1.6,1.5],-Math.PI/2,{forward:1,sprint:true},3);
  assert.ok(stopped[0]>.393+.22,'body remains outside the actual center shelf');
  assert.ok(movement.collision.isFree(stopped[0],stopped[2]));
});

test('diagonal movement slides along furniture instead of sticking or passing through it',()=>{
  const movement=new RoomMovement(),start=[.73,1.6,2.7];
  const end=advance(movement,start,0,{forward:1,right:-1},.5);
  assert.ok(end[0]>.393+.22);assert.ok(end[2]<start[2]-.3,'forward component slides along shelf');
  assert.ok(movement.collision.isFree(end[0],end[2]));
});

let actualPromise;
async function actualScene(){
  const url=new URL('../dist/assets/bookstore-depth.gltf',import.meta.url);
  const oldFetch=globalThis.fetch,oldSelf=globalThis.self,oldProgressEvent=globalThis.ProgressEvent,oldLoad=THREE.TextureLoader.prototype.load;
  globalThis.self={URL};globalThis.ProgressEvent??=class extends Event{constructor(type,options={}){super(type);Object.assign(this,options);}};
  globalThis.fetch=async(input,options)=>{const u=new URL(input instanceof Request?input.url:input);if(u.protocol!=='file:'||!u.pathname.endsWith('.bin'))return oldFetch(input,options);const bytes=await readFile(u);return new Response(bytes,{status:200,headers:{'Content-Length':String(bytes.byteLength)}});};
  THREE.TextureLoader.prototype.load=function(_url,onLoad){const texture=new THREE.Texture({width:1,height:1});queueMicrotask(()=>onLoad(texture));return texture;};
  try{
    const gltf=await new GLTFLoader().parseAsync(await readFile(url,'utf8'),new URL('.',url).href);
    const collision=createRoomCollision(gltf.scene);
    console.log('Actual scene walking map:',JSON.stringify(collision.stats),'grid',collision.columns,collision.rows);
    return {room:gltf.scene,collision};
  }finally{
    globalThis.fetch=oldFetch;THREE.TextureLoader.prototype.load=oldLoad;
    if(oldSelf===undefined)delete globalThis.self;else globalThis.self=oldSelf;
    if(oldProgressEvent===undefined)delete globalThis.ProgressEvent;else globalThis.ProgressEvent=oldProgressEvent;
  }
}
const actual=()=>actualPromise??=actualScene();

test('the actual delivered geometry permits every original and shelf inspection stop',async()=>{
  const {collision}=await actual();
  const stops=[...Object.entries(ROOM_POSES),...curiosities.map(c=>[c.id,c.pose])];
  const blocked=stops.filter(([,pose])=>!collision.isFree(pose[0][0],pose[0][2])).map(([id,pose])=>({id,position:pose[0]}));
  assert.deepEqual(blocked,[]);
  assert.ok(collision.stats.triangles>100000,'collision came from the complete export');
  assert.ok(collision.cells.length<25000,'per-frame collision uses a compact spatial map');
});

test('the actual scene allows complete walking loops around both shelf ends',async()=>{
  const {collision}=await actual(),movement=new RoomMovement(collision);
  let point=[-.9,1.6,4.3];
  // Follow the whole perimeter twice in opposite directions using only manual input.
  const corners=[[-.9,1.6,-1],[.9,1.6,-1],[.9,1.6,4.3],[-.9,1.6,4.3]];
  for(const targets of [corners,[...corners.slice(0,-1)].reverse().concat([corners.at(-1)])]){
    for(const target of targets){
      const length=distance(point,target),heading=Math.atan2(target[0]-point[0],-(target[2]-point[2]));
      const steps=Math.ceil(length/(WALK_SPEED/60)),dt=length/WALK_SPEED/steps;
      for(let i=0;i<steps;i++){
        point=movement.step(point,heading,{forward:1},dt);
        assert.ok(collision.isFree(point[0],point[2]),'each actual manual step stays clear');
      }
      assert.ok(distance(point,target)<1e-6,'complete loop reaches the next corner '+JSON.stringify({point,target}));
    }
  }
});

test('guided approaches from free-walk positions route around the shelf and through the real rear doorway',async()=>{
  const {collision}=await actual(),movement=new RoomMovement(collision);
  const stops=[...Object.entries(ROOM_POSES),...curiosities.map(c=>[c.id,c.pose])];
  for(const start of [[-.73,1.6,1.5],[.73,1.6,1.5],[0,1.6,6.6],[0,1.6,-3.4]]){
    assert.ok(collision.isFree(start[0],start[2]),'test starts in open space');
    for(const [id,pair] of stops){
      const route=movement.planPath(start,pair[0]);
      assert.deepEqual(route.points[0],start);assert.deepEqual(route.points.at(-1),pair[0]);
      for(let i=1;i<route.points.length;i++)assert.ok(collision.lineFree(route.points[i-1],route.points[i]),id+' has an obstructed route segment');
      for(let i=0;i<=200;i++){const p=sampleRoomPath(route,i/200);assert.ok(collision.isFree(p[0],p[2]),id+' route clips occupied geometry');}
    }
  }
});

test('manual walking does not scan scene meshes after collision setup',async()=>{
  const {collision,room}=await actual(),movement=new RoomMovement(collision);
  room.traverse=()=>{throw new Error('A frame must not traverse meshes.');};
  const start=[-1.1,1.6,2.5],result=advance(movement,start,0,{forward:1},.5);
  assert.ok(result[2]<start[2]);
});

test('continuous sweeps reject a shallow shelf-corner crossing that discrete samples miss',async()=>{
  const {collision}=await actual();
  const from=[.32,1.6,-2.12],to=[.96,1.6,1.56];
  assert.ok(collision.isFree(from[0],from[2])&&collision.isFree(to[0],to[2]));
  assert.equal(collision.lineFree(from,to),false,'the whole swept body clears the shelf, not only sampled centers');
  const movement=new RoomMovement(collision);
  const start=[-.08,1.6,-7.88],route=movement.planPath(start,ROOM_POSES.aisle[0]);
  for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i],count=Math.ceil(distance(a,b)/.002);
    for(let j=0;j<=count;j++){
      const t=j/count;
      assert.ok(collision.isFree(a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t),'dense independent point check remains clear');
    }
  }
  // A short chord grazing the same rounded corner has free endpoints, but a
  // blocked interior. Manual motion must slide or stop instead of crossing it.
  const contact=[.5963169165,1.6,-.5311777302],length=distance(from,to);
  const dx=(to[0]-from[0])/length,dz=(to[2]-from[2])/length;
  const a=[contact[0]-.03*dx,1.6,contact[2]-.03*dz],b=[contact[0]+.03*dx,1.6,contact[2]+.03*dz];
  assert.ok(collision.isFree(a[0],a[2])&&collision.isFree(b[0],b[2]));
  assert.equal(collision.lineFree(a,b),false);
  const end=movement.step(a,Math.atan2(dx,-dz),{forward:1},.06/WALK_SPEED);
  assert.ok(distance(end,b)>.0001,'manual movement does not take the unsafe chord');
  assert.ok(collision.lineFree(a,end),'manual sliding keeps its returned motion clear');
});
