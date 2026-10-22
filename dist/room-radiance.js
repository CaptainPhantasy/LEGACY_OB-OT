import * as THREE from 'three';

const ROOM_MIN = new THREE.Vector3(-3.4,-.15,-8.2), ROOM_MAX = new THREE.Vector3(3.4,3.55,7.3);
export const REFLECTION_PROBES = Object.freeze([
  Object.freeze({name:'front',position:Object.freeze([0,1.6,3.8])}),
  Object.freeze({name:'rear',position:Object.freeze([0,1.45,-4.1])}),
  Object.freeze({name:'street',position:Object.freeze([0,1.8,13.5])}),
]);

// Mirrors the shader's ray/room-box intersection. This is parallax correction
// for local reflection captures, not a claim of hardware ray tracing.
export function boxProjectedDirection(position,direction,probe,out=new THREE.Vector3()){
  if(![position,direction,probe].every(v=>[v.x,v.y,v.z].every(Number.isFinite)))throw new TypeError('Reflection vectors must be finite.');
  if(!new THREE.Box3(ROOM_MIN,ROOM_MAX).containsPoint(position))return out.copy(direction);
  let distance=Infinity;
  for(const axis of ['x','y','z'])if(Math.abs(direction[axis])>1e-7){
    const plane=direction[axis]>0?ROOM_MAX[axis]:ROOM_MIN[axis];
    distance=Math.min(distance,(plane-position[axis])/direction[axis]);
  }
  return Number.isFinite(distance)?out.copy(direction).multiplyScalar(distance).add(position).sub(probe):out.copy(direction);
}

const projectionShader=`
varying vec3 vLocalReflectionPosition;
uniform sampler2D roomRearEnvironment;
uniform vec3 roomFrontProbe;
uniform vec3 roomRearProbe;
vec3 roomProjectedDirection(vec3 direction,vec3 probe){
  vec3 p=vLocalReflectionPosition;
  vec3 low=vec3(-3.4,-.15,-8.2),high=vec3(3.4,3.55,7.3);
  if(any(lessThan(p,low))||any(greaterThan(p,high)))return direction;
  vec3 safeDirection=mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),direction))*max(abs(direction),vec3(.000001));
  vec3 farDistance=max((high-p)/safeDirection,(low-p)/safeDirection);
  float distance=min(farDistance.x,min(farDistance.y,farDistance.z));
  return p+direction*distance-probe;
}
`;

// Baked Cycles diffuse remains the light transport baseline. Two room captures
// supply spatially corrected, roughness-filtered specular light; a separate
// outdoor capture keeps the sky and city in vehicle paint and storefront glass.
export class RoomRadiance {
  constructor(scene, renderer) {
    this.scene=scene;this.renderer=renderer;this.lamps=[];this.shelfLights=[];
    this.shopLight=1;this.daylightLevel=1;this.materialRoom=null;this.materialBases=new Map();
    this.compact=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
    this.clock=0;this.lastCapture=-Infinity;this.lastLightChange=-Infinity;this.captureState={shop:1,day:1};
    this.environments=new Map();this.exteriorBases=new Map();this.projected=new WeakSet();this.context={};this.captureJob=null;
    this.stats={captures:0,cubeFaces:0,pending:false,failures:0};
    this.reflectionUniforms={roomRearEnvironment:{value:null},roomFrontProbe:{value:new THREE.Vector3(...REFLECTION_PROBES[0].position)},roomRearProbe:{value:new THREE.Vector3(...REFLECTION_PROBES[1].position)}};
    this.hemisphere=new THREE.HemisphereLight(0xb8c9d3,0x655039,.34);
    this.ambient=new THREE.AmbientLight(0xbba17b,.055);scene.add(this.hemisphere,this.ambient);
    // Restore broad lantern illumination. A narrow, shadowed cone at each
    // enclosed lantern can turn its cage into a hard stencil across the room.
    this.practical([-1.55,2.402,4.47],24);
    this.practical([1.46,2.485,-.63],20);
    this.practical([-1.3,2.403,-6.65],12);
    this.practical([-.86,1.31,-5.66],10);
    // Soft display-face highlights accompany the baked area-light illumination.
    // The lightmap replaces dynamic diffuse; these steady, unshadowed sources
    // let handled brass and steel retain a live highlight as the visitor moves.
    for(const side of [-1,1])for(const depth of [2.75,1.5,.25]){
      const light=new THREE.SpotLight(0xffdfb6,4,3.2,.8,1,2);
      light.name=`Shelf face light ${side<0?'west':'east'} ${depth}`;
      light.position.set(side*1.6,1.95,depth);
      light.target.position.set(side*.2,1,depth);
      light.castShadow=false;
      scene.add(light,light.target);this.shelfLights.push(light);
    }
    // One controlled shadow source retains the book's grounding and movement.
    const tableLight=new THREE.SpotLight(0xffd8a7,15,7,.9,.8,1.5);
    tableLight.position.set(-1.3,2.4,-6.65);tableLight.target.position.set(0,0,-5);
    tableLight.castShadow=true;
    tableLight.shadow.autoUpdate=false;tableLight.shadow.needsUpdate=true;
    tableLight.shadow.mapSize.set(this.compact?1024:2048,this.compact?1024:2048);
    tableLight.shadow.camera.near=.1;tableLight.shadow.camera.far=7;
    tableLight.shadow.bias=-.0007;tableLight.shadow.normalBias=.025;
    tableLight.shadow.intensity=.65;
    scene.add(tableLight,tableLight.target);this.tableLight=tableLight;
    // Broad doorway spill has a direction and finite reach. It cannot light
    // through the rear of the shop like an omnidirectional point in the street.
    const daylight=new THREE.SpotLight(0xb6d0e3,4,12,1.05,1,2);
    daylight.position.set(0,2.75,6.7);daylight.target.position.set(0,.8,1.2);
    scene.add(daylight,daylight.target);this.daylight=daylight;
  }
  practical(position,power){
    const light=new THREE.PointLight(0xffd3a0,power,8,2);
    light.position.fromArray(position);this.scene.add(light);this.lamps.push({light,power});
  }
  bindRoom(room){
    if(!room||room===this.materialRoom)return;
    this.materialRoom=room;this.materialBases.clear();
    room.traverse(object=>{if(!object.isMesh)return;for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(!material||this.materialBases.has(material))continue;
      this.materialBases.set(material,{
        lightMapIntensity:material.lightMapIntensity,
        emissiveIntensity:material.emissiveIntensity,
        envMapIntensity:material.envMapIntensity
      });
    }});
  }
  setEnvironmentContext({storefront}={}){
    this.context.storefront=storefront||null;
    this.exteriorBases.clear();
    storefront?.root?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
      if(!m?.isMeshStandardMaterial||this.exteriorBases.has(m))continue;
      this.exteriorBases.set(m,Number.isFinite(m.envMapIntensity)?m.envMapIntensity:1);
      const environment=this.environments.get('street');if(environment){m.envMap=environment.texture;m.needsUpdate=true;}
    }});
    return this;
  }
  setShopLight(level,room,daylight){
    if(!Number.isFinite(level))throw new TypeError('The shop light level must be finite.');
    this.bindRoom(room);const next=THREE.MathUtils.clamp(level,0,1);
    if(Math.abs(next-this.shopLight)>.0001)this.lastLightChange=this.clock;
    this.shopLight=next;
    if(daylight!==undefined)this.setDaylight(daylight);
    const value=this.shopLight;
    // The practical lamps really switch off. A little reflected street/moon
    // light remains so the visitor can navigate the room after closing.
    for(const {light,power} of this.lamps)light.intensity=power*value;
    for(const light of this.shelfLights)light.intensity=4*value;
    this.tableLight.intensity=15*value;
    this.hemisphere.intensity=.012+(.34-.012)*value;
    this.ambient.intensity=.003+(.055-.003)*value;
    for(const [material,base] of this.materialBases){
      if(Number.isFinite(base.lightMapIntensity))material.lightMapIntensity=base.lightMapIntensity*(.018+.982*value);
      if(Number.isFinite(base.emissiveIntensity))material.emissiveIntensity=base.emissiveIntensity*value;
      // Once a dark-room capture replaces the daytime one, don't dim its
      // already dark radiance twice. Before replacement, fade it immediately.
      if(Number.isFinite(base.envMapIntensity))material.envMapIntensity=base.envMapIntensity*(.04+.96*value)/(.04+.96*this.captureState.shop);
    }
    return this;
  }
  setDaylight(level){
    if(!Number.isFinite(level))throw new TypeError('The daylight level must be finite.');
    const next=THREE.MathUtils.clamp(level,0,1);
    if(Math.abs(next-this.daylightLevel)>.0001)this.lastLightChange=this.clock;
    this.daylightLevel=next;
    this.daylight.intensity=4*(.025+.975*this.daylightLevel);
    this.daylight.color.set(0x526d9b).lerp(new THREE.Color(0xb6d0e3),this.daylightLevel);
    for(const [material,intensity]of this.exteriorBases)material.envMapIntensity=intensity*(.05+.95*this.daylightLevel)/(.05+.95*this.captureState.day);
    return this;
  }
  installProjection(material){
    if(this.projected.has(material))return;
    const previousCompile=material.onBeforeCompile,previousKey=material.customProgramCacheKey.bind(material);
    material.onBeforeCompile=(shader,renderer)=>{
      previousCompile.call(material,shader,renderer);
      const anchor='#include <envmap_physical_pars_fragment>';
      const original='vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );';
      const chunk=THREE.ShaderChunk.envmap_physical_pars_fragment;
      if(!shader.vertexShader.includes('#include <worldpos_vertex>')||!shader.fragmentShader.includes(anchor)||!chunk.includes(original))throw new Error('Local reflection projection does not match the supplied renderer.');
      Object.assign(shader.uniforms,this.reflectionUniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLocalReflectionPosition;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvLocalReflectionPosition = (modelMatrix * vec4(transformed,1.0)).xyz;');
      const corrected=chunk.replace(original,`
        vec3 frontRay=roomProjectedDirection(reflectVec,roomFrontProbe);
        vec3 rearRay=roomProjectedDirection(reflectVec,roomRearProbe);
        float rearWeight=1.0-smoothstep(-4.1,3.8,vLocalReflectionPosition.z);
        vec4 envMapColor=mix(textureCubeUV(envMap,envMapRotation*frontRay,roughness),textureCubeUV(roomRearEnvironment,envMapRotation*rearRay,roughness),rearWeight);
      `);
      shader.fragmentShader=shader.fragmentShader.replace(anchor,projectionShader+'\n'+corrected);
    };
    material.customProgramCacheKey=()=>previousKey()+'|room-local-probes-v1';
    this.projected.add(material);material.needsUpdate=true;
  }
  startCapture(room=this.materialRoom,atmosphere=this.atmosphere){
    if(this.captureJob||!room)return;
    this.bindRoom(room);this.atmosphere=atmosphere;
    const renderer=this.renderer,size=this.compact?128:256;
    const specs=this.context.storefront?REFLECTION_PROBES:REFLECTION_PROBES.slice(0,2);
    const target=new THREE.WebGLCubeRenderTarget(size,{type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,generateMipmaps:false});
    const probe=new THREE.CubeCamera(.08,60,target);
    probe.coordinateSystem=renderer.coordinateSystem;probe.updateCoordinateSystem();
    const missingShadows=[];
    this.scene.traverse(object=>{if(object.isLight&&object.castShadow&&object.shadow&&!object.shadow.map)missingShadows.push(object);});
    this.captureJob={room,atmosphere,target,probe,generator:new THREE.PMREMGenerator(renderer),specs,index:0,face:0,maps:new Map(),missingShadows,state:{shop:this.shopLight,day:this.daylightLevel}};
    this.stats.pending=true;
  }
  withCaptureScene(action,missingShadows=[]){
    const hidden=[],forced=[],intensities=[],renderer=this.renderer;
    const remember=(object,value,list)=>{if(object){list.push([object,object.visible]);object.visible=value;}};
    const atmosphere=this.atmosphere;
    for(const object of [atmosphere?.points,...atmosphere?.beams||[],...atmosphere?.bookRays||[]])remember(object,false,hidden);
    const storefront=this.context.storefront;
    remember(storefront?.root,true,forced);
    for(const actor of storefront?.actors||[])remember(actor.group,false,hidden);
    // The captures contain direct/baked light, avoiding an ever-brighter
    // recursive reflection of the preceding capture on later refreshes.
    for(const material of new Set([...this.materialBases.keys(),...this.exteriorBases.keys()])){
      intensities.push([material,material.envMapIntensity]);material.envMapIntensity=0;
    }
    const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel(),xr=renderer.xr.enabled;
    const shadowDirty=renderer.shadowMap.needsUpdate,shadowAuto=renderer.shadowMap.autoUpdate;
    // Preserve the main view's shadow cache. Only a cold first capture needs
    // to initialize maps; uninitialized depth textures can black out surfaces.
    const warmup=missingShadows.length>0;
    try{
      renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=warmup;
      for(const light of missingShadows)light.shadow.needsUpdate=true;
      return action();
    }
    finally{
      renderer.setRenderTarget(target,face,mip);renderer.xr.enabled=xr;
      for(const [material,value]of intensities)material.envMapIntensity=value;
      for(const [object,value]of [...hidden,...forced])object.visible=value;
      renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowDirty||warmup;
      // Cold-start maps contained no actors. The first main render restores
      // their sun shadows; all remaining probe faces reuse the warm cache.
      if(warmup&&storefront?.sun?.shadow)storefront.sun.shadow.needsUpdate=true;
    }
  }
  advanceCapture(){
    const job=this.captureJob;if(!job)return false;
    try{
      if(job.face<6){
        const spec=job.specs[job.index];job.probe.position.fromArray(spec.position);job.probe.updateMatrixWorld(true);
        this.withCaptureScene(()=>{
          this.renderer.setRenderTarget(job.target,job.face,0);
          this.renderer.render(this.scene,job.probe.children[job.face]);
        },job.missingShadows);
        job.missingShadows=[];
        job.face++;this.stats.cubeFaces++;return true;
      }
      job.target.texture.needsPMREMUpdate=true;
      // PMREM also changes render target and XR state. Guard its failure path
      // just like a cube face so an interrupted refresh cannot hijack the view.
      const filtered=this.withCaptureScene(()=>job.generator.fromCubemap(job.target.texture));
      job.maps.set(job.specs[job.index].name,filtered);
      job.index++;job.face=0;
      if(job.index<job.specs.length)return true;
      const previous=this.environments;this.environments=job.maps;this.captureState=job.state;
      this.environment=job.maps.get('front');this.reflectionUniforms.roomRearEnvironment.value=job.maps.get('rear').texture;
      for(const [material,base]of this.materialBases){
        if(!material.isMeshStandardMaterial)continue;
        material.envMap=this.environment.texture;this.installProjection(material);
        // Authored finish response remains the material's own choice.
        material.envMapIntensity=base.envMapIntensity;
      }
      const exterior=job.maps.get('street');
      if(exterior)for(const [material,intensity]of this.exteriorBases){material.envMap=exterior.texture;material.envMapIntensity=intensity;material.needsUpdate=true;}
      this.lastCapture=this.clock;this.stats.captures++;this.stats.pending=false;
      job.target.dispose();job.generator.dispose();this.captureJob=null;
      for(const map of previous.values())map.dispose();
      this.setShopLight(this.shopLight);this.setDaylight(this.daylightLevel);
      return false;
    }catch(error){
      for(const map of job.maps.values())map.dispose();job.target.dispose();job.generator.dispose();
      this.captureJob=null;this.stats.pending=false;this.stats.failures++;this.lastCapture=this.clock;
      throw error;
    }
  }
  capture(room,atmosphere){
    this.startCapture(room,atmosphere);
    while(this.captureJob)this.advanceCapture();
    return this;
  }
  cancelCapture(){
    if(!this.captureJob)return;
    for(const map of this.captureJob.maps.values())map.dispose();
    this.captureJob.target.dispose();this.captureJob.generator.dispose();this.captureJob=null;this.stats.pending=false;
  }
  dispose(){
    this.cancelCapture();
    for(const map of this.environments.values())map.dispose();this.environments.clear();
  }
  update(time,gentle,movingCover){
    this.clock=Number.isFinite(time)?time:this.clock;
    for(let i=0;i<this.lamps.length;i++){
      const {light,power}=this.lamps[i];
      light.intensity=power*this.shopLight*(gentle?1:1+.007*Math.sin(time*1.3+i)+.003*Math.sin(time*4.7+i*2));
    }
    // Camera motion needs no new shadow renders: only the articulated book changes.
    if(movingCover){this.tableLight.shadow.needsUpdate=true;this.renderer.shadowMap.needsUpdate=true;}
    // Changes are debounced until lamps settle. A refresh adds at most one
    // cube face OR one PMREM filtering step to a frame, never eighteen views.
    const changed=Math.abs(this.shopLight-this.captureState.shop)>.04||Math.abs(this.daylightLevel-this.captureState.day)>.035;
    if(this.captureJob&&(Math.abs(this.shopLight-this.captureJob.state.shop)>.04||Math.abs(this.daylightLevel-this.captureJob.state.day)>.035))this.cancelCapture();
    if(!this.captureJob&&this.environment&&changed&&time-this.lastLightChange>.4&&time-this.lastCapture>3)this.startCapture();
    if(this.captureJob&&!movingCover){
      try{this.advanceCapture();}catch(error){console.warn('Reflection refresh paused; the last complete lighting remains available.',error);}
    }
  }
}
