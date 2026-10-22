import * as THREE from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';
import { buildStreetEnvironment } from './street-environment.js?scene=realism-2';
import { buildStreetVehicle, buildStreetPerson, animateStreetActor } from './street-actors.js?scene=realism-2';

export const ENTRANCE_THRESHOLD = Object.freeze([0, 1.6, 6.65]);
export const EXIT_POSITION = Object.freeze([0, 1.6, 9.4]);
export const STREET_VEHICLES = Object.freeze(['car', 'suv', 'city-bus', 'school-bus', 'garbage-truck']);
const clamp = (v, low=0, high=1) => Math.max(low, Math.min(high, v));
const fract = value => value - Math.floor(value);
function noise(seed) { return fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453123); }

// Keep the delivered attributes (including the baked-light UVs) intact. Only
// the obsolete opaque entrance faces are replaced. The original is retained
// on the mesh for a reversible in-memory restoration, never destroyed.
export function openOriginalEntrance(room) {
  if (!room) return { removedTriangles: 0, changedMeshes: 0 };
  room.updateMatrixWorld(true);
  let removedTriangles=0, changedMeshes=0;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  room.getObjectByName('OldCuriosityShop')?.traverse(mesh=>{
    if (!mesh.isMesh || mesh.userData.storefrontOriginalGeometry) return;
    const source=mesh.geometry, position=source.attributes.position, index=source.index;
    if (!position) return;
    const kept=[], count=index?index.count:position.count;
    let removed=0;
    for(let i=0;i<count;i+=3){
      const ia=index?index.getX(i):i,ib=index?index.getX(i+1):i+1,ic=index?index.getX(i+2):i+2;
      a.fromBufferAttribute(position,ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position,ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position,ic).applyMatrix4(mesh.matrixWorld);
      const normal=ab.subVectors(b,a).cross(ac.subVectors(c,a));
      const vertical=Math.abs(normal.y)<normal.length()*.6;
      const oldFront=Math.min(a.z,b.z,c.z)>6.94&&Math.max(a.y,b.y,c.y)>.28&&
        Math.max(a.y,b.y,c.y)<3.5&&Math.min(a.y,b.y,c.y)>-.2&&vertical;
      if(oldFront){removed++;continue;}kept.push(ia,ib,ic);
    }
    if(!removed)return;
    const replacement=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(source.attributes))replacement.setAttribute(name,attribute);
    replacement.setIndex(kept);replacement.computeBoundingBox();replacement.computeBoundingSphere();
    replacement.name=source.name+' / open storefront';
    mesh.userData.storefrontOriginalGeometry=source;mesh.geometry=replacement;
    removedTriangles+=removed;changedMeshes++;
  });
  return {removedTriangles,changedMeshes};
}

// A fixed actor pool, evaluated against absolute time, replaces off-screen
// simulation. Returning to the window shows the same uninterrupted street.
export function streetActorPose(kind,index,nowMs,seed=37) {
  const vehicle=STREET_VEHICLES.includes(kind), seconds=nowMs/1000;
  const period=vehicle?72:180, offset=vehicle?index*13.7:index*29.3;
  const cycle=Math.floor((seconds+offset)/period);
  const jitter=noise(seed+index*19+cycle*13)*(vehicle?4:8);
  const local=seconds+offset-cycle*period-jitter;
  const direction=index%2===0?1:-1;
  const speed=vehicle?7+noise(seed+cycle+index*3)*2:kind==='jogger'?2.6:1.13+index*.055;
  // Spawn beyond the camera's far plane, including when standing outside.
  const half=80, distance=local*speed;
  const active=local>=0&&distance<half*2;
  return {active,x:direction*(-half+distance),z:vehicle?(direction===1?13.7:17.1):(index%2===0?10.45:20.5),
    direction,speed,phase:seconds*(kind==='jogger'?10:5.3)+index,cycle};
}

class Builder {
  constructor(){
    this.geometry={box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.SphereGeometry(1,20,14),cylinder:new THREE.CylinderGeometry(1,1,1,20),cone:new THREE.ConeGeometry(1,1,16)};
    this.materials=new Map();this.daylight={value:1};
  }
  material(name,color,roughness=.75,metalness=0,extra={}){
    const physical=extra.clearcoat!==undefined||extra.transmission!==undefined||extra.ior!==undefined;
    if(!this.materials.has(name))this.materials.set(name,this.exteriorMaterial(new (physical?THREE.MeshPhysicalMaterial:THREE.MeshStandardMaterial)({name,color,roughness,metalness,...extra})));
    return this.materials.get(name);
  }
  exteriorMaterial(material){
    // Keep the indoor sepia haze inside. This shared daylight uniform gives
    // the street a softer blue distance haze without changing room materials.
    material.fog=false;
    const previous=material.onBeforeCompile;
    material.onBeforeCompile=shader=>{
      previous.call(material,shader);
      shader.uniforms.streetDaylight=this.daylight;
      shader.uniforms.streetDayFog={value:new THREE.Color(0xa4b5be)};
      shader.uniforms.streetNightFog={value:new THREE.Color(0x26334c)};
      shader.fragmentShader='uniform float streetDaylight; uniform vec3 streetDayFog; uniform vec3 streetNightFog;\n'+shader.fragmentShader.replace('#include <tonemapping_fragment>',`
        float streetHaze=1.0-exp(-dot(vViewPosition,vViewPosition)*0.00012);
        vec3 streetHazeColor=mix(streetNightFog,streetDayFog,streetDaylight);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,streetHazeColor,streetHaze);
        #include <tonemapping_fragment>
      `);
    };
    material.customProgramCacheKey=()=> 'storefront-linear-haze-v2';
    return material;
  }
  mesh(parent,shape,material,position,scale,rotation){
    const mesh=new THREE.Mesh(this.geometry[shape],material);mesh.position.fromArray(position);mesh.scale.fromArray(scale);
    if(rotation)mesh.rotation.set(...rotation);mesh.receiveShadow=true;mesh.castShadow=!material.transparent;parent.add(mesh);return mesh;
  }
  box(p,m,pos,size,r){return this.mesh(p,'box',m,pos,size,r);}
  sphere(p,m,pos,size){return this.mesh(p,'sphere',m,pos,size);}
  cylinder(p,m,pos,size,r){return this.mesh(p,'cylinder',m,pos,size,r);}
  // Merge decorative pieces by material once, keeping moving joints separate.
  batch(parent){
    const groups=new Map();
    for(const child of [...parent.children]){
      if(!child.isMesh||child.isInstancedMesh||child.userData.keepSeparate)continue;
      child.updateMatrix();let geometry=child.geometry.clone().applyMatrix4(child.matrix);
      if(geometry.index){const nonIndexed=geometry.toNonIndexed();geometry.dispose();geometry=nonIndexed;}
      if(!groups.has(child.material))groups.set(child.material,[]);groups.get(child.material).push(geometry);parent.remove(child);
    }
    for(const [material,parts]of groups){
      const geometry=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());
      geometry.computeBoundingSphere();geometry.computeBoundingBox();
      const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name+' / batched';mesh.receiveShadow=true;mesh.castShadow=!material.transparent;parent.add(mesh);
    }
  }
}

export class ShopStorefront {
  constructor(scene,room,{seed=37}={}){
    this.scene=scene;this.seed=seed;this.builder=new Builder();this.root=new THREE.Group();this.root.name='Living Indiana storefront';this.group=this.root;
    this.bounds=new THREE.Box3(new THREE.Vector3(-100,-42,-34.5),new THREE.Vector3(100,42,49.5));
    this.portalBounds=new THREE.Box3(new THREE.Vector3(-3.55,-.25,6.75),new THREE.Vector3(3.55,3.75,8.5));
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();this.shadowActorBounds=new THREE.Sphere();this.viewPosition=new THREE.Vector3();
    this.stats={...openOriginalEntrance(room),actorCount:0,animatedActors:0,updates:0,skippedUpdates:0,drawMeshes:0};
    this.actors=[];this.nightMaterials=[];this.doorAmount=0;this.doorTarget=0;this.doorVelocity=0;this.closed=false;
    this.palette();this.makeEntrance();this.makeSky();this.makeStreet();this.makeActors();scene.add(this.root);
    this.sun=new THREE.DirectionalLight(0xffedd4,1.8);this.sun.position.set(-9,18,17);this.sun.target.position.set(0,0,17);this.sun.userData.exteriorLight=true;
    const compact=typeof matchMedia==='function'&&matchMedia('(pointer: coarse)').matches;
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(compact?1024:2048,compact?1024:2048);
    Object.assign(this.sun.shadow.camera,{left:-29,right:29,top:19,bottom:-19,near:.5,far:85});
    this.sun.shadow.bias=-.00015;this.sun.shadow.normalBias=.035;this.sun.shadow.radius=2;this.sun.shadow.intensity=.8;
    this.sun.shadow.autoUpdate=false;this.sun.shadow.needsUpdate=true;
    this.shadowDirty=true;this.shadowAt=-Infinity;this.sunVector=new THREE.Vector3(-.45,.7,.35).normalize();
    this.skyLight=new THREE.HemisphereLight(0xbcd6ef,0x635747,.75);this.skyLight.userData.exteriorLight=true;
    scene.add(this.sun,this.sun.target,this.skyLight);
    this.root.traverse(o=>{if(o.isMesh){o.frustumCulled=true;this.stats.drawMeshes++;}});
    this.stats.actorCount=this.actors.length;
  }
  palette(){
    const b=this.builder,m=(...args)=>b.material(...args);
    this.wood=m('Storefront / dark walnut',0x35291f,.86);
    this.woodEdge=m('Storefront / worn raised moulding',0x6f5940,.77);
    this.brass=m('Storefront / old brass',0x9d8450,.4,.65);
    this.black=m('Street / charcoal rubber',0x141719,.96);
    this.iron=m('Street / painted iron',0x263335,.72,.4);
    this.chrome=m('Street / aged aluminium',0xa6aaa8,.35,.6);
    this.glass=b.material('Storefront / clear glass',0xd5e2df,.07,0,{clearcoat:1,clearcoatRoughness:.045,ior:1.5,transparent:true,opacity:.105,depthWrite:false,side:THREE.DoubleSide,envMapIntensity:1.1});
    this.vehicleGlass=m('Street / tinted vehicle glass',0x32434c,.1,.05,{clearcoat:1,clearcoatRoughness:.04,envMapIntensity:1});
    this.asphalt=m('Street / asphalt',0x646769,.97);this.asphalt.userData.streetSurface='asphalt';
    this.concrete=m('Street / limestone sidewalk',0xa49e8c,.95);
    this.mortar=m('Street / mortar',0x7d786b,.98);
    this.cream=m('Street / warm limestone trim',0xbbae8c,.88);
    this.paintWhite=m('Street / road paint',0xd5cdb3,.9);
    this.yellow=m('Street / road yellow',0xc6a24e,.9);
    this.green=m('Street / leaves',0x4b6242,.95);
    this.trunk=m('Street / bark',0x514a3b,.98);
    this.windowMat=m('Street / building windows',0x899a9c,.13,0,{clearcoat:1,clearcoatRoughness:.06,transparent:true,opacity:.24,depthWrite:false,emissive:0xceb184,emissiveIntensity:.025,envMapIntensity:.9});
    this.headlight=m('Street / headlamps',0xffe9b7,.3,.1,{emissive:0xffd992,emissiveIntensity:.3});
    this.tailLight=m('Street / brake lenses',0x6d1e16,.3,.1,{emissive:0xc12f1b,emissiveIntensity:.25});
    this.lampGlass=m('Street / lamp glass',0xf0ddac,.5,0,{emissive:0xffd399,emissiveIntensity:.1});
    this.nightMaterials.push(this.headlight,this.tailLight,this.lampGlass);
  }
  sign(parent,text,position,size,{color='#decaa1',background='#26332e',facing=-1}={}){
    const b=this.builder;
    if(typeof document==='undefined'){
      const mesh=b.box(parent,b.material(`Sign / ${text}`,background),position,[size[0],size[1],.018]);mesh.userData.text=text;return mesh;
    }
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
    const ctx=canvas.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,512,128);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.strokeRect(9,9,494,110);
    ctx.fillStyle=color;ctx.font='34px Georgia,serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,66,466);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const material=b.exteriorMaterial(new THREE.MeshStandardMaterial({name:`Sign / ${text}`,map:texture,roughness:.85,emissive:0xffffff,emissiveMap:texture,emissiveIntensity:.1}));
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(size[0],size[1]),material);mesh.position.fromArray(position);mesh.rotation.y=facing<0?Math.PI:0;parent.add(mesh);return mesh;
  }
  makeEntrance(){
    const b=this.builder,facade=new THREE.Group();facade.name='Glazed wood shop front';this.facade=facade;this.root.add(facade);
    const z=7.22;
    // Wide sidelights make the street visible from both room aisles.
    for(const x of [-3.12,-.72,.72,3.12]){
      b.box(facade,this.wood,[x,1.56,z],[.17,3.12,.23]);
      b.box(facade,this.woodEdge,[x,1.56,z-.13],[.055,3.03,.025]);
    }
    b.box(facade,this.wood,[0,3.10,z],[6.40,.36,.3]);
    for(const y of [2.9,3.32])b.box(facade,this.woodEdge,[0,y,z-.07],[6.55,.09,.36]);
    b.box(facade,this.cream,[0,.018,7.31],[6.3,.035,.6]);
    for(const x of [-1.92,1.92]){
      b.box(facade,this.wood,[x,.35,z],[2.22,.65,.19]);
      b.box(facade,this.woodEdge,[x,.35,z-.11],[1.94,.43,.035]);
      b.box(facade,this.wood,[x,.72,z],[2.3,.12,.27]);
      b.box(facade,this.glass,[x,1.81,z],[2.2,2.04,.025]);
      b.box(facade,this.wood,[x,2.48,z],[2.24,.055,.1]);
      b.box(facade,this.wood,[x,2.77,z],[2.24,.055,.1]);
      b.box(facade,this.wood,[x,2.62,z],[.055,.31,.1]);
      // Small brass corners and rubbed sill edges, not an opaque window decal.
      for(const side of [-1,1])b.box(facade,this.brass,[x+side*1.02,.78,z-.03],[.08,.06,.1]);
    }
    this.doorPivot=new THREE.Group();this.doorPivot.name='Glass entrance door hinge';this.doorPivot.position.set(-.64,0,z);facade.add(this.doorPivot);
    const door=this.doorPivot;
    for(const x of [0,1.28])b.box(door,this.wood,[x,1.42,0],[.105,2.84,.13]);
    for(const [y,h]of [[.13,.26],[.38,.07],[2.79,.1]])b.box(door,this.wood,[.64,y,0],[1.28,h,.13]);
    b.box(door,this.glass,[.64,1.59,0],[1.18,2.32,.026]);
    b.box(door,this.brass,[1.12,1.16,-.13],[.035,.35,.035]);
    b.box(door,this.brass,[1.12,1.16,.13],[.035,.35,.035]);
    for(const y of [1.03,1.29])b.box(door,this.brass,[1.12,y,0],[.035,.035,.27]);
    for(const y of [.45,1.42,2.42])b.cylinder(door,this.brass,[-.02,y,0],[.026,.13,.026]);
    this.openSign=this.sign(door,'OPEN · UNTIL 8',[.64,2.04,-.09],[.55,.17]);
    this.closedSign=this.sign(door,'CLOSED',[.64,2.04,-.095],[.55,.17]);this.closedSign.visible=false;
    this.openOutsideSign=this.sign(door,'OPEN · UNTIL 8',[.64,2.04,.09],[.55,.17],{facing:1});
    this.closedOutsideSign=this.sign(door,'CLOSED',[.64,2.04,.095],[.55,.17],{facing:1});this.closedOutsideSign.visible=false;
    // Separate readable faces avoid mirrored lettering from the sidewalk.
    // Keep all four stateful signs attached to the moving door when batching.
    for(const sign of [this.openSign,this.closedSign,this.openOutsideSign,this.closedOutsideSign])sign.userData.keepSeparate=true;
    this.sign(facade,'OLD BOOKS & ODD THINGS',[0,3.11,z-.17],[3.9,.24]);
    this.sign(facade,'OLD BOOKS & ODD THINGS',[0,3.11,z+.17],[3.9,.24],{facing:1});
    // The threshold remains flat and passable; the entrance never jumps to black.
    const mat=b.material('Storefront / welcome mat',0x60583d,.98);b.box(facade,mat,[0,.025,7.85],[1.45,.035,.66]);
    for(let i=0;i<12;i++)b.box(facade,this.black,[-.63+i*.115,.047,7.85],[.025,.005,.58]);
    this.sign(facade,'COME IN',[0,.05,7.85],[.6,.24]).rotation.set(-Math.PI/2,0,0);
    b.batch(door);b.batch(facade);
  }
  makeSky(){
    this.skyMaterial=new THREE.ShaderMaterial({name:'Street / daylight sky',depthWrite:false,depthTest:false,side:THREE.BackSide,
      uniforms:{daylight:{value:1},sunDirection:{value:new THREE.Vector3(-.45,.7,.35).normalize()},cloudTime:{value:0}},
      vertexShader:'varying vec3 skyDirection; void main(){ skyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:`varying vec3 skyDirection; uniform float daylight; uniform vec3 sunDirection; uniform float cloudTime;
        float hashSky(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashSky(i),hashSky(i+vec2(1.,0.)),f.x),mix(hashSky(i+vec2(0.,1.)),hashSky(i+1.),f.x),f.y);}
        float cloudField(vec2 p){float f=0.,a=.54;for(int i=0;i<4;i++){f+=skyNoise(p)*a;p=mat2(1.6,-1.2,1.2,1.6)*p;a*=.5;}return f;}
        void main(){
          vec3 ray=normalize(skyDirection);float altitude=smoothstep(-.025,.94,ray.y);
          vec3 day=mix(vec3(.65,.70,.72),vec3(.13,.31,.52),pow(altitude,.42));
          vec3 dark=mix(vec3(.027,.037,.065),vec3(.004,.009,.025),altitude);
          float warm=pow(1.0-clamp(abs(sunDirection.y)*3.0,0.0,1.0),2.0)*daylight;
          float glow=pow(max(0.0,dot(ray,sunDirection)),14.0);
          vec3 sky=mix(dark,day,daylight)+vec3(.33,.095,.015)*warm*(1.0-altitude)*(.5+glow);
          float sunDot=dot(ray,sunDirection);
          sky+=vec3(1.0,.84,.61)*pow(max(0.0,sunDot),160.0)*daylight*.27;
          sky+=vec3(6.0,5.5,4.1)*smoothstep(.99985,.99997,sunDot)*daylight;
          if(ray.y>.012){
            vec2 uv=ray.xz/(ray.y+.17)*.72+vec2(cloudTime*.0011,cloudTime*.00032);
            float cloud=cloudField(uv),mask=smoothstep(.47,.72,cloud)*smoothstep(.012,.18,ray.y);
            float edge=cloudField(uv+sunDirection.xz*.1);
            vec3 white=mix(vec3(.24,.29,.35),vec3(.88,.89,.86),smoothstep(.38,.7,edge));
            vec3 cloudColor=mix(vec3(.022,.031,.052),white,daylight);
            cloudColor+=vec3(.24,.07,.012)*warm;
            sky=mix(sky,cloudColor,mask*.86);
          }
          gl_FragColor=vec4(sky,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const sky=new THREE.Mesh(new THREE.SphereGeometry(42,32,20),this.skyMaterial);sky.name='Sky beyond Indiana street';sky.position.set(0,0,7.5);sky.renderOrder=-1000;this.root.add(sky);
  }
  makeStreet(){buildStreetEnvironment(this);}
  vehicle(kind,index){return buildStreetVehicle(this,kind,index);}
  person(kind,index){return buildStreetPerson(this,kind,index);}
  makeActors(){
    for(const [index,kind]of STREET_VEHICLES.entries()){
      const group=this.vehicle(kind,index);group.visible=false;group.userData.streetActor=true;this.root.add(group);this.actors.push({group,kind,index});
    }
    for(let index=0;index<6;index++){
      const kind=index===1?'jogger':index===2||index===5?'dog-walker':'pedestrian';
      const group=this.person(kind,index);group.visible=false;group.userData.streetActor=true;this.root.add(group);this.actors.push({group,kind,index});
    }
  }
  setDoorOpen(value){this.doorTarget=clamp(Number(value)||0);}
  setClosed(value){
    this.closed=!!value;this.openSign.visible=!this.closed;this.closedSign.visible=this.closed;
    this.openOutsideSign.visible=!this.closed;this.closedOutsideSign.visible=this.closed;
  }
  update({nowMs=Date.now(),dt=0,camera,daylight=1,night=1-daylight,gentle=false,visible,sunDirection}={}){
    const light=clamp(daylight),dark=clamp(night);
    const previousVisible=this.root.visible,previousDoor=this.doorAmount;
    this.shadowDirty=false;
    this.builder.daylight.value=light;
    this.skyMaterial.uniforms.daylight.value=light;
    if(sunDirection?.length===3&&sunDirection.every(Number.isFinite)&&Math.hypot(...sunDirection)>.01)this.sunVector.fromArray(sunDirection).normalize();
    this.sun.position.copy(this.sunVector).multiplyScalar(40).add(this.sun.target.position);
    this.skyMaterial.uniforms.sunDirection.value.copy(this.sunVector);
    const lowSun=1-clamp(this.sunVector.y*3);
    // Twilight still lights the sky, but direct sun cannot illuminate the
    // underside of the street after the solar disc falls below the horizon.
    this.sun.intensity=light*2.8*clamp(this.sunVector.y/.04);this.sun.color.set(0xfff0d9).lerp(new THREE.Color(0xffbd83),lowSun*.65);
    this.skyLight.intensity=.025+light*.48;this.skyLight.color.set(light>.2?0xbdd0e0:0x526b9a);
    this.windowMat.emissiveIntensity=.025+dark*.65;
    this.headlight.emissiveIntensity=.3+dark*2.2;this.tailLight.emissiveIntensity=.25+dark*.8;this.lampGlass.emissiveIntensity=.1+dark*2.4;
    for(const {light:lamp,power}of this.streetLights)lamp.intensity=power*dark;
    const occupied=this.builder.materials.get('Street / occupied window interior');if(occupied)occupied.emissiveIntensity=.025+dark*.7;
    if(camera){
      camera.updateMatrixWorld(true);camera.getWorldPosition(this.viewPosition);
      this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);
    }
    const inView=visible??(!camera||this.viewPosition.z>6.75||this.frustum.intersectsBox(this.portalBounds));
    this.root.visible=!!inView;this.stats.animatedActors=0;
    // Door opening belongs to the visitor's exit action and is never tied to
    // frame visibility; the next visible frame sees its current requested state.
    if(gentle){this.doorAmount=this.doorTarget;this.doorVelocity=0;}
    else{
      // Exact critically damped hinge solution: heavy door acceleration and
      // settling are independent of frame rate, without a springy bounce.
      const elapsed=Number.isFinite(dt)?Math.max(0,dt):0,omega=6;
      const offset=this.doorAmount-this.doorTarget,coefficient=this.doorVelocity+omega*offset,decay=Math.exp(-omega*elapsed);
      const amount=this.doorTarget+(offset+coefficient*elapsed)*decay;
      this.doorVelocity=(this.doorVelocity-omega*coefficient*elapsed)*decay;
      this.doorAmount=clamp(amount);if(amount!==this.doorAmount)this.doorVelocity=0;
      if(Math.abs(this.doorAmount-this.doorTarget)<1e-10&&Math.abs(this.doorVelocity)<1e-10){
        this.doorAmount=this.doorTarget;this.doorVelocity=0;
      }
    }
    this.doorPivot.rotation.y=-this.doorAmount*1.35;
    if(!inView){this.stats.skippedUpdates++;return false;}
    this.wind.value=gentle?0:(nowMs%86400000)/1000;
    this.skyMaterial.uniforms.cloudTime.value=(nowMs%86400000)/1000;
    this.stats.updates++;
    let nearbyMovingVehicle=false;
    for(const actor of this.actors){
      const p=streetActorPose(actor.kind,actor.index,nowMs,this.seed),g=actor.group;
      g.visible=p.active;if(!p.active)continue;
      g.position.set(p.x,STREET_VEHICLES.includes(actor.kind)?-.04:0,p.z);g.rotation.y=p.direction===1?0:Math.PI;
      animateStreetActor(actor,p,{gentle,nowMs});
      this.stats.animatedActors++;
      if(camera&&p.speed>0&&STREET_VEHICLES.includes(actor.kind)){
        // Nearby traffic moves too far between the distant shadow cadence's
        // frames. Use a conservative actor bound, not a per-mesh scene scan.
        const height=g.userData.height||1.8,length=g.userData.length||4.5;
        this.shadowActorBounds.center.copy(g.position);this.shadowActorBounds.center.y+=height*.5;
        this.shadowActorBounds.radius=Math.hypot(length*.5,height*.5,1.35);
        if(this.shadowActorBounds.distanceToPoint(this.viewPosition)<20&&this.frustum.intersectsSphere(this.shadowActorBounds))nearbyMovingVehicle=true;
      }
    }
    // A hidden exterior retains its last valid shadow map. Other room shadow
    // updates must never replace it with an empty view of hidden casters.
    if(nearbyMovingVehicle||!previousVisible||Math.abs(previousDoor-this.doorAmount)>.00001||nowMs-this.shadowAt>=80||nowMs<this.shadowAt){
      this.shadowAt=nowMs;this.shadowDirty=true;this.sun.shadow.needsUpdate=true;
    }
    return true;
  }
}
