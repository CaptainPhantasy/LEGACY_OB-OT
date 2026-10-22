import * as THREE from 'three';

// Practical lanterns, doorway light, and a reflection capture of this actual room.
// Indirect diffuse is baked separately by art/bake-room-light.py.
export class RoomRadiance {
  constructor(scene, renderer) {
    this.scene=scene;this.renderer=renderer;this.lamps=[];this.shelfLights=[];
    this.shopLight=1;this.daylightLevel=1;this.materialRoom=null;this.materialBases=new Map();
    this.compact=matchMedia('(pointer: coarse)').matches;
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
    tableLight.shadow.mapSize.set(2048,2048);
    tableLight.shadow.camera.near=.1;tableLight.shadow.camera.far=7;
    tableLight.shadow.bias=-.0007;tableLight.shadow.normalBias=.025;
    tableLight.shadow.intensity=.65;
    scene.add(tableLight,tableLight.target);this.tableLight=tableLight;
    const daylight=new THREE.PointLight(0xb6d0e3,4,10,2);
    daylight.position.set(0,2.75,6.7);scene.add(daylight);this.daylight=daylight;
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
  setShopLight(level,room,daylight){
    if(!Number.isFinite(level))throw new TypeError('The shop light level must be finite.');
    this.bindRoom(room);this.shopLight=THREE.MathUtils.clamp(level,0,1);
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
      if(Number.isFinite(base.envMapIntensity))material.envMapIntensity=base.envMapIntensity*(.04+.96*value);
    }
    return this;
  }
  setDaylight(level){
    if(!Number.isFinite(level))throw new TypeError('The daylight level must be finite.');
    this.daylightLevel=THREE.MathUtils.clamp(level,0,1);
    this.daylight.intensity=4*(.025+.975*this.daylightLevel);
    this.daylight.color.set(0x526d9b).lerp(new THREE.Color(0xb6d0e3),this.daylightLevel);
    return this;
  }
  capture(room,atmosphere){
    const renderer=this.renderer,scene=this.scene;
    const target=new THREE.WebGLCubeRenderTarget(this.compact?128:256,{
      type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,
      generateMipmaps:false
    });
    const probe=new THREE.CubeCamera(.08,60,target);probe.position.set(0,1.6,.1);
    const generator=new THREE.PMREMGenerator(renderer);
    // Dust should not be painted into the metal's stationary reflection.
    const air=[atmosphere.points,...atmosphere.beams,...atmosphere.bookRays];
    const visibility=air.map(o=>o.visible);air.forEach(o=>o.visible=false);
    try{
      renderer.shadowMap.needsUpdate=true;
      probe.update(renderer,scene);
      this.environment=generator.fromCubemap(target.texture);
      room.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){
        if(!m.isMeshStandardMaterial)continue;
        m.envMap=this.environment.texture;
        if(!m.userData.surfaceFamily)m.envMapIntensity=m.metalness>.3?.72:.22;
        m.needsUpdate=true;
      }});
      this.bindRoom(room);
      this.setShopLight(this.shopLight);
    }finally{
      air.forEach((o,i)=>o.visible=visibility[i]);target.dispose();generator.dispose();
    }
  }
  update(time,gentle,movingCover){
    for(let i=0;i<this.lamps.length;i++){
      const {light,power}=this.lamps[i];
      light.intensity=power*this.shopLight*(gentle?1:1+.007*Math.sin(time*1.3+i)+.003*Math.sin(time*4.7+i*2));
    }
    // Camera motion needs no new shadow renders: only the articulated book changes.
    if(movingCover)this.renderer.shadowMap.needsUpdate=true;
  }
}
