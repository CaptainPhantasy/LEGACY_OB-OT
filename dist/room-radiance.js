import * as THREE from 'three';

// Practical lanterns, doorway light, and a reflection capture of this actual room.
// Indirect diffuse is baked separately by art/bake-room-light.py.
export class RoomRadiance {
  constructor(scene, renderer) {
    this.scene=scene;this.renderer=renderer;this.lamps=[];
    this.compact=matchMedia('(pointer: coarse)').matches;
    this.shadowSize=this.compact?1024:1536;
    const sky=new THREE.HemisphereLight(0xb8c9d3,0x655039,.34);scene.add(sky);
    scene.add(new THREE.AmbientLight(0xbba17b,.035));
    this.practical([-1.55,2.402,4.47],[-.7,.05,3.55],28,8,1.18);
    this.practical([1.46,2.485,-.63],[.55,.05,-.1],25,8,1.19);
    this.practical([-1.3,2.403,-6.65],[-.15,.05,-5.4],18,7,1.16);
    this.practical([-.86,1.31,-5.66],[0,1.02,-4.92],8,3,.99,false);
    // Cooler light entering from the stairwell gives depth against the amber lamps.
    const daylight=new THREE.SpotLight(0xb6d0e3,15,15,.60,.85,2);
    daylight.position.set(0,2.75,7.1);daylight.target.position.set(-.45,.4,1.6);
    scene.add(daylight,daylight.target);
    this.daylight=daylight;
  }
  practical(position,target,power,distance,angle,shadows=true){
    const light=new THREE.SpotLight(0xffc588,power,distance,angle,.72,2);
    light.position.fromArray(position);light.target.position.fromArray(target);
    light.castShadow=shadows;
    light.shadow.mapSize.set(this.shadowSize,this.shadowSize);
    light.shadow.camera.near=.08;light.shadow.camera.far=distance;
    light.shadow.bias=-.00012;light.shadow.normalBias=.016;
    light.shadow.radius=2;
    this.scene.add(light,light.target);this.lamps.push({light,power});
    // A little light leaves the sides of the glass. Most arrives through the shade.
    const fill=new THREE.PointLight(0xffcf9e,power*.17,distance*.68,2);
    fill.position.fromArray(position);this.scene.add(fill);
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

// Modest optical bloom, evaluated in linear light before the display transform.
// No depth blur: books, lettering and small discoveries remain in focus.
export class RoomFinish {
  constructor(renderer){
    this.renderer=renderer;this.scene=new THREE.Scene();
    this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    this.geometry=new THREE.PlaneGeometry(2,2);
    this.hdr=renderer.extensions.has('EXT_color_buffer_float');
    const options={type:this.hdr?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:false};
    this.main=new THREE.WebGLRenderTarget(1,1,{...options,depthBuffer:true,samples:2});
    this.haloA=new THREE.WebGLRenderTarget(1,1,options);this.haloB=new THREE.WebGLRenderTarget(1,1,options);
    const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
    this.blur=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,uniforms:{source:{value:null},stepUV:{value:new THREE.Vector2()},threshold:{value:0}},vertexShader,fragmentShader:`
      varying vec2 vUv;uniform sampler2D source;uniform vec2 stepUV;uniform float threshold;
      vec3 sampleLight(vec2 uv){vec3 c=texture2D(source,uv).rgb;float lum=max(c.r,max(c.g,c.b));return c*max(0.,lum-threshold)/max(lum,.001);}
      void main(){vec3 c=sampleLight(vUv)*.227027;
        c+=(sampleLight(vUv+stepUV*1.384615)+sampleLight(vUv-stepUV*1.384615))*.316216;
        c+=(sampleLight(vUv+stepUV*3.230769)+sampleLight(vUv-stepUV*3.230769))*.070270;
        gl_FragColor=vec4(c,1.);}`});
    this.finish=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{source:{value:this.main.texture},halo:{value:this.haloB.texture}},vertexShader,fragmentShader:`
      varying vec2 vUv;uniform sampler2D source;uniform sampler2D halo;
      void main(){vec3 c=texture2D(source,vUv).rgb+texture2D(halo,vUv).rgb*.12;
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
    this.quad=new THREE.Mesh(this.geometry,this.finish);this.quad.frustumCulled=false;this.scene.add(this.quad);
  }
  resize(){const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());this.main.setSize(size.x,size.y);this.haloA.setSize(Math.max(1,Math.floor(size.x/4)),Math.max(1,Math.floor(size.y/4)));this.haloB.setSize(this.haloA.width,this.haloA.height);}
  render(scene,camera){
    const r=this.renderer;
    r.setRenderTarget(this.main);r.render(scene,camera);
    this.quad.material=this.blur;
    this.blur.uniforms.source.value=this.main.texture;
    this.blur.uniforms.threshold.value=this.hdr?1.1:.72;
    this.blur.uniforms.stepUV.value.set(1.5/this.haloA.width,0);
    r.setRenderTarget(this.haloA);r.render(this.scene,this.camera);
    this.blur.uniforms.source.value=this.haloA.texture;this.blur.uniforms.threshold.value=0;
    this.blur.uniforms.stepUV.value.set(0,1.5/this.haloA.height);
    r.setRenderTarget(this.haloB);r.render(this.scene,this.camera);
    this.quad.material=this.finish;r.setRenderTarget(null);r.render(this.scene,this.camera);
  }
}
