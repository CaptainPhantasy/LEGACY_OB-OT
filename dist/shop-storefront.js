import * as THREE from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';

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
    this.geometry={box:new THREE.BoxGeometry(1,1,1),sphere:new THREE.SphereGeometry(1,12,8),cylinder:new THREE.CylinderGeometry(1,1,1,12),cone:new THREE.ConeGeometry(1,1,10)};
    this.materials=new Map();this.daylight={value:1};
  }
  material(name,color,roughness=.75,metalness=0,extra={}){
    if(!this.materials.has(name))this.materials.set(name,this.exteriorMaterial(new THREE.MeshStandardMaterial({name,color,roughness,metalness,...extra})));
    return this.materials.get(name);
  }
  exteriorMaterial(material){
    // Keep the indoor sepia haze inside. This shared daylight uniform gives
    // the street a softer blue distance haze without changing room materials.
    material.fog=false;
    material.onBeforeCompile=shader=>{
      shader.uniforms.streetDaylight=this.daylight;
      shader.fragmentShader='uniform float streetDaylight;\n'+shader.fragmentShader.replace('#include <fog_fragment>',`
        float streetHaze=1.0-exp(-dot(vViewPosition,vViewPosition)*0.00022);
        vec3 streetHazeColor=mix(vec3(.025,.035,.065),vec3(.62,.69,.73),streetDaylight);
        gl_FragColor.rgb=mix(gl_FragColor.rgb,streetHazeColor,streetHaze);
      `);
    };
    material.customProgramCacheKey=()=> 'storefront-local-haze-v1';
    return material;
  }
  mesh(parent,shape,material,position,scale,rotation){
    const mesh=new THREE.Mesh(this.geometry[shape],material);mesh.position.fromArray(position);mesh.scale.fromArray(scale);
    if(rotation)mesh.rotation.set(...rotation);mesh.receiveShadow=false;mesh.castShadow=false;parent.add(mesh);return mesh;
  }
  box(p,m,pos,size,r){return this.mesh(p,'box',m,pos,size,r);}
  sphere(p,m,pos,size){return this.mesh(p,'sphere',m,pos,size);}
  cylinder(p,m,pos,size,r){return this.mesh(p,'cylinder',m,pos,size,r);}
  // Merge decorative pieces by material once, keeping moving joints separate.
  batch(parent){
    const groups=new Map();
    for(const child of [...parent.children]){
      if(!child.isMesh||child.userData.keepSeparate)continue;
      child.updateMatrix();let geometry=child.geometry.clone().applyMatrix4(child.matrix);
      if(geometry.index){const nonIndexed=geometry.toNonIndexed();geometry.dispose();geometry=nonIndexed;}
      if(!groups.has(child.material))groups.set(child.material,[]);groups.get(child.material).push(geometry);parent.remove(child);
    }
    for(const [material,parts]of groups){
      const geometry=mergeGeometries(parts,false);parts.forEach(part=>part.dispose());
      geometry.computeBoundingSphere();geometry.computeBoundingBox();
      const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name+' / batched';parent.add(mesh);
    }
  }
}

export class ShopStorefront {
  constructor(scene,room,{seed=37}={}){
    this.scene=scene;this.seed=seed;this.builder=new Builder();this.root=new THREE.Group();this.root.name='Living Indiana storefront';this.group=this.root;
    this.bounds=new THREE.Box3(new THREE.Vector3(-100,-42,-34.5),new THREE.Vector3(100,42,49.5));
    this.portalBounds=new THREE.Box3(new THREE.Vector3(-3.55,-.25,6.75),new THREE.Vector3(3.55,3.75,8.5));
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();
    this.stats={...openOriginalEntrance(room),actorCount:0,animatedActors:0,updates:0,skippedUpdates:0,drawMeshes:0};
    this.actors=[];this.nightMaterials=[];this.doorAmount=0;this.doorTarget=0;this.closed=false;
    this.palette();this.makeEntrance();this.makeSky();this.makeStreet();this.makeActors();scene.add(this.root);
    this.sun=new THREE.DirectionalLight(0xffedd4,1.8);this.sun.position.set(-9,18,17);this.sun.target.position.set(0,0,17);this.sun.userData.exteriorLight=true;
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
    this.glass=b.material('Storefront / clear glass',0xbcd2cf,.12,.08,{transparent:true,opacity:.095,depthWrite:false,side:THREE.DoubleSide});
    this.vehicleGlass=m('Street / tinted vehicle glass',0x2d4b55,.25,.25);
    this.asphalt=m('Street / asphalt',0x44484a,.97);
    this.concrete=m('Street / limestone sidewalk',0xa49e8c,.95);
    this.mortar=m('Street / mortar',0x7d786b,.98);
    this.cream=m('Street / warm limestone trim',0xbbae8c,.88);
    this.paintWhite=m('Street / road paint',0xd5cdb3,.9);
    this.yellow=m('Street / road yellow',0xc6a24e,.9);
    this.green=m('Street / leaves',0x4b6242,.95);
    this.trunk=m('Street / bark',0x514a3b,.98);
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
    // A local sky backdrop prevents the room's warm fog/background from
    // turning the world beyond the clear glass into an opaque brown void.
    this.skyMaterial=new THREE.ShaderMaterial({name:'Street / daylight sky',depthWrite:false,depthTest:false,side:THREE.BackSide,
      uniforms:{daylight:{value:1}},
      vertexShader:'varying vec2 skyUv; void main(){ skyUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader:`varying vec2 skyUv; uniform float daylight;
        void main(){
          float altitude=smoothstep(0.48,0.98,skyUv.y);
          vec3 day=mix(vec3(.76,.79,.73),vec3(.26,.48,.66),altitude);
          vec3 dark=mix(vec3(.065,.08,.13),vec3(.015,.025,.065),altitude);
          float dusk=4.0*daylight*(1.0-daylight)*(1.0-altitude);
          vec3 sky=mix(dark,day,daylight)+vec3(.13,.035,.005)*dusk;
          gl_FragColor=vec4(sky,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const sky=new THREE.Mesh(new THREE.SphereGeometry(42,24,12),this.skyMaterial);sky.name='Sky beyond Indiana street';sky.position.set(0,0,7.5);sky.renderOrder=-1000;this.root.add(sky);
  }
  makeStreet(){
    const b=this.builder,staticStreet=new THREE.Group();staticStreet.name='Indiana city block';this.root.add(staticStreet);this.street=staticStreet;
    b.box(staticStreet,this.cream,[0,-.04,7.7],[6.6,.14,1]);
    b.box(staticStreet,this.asphalt,[0,-.12,15.6],[200,.16,8.5]);
    for(const z of [9.7,20.8]){
      b.box(staticStreet,this.concrete,[0,-.02,z],[200,.18,3.4]);
      for(let x=-99;x<100;x+=2)b.box(staticStreet,this.mortar,[x,.073,z],[.017,.003,3.38]);
      b.box(staticStreet,this.mortar,[0,.075,z],[200,.003,.015]);
    }
    for(const z of [11.43,19.12])b.box(staticStreet,this.cream,[0,.005,z],[200,.24,.18]);
    for(const z of [15.38,15.57])for(let x=-97;x<98;x+=6)b.box(staticStreet,this.yellow,[x,-.032,z],[3,.008,.07]);
    for(const z of [12.1,18.5])b.box(staticStreet,this.paintWhite,[0,-.031,z],[200,.008,.08]);
    for(let x=12;x<17;x+=.65)b.box(staticStreet,this.paintWhite,[x,-.027,15.6],[.34,.008,6.8]);
    // City facades have recessed shop fronts, cornices, sills and varied windows.
    const bricks=[0x7b5142,0x796956,0x8b7153,0x5b625d,0x955e46,0x766253,0x545e61];
    const names=['CAFÉ & BAKERY','CENTRAL HARDWARE','FLOWERS','CITY BOOKBINDERS','CORNER MARKET','STUDIO 14','TAILOR & ALTERATIONS'];
    const windowMat=b.material('Street / building windows',0x455b60,.22,.25,{emissive:0xefd49f,emissiveIntensity:.05});this.windowMat=windowMat;
    for(let i=-5;i<=5;i++){
      const x=i*7.4, height=8.8+noise(i+this.seed)*5.3,width=7.1;
      const brick=b.material(`Street / masonry ${i}`,bricks[(i+7)%bricks.length],.95);
      b.box(staticStreet,brick,[x,height/2,26],[width,height,6.8]);
      for(const y of [.25,3.3,height-.18,height+.12])b.box(staticStreet,this.cream,[x,y,22.52],[width+.2,.22,.24]);
      b.box(staticStreet,this.iron,[x,1.68,22.51],[width-.45,2.7,.15]);
      for(const wx of [-2.35,0,2.35]){
        b.box(staticStreet,windowMat,[x+wx,1.75,22.4],[2.0,2.25,.05]);
        b.box(staticStreet,this.cream,[x+wx,1.72,22.35],[.07,2.35,.08]);
      }
      for(let floor=0;floor<Math.floor((height-3.6)/2.45);floor++)for(const wx of [-2.3,0,2.3]){
        const y=4.7+floor*2.45;
        b.box(staticStreet,this.iron,[x+wx,y,22.49],[1.44,1.8,.15]);
        b.box(staticStreet,windowMat,[x+wx,y,22.38],[1.25,1.62,.06]);
        for(const sy of [-.84,.84])b.box(staticStreet,this.cream,[x+wx,y+sy,22.32],[1.55,.1,.28]);
        b.box(staticStreet,this.cream,[x+wx,y,22.3],[.065,1.6,.08]);
        b.box(staticStreet,this.cream,[x+wx,y,22.3],[1.3,.055,.08]);
      }
      const awning=b.material(`Street / canvas canopy ${i}`,[0x4c5a45,0x6b3d35,0x465b66][(i+6)%3],.9);
      b.box(staticStreet,awning,[x,3.04,22.1],[width-.4,.12,.86],[.13,0,0]);
      b.box(staticStreet,awning,[x,2.88,21.7],[width-.4,.24,.08]);
      if(Math.abs(i)<4)this.sign(staticStreet,names[(i+7)%names.length],[x,3.57,22.35],[width-.9,.36]);
      // Brick joints are restrained near the street rather than thousands of meshes.
      for(let y=.5;y<height;y+=.5)b.box(staticStreet,this.mortar,[x,y,22.595],[width,.012,.008]);
    }
    // Neighbouring premises continue this side of the block, so looking back
    // after leaving still reveals a city around the shop rather than an edge.
    for(const i of [-2,-1,1,2]){
      const x=i*7.4,height=8.7+noise(i+this.seed+80)*3.8;
      const brick=b.material(`Street / masonry ${i}`,bricks[(i+7)%bricks.length],.95);
      b.box(staticStreet,brick,[x,height/2,3.9],[7.2,height,6.8]);
      for(const y of [.24,3.3,height-.12])b.box(staticStreet,this.cream,[x,y,7.39],[7.35,.2,.22]);
      b.box(staticStreet,this.iron,[x,1.66,7.37],[6.65,2.7,.15]);
      for(const wx of [-2.2,0,2.2])b.box(staticStreet,windowMat,[x+wx,1.66,7.47],[1.95,2.35,.05]);
      for(let y=4.8;y<height-.7;y+=2.4)for(const wx of [-2.25,0,2.25]){
        b.box(staticStreet,this.cream,[x+wx,y,7.38],[1.5,1.85,.18]);
        b.box(staticStreet,windowMat,[x+wx,y,7.49],[1.27,1.6,.05]);
        b.box(staticStreet,this.cream,[x+wx,y,7.53],[.06,1.6,.06]);
        b.box(staticStreet,this.cream,[x+wx,y,7.53],[1.3,.055,.06]);
      }
      this.sign(staticStreet,i<0?'ANTIQUES & RESTORATION':'THE CORNER CAFÉ',[x,3.55,7.46],[5.5,.36],{facing:1});
    }
    for(const x of [-21,-10,10,23]){
      const z=19.65;
      b.cylinder(staticStreet,this.iron,[x,2.15,z],[.055,4.3,.055]);
      b.box(staticStreet,this.iron,[x,4.18,z-.38],[.07,.07,.8]);
      b.box(staticStreet,this.iron,[x,4.02,z-.78],[.37,.1,.5]);
      b.box(staticStreet,this.lampGlass,[x,3.95,z-.78],[.28,.035,.38]);
      b.cylinder(staticStreet,this.iron,[x,.13,z],[.18,.26,.18]);
    }
    for(const x of [-16,6,28]){
      b.cylinder(staticStreet,this.trunk,[x,1.75,20.9],[.17,3.5,.17]);
      for(let k=0;k<5;k++)b.sphere(staticStreet,this.green,[x+Math.cos(k*2.4)*.9,3.8+noise(k+x)*.5,20.9+Math.sin(k*2.4)*.65],[1.3,1.4,1.15]);
      b.box(staticStreet,this.iron,[x,.1,20.9],[1.65,.08,1.65]);
    }
    for(const x of [-5,18]){
      b.box(staticStreet,this.woodEdge,[x,.55,21.2],[1.7,.1,.45]);b.box(staticStreet,this.woodEdge,[x,.93,21.39],[1.7,.55,.08]);
      for(const dx of [-.65,.65])b.box(staticStreet,this.iron,[x+dx,.28,21.2],[.06,.5,.38]);
    }
    b.cylinder(staticStreet,this.iron,[-7,.5,20.5],[.29,1,.29]);b.cylinder(staticStreet,this.iron,[-7,1.04,20.5],[.32,.09,.32]);
    b.box(staticStreet,b.material('Street / bus stop blue',0x3b6171),[11,2.7,20.3],[.55,.5,.04]);b.cylinder(staticStreet,this.iron,[11,1.35,20.3],[.035,2.7,.035]);
    b.batch(staticStreet);
  }
  vehicle(kind,index){
    const b=this.builder,g=new THREE.Group();g.name=`Passing ${kind}`;g.userData.kind=kind;
    const bus=kind.includes('bus'),truck=kind==='garbage-truck',suv=kind==='suv';
    const length=bus?8.3:truck?7.5:suv?4.7:4.3,width=bus||truck?2.35:1.82,height=bus?2.9:truck?3.0:suv?1.77:1.42;
    const paint=b.material(`Vehicle / ${kind} paint`,{car:0x5e3332,suv:0x53665d,'city-bus':0xe3d6bb,'school-bus':0xd6a732,'garbage-truck':0x597660}[kind],.42,.2);
    b.box(g,this.black,[0,.38,0],[length*.88,.18,width*.8]);
    b.box(g,paint,[0,.78,0],[length,.64,width]);
    if(bus){
      b.box(g,paint,[-.1,1.94,0],[length-.25,1.7,width]);
      b.box(g,this.vehicleGlass,[length/2+.012,2.02,0],[.035,1.12,width-.25]);
      for(const side of [-1,1])for(let i=0;i<8;i++)b.box(g,this.vehicleGlass,[-3.25+i*.87,2.04,side*(width/2+.012)],[.68,1.02,.025]);
      for(const side of [-1,1])b.box(g,kind==='city-bus'?b.material('City bus / blue belt',0x34596d):this.black,[0,1.37,side*(width/2+.018)],[length,.12,.025]);
      b.box(g,this.cream,[0,2.84,0],[length-.2,.16,width-.1]);
      if(kind==='school-bus')for(const side of [-1,1]){
        b.box(g,this.black,[length/2+.03,2.76,side*.77],[.04,.14,.16]);
        b.box(g,this.tailLight,[length/2+.054,2.76,side*.77],[.045,.09,.1]);
      }
      this.sign(g,kind==='school-bus'?'SCHOOL BUS':'CITY TRANSIT',[length/2+.04,2.6,0],[1.5,.18]).rotation.y=Math.PI/2;
    }else if(truck){
      b.box(g,paint,[2.25,1.72,0],[2.7,1.45,width]);
      b.box(g,this.vehicleGlass,[3.62,1.99,0],[.03,.87,width-.24]);
      for(const side of [-1,1])b.box(g,this.vehicleGlass,[2.55,2.03,side*1.19],[1.32,.83,.025]);
      b.box(g,paint,[-1.2,1.83,0],[4.4,2.35,width+.1]);
      for(let x=-3;x<1;x+=.65)for(const side of [-1,1])b.box(g,this.chrome,[x,1.81,side*1.25],[.055,2.08,.04]);
      b.box(g,this.black,[-3.53,1.3,0],[.12,1.44,1.95]);
      b.cylinder(g,this.chrome,[-2.7,1.3,1.32],[.07,1.6,.07],[0,0,.45]);
      b.box(g,this.yellow,[-3.62,.65,0],[.05,.16,width]);
    }else{
      // Sloped windscreens, a distinct bonnet and rounded roof soften the silhouette.
      b.box(g,paint,[-.2,suv?1.36:1.14,0],[suv?2.8:2.35,suv?.84:.68,width*.87]);
      b.box(g,this.vehicleGlass,[suv?1.2:1.0,suv?1.38:1.18,0],[.04,suv?.62:.53,width*.8],[0,0,-.34]);
      b.box(g,this.vehicleGlass,[-1.35,suv?1.36:1.17,0],[.04,suv?.6:.49,width*.8],[0,0,.25]);
      for(const side of [-1,1]){
        b.box(g,this.vehicleGlass,[-.22,suv?1.41:1.22,side*width*.442],[suv?2.38:1.92,suv?.51:.43,.025]);
        b.box(g,paint,[-.15,suv?1.42:1.21,side*width*.461],[.09,suv?.55:.47,.028]);
        for(const x of [-.67,.55])b.box(g,this.chrome,[x,.94,side*width*.506],[.17,.035,.02]);
        b.box(g,paint,[.97,1.12,side*1.0],[.22,.12,.17]);
      }
      if(suv)for(const side of [-1,1])b.box(g,this.iron,[-.3,1.83,side*.61],[2.3,.045,.045]);
    }
    const wheelX=bus?[-2.65,2.65]:truck?[-2.5,-1.5,2.5]:[-1.38,1.38];
    for(const x of wheelX)for(const side of [-1,1]){
      const radius=(bus||truck)?.46:.34;
      b.cylinder(g,this.black,[x,radius,side*(width/2-.04)],[radius,.22,radius],[Math.PI/2,0,0]);
      b.cylinder(g,this.chrome,[x,radius,side*(width/2+.075)],[radius*.54,.025,radius*.54],[Math.PI/2,0,0]);
    }
    for(const side of [-1,1]){
      b.box(g,this.headlight,[length/2+.022,.85,side*width*.34],[.045,.16,.32]);
      b.box(g,this.tailLight,[-length/2-.022,.86,side*width*.35],[.045,.18,.25]);
    }
    for(const side of [-1,1])b.box(g,this.chrome,[side*(length/2+.03),.54,0],[.07,.12,width*.9]);
    b.box(g,this.cream,[-length/2-.075,.73,0],[.04,.14,.32]);
    b.batch(g);g.userData.height=height;g.userData.length=length;return g;
  }
  person(kind,index){
    const b=this.builder,g=new THREE.Group();g.name=`Passing ${kind} ${index}`;g.userData.kind=kind;
    const shirt=b.material(`Walker / coat ${index}`,[0x806052,0x566e7a,0x847447,0x775660,0x495c4b,0x7f5443][index],.9);
    const skin=b.material(`Walker / skin ${index}`,[0xbd9271,0x8d634c,0xd1ad8a][index%3],.85);
    const trousers=b.material(`Walker / trousers ${index}`,index%2?0x364b5b:0x45423d,.95);
    const hair=b.material(`Walker / hair ${index}`,index%3?0x403329:0x81725f,.96);
    b.sphere(g,shirt,[0,1.16,0],[.19,.32,.13]);
    b.cylinder(g,skin,[0,1.49,0],[.065,.13,.065]);
    b.sphere(g,skin,[0,1.67,0],[.12,.155,.12]);
    b.sphere(g,hair,[-.015,1.74,0],[.125,.09,.125]);
    b.sphere(g,skin,[.112,1.67,0],[.045,.04,.038]);
    if(kind==='jogger')b.box(g,shirt,[.07,1.79,0],[.22,.035,.22]);
    const limbs=[];
    for(const side of [-1,1]){
      const leg=new THREE.Group();leg.position.set(0,.93,side*.095);g.add(leg);
      b.cylinder(leg,trousers,[0,-.4,0],[.068,.8,.068]);
      b.box(leg,this.black,[.055,-.82,0],[.23,.105,.13]);b.batch(leg);limbs.push({joint:leg,sign:side,leg:true});
      const arm=new THREE.Group();arm.position.set(0,1.38,side*.19);g.add(arm);
      b.cylinder(arm,shirt,[0,-.235,0],[.053,.47,.053]);b.sphere(arm,skin,[0,-.5,0],[.052,.07,.05]);b.batch(arm);limbs.push({joint:arm,sign:-side,leg:false});
    }
    if(kind==='dog-walker'){
      const dog=new THREE.Group();dog.position.set(.75,0,.38);g.add(dog);
      const fur=b.material(`Dog / fur ${index}`,index%2?0x9b805b:0x695342,.96);
      b.sphere(dog,fur,[0,.37,0],[.34,.16,.13]);b.sphere(dog,fur,[.31,.52,0],[.14,.13,.12]);b.sphere(dog,fur,[.43,.5,0],[.11,.065,.08]);
      for(const side of [-1,1])b.sphere(dog,hair,[.28,.59,side*.105],[.06,.11,.035]);
      const dogLegs=[];
      for(const x of [-.21,.21])for(const side of [-1,1]){
        const joint=new THREE.Group();joint.position.set(x,.31,side*.09);dog.add(joint);b.cylinder(joint,fur,[0,-.13,0],[.03,.26,.03]);dogLegs.push({joint,sign:x*side>0?1:-1});
      }
      b.cylinder(dog,fur,[-.38,.48,0],[.035,.28,.035],[0,0,-.65]);
      const leashPath=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.88,.24),new THREE.Vector3(.37,.77,.34),new THREE.Vector3(1.04,.53,.38)]);
      const leash=new THREE.Mesh(new THREE.TubeGeometry(leashPath,8,.009,4,false),this.iron);g.add(leash);
      b.batch(dog);g.userData.dogLegs=dogLegs;
    }
    b.batch(g);g.userData.limbs=limbs;return g;
  }
  makeActors(){
    for(const [index,kind]of STREET_VEHICLES.entries()){
      const group=this.vehicle(kind,index);group.visible=false;this.root.add(group);this.actors.push({group,kind,index});
    }
    for(let index=0;index<6;index++){
      const kind=index===1?'jogger':index===2||index===5?'dog-walker':'pedestrian';
      const group=this.person(kind,index);group.visible=false;this.root.add(group);this.actors.push({group,kind,index});
    }
  }
  setDoorOpen(value){this.doorTarget=clamp(Number(value)||0);}
  setClosed(value){
    this.closed=!!value;this.openSign.visible=!this.closed;this.closedSign.visible=this.closed;
    this.openOutsideSign.visible=!this.closed;this.closedOutsideSign.visible=this.closed;
  }
  update({nowMs=Date.now(),dt=0,camera,daylight=1,night=1-daylight,gentle=false,visible}={}){
    const light=clamp(daylight),dark=clamp(night);
    this.builder.daylight.value=light;
    this.skyMaterial.uniforms.daylight.value=light;
    this.sun.intensity=light*2.6;this.sun.color.set(light>.3?0xffedd4:0xe8a16b);
    this.skyLight.intensity=.12+light*.74;this.skyLight.color.set(light>.2?0xbcd6ef:0x647aaf);
    this.windowMat.emissiveIntensity=.025+dark*.65;
    this.headlight.emissiveIntensity=.3+dark*2.2;this.tailLight.emissiveIntensity=.25+dark*.8;this.lampGlass.emissiveIntensity=.1+dark*2.4;
    let inView=visible;
    if(inView===undefined){
      if(!camera)inView=true;
      else{
        camera.updateMatrixWorld(true);this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
        this.frustum.setFromProjectionMatrix(this.projection);inView=camera.position.z>6.75||this.frustum.intersectsBox(this.portalBounds);
      }
    }
    this.root.visible=!!inView;this.stats.animatedActors=0;
    // Door opening belongs to the visitor's exit action and is never tied to
    // frame visibility; the next visible frame sees its current requested state.
    const blend=gentle?1:1-Math.exp(-Math.max(0,dt)*7);
    this.doorAmount+=(this.doorTarget-this.doorAmount)*blend;this.doorPivot.rotation.y=-this.doorAmount*1.35;
    if(!inView){this.stats.skippedUpdates++;return false;}
    this.stats.updates++;
    for(const actor of this.actors){
      const p=streetActorPose(actor.kind,actor.index,nowMs,this.seed),g=actor.group;
      g.visible=p.active;if(!p.active)continue;
      g.position.set(p.x,STREET_VEHICLES.includes(actor.kind)?-.04:0,p.z);g.rotation.y=p.direction===1?0:Math.PI;
      const bounce=gentle?0:Math.sin(p.phase*2)*(actor.kind==='jogger'?.035:.012);
      if(!STREET_VEHICLES.includes(actor.kind))g.position.y=bounce;
      for(const limb of g.userData.limbs||[])limb.joint.rotation.z=gentle?0:Math.sin(p.phase)*limb.sign*(limb.leg?.46:.31)*(actor.kind==='jogger'?1.4:1);
      for(const limb of g.userData.dogLegs||[])limb.joint.rotation.z=gentle?0:Math.sin(p.phase*1.4)*limb.sign*.38;
      this.stats.animatedActors++;
    }
    return true;
  }
}
