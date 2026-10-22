import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';

const threeURL=new URL('../dist/vendor/three.module.js',import.meta.url).href;
registerHooks({resolve(specifier,context,nextResolve){return specifier==='three'?{url:threeURL,shortCircuit:true}:nextResolve(specifier,context);}});
const THREE=await import(threeURL);
const {RoomRenderer,renderResolution,viewPositionFromDepth}=await import('../dist/room-renderer.js');
const near=(a,b,message='')=>assert.ok(Math.abs(a-b)<1e-7,`${a} must equal ${b}: ${message}`);

function rendererHarness({hdr=true,framebuffer=true,failAt=0,shaderFailure=false,onRender=()=>{}}={}){
  const calls=[],clear=new THREE.Color(0x112233),target={name:'previous target'};
  let currentTarget=target,alpha=.6,count=0;
  const gl={FRAMEBUFFER:0x8d40,FRAMEBUFFER_COMPLETE:0x8cd5,
    checkFramebufferStatus:()=>framebuffer?0x8cd5:0,getShaderSource:()=>shaderFailure?'// ROOM_RENDER_PIPELINE':''};
  const renderer={
    autoClear:false,debug:{onShaderError:undefined},info:{autoReset:true,reset(){calls.push({kind:'reset'});}},
    extensions:{has:name=>hdr&&name==='EXT_color_buffer_float'},
    drawingSize:new THREE.Vector2(1200,800),getDrawingBufferSize(out){return out.copy(this.drawingSize);},
    getContext:()=>gl,getRenderTarget:()=>currentTarget,setRenderTarget(value){currentTarget=value;},
    getClearColor:out=>out.copy(clear),getClearAlpha:()=>alpha,
    setClearColor(value,a){clear.set(value);alpha=a;},
    clear(){calls.push({kind:'clear',target:currentTarget,alpha});},
    render(scene,camera){
      count++;calls.push({kind:'render',target:currentTarget,scene,camera,material:scene.children?.[0]?.material});
      onRender(scene,camera,currentTarget);
      if(count===failAt)throw new Error('Intentional render failure');
      if(shaderFailure&&count===2)this.debug.onShaderError(gl,{}, {}, {});
    },
  };
  return {renderer,calls,target,clear,get alpha(){return alpha;}};
}

test('resolution preserves aspect and bounds HDR/effect allocations for phones, tablets and retina desktops',()=>{
  const budgets={high:2600000,balanced:1500000,low:1000000};
  for(const [width,height]of [[390,844],[768,1024],[3840,2160],[7680,4320]])for(const quality of Object.keys(budgets)){
    const r=renderResolution(width,height,quality);
    assert.ok(r.width*r.height<=budgets[quality]);
    assert.ok(Math.abs(r.width/r.height-width/height)<.01);
    assert.ok(r.effectsWidth<=r.width/2&&r.effectsHeight<=r.height/2);
    assert.ok(r.effectsWidth>0&&r.effectsHeight>0);
  }
  assert.deepEqual(renderResolution(NaN,0),{width:1,height:1,effectsWidth:1,effectsHeight:1});
});

test('depth reconstruction follows actual perspective and shelf view offsets, near and far',()=>{
  for(const viewport of [[390,844],[1366,768]])for(const offset of [0,130]){
    const camera=new THREE.PerspectiveCamera(58,viewport[0]/viewport[1],.04,60);
    if(offset)camera.setViewOffset(...viewport,0,offset,...viewport);
    for(const p of [new THREE.Vector3(.001,.002,-.05),new THREE.Vector3(.2,-.1,-2),new THREE.Vector3(-2,3,-40)]){
      const projected=p.clone().applyMatrix4(camera.projectionMatrix);
      const restored=viewPositionFromDepth(new THREE.Vector2(projected.x*.5+.5,projected.y*.5+.5),projected.z*.5+.5,camera.projectionMatrixInverse);
      assert.ok(restored.distanceTo(p)<1e-8,'all post effects must use the camera’s actual inverse matrix');
    }
  }
});

test('metadata hook preserves prior lighting hooks, material cache keys and authored transparency',()=>{
  const h=rendererHarness(),pipeline=new RoomRenderer(h.renderer),scene=new THREE.Scene();
  const material=new THREE.MeshPhysicalMaterial({roughness:.3,metalness:.7,clearcoat:.2});
  const transparent=new THREE.MeshPhysicalMaterial({transparent:true,opacity:.12,transmission:.8});
  let calls=0;const originalHook=shader=>{calls++;shader.fragmentShader='// original lightmap and reflection hook\n'+shader.fragmentShader;};
  const originalKey=()=> 'existing-surface-key';material.onBeforeCompile=originalHook;material.customProgramCacheKey=originalKey;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material),new THREE.Mesh(new THREE.BoxGeometry(),transparent));
  pipeline.refreshMaterials(scene);pipeline.refreshMaterials(scene);
  const shader={uniforms:{},fragmentShader:THREE.ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader,h.renderer);
  assert.equal(calls,1,'registering twice does not wrap the hook twice');
  assert.match(shader.fragmentShader,/original lightmap and reflection hook/);
  assert.match(shader.fragmentShader,/roomSurfaceMetadata/);
  assert.match(shader.fragmentShader,/roughnessFactor/);
  assert.equal(shader.uniforms.roomSurfaceMetadata,pipeline.metadata);
  assert.equal(shader.uniforms.roomSurfaceCoat.value,.2);
  assert.match(material.customProgramCacheKey(),/^existing-surface-key\|/);
  assert.equal(pipeline.materials.has(transparent),false);
  near(transparent.opacity,.12);near(transparent.transmission,.8);
  pipeline.dispose();assert.equal(material.onBeforeCompile,originalHook);assert.equal(material.customProgramCacheKey,originalKey);
});

test('different prior hooks retain different default program keys after metadata wrapping',()=>{
  const h=rendererHarness(),pipeline=new RoomRenderer(h.renderer),scene=new THREE.Scene();
  const first=new THREE.MeshStandardMaterial(),second=new THREE.MeshStandardMaterial();
  first.onBeforeCompile=shader=>{shader.fragmentShader='// first lighting hook\n'+shader.fragmentShader;};
  second.onBeforeCompile=shader=>{shader.fragmentShader='// second lighting hook\n'+shader.fragmentShader;};
  const firstKey=first.customProgramCacheKey(),secondKey=second.customProgramCacheKey();assert.notEqual(firstKey,secondKey);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(),first),new THREE.Mesh(new THREE.BoxGeometry(),second));
  pipeline.refreshMaterials(scene);
  assert.ok(first.customProgramCacheKey().startsWith(firstKey));assert.ok(second.customProgramCacheKey().startsWith(secondKey));
  assert.notEqual(first.customProgramCacheKey(),second.customProgramCacheKey());pipeline.dispose();
});

test('transparent panes and additive dust preserve destination metadata without changing RGB blend rules',()=>{
  const samples=[];let scene;
  const h=rendererHarness({onRender(drawn){if(drawn===scene)samples.push(drawn.children.map(o=>({
    blending:o.material.blending,src:o.material.blendSrc,dst:o.material.blendDst,
    srcAlpha:o.material.blendSrcAlpha,dstAlpha:o.material.blendDstAlpha,opacity:o.material.opacity,
  })));}});
  const pipeline=new RoomRenderer(h.renderer);scene=new THREE.Scene();
  const glass=new THREE.MeshPhysicalMaterial({transparent:true,opacity:.12});
  const dust=new THREE.PointsMaterial({transparent:true,opacity:.3,blending:THREE.AdditiveBlending});
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(),glass),new THREE.Points(new THREE.BufferGeometry(),dust));
  pipeline.render(scene,new THREE.PerspectiveCamera());
  assert.equal(samples.length,1);
  for(const sample of samples[0]){
    assert.equal(sample.blending,THREE.CustomBlending);assert.equal(sample.srcAlpha,THREE.ZeroFactor);assert.equal(sample.dstAlpha,THREE.OneFactor);
    assert.equal(sample.src,THREE.SrcAlphaFactor);
  }
  assert.equal(samples[0][0].dst,THREE.OneMinusSrcAlphaFactor);near(samples[0][0].opacity,.12);
  assert.equal(samples[0][1].dst,THREE.OneFactor);near(samples[0][1].opacity,.3);
  assert.equal(glass.blending,THREE.NormalBlending);assert.equal(dust.blending,THREE.AdditiveBlending);
  assert.equal(glass.blendSrcAlpha,null);assert.equal(dust.blendDstAlpha,null);
  pipeline.dispose();
});

test('post shaders do not redeclare functions injected by the bundled Three GLSL prefix',()=>{
  const h=rendererHarness(),pipeline=new RoomRenderer(h.renderer);
  const vendor=readFileSync(new URL('../dist/vendor/three.module.js',import.meta.url),'utf8');
  const luminanceGenerator=vendor.slice(vendor.indexOf('function getLuminanceFunction()'),vendor.indexOf('function generateVertexExtensions'));
  const injected=THREE.ShaderChunk.tonemapping_pars_fragment+'\n'+THREE.ShaderChunk.colorspace_pars_fragment+'\n'+luminanceGenerator;
  const functions=shader=>new Set([...shader.matchAll(/(?:float|bool|vec[234]|mat[234])\s+(\w+)\s*\(/g)].map(match=>match[1]));
  const prefixNames=functions(injected);assert.ok(prefixNames.has('luminance'),'use the actual vendor prefix, whose injected helper caused the regression');
  for(const material of [pipeline.aoMaterial,pipeline.reflectionMaterial,pipeline.compositeMaterial]){
    for(const name of functions(material.fragmentShader))assert.ok(!prefixNames.has(name),`${material.name} duplicates injected GLSL function ${name}`);
  }
  pipeline.dispose();
});

test('one beauty pass feeds three screen passes and restores target, clear state, exposure and callbacks',()=>{
  const h=rendererHarness(),pipeline=new RoomRenderer(h.renderer),scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(58,1.5,.04,60);
  h.renderer.toneMapping=THREE.AgXToneMapping;h.renderer.toneMappingExposure=1.75;
  const callback=()=>{};h.renderer.debug.onShaderError=callback;
  pipeline.render(scene,camera);
  const renders=h.calls.filter(c=>c.kind==='render');assert.equal(renders.length,4);
  assert.equal(renders[0].scene,scene);assert.equal(renders[0].target,pipeline.beauty);
  assert.equal(renders[1].target,pipeline.occlusion);assert.equal(renders[2].target,pipeline.reflection);assert.equal(renders[3].target,h.target);
  assert.equal(pipeline.beauty.texture.type,THREE.HalfFloatType);
  assert.equal(pipeline.beauty.texture.colorSpace,THREE.LinearSRGBColorSpace);
  assert.equal(pipeline.beauty.depthTexture.type,THREE.UnsignedIntType);
  assert.equal(pipeline.aoMaterial.toneMapped,false);assert.equal(pipeline.reflectionMaterial.toneMapped,false);assert.equal(pipeline.compositeMaterial.toneMapped,true);
  assert.equal(h.renderer.getRenderTarget(),h.target);assert.equal(h.renderer.autoClear,false);near(h.alpha,.6);assert.equal(h.clear.getHex(),0x112233);
  near(h.renderer.toneMappingExposure,1.75);assert.equal(h.renderer.toneMapping,THREE.AgXToneMapping);
  assert.equal(h.renderer.debug.onShaderError,callback);assert.equal(h.renderer.info.autoReset,true);assert.equal(pipeline.metadata.value,0);
  pipeline.dispose();
});

test('adaptive resolution follows later DPR changes and low quality removes reflection ray work',()=>{
  const h=rendererHarness(),pipeline=new RoomRenderer(h.renderer,{compact:true});
  assert.equal(pipeline.quality,'balanced');
  h.renderer.drawingSize.set(2400,1600);pipeline.resize();
  assert.ok(pipeline.beauty.width*pipeline.beauty.height<=1500000);
  pipeline.setQuality('low');assert.equal(pipeline.reflectionMaterial.uniforms.stepCount.value,0);
  assert.equal(pipeline.aoMaterial.uniforms.sampleCount.value,6);
  assert.ok(pipeline.beauty.width*pipeline.beauty.height<=1000000);
  pipeline.render(new THREE.Scene(),new THREE.PerspectiveCamera());
  assert.equal(h.calls.filter(c=>c.kind==='render').length,3);
  const cleared=h.calls.find(c=>c.kind==='clear');assert.equal(cleared.target,pipeline.reflection);assert.equal(cleared.alpha,0);
  assert.throws(()=>pipeline.setQuality('ultra'),RangeError);pipeline.dispose();
});

test('unsupported HDR, incomplete buffers and render failures fall back to the original scene',()=>{
  for(const options of [{hdr:false},{framebuffer:false},{failAt:2},{shaderFailure:true}]){
    const h=rendererHarness(options),reasons=[],pipeline=new RoomRenderer(h.renderer,{onFallback:reason=>reasons.push(reason)});
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
    const material=new THREE.MeshStandardMaterial();const oldHook=material.onBeforeCompile;
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(),material));pipeline.refreshMaterials(scene);
    pipeline.render(scene,camera);
    assert.equal(pipeline.enabled,false);assert.equal(material.onBeforeCompile,oldHook);
    assert.equal(pipeline.metadata.value,0);assert.equal(h.renderer.getRenderTarget(),h.target);
    assert.equal(h.calls.at(-1).scene,scene,'the same requested view is rendered through the direct path');
    assert.equal(h.renderer.autoClear,false);near(h.alpha,.6);assert.equal(h.clear.getHex(),0x112233);
    assert.ok(pipeline.stats.fallbackReason);assert.equal(reasons.length,options.hdr===false?0:1);
    const before=h.calls.length;pipeline.render(scene,camera);assert.equal(h.calls.length,before+1,'a failed effect is not repeatedly retried');
    pipeline.dispose();
  }
});

