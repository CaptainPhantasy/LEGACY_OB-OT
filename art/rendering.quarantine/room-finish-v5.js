// Quarantined after version 5 visual regressions; excluded from dist and deployment.
import * as THREE from '../../dist/vendor/three.module.js';

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
