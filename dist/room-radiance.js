import * as THREE from 'three';

// Practical lanterns, doorway light, and a reflection capture of this actual room.
// Indirect diffuse is baked separately by art/bake-room-light.py.
export class RoomRadiance {
  constructor(scene, renderer) {
    this.scene=scene;this.renderer=renderer;this.lamps=[];
    this.compact=matchMedia('(pointer: coarse)').matches;
    scene.add(new THREE.HemisphereLight(0xb8c9d3,0x655039,.34));
    scene.add(new THREE.AmbientLight(0xbba17b,.055));
    // Restore broad lantern illumination. A narrow, shadowed cone at each
    // enclosed lantern can turn its cage into a hard stencil across the room.
    this.practical([-1.55,2.402,4.47],24);
    this.practical([1.46,2.485,-.63],20);
    this.practical([-1.3,2.403,-6.65],12);
    this.practical([-.86,1.31,-5.66],10);
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
    daylight.position.set(0,2.75,6.7);scene.add(daylight);
  }
  practical(position,power){
    const light=new THREE.PointLight(0xffd3a0,power,8,2);
    light.position.fromArray(position);this.scene.add(light);this.lamps.push({light,power});
  }
  capture(room,atmosphere){
    const renderer=this.renderer,scene=this.scene;
    const target=new THREE.WebGLCubeRenderTarget(this.compact?128:256,{
      type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,
      generateMipmaps:false
    });
    const probe=new THREE.CubeCamera(.08,24,target);probe.position.set(0,1.6,.1);
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
    }finally{
      air.forEach((o,i)=>o.visible=visibility[i]);target.dispose();generator.dispose();
    }
  }
  update(time,gentle,movingCover){
    for(let i=0;i<this.lamps.length;i++){
      const {light,power}=this.lamps[i];
      light.intensity=power*(gentle?1:1+.007*Math.sin(time*1.3+i)+.003*Math.sin(time*4.7+i*2));
    }
    // Camera motion needs no new shadow renders: only the articulated book changes.
    if(movingCover)this.renderer.shadowMap.needsUpdate=true;
  }
}
