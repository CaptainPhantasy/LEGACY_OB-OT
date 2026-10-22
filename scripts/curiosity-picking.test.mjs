import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { curiosities } from '../dist/curiosities.js';
import { wallCuriosityAtHit, WALL_CURIOSITY_TARGETS } from '../dist/curiosity-picking.js';
const threeURL = new URL('../dist/vendor/three.module.js', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'three' ? { url: threeURL, shortCircuit: true } : nextResolve(specifier, context);
} });
const THREE = await import(threeURL);
const { GLTFLoader } = await import('../dist/vendor/loaders/GLTFLoader.js');
const { RoomVisibility } = await import('../dist/room-visibility.js');
async function loadActualRoom() {
  const roomURL = new URL('../dist/assets/bookstore-depth.gltf', import.meta.url);
  const oldFetch = globalThis.fetch, oldSelf = globalThis.self, oldProgressEvent = globalThis.ProgressEvent;
  const oldLoad = THREE.TextureLoader.prototype.load;
  globalThis.self = { URL };
  globalThis.ProgressEvent ??= class extends Event { constructor(type, options = {}) { super(type);Object.assign(this, options); } };
  globalThis.fetch = async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'file:' || !url.pathname.endsWith('.bin')) return oldFetch(input, options);
    const bytes = await readFile(url);
    return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } });
  };
  THREE.TextureLoader.prototype.load = function(_url, onLoad) {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    queueMicrotask(() => onLoad(texture));
    return texture;
  };
  try {
    const source = await readFile(roomURL, 'utf8');
    const gltf = await new GLTFLoader().parseAsync(source, new URL('.', roomURL).href);
    gltf.scene.updateMatrixWorld(true);
    return gltf.scene;
  } finally {
    globalThis.fetch = oldFetch;
    THREE.TextureLoader.prototype.load = oldLoad;
    if (oldSelf === undefined) delete globalThis.self; else globalThis.self = oldSelf;
    if (oldProgressEvent === undefined) delete globalThis.ProgressEvent; else globalThis.ProgressEvent = oldProgressEvent;
  }
}


function triangleCandidates(room) {
  const candidates=new Map(curiosities.filter(c=>!c.shelf).map(c=>[c.id,[]]));
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  room.traverse(object=>{
    if(!object.isMesh)return;
    const geometry=object.geometry,position=geometry.attributes.position,index=geometry.index;
    const count=index?.count??position.count;
    for(let offset=0;offset<count;offset+=3){
      const materialIndex=geometry.groups.find(group=>offset>=group.start&&offset<group.start+group.count)?.materialIndex??0;
      const material=Array.isArray(object.material)?object.material[materialIndex]:object.material;
      if(!WALL_CURIOSITY_TARGETS.some(target=>target.materials.test(material.name)))continue;
      a.fromBufferAttribute(position,index?index.getX(offset):offset);
      b.fromBufferAttribute(position,index?index.getX(offset+1):offset+1);
      c.fromBufferAttribute(position,index?index.getX(offset+2):offset+2);
      const point=a.clone().add(b).add(c).multiplyScalar(1/3).applyMatrix4(object.matrixWorld);
      const item=wallCuriosityAtHit(curiosities,{object,point,face:{materialIndex}});
      if(item)candidates.get(item.id).push(point);
    }
  });
  return candidates;
}

test('all six original assemblies are selectable through the nearest real scene triangle, before and after visibility partitioning',async()=>{
  const room=await loadActualRoom();
  const candidates=triangleCandidates(room),ray=new THREE.Raycaster();
  for(const target of WALL_CURIOSITY_TARGETS.filter(target=>target.id==='bottles')){
    assert.ok(candidates.get('bottles').some(point=>[point.x,point.y,point.z].every((value,axis)=>
      value>=target.bounds[0][axis]&&value<=target.bounds[1][axis])),
    `the bottle at ${target.bounds[0]} retains an actual selectable surface`);
  }
  for(const partitioned of [false,true]){
    if(partitioned)new RoomVisibility(room);
    room.updateMatrixWorld(true);
    for(const item of curiosities.filter(c=>!c.shelf)){
      const points=candidates.get(item.id);
      assert.ok(points.length>0,`${item.id}: the current export still has target surfaces`);
      const eye=new THREE.Vector3(...item.pose[0]);let found=false;
      // Real mesh triangles, not artificial hotspot planes. Sampling evenly
      // across the assembly includes thin keys and the gramophone's hollow horn.
      for(let sample=0;sample<Math.min(points.length,80);sample++){
        const point=points[Math.floor(sample*points.length/Math.min(points.length,80))];
        ray.set(eye,point.clone().sub(eye).normalize());
        const hit=ray.intersectObject(room,true)[0];
        if(wallCuriosityAtHit(curiosities,hit)?.id===item.id){found=true;break;}
      }
      assert.ok(found,`${item.id}: no original surface can be selected from its approach (partitioned=${partitioned})`);
    }
    // A ray toward the keys from behind their partition must stop at the wall.
    const behind=new THREE.Vector3(1.1,1.6,-3.1);
    ray.set(behind,new THREE.Vector3(1.1,1.6,-2.55).sub(behind).normalize());
    assert.equal(wallCuriosityAtHit(curiosities,ray.intersectObject(room,true)[0]),null,
      'the nearest intervening wall prevents picking keys through the partition');
  }
});

test('only a visible original prop surface can select a wall curiosity',()=>{
  const parent={name:'OldCuriosityShop',visible:true};
  const object={isMesh:true,material:{name:'Oxidized bronze / delivery'},parent};
  const hit={object,point:new THREE.Vector3(1.1,1.6,-2.55)};
  assert.equal(wallCuriosityAtHit(curiosities,hit)?.id,'time');
  object.material.name='Damp grey green plaster / delivery';
  assert.equal(wallCuriosityAtHit(curiosities,hit),null,'the wall behind the keys is not a key');
  object.material.name='Oxidized bronze / delivery';hit.point.set(1.1,1.6,-2.7);
  assert.equal(wallCuriosityAtHit(curiosities,hit),null,'matching metal elsewhere cannot trigger the keys');
  hit.point.set(1.1,1.6,-2.55);parent.visible=false;
  assert.equal(wallCuriosityAtHit(curiosities,hit),null,'hidden assemblies are not selectable');
  parent.visible=true;object.parent={name:'BookCoverHinge',parent};
  assert.equal(wallCuriosityAtHit(curiosities,hit),null,'the original book retains its separate action');
  object.parent={name:'Street'};
  assert.equal(wallCuriosityAtHit(curiosities,hit),null,'outside geometry is not a room discovery');
  object.parent=parent;hit.point.set(NaN,1.6,-2.55);
  assert.equal(wallCuriosityAtHit(curiosities,hit),null);
  assert.equal(wallCuriosityAtHit(curiosities,undefined),null,'empty space is not an invisible hotspot');
});

test('middle shelf assemblies and plaques never enter the original-object picker',async()=>{
  const layout=JSON.parse(await readFile(new URL('../dist/assets/rabbit-hole-layout.json',import.meta.url),'utf8'));
  const object={isMesh:true,parent:{name:'CenterCuriosityShelf'},material:{name:'Oxidized bronze / delivery'}};
  for(const item of layout.items)for(const bounds of [item.pickBounds,item.labelBounds]){
    for(let corner=0;corner<8;corner++){
      const point=new THREE.Vector3(...[0,1,2].map(axis=>bounds[(corner>>axis)&1][axis]));
      assert.equal(wallCuriosityAtHit(curiosities,{object,point}),null,`${item.id}: preserve shelf routing`);
    }
  }
});
