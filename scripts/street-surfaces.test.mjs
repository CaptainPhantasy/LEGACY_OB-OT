import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const {prepareStreetSurfaceUV,streetSurfaceFamily,applyStreetSurfaces,applyStreetGroundAO}=await import('../dist/street-surfaces.js');

test('bundled photographic maps match their licensed provenance and WebP bytes',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../dist/assets/street-surfaces/sources.json',import.meta.url),'utf8'));
 assert.equal(manifest.provider,'Poly Haven');assert.equal(manifest.maps.length,17);
 for(const map of manifest.maps){
  assert.equal(map.license,'CC0-1.0');assert.deepEqual(map.dimensions,[1024,1024]);
  assert.ok(map.source.startsWith('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/'));
  const bytes=await readFile(new URL('../dist/assets/street-surfaces/'+map.file,import.meta.url));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert.equal(bytes.length,map.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),map.sha256);
 }
});

test('the deployed ground bake is the recorded BlenderProc output and excludes moving actors',async()=>{
 const base=new URL('../dist/assets/street-surfaces/',import.meta.url);
 const record=JSON.parse(await readFile(new URL('ground-ao-source.json',base),'utf8'));
 const bytes=await readFile(new URL(record.file,base));
 assert.equal(record.generator,'https://github.com/DLR-RM/BlenderProc');
 assert.equal(record.engine,'Cycles CPU');assert.deepEqual(record.size,[2048,512]);
 assert.equal(record.sun_shadows_baked,false);assert.ok(record.membership.excluded_actor_meshes>0);
 assert.ok(record.membership.static_meshes>1000);assert.ok(record.receiver_triangles>1000);
 assert.equal(record.row0_world_z,7.5);assert.equal(record.white_border_pixels,2);
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
 assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
});

test('physical surface UVs survive scale and batching without overwriting authored or baked coordinates',()=>{
 const shared=new THREE.BoxGeometry(1,1,1);shared.setAttribute('uv2',shared.attributes.uv.clone());
 const before0=Array.from(shared.attributes.uv.array),before2=Array.from(shared.attributes.uv2.array);
 const mesh=new THREE.Mesh(shared,new THREE.MeshStandardMaterial());mesh.scale.set(5,5,5);mesh.position.set(9,1,2);mesh.updateMatrixWorld(true);
 const neighbor=new THREE.Mesh(shared,mesh.material);
 assert.equal(prepareStreetSurfaceUV(mesh,'brick'),true);
 assert.notEqual(mesh.geometry,shared);assert.equal(neighbor.geometry,shared);assert.equal(shared.attributes.uv1,undefined);
 assert.deepEqual(Array.from(mesh.geometry.attributes.uv.array),before0);assert.deepEqual(Array.from(mesh.geometry.attributes.uv2.array),before2);
 const uv=mesh.geometry.attributes.uv1;
 const spans=[];for(let face=0;face<6;face++){
  const values=Array.from({length:4},(_,i)=>uv.getX(face*4+i));spans.push(Math.max(...values)-Math.min(...values));
 }
 for(const span of spans)assert.ok(Math.abs(span-2)<1e-6,'a five-metre face contains two 2.5m brick tiles');
});

test('glass, signs, skin and car paint retain their authored appearance',()=>{
 for(const name of ['Sign / café','Street / building windows','Vehicle / car paint','Walker / skin 1','Street / leaves'])
  assert.equal(streetSurfaceFamily(new THREE.MeshStandardMaterial({name})),null);
 const material=new THREE.MeshStandardMaterial({name:'Storefront / dark walnut'});assert.equal(streetSurfaceFamily(material),'wood');
 material.map=new THREE.Texture();assert.equal(streetSurfaceFamily(material),null);
 const explicit=new THREE.MeshStandardMaterial();explicit.userData.streetSurface='stone';assert.equal(streetSurfaceFamily(explicit),'concrete');
});

test('material assignment uses linear normal and roughness maps with shared texture loading',async()=>{
 const originalLoad=THREE.TextureLoader.prototype.load;const requests=[];
 THREE.TextureLoader.prototype.load=function(url,callback){requests.push(url);const texture=new THREE.Texture({width:1024,height:1024});queueMicrotask(()=>callback(texture));return texture;};
 try{
  const root=new THREE.Group();
  for(let i=0;i<2;i++)root.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({name:'Street / masonry '+i,color:0x7b5142})));
  const report=await applyStreetSurfaces(root,{capabilities:{getMaxAnisotropy:()=>16}});
  assert.equal(report.materials,2);assert.deepEqual(report.failures,[]);assert.equal(requests.length,3);
  const [first,second]=root.children.map(m=>m.material);
  assert.equal(first.map,second.map);assert.equal(first.normalMap,second.normalMap);
  assert.equal(first.map.colorSpace,THREE.SRGBColorSpace);assert.equal(first.normalMap.colorSpace,THREE.NoColorSpace);
  assert.equal(first.roughnessMap.colorSpace,THREE.NoColorSpace);assert.equal(first.normalMap.channel,1);assert.equal(first.normalMap.anisotropy,8);
  assert.ok(root.children.every(m=>m.geometry.attributes.uv1));
 }finally{THREE.TextureLoader.prototype.load=originalLoad;}
});

test('ground AO preserves the bake bounds, top faces and authored UVs without leaking onto shared walls',async()=>{
 const originalLoad=THREE.TextureLoader.prototype.load;
 THREE.TextureLoader.prototype.load=function(url,callback){assert.equal(url,'./assets/street-surfaces/ground-ao.webp');const texture=new THREE.Texture();queueMicrotask(()=>callback(texture));return texture;};
 try{
  const root=new THREE.Group(),material=new THREE.MeshStandardMaterial({name:'Street / concrete'});
  const ground=new THREE.Mesh(new THREE.BoxGeometry(200,.1,16),material);ground.position.set(0,-.05,15.5);
  ground.geometry.setAttribute('uv1',ground.geometry.attributes.uv.clone());
  const before0=Array.from(ground.geometry.attributes.uv.array),before1=Array.from(ground.geometry.attributes.uv1.array);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(4,2,1),material);wall.position.set(0,2,20);
  const authored=new THREE.Mesh(new THREE.BoxGeometry(2,.1,2),material);authored.geometry.setAttribute('uv2',authored.geometry.attributes.uv.clone());
  const authoredBefore=Array.from(authored.geometry.attributes.uv2.array);
  root.add(ground,wall,authored);
  const result=await applyStreetGroundAO(root,{capabilities:{getMaxAnisotropy:()=>4}});
  assert.equal(result.meshes,1);assert.equal(result.materials,1);assert.equal(result.texture.channel,2);
  assert.equal(result.texture.wrapS,THREE.ClampToEdgeWrapping);assert.equal(result.texture.colorSpace,THREE.NoColorSpace);
  assert.notEqual(ground.material,material);assert.equal(ground.material.aoMap,result.texture);
  assert.equal(wall.material,material);assert.equal(authored.material,material);assert.equal(material.aoMap,null);
  assert.deepEqual(Array.from(authored.geometry.attributes.uv2.array),authoredBefore);
  assert.deepEqual(Array.from(ground.geometry.attributes.uv.array),before0);assert.deepEqual(Array.from(ground.geometry.attributes.uv1.array),before1);
  const {normal,uv2}=ground.geometry.attributes;let tops=0;
  for(let i=0;i<normal.count;i++){
   if(normal.getY(i)>.7){
    tops++;assert.ok(uv2.getX(i)===-0.75||uv2.getX(i)===1.75,'wide road coordinates stay linear beyond the bake');
    assert.ok(uv2.getY(i)===0||uv2.getY(i)===1,'near z=7.5 is v=1 and far z=23.5 is v=0');
   }else{assert.equal(uv2.getX(i),-10);assert.equal(uv2.getY(i),-10);}
  }
  assert.equal(tops,4);
 }finally{THREE.TextureLoader.prototype.load=originalLoad;}
});
