import * as THREE from 'three';

// The room's baked indirect light and reflection probes remain the foundation.
// These bounded screen-space effects add moving contact detail and reflections
// of visible objects. They are not hardware ray tracing or a path tracer.
const QUALITY = Object.freeze({
  high: Object.freeze({scale: .5, aoSamples: 12, reflectionSteps: 24, pixels: 2600000}),
  balanced: Object.freeze({scale: .45, aoSamples: 8, reflectionSteps: 16, pixels: 1500000}),
  low: Object.freeze({scale: .4, aoSamples: 6, reflectionSteps: 0, pixels: 1000000}),
});

export function renderResolution(width, height, quality='high') {
  const profile=QUALITY[quality]||QUALITY.high;
  const w=Math.max(1,Number.isFinite(width)?width:1),h=Math.max(1,Number.isFinite(height)?height:1);
  const scale=Math.min(1,Math.sqrt(profile.pixels/(w*h)));
  const fullWidth=Math.max(1,Math.floor(w*scale)),fullHeight=Math.max(1,Math.floor(h*scale));
  return {width:fullWidth,height:fullHeight,
    effectsWidth:Math.max(1,Math.floor(fullWidth*profile.scale)),effectsHeight:Math.max(1,Math.floor(fullHeight*profile.scale))};
}

export function viewPositionFromDepth(uv, depth, inverseProjection, out=new THREE.Vector3()) {
  return out.set(uv.x*2-1,uv.y*2-1,depth*2-1).applyMatrix4(inverseProjection);
}

const vertexShader=/* glsl */`
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;

const depthFunctions=/* glsl */`
  uniform sampler2D tDepth;
  uniform mat4 inverseProjection;
  uniform mat4 projection;
  uniform vec2 texelSize;
  vec3 viewPosition(vec2 uv,float depth){
    vec4 p=inverseProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0);
    return p.xyz/p.w;
  }
  vec3 positionAt(vec2 uv){return viewPosition(uv,texture2D(tDepth,uv).r);}
  vec3 surfaceNormal(vec2 uv,vec3 p){
    // Pick the closer derivative at a silhouette, instead of connecting the
    // foreground object to the far wall behind it and making a dark halo.
    vec3 left=positionAt(uv-vec2(texelSize.x,0.0));
    vec3 right=positionAt(uv+vec2(texelSize.x,0.0));
    vec3 down=positionAt(uv-vec2(0.0,texelSize.y));
    vec3 up=positionAt(uv+vec2(0.0,texelSize.y));
    vec3 dx=abs(right.z-p.z)<abs(left.z-p.z)?right-p:p-left;
    vec3 dy=abs(up.z-p.z)<abs(down.z-p.z)?up-p:p-down;
    vec3 crossNormal=cross(dx,dy);
    return dot(crossNormal,crossNormal)>.0000000001?normalize(crossNormal):vec3(0.0,0.0,1.0);
  }
  bool projectPosition(vec3 p,out vec2 uv){
    vec4 clip=projection*vec4(p,1.0);
    if(clip.w<=0.0)return false;
    uv=clip.xy/clip.w*.5+.5;
    return all(greaterThan(uv,vec2(.001)))&&all(lessThan(uv,vec2(.999)));
  }
`;

const aoShader=/* glsl */`
  // ROOM_RENDER_PIPELINE: contact occlusion in view-space metres.
  varying vec2 vUv;
  uniform int sampleCount;
  uniform float radius;
  ${depthFunctions}
  void main(){
    float depth=texture2D(tDepth,vUv).r;
    if(depth>=.999999){gl_FragColor=vec4(1.0);return;}
    vec3 p=viewPosition(vUv,depth),normal=surfaceNormal(vUv,p);
    float screenRadius=clamp(radius*projection[1][1]/max(-p.z,.12)*.5,texelSize.y*2.0,.12);
    vec2 aspect=vec2(projection[0][0]/projection[1][1],1.0);
    float occlusion=0.0,weight=0.0;
    // Stable low-discrepancy samples: no per-frame noise or temporal ghosting.
    for(int i=0;i<12;i++){
      if(i>=sampleCount)break;
      float fi=float(i)+.5,angle=fi*2.39996323;
      float ring=sqrt(fi/float(sampleCount));
      vec2 sampleUv=vUv+vec2(cos(angle),sin(angle))*screenRadius*ring*aspect;
      if(any(lessThan(sampleUv,vec2(.001)))||any(greaterThan(sampleUv,vec2(.999))))continue;
      float sampleDepth=texture2D(tDepth,sampleUv).r;
      if(sampleDepth>=.999999)continue;
      vec3 delta=viewPosition(sampleUv,sampleDepth)-p;
      float distanceSquared=dot(delta,delta);
      if(distanceSquared<.000001)continue;
      float distanceToSample=sqrt(distanceSquared);
      float falloff=1.0-smoothstep(radius*.2,radius,distanceToSample);
      float horizon=max(0.0,dot(normal,delta/distanceToSample)-.12);
      occlusion+=horizon*falloff;
      weight+=1.0;
    }
    // Existing baked occlusion stays readable; live contact never crushes it.
    float ao=1.0-clamp(occlusion/max(weight,1.0)*1.65,0.0,.32);
    ao=mix(1.0,ao,1.0-smoothstep(30.0,50.0,-p.z));
    gl_FragColor=vec4(vec3(ao),1.0);
  }
`;

const reflectionShader=/* glsl */`
  // ROOM_RENDER_PIPELINE: bounded screen-space reflection ray march.
  varying vec2 vUv;
  uniform sampler2D tBeauty;
  uniform int stepCount;
  uniform float maxDistance;
  ${depthFunctions}
  void main(){
    gl_FragColor=vec4(0.0);
    float surface=texture2D(tBeauty,vUv).a;
    float depth=texture2D(tDepth,vUv).r;
    if(stepCount==0||surface<.025||depth>=.999999)return;
    vec3 p=viewPosition(vUv,depth),normal=surfaceNormal(vUv,p);
    vec3 incident=normalize(p),ray=reflect(incident,normal);
    // Reflect only the visible face and start beyond its numerical depth bias.
    if(dot(normal,-incident)<.02)return;
    vec3 origin=p+normal*.045;
    float previousDistance=0.0,previousGap=-.045;
    for(int i=0;i<24;i++){
      if(i>=stepCount)break;
      float fraction=(float(i)+1.0)/float(stepCount);
      float distanceAlong=.06+maxDistance*fraction*fraction;
      vec3 current=origin+ray*distanceAlong;
      vec2 sampleUv;
      if(!projectPosition(current,sampleUv))break;
      float sampleDepth=texture2D(tDepth,sampleUv).r;
      if(sampleDepth>=.999999){previousDistance=distanceAlong;previousGap=-1.0;continue;}
      vec3 samplePosition=viewPosition(sampleUv,sampleDepth);
      float gap=samplePosition.z-current.z;
      float thickness=.12+distanceAlong*.025;
      if(gap>=0.0&&previousGap<0.0&&gap<thickness){
        float nearDistance=previousDistance,farDistance=distanceAlong;
        // Refine the crossing, not the arbitrary last ray step.
        for(int refine=0;refine<4;refine++){
          float middle=(nearDistance+farDistance)*.5;
          vec3 candidate=origin+ray*middle;
          vec2 candidateUv;
          if(!projectPosition(candidate,candidateUv))break;
          float candidateDepth=texture2D(tDepth,candidateUv).r;
          float candidateGap=viewPosition(candidateUv,candidateDepth).z-candidate.z;
          if(candidateGap>=0.0){farDistance=middle;sampleUv=candidateUv;}
          else nearDistance=middle;
        }
        vec3 hit=positionAt(sampleUv),hitNormal=surfaceNormal(sampleUv,hit);
        if(dot(hitNormal,-ray)<=.02)return;
        float edge=min(min(sampleUv.x,1.0-sampleUv.x),min(sampleUv.y,1.0-sampleUv.y));
        float confidence=smoothstep(.015,.15,edge)*(1.0-smoothstep(maxDistance*.65,maxDistance,distanceAlong));
        float fresnel=surface+(1.0-surface)*pow(1.0-clamp(dot(normal,-incident),0.0,1.0),5.0);
        float blend=min(.58,fresnel*.65)*confidence;
        gl_FragColor=vec4(texture2D(tBeauty,sampleUv).rgb,blend);
        return;
      }
      previousGap=gap;previousDistance=distanceAlong;
    }
    // A missing ray leaves alpha zero: the original probe reflection survives.
  }
`;

const compositeShader=/* glsl */`
  // ROOM_RENDER_PIPELINE: depth-aware composite in linear HDR, one output transform.
  varying vec2 vUv;
  uniform sampler2D tBeauty;
  uniform sampler2D tOcclusion;
  uniform sampler2D tReflection;
  uniform vec2 effectsTexel;
  uniform float bloomStrength;
  ${depthFunctions}
  float roomLuminance(vec3 color){return dot(color,vec3(.2126,.7152,.0722));}
  vec3 bright(vec2 uv){
    vec3 color=texture2D(tBeauty,clamp(uv,vec2(0.0),vec2(1.0))).rgb;
    return color*(max(roomLuminance(color)-1.35,0.0)/(roomLuminance(color)+.001));
  }
  vec3 antialiasedBeauty(vec2 uv){
    // A bounded contrast-directed filter replaces lost canvas MSAA offscreen.
    vec3 c=texture2D(tBeauty,uv).rgb;
    vec3 n=texture2D(tBeauty,uv+vec2(0.0,texelSize.y)).rgb;
    vec3 s=texture2D(tBeauty,uv-vec2(0.0,texelSize.y)).rgb;
    vec3 e=texture2D(tBeauty,uv+vec2(texelSize.x,0.0)).rgb;
    vec3 w=texture2D(tBeauty,uv-vec2(texelSize.x,0.0)).rgb;
    float l=roomLuminance(c),ln=roomLuminance(n),ls=roomLuminance(s),le=roomLuminance(e),lw=roomLuminance(w);
    float low=min(l,min(min(ln,ls),min(le,lw))),high=max(l,max(max(ln,ls),max(le,lw)));
    float contrast=high-low;
    if(contrast<max(.04,high*.18))return c;
    vec3 along=abs(ln-ls)>abs(le-lw)?(e+w)*.5:(n+s)*.5;
    return mix(c,along,.22*clamp(contrast/(high+.001),0.0,1.0));
  }
  void main(){
    vec3 color=antialiasedBeauty(vUv);
    float depth=texture2D(tDepth,vUv).r;
    if(depth<.999999){
      float centerZ=viewPosition(vUv,depth).z;
      float ao=0.0,total=0.0,reflectionWeight=0.0;
      vec3 reflection=vec3(0.0);
      // Joint bilateral upsampling rejects a foreground/background boundary.
      for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
        vec2 uv=clamp(vUv+vec2(float(x),float(y))*effectsTexel,vec2(0.0),vec2(1.0));
        float sampleZ=positionAt(uv).z;
        float weight=exp(-abs(sampleZ-centerZ)/max(.045,abs(centerZ)*.012));
        weight*=x==0&&y==0?2.0:1.0;
        ao+=texture2D(tOcclusion,uv).r*weight;
        vec4 reflected=texture2D(tReflection,uv);
        reflection+=reflected.rgb*reflected.a*weight;
        reflectionWeight+=reflected.a*weight;total+=weight;
      }
      float denominator=max(total,.00001);
      color*=mix(1.0,ao/denominator,.85);
      // Never paint nearby metal reflections onto rough cloth or dry timber.
      if(texture2D(tBeauty,vUv).a>=.025){
        float blend=reflectionWeight/denominator;
        color=color*(1.0-blend)+reflection/denominator;
      }
    }
    vec2 glow=texelSize*5.0;
    color+=(bright(vUv+glow)+bright(vUv-glow)+bright(vUv+vec2(glow.x,-glow.y))+bright(vUv+vec2(-glow.x,glow.y)))*bloomStrength*.25;
    gl_FragColor=vec4(max(color,vec3(0.0)),1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function target(width,height,{hdr=false,depth=false}={}){
  const result=new THREE.WebGLRenderTarget(width,height,{
    type:hdr?THREE.HalfFloatType:THREE.UnsignedByteType,
    format:THREE.RGBAFormat,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    depthBuffer:depth,stencilBuffer:false,generateMipmaps:false,samples:0,
  });
  result.texture.colorSpace=THREE.LinearSRGBColorSpace;
  if(depth){
    result.depthTexture=new THREE.DepthTexture(width,height,THREE.UnsignedIntType);
    result.depthTexture.format=THREE.DepthFormat;
    result.depthTexture.minFilter=result.depthTexture.magFilter=THREE.NearestFilter;
  }
  return result;
}

export class RoomRenderer {
  constructor(renderer,{compact=false,quality=compact?'balanced':'high',onFallback=()=>{}}={}){
    this.renderer=renderer;this.quality=QUALITY[quality]?quality:'high';this.onFallback=onFallback;
    this.metadata={value:0};this.materials=new Map();this.transparentMaterials=new Set();this.size=new THREE.Vector2();this.dimensions=null;
    this.disposed=false;this.enabled=!!renderer.extensions?.has('EXT_color_buffer_float');
    this.stats={enabled:this.enabled,quality:this.quality,passes:this.enabled?(this.quality==='low'?3:4):1,frames:0,fallbackReason:this.enabled?null:'HDR render targets are unavailable'};
    if(!this.enabled)return;
    this.beauty=target(1,1,{hdr:true,depth:true});this.occlusion=target(1,1);this.reflection=target(1,1,{hdr:true});
    this.shared={tDepth:{value:this.beauty.depthTexture},tBeauty:{value:this.beauty.texture},
      inverseProjection:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4()},texelSize:{value:new THREE.Vector2(1,1)}};
    this.aoMaterial=new THREE.ShaderMaterial({name:'Live contact shading',vertexShader,fragmentShader:aoShader,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...this.shared,sampleCount:{value:QUALITY[this.quality].aoSamples},radius:{value:.32}}});
    this.reflectionMaterial=new THREE.ShaderMaterial({name:'Visible-world ray reflections',vertexShader,fragmentShader:reflectionShader,depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{...this.shared,stepCount:{value:QUALITY[this.quality].reflectionSteps},maxDistance:{value:6}}});
    this.compositeMaterial=new THREE.ShaderMaterial({name:'Linear HDR room output',vertexShader,fragmentShader:compositeShader,depthTest:false,depthWrite:false,toneMapped:true,
      uniforms:{...this.shared,tOcclusion:{value:this.occlusion.texture},tReflection:{value:this.reflection.texture},effectsTexel:{value:new THREE.Vector2(1,1)},bloomStrength:{value:.045}}});
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,2,0,0,2],2));
    this.quad=new THREE.Mesh(geometry,this.compositeMaterial);this.quad.frustumCulled=false;
    this.screen=new THREE.Scene();this.screen.add(this.quad);this.screenCamera=new THREE.Camera();
    this.resize();
  }
  refreshMaterials(root){
    if(!this.enabled||!root)return;
    if(root.isScene)this.registeredScene=root;
    root.traverse(object=>{
      if(!object.material)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!material)continue;
        if(material.transparent||material.transmission>0){this.transparentMaterials.add(material);continue;}
        const standard=material.isMeshStandardMaterial;
        if(!(standard||material.isMeshBasicMaterial||material.isMeshPhongMaterial||material.isMeshLambertMaterial)||this.materials.has(material))continue;
        const previousCompile=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
        // The default key serializes onBeforeCompile. Capture it before wrapping
        // or distinct pre-existing lighting hooks would acquire the same key.
        const priorProgramKey=previousKey.call(material);
        const state={previousCompile,previousKey,coat:{value:material.clearcoat||0}};
        const metadata=this.metadata;
        state.compile=function(shader,renderer){
          previousCompile.call(this,shader,renderer);
          shader.uniforms.roomSurfaceMetadata=metadata;shader.uniforms.roomSurfaceCoat=state.coat;
          shader.fragmentShader='uniform float roomSurfaceMetadata;\nuniform float roomSurfaceCoat;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
            // ROOM_RENDER_PIPELINE_METADATA: only the offscreen beauty alpha.
            if(roomSurfaceMetadata>.5){
              ${standard?`float smoothSurface=1.0-smoothstep(.2,.78,roughnessFactor);
              gl_FragColor.a=clamp((mix(.04,.85,metalnessFactor)+roomSurfaceCoat*.18)*smoothSurface,0.0,.95);`:'gl_FragColor.a=0.0;'}
            }
          `);
        };
        state.key=function(){return priorProgramKey+'|room-reflection-mask-v1';};
        material.onBeforeCompile=state.compile;material.customProgramCacheKey=state.key;material.needsUpdate=true;
        this.materials.set(material,state);
      }
    });
  }
  setQuality(quality){
    if(!QUALITY[quality])throw new RangeError('Unknown room rendering quality.');
    this.quality=quality;this.stats.quality=quality;
    if(this.enabled){
      this.stats.passes=quality==='low'?3:4;
      this.aoMaterial.uniforms.sampleCount.value=QUALITY[quality].aoSamples;
      this.reflectionMaterial.uniforms.stepCount.value=QUALITY[quality].reflectionSteps;
      this.resize();
    }
    return this;
  }
  resize(){
    if(!this.enabled||this.disposed)return;
    this.renderer.getDrawingBufferSize(this.size);
    const dimensions=renderResolution(this.size.x,this.size.y,this.quality);
    if(this.dimensions&&Object.keys(dimensions).every(key=>dimensions[key]===this.dimensions[key]))return;
    this.dimensions=dimensions;const {width,height,effectsWidth,effectsHeight}=dimensions;
    this.beauty.setSize(width,height);this.occlusion.setSize(effectsWidth,effectsHeight);this.reflection.setSize(effectsWidth,effectsHeight);
    this.shared.texelSize.value.set(1/width,1/height);
    this.compositeMaterial.uniforms.effectsTexel.value.set(1/effectsWidth,1/effectsHeight);
    this.framebuffersChecked=false;
  }
  checkFramebuffer(){
    const gl=this.renderer.getContext();
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('The HDR framebuffer is incomplete.');
  }
  preserveTransparentMetadata(){
    const changed=[];
    const keys=['blending','blendSrc','blendDst','blendEquation','blendSrcAlpha','blendDstAlpha','blendEquationAlpha'];
    for(const material of this.transparentMaterials){
      const previous=Object.fromEntries(keys.map(key=>[key,material[key]]));
      const premultiplied=material.premultipliedAlpha;
      if(material.blending!==THREE.CustomBlending){
        material.blendEquation=THREE.AddEquation;
        if(material.blending===THREE.NormalBlending){material.blendSrc=premultiplied?THREE.OneFactor:THREE.SrcAlphaFactor;material.blendDst=THREE.OneMinusSrcAlphaFactor;}
        else if(material.blending===THREE.AdditiveBlending){material.blendSrc=premultiplied?THREE.OneFactor:THREE.SrcAlphaFactor;material.blendDst=THREE.OneFactor;}
        else if(material.blending===THREE.SubtractiveBlending){material.blendSrc=THREE.ZeroFactor;material.blendDst=THREE.OneMinusSrcColorFactor;}
        else if(material.blending===THREE.MultiplyBlending){material.blendSrc=THREE.DstColorFactor;material.blendDst=THREE.OneMinusSrcAlphaFactor;}
        else {material.blendSrc=THREE.OneFactor;material.blendDst=THREE.ZeroFactor;}
      }
      // Keep RGB exactly as before. Glass and dust must not turn the opaque
      // surface's reflection metadata into their own opacity or glow alpha.
      material.blending=THREE.CustomBlending;material.blendSrcAlpha=THREE.ZeroFactor;
      material.blendDstAlpha=THREE.OneFactor;material.blendEquationAlpha=THREE.AddEquation;
      changed.push([material,previous]);
    }
    return ()=>{for(const [material,previous]of changed)Object.assign(material,previous);};
  }
  render(scene,camera){
    if(this.disposed)return;
    const renderer=this.renderer;
    if(!this.enabled){renderer.render(scene,camera);this.stats.frames++;return;}
    const previousTarget=renderer.getRenderTarget(),previousAutoClear=renderer.autoClear;
    const previousCubeFace=renderer.getActiveCubeFace?.()||0,previousMipmap=renderer.getActiveMipmapLevel?.()||0;
    const previousClearColor=renderer.getClearColor(new THREE.Color()),previousClearAlpha=renderer.getClearAlpha();
    const previousShaderError=renderer.debug?.onShaderError,previousInfoReset=renderer.info.autoReset;
    let failure=null,restoreTransparency=()=>{};
    try{
      this.resize();
      if(this.registeredScene!==scene)this.refreshMaterials(scene);
      this.shared.projection.value.copy(camera.projectionMatrix);this.shared.inverseProjection.value.copy(camera.projectionMatrixInverse);
      this.aoMaterial.uniforms.radius.value=camera.position.z>8?.6:.32;
      this.reflectionMaterial.uniforms.maxDistance.value=camera.position.z>8?12:6;
      this.shaderFailure=false;
      if(renderer.debug)renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
        if(gl.getShaderSource(fragment)?.includes('ROOM_RENDER_PIPELINE'))this.shaderFailure=true;
        if(previousShaderError)previousShaderError(gl,program,vertex,fragment);
      };
      renderer.autoClear=true;renderer.info.autoReset=false;renderer.info.reset();
      renderer.setClearColor(0x000000,0);
      renderer.setRenderTarget(this.beauty);if(!this.framebuffersChecked)this.checkFramebuffer();
      restoreTransparency=this.preserveTransparentMetadata();
      this.metadata.value=1;renderer.render(scene,camera);this.metadata.value=0;
      restoreTransparency();restoreTransparency=()=>{};
      this.quad.material=this.aoMaterial;renderer.setRenderTarget(this.occlusion);if(!this.framebuffersChecked)this.checkFramebuffer();
      renderer.render(this.screen,this.screenCamera);
      this.quad.material=this.reflectionMaterial;renderer.setRenderTarget(this.reflection);if(!this.framebuffersChecked)this.checkFramebuffer();
      if(this.reflectionMaterial.uniforms.stepCount.value>0)renderer.render(this.screen,this.screenCamera);
      else renderer.clear(true,false,false);
      this.framebuffersChecked=true;
      this.quad.material=this.compositeMaterial;renderer.setRenderTarget(previousTarget,previousCubeFace,previousMipmap);renderer.render(this.screen,this.screenCamera);
      if(this.shaderFailure)throw new Error('The enhanced shading program could not compile.');
      this.stats.frames++;
    }catch(error){failure=error;}
    finally{
      this.metadata.value=0;restoreTransparency();renderer.setRenderTarget(previousTarget,previousCubeFace,previousMipmap);renderer.setClearColor(previousClearColor,previousClearAlpha);
      renderer.autoClear=previousAutoClear;renderer.info.autoReset=previousInfoReset;
      if(renderer.debug)renderer.debug.onShaderError=previousShaderError;
    }
    if(failure){
      this.disable(failure.message);renderer.render(scene,camera);
    }
  }
  restoreMaterials(){
    for(const [material,state]of this.materials){
      if(material.onBeforeCompile===state.compile)material.onBeforeCompile=state.previousCompile;
      if(material.customProgramCacheKey===state.key)material.customProgramCacheKey=state.previousKey;
      material.needsUpdate=true;
    }
    this.materials.clear();
    this.transparentMaterials.clear();
  }
  disable(reason){
    this.enabled=false;this.stats.enabled=false;this.stats.passes=1;this.stats.fallbackReason=reason;
    this.restoreMaterials();this.releaseTargets();this.onFallback(reason);
  }
  releaseTargets(){
    for(const resource of [this.beauty,this.occlusion,this.reflection,this.aoMaterial,this.reflectionMaterial,this.compositeMaterial,this.quad?.geometry])resource?.dispose();
  }
  dispose(){
    if(this.disposed)return;
    this.restoreMaterials();this.releaseTargets();this.disposed=true;this.enabled=false;
  }
}
