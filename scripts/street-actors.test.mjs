import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const {buildStreetVehicle,buildStreetPerson,animateStreetActor}=await import('../dist/street-actors.js');

function shop(){
  const materials=new Map();
  const builder={materials,exteriorMaterial:m=>m,material(name,color,roughness=.8,metalness=0,extra={}){
    if(!materials.has(name))materials.set(name,new THREE.MeshStandardMaterial({name,color,roughness,metalness,...extra}));
    return materials.get(name);
  }};
  const result={builder};
  for(const [key,color]of Object.entries({chrome:0xa6aaa8,iron:0x263335,cream:0xbbae8c,yellow:0xc6a24e,headlight:0xffe9b7,tailLight:0x6d1e16}))result[key]=builder.material(key,color);
  return result;
}
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} should equal ${b}`);

test('profiled vehicles have finite bounded geometry, curved body sections and independently rolling wheels',()=>{
  const fixture=shop();
  for(const [i,kind]of ['car','suv','city-bus','school-bus','garbage-truck'].entries()){
    const g=buildStreetVehicle(fixture,kind,i),rig=g.userData.actorRig;
    assert.equal(rig.type,'vehicle');assert.ok(rig.wheels.length>=4);
    let triangles=0,meshes=0;
    g.traverse(o=>{
      if(!o.isMesh)return;meshes++;assert.ok(o.castShadow&&o.receiveShadow);
      const p=o.geometry.attributes.position,n=o.geometry.attributes.normal;
      for(const value of p.array)assert.ok(Number.isFinite(value));
      for(const value of n.array)assert.ok(Number.isFinite(value));
      triangles+=(o.geometry.index?.count??p.count)/3;
    });
    assert.ok(triangles<24000,`${kind}: ${triangles} triangles`);
    assert.ok(meshes<30,`${kind}: ${meshes} draw meshes`);
    const wheel=rig.wheels[0];
    animateStreetActor({group:g,kind,index:i},{x:0,direction:1,phase:0});near(wheel.group.rotation.z,0);
    animateStreetActor({group:g,kind,index:i},{x:wheel.radius*Math.PI,direction:1,phase:1});near(wheel.group.rotation.z,-Math.PI);
    animateStreetActor({group:g,kind,index:i},{x:-wheel.radius*Math.PI,direction:-1,phase:1});near(wheel.group.rotation.z,-Math.PI);
    animateStreetActor({group:g,kind,index:i},{x:2,direction:1,phase:5},{gentle:true});
    near(rig.body.position.y,0);near(rig.body.rotation.z,0);
  }
});

test('the car and SUV wheel arches are actual open body geometry rather than painted dark patches',()=>{
  const fixture=shop();
  for(const kind of ['car','suv']){
    const g=buildStreetVehicle(fixture,kind),body=g.userData.actorRig.body;g.updateMatrixWorld(true);
    const hits=(x,y)=>new THREE.Raycaster(new THREE.Vector3(x,y,2),new THREE.Vector3(0,0,-1),0,4).intersectObject(body,true);
    for(const x of [-1.38,1.38])assert.equal(hits(x,.56).length,0,`${kind} wheel opening at ${x}`);
    assert.ok(hits(0,.65).length>0,`${kind} door and sill panels remain solid`);
  }
});

test('walking and running soles stay planted in world space during their support phase',()=>{
  const fixture=shop();
  for(const [kind,speed,stride]of [['pedestrian',1.13,.62],['pedestrian',1.405,.62],['jogger',2.6,.76]]){
    const g=buildStreetPerson(fixture,kind,0),rig=g.userData.actorRig,leg=rig.legs.find(l=>l.side===-1);
    const cycleSeconds=stride/(speed*.62),start=cycleSeconds*.2;
    function at(seconds){
      g.position.x=seconds*speed;
      animateStreetActor({group:g,kind,index:0},{x:g.position.x,direction:1,speed,phase:0},{nowMs:seconds*1000});
      g.updateMatrixWorld(true);
      return leg.ankle.localToWorld(new THREE.Vector3(0,-.09,0));
    }
    const first=at(start),second=at(start+.005);
    near(first.x,second.x);near(first.y,.075);near(second.y,.075);near(first.z,second.z);
    assert.ok(Math.abs(leg.knee.rotation.z)>.05,'the knee bends instead of swinging one rigid leg');
  }
});

test('articulated actor sampling is deterministic after hidden intervals and retains ground contact',()=>{
  const fixture=shop();
  for(const kind of ['pedestrian','jogger','dog-walker']){
    const a=buildStreetPerson(fixture,kind,2),b=buildStreetPerson(fixture,kind,2);
    const pose={x:8,direction:1,speed:kind==='jogger'?2.6:1.24,phase:20};
    for(let ms=0;ms<1000;ms+=16)animateStreetActor({group:a,kind,index:2},pose,{nowMs:ms});
    animateStreetActor({group:a,kind,index:2},pose,{nowMs:61000});
    animateStreetActor({group:b,kind,index:2},pose,{nowMs:61000});
    const ar=a.userData.actorRig,br=b.userData.actorRig;
    for(let i=0;i<2;i++){
      near(ar.legs[i].hip.rotation.z,br.legs[i].hip.rotation.z);
      near(ar.legs[i].knee.rotation.z,br.legs[i].knee.rotation.z);
    }
    near(a.position.y,.075);
    if(ar.dog){
      assert.equal(ar.dog.legs.length,4);assert.equal(ar.leash.geometry.attributes.position.count,17);
      for(const v of ar.leash.geometry.attributes.position.array)assert.ok(Number.isFinite(v));
      assert.deepEqual(Array.from(ar.leash.geometry.attributes.position.array),Array.from(br.leash.geometry.attributes.position.array));
    }
  }
});

test('adult heads have restrained facial relief and clothing covers bending knee joints',()=>{
  const fixture=shop();
  for(const kind of ['pedestrian','jogger']){
    const g=buildStreetPerson(fixture,kind,1),rig=g.userData.actorRig;
    const skin=rig.head.children.find(o=>o.isMesh&&o.material.name==='Walker / skin 1');
    skin.geometry.computeBoundingBox();
    const bounds=skin.geometry.boundingBox,size=bounds.getSize(new THREE.Vector3());
    assert.ok(size.y>.23&&size.y<.26,`adult head height: ${size.y}`);
    assert.ok(size.z>.15&&size.z<.18,`adult head width: ${size.z}`);
    assert.ok(bounds.max.x<.11,`nasal profile stays close to the face: ${bounds.max.x}`);
    for(const nowMs of [0,100,250,500,700]){
      animateStreetActor({group:g,kind,index:1},{x:0,direction:1,speed:kind==='jogger'?2.6:1.24},{nowMs});
      g.updateMatrixWorld(true);
      for(const leg of rig.legs){
        const center=leg.knee.getWorldPosition(new THREE.Vector3());
        for(const dy of [-.02,0,.02]){
          const ray=new THREE.Raycaster(center.clone().add(new THREE.Vector3(0,dy,.2)),new THREE.Vector3(0,0,-1),0,.4);
          assert.ok(ray.intersectObject(leg.hip,true).length>0,`${kind} knee cloth remains continuous at ${nowMs} ms`);
        }
      }
    }
  }
});
