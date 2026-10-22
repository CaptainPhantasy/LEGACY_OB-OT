import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return specifier==='three'?{url:threeURL,shortCircuit:true}:next(specifier,context);}});
const THREE=await import(threeURL);
const {RoomRadiance,REFLECTION_PROBES,boxProjectedDirection}=await import('../dist/room-radiance.js');

// Use Three's actual cube cameras and PMREM pass orchestration. These tests
// exercise scheduling/state/resource ownership, not GPU shader compilation.
function fixture(){
  const scene=new THREE.Scene(),room=new THREE.Group(),root=new THREE.Group(),actor=new THREE.Group();
  const material=new THREE.MeshStandardMaterial({envMapIntensity:.7,lightMapIntensity:8,emissiveIntensity:3});
  const exterior=new THREE.MeshPhysicalMaterial({envMapIntensity:.8,clearcoat:.4});
  room.add(new THREE.Mesh(new THREE.BoxGeometry(),material));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(),exterior),actor);root.visible=false;
  const sun=new THREE.DirectionalLight();sun.castShadow=true;sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;
  scene.add(room,root,sun);
  const air={points:new THREE.Object3D(),beams:[new THREE.Object3D()],bookRays:[]};air.beams[0].visible=false;
  const originalTarget=new THREE.WebGLRenderTarget(2,2),views=[];
  let target=originalTarget,face=3,mip=2,failure=null,onView=()=>{};
  const renderer={
    coordinateSystem:THREE.WebGLCoordinateSystem,extensions:{has:()=>false},shadowMap:{needsUpdate:true,autoUpdate:false},xr:{enabled:true},autoClear:true,
    compile(){},getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    setRenderTarget(value,nextFace=0,nextMip=0){target=value;face=nextFace;mip=nextMip;},
    render(object,camera){
      if(object!==scene){if(failure==='filter')throw new Error('fixture filter failure');return;}
      scene.updateMatrixWorld(true);
      views.push({position:camera.getWorldPosition(new THREE.Vector3()),face,shadows:renderer.shadowMap.needsUpdate});
      onView();if(failure==='scene')throw new Error('fixture render failure');
      if(renderer.shadowMap.needsUpdate){
        scene.traverse(object=>{if(object.isLight&&object.castShadow){object.shadow.map??=new THREE.WebGLRenderTarget(2,2);object.shadow.needsUpdate=false;}});
        renderer.shadowMap.needsUpdate=false;
      }
    }
  };
  const radiance=new RoomRadiance(scene,renderer);
  radiance.setEnvironmentContext({storefront:{root,actors:[{group:actor}],sun}});
  return {scene,room,root,actor,sun,material,exterior,air,renderer,radiance,views,originalTarget,
    onView:callback=>{onView=callback;},fail:(mode='scene')=>{failure=mode;}};
}

test('box projection returns directions toward the same room hit from each local probe',()=>{
  const p=new THREE.Vector3(1,1,3),direction=new THREE.Vector3(0,0,1),front=new THREE.Vector3(...REFLECTION_PROBES[0].position);
  const projected=boxProjectedDirection(p,direction,front);
  assert.ok(projected.distanceTo(new THREE.Vector3(1,-.6,3.5))<1e-10);
  assert.deepEqual(direction.toArray(),[0,0,1],'The supplied ray is not changed');
  const scaled=boxProjectedDirection(p,direction.clone().multiplyScalar(4),front);
  assert.ok(scaled.distanceTo(projected)<1e-10,'Intersection is independent of ray magnitude');
  assert.deepEqual(boxProjectedDirection(new THREE.Vector3(0,1,12),direction,front).toArray(),[0,0,1]);
  assert.deepEqual(boxProjectedDirection(p,new THREE.Vector3(),front).toArray(),[0,0,0]);
  assert.throws(()=>boxProjectedDirection(new THREE.Vector3(NaN,1,0),direction,front),TypeError);
});

test('three local captures preserve view state, exclude actors, and keep dark captures at their authored response',()=>{
  const f=fixture(),{radiance,renderer,material,exterior}=f;
  radiance.setShopLight(0,f.room,0);
  f.onView(()=>{
    assert.equal(f.root.visible,true);assert.equal(f.actor.visible,false);
    assert.equal(f.air.points.visible,false);assert.equal(f.air.beams[0].visible,false);
    assert.equal(material.envMapIntensity,0);assert.equal(exterior.envMapIntensity,0);
    assert.equal(renderer.xr.enabled,false);assert.equal(renderer.shadowMap.autoUpdate,false);
  });
  radiance.capture(f.room,f.air);
  assert.equal(f.views.length,18);assert.equal(f.views.filter(view=>view.shadows).length,1,'Only the cold first face initializes shadow maps');
  for(let i=0;i<3;i++)assert.deepEqual(f.views.slice(i*6,i*6+6).map(view=>view.position.toArray()),Array.from({length:6},()=>REFLECTION_PROBES[i].position));
  assert.equal(f.root.visible,false);assert.equal(f.actor.visible,true);assert.equal(f.air.points.visible,true);assert.equal(f.air.beams[0].visible,false);
  assert.equal(renderer.getRenderTarget(),f.originalTarget);assert.equal(renderer.getActiveCubeFace(),3);assert.equal(renderer.getActiveMipmapLevel(),2);
  assert.equal(renderer.xr.enabled,true);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(f.sun.shadow.needsUpdate,true);
  assert.equal(material.lightMapIntensity,8*.018);assert.equal(material.emissiveIntensity,0);
  assert.equal(material.envMapIntensity,.7,'Captured darkness is not multiplied by the closing fade twice');
  assert.ok(Math.abs(exterior.envMapIntensity-.8)<1e-12);assert.notEqual(material.envMap,exterior.envMap);
  assert.equal(radiance.reflectionUniforms.roomRearEnvironment.value,radiance.environments.get('rear').texture);
  const disposed=[];for(const map of radiance.environments.values())map.addEventListener('dispose',()=>disposed.push(map));
  radiance.dispose();assert.equal(disposed.length,3);
});

test('reflection refresh is bounded per frame, commits atomically and retires old maps after completion',()=>{
  const f=fixture(),{radiance,renderer,material}=f;radiance.capture(f.room,f.air);
  renderer.shadowMap.needsUpdate=false;f.sun.shadow.needsUpdate=false;
  const original=new Map(radiance.environments),disposed=[];
  for(const map of original.values())map.addEventListener('dispose',()=>disposed.push(map));
  radiance.setDaylight(.2);radiance.update(4,false,false);
  assert.equal(radiance.stats.pending,true);assert.equal(radiance.environments.get('front'),original.get('front'));
  let frames=1;
  while(radiance.stats.pending){
    assert.equal(disposed.length,0);assert.equal(material.envMap,original.get('front').texture);
    const before=f.views.length;radiance.update(4+frames/60,false,false);frames++;
    assert.ok(f.views.length-before<=1,'A refresh may add no more than one scene view to a frame');
    assert.ok(frames<30);
  }
  assert.equal(frames,21,'Three probes each need six faces and one PMREM filtering step');
  assert.equal(disposed.length,3);assert.notEqual(material.envMap,original.get('front').texture);
  assert.equal(radiance.stats.captures,2);assert.equal(renderer.shadowMap.needsUpdate,false);assert.equal(f.sun.shadow.needsUpdate,false);
  assert.equal(f.views.slice(18).filter(view=>view.shadows).length,0,'A refresh cannot consume or replace the main shadow cache');
  radiance.dispose();
});

test('failed or stale refreshes preserve the last complete capture and restore hidden state',()=>{
  const f=fixture(),{radiance,renderer}=f;radiance.capture(f.room,f.air);
  const environment=radiance.environment;radiance.setDaylight(.4);radiance.update(4,false,false);
  const discarded=radiance.captureJob.target;let disposed=false;discarded.addEventListener('dispose',()=>{disposed=true;});
  radiance.setShopLight(0,f.room);radiance.update(4.1,false,false);
  assert.equal(disposed,true);assert.equal(radiance.captureJob,null);assert.equal(radiance.environment,environment);
  radiance.startCapture();f.fail();assert.throws(()=>radiance.advanceCapture(),/fixture render failure/);
  assert.equal(radiance.environment,environment);assert.equal(radiance.captureJob,null);assert.equal(radiance.stats.failures,1);
  assert.equal(f.root.visible,false);assert.equal(f.actor.visible,true);assert.equal(f.air.points.visible,true);
  assert.equal(renderer.xr.enabled,true);assert.equal(renderer.getRenderTarget(),f.originalTarget);
  assert.equal(renderer.getActiveCubeFace(),3);assert.equal(renderer.getActiveMipmapLevel(),2);
  f.fail('filter');radiance.startCapture();for(let face=0;face<6;face++)radiance.advanceCapture();
  assert.throws(()=>radiance.advanceCapture(),/fixture filter failure/);
  assert.equal(radiance.environment,environment);assert.equal(radiance.captureJob,null);assert.equal(radiance.stats.failures,2);
  assert.equal(renderer.xr.enabled,true);assert.equal(renderer.getRenderTarget(),f.originalTarget);
  assert.equal(renderer.getActiveCubeFace(),3);assert.equal(renderer.getActiveMipmapLevel(),2);
  radiance.dispose();
});

test('spatial projection composes with authored material shader hooks and does not wrap them again on recapture',()=>{
  const f=fixture(),{material,radiance}=f;
  const shared={value:.73};let calls=0;
  material.onBeforeCompile=shader=>{calls++;shader.uniforms.authored=shared;shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float authored;');};
  material.customProgramCacheKey=()=> 'authored-fixture';
  radiance.capture(f.room,f.air);
  const hook=material.onBeforeCompile,compile=()=>{
    const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
    material.onBeforeCompile(shader,f.renderer);return shader;
  };
  const shader=compile();assert.equal(calls,1);assert.equal(shader.uniforms.authored,shared);
  assert.equal(shader.uniforms.roomRearEnvironment,radiance.reflectionUniforms.roomRearEnvironment);
  assert.match(shader.fragmentShader,/roomProjectedDirection\(reflectVec,roomFrontProbe\)/);
  assert.match(shader.fragmentShader,/textureCubeUV\(roomRearEnvironment/);
  assert.match(shader.vertexShader,/vLocalReflectionPosition = \(modelMatrix \* vec4\(transformed,1\.0\)\)\.xyz/);
  assert.equal(material.customProgramCacheKey(),'authored-fixture|room-local-probes-v1');
  radiance.capture(f.room,f.air);assert.equal(material.onBeforeCompile,hook);compile();assert.equal(calls,2);
  radiance.dispose();
});
