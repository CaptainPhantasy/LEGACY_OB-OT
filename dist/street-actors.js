import * as THREE from 'three';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';

// Metre-scale street assets. Their source construction remains editable here;
// static details are merged by material while wheels and anatomical joints stay
// separate. Animation samples absolute street time, never an off-screen loop.
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const fract=x=>x-Math.floor(x);
const cache=new Map();
const geometry=(name,make)=>{if(!cache.has(name))cache.set(name,make());return cache.get(name);};
const sphere=()=>geometry('sphere',()=>new THREE.SphereGeometry(1,16,12));
const cylinder=()=>geometry('cylinder',()=>new THREE.CylinderGeometry(1,1,1,24));
function mesh(parent,geo,material,position=[0,0,0],scale=[1,1,1],rotation){
  const object=new THREE.Mesh(geo,material);object.position.fromArray(position);object.scale.fromArray(scale);
  if(rotation)object.rotation.set(...rotation);
  object.castShadow=true;object.receiveShadow=true;parent.add(object);return object;
}
const ellipsoid=(p,m,pos,size)=>mesh(p,sphere(),m,pos,size);
const tube=(p,m,pos,size,r)=>mesh(p,cylinder(),m,pos,size,r);
function roundedBox(size,radius=.04){
  const [x,y,z]=size,r=Math.min(radius,x*.24,y*.24,z*.24);
  const key=`rounded/${x}/${y}/${z}/${r}`;
  return geometry(key,()=>{
    // Reserve the bevel outside the extrusion contour so the declared metre
    // dimensions remain exact. Sub-pixel trim needs no bevel tessellation.
    if(r<.015)return new THREE.BoxGeometry(x,y,z);
    const s=new THREE.Shape(),w=x/2-2*r,h=y/2-2*r;
    s.moveTo(-w-r,-h);s.lineTo(-w-r,h);s.quadraticCurveTo(-w-r,h+r,-w,h+r);
    s.lineTo(w,h+r);s.quadraticCurveTo(w+r,h+r,w+r,h);s.lineTo(w+r,-h);
    s.quadraticCurveTo(w+r,-h-r,w,-h-r);s.lineTo(-w,-h-r);s.quadraticCurveTo(-w-r,-h-r,-w-r,-h);
    const g=new THREE.ExtrudeGeometry(s,{depth:z-2*r,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:r,bevelThickness:r,curveSegments:3});
    g.translate(0,0,-(z-2*r)/2);return g;
  });
}
const box=(p,m,pos,size,r=.025,rot)=>mesh(p,roundedBox(size,r),m,pos,[1,1,1],rot);
function batch(parent){
  const materials=new Map();
  for(const item of [...parent.children]){
    if(!item.isMesh||item.userData.keepSeparate)continue;
    item.updateMatrix();let g=item.geometry.clone().applyMatrix4(item.matrix);
    if(g.index){const expanded=g.toNonIndexed();g.dispose();g=expanded;}
    // All actor source meshes use these attributes. Tangents are not needed.
    for(const key of Object.keys(g.attributes))if(!['position','normal','uv'].includes(key))g.deleteAttribute(key);
    if(!materials.has(item.material))materials.set(item.material,[]);
    materials.get(item.material).push(g);parent.remove(item);
  }
  for(const [material,parts]of materials){
    const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
    g.computeBoundingBox();g.computeBoundingSphere();const item=mesh(parent,g,material);
    item.name=`${material.name} / actor assembly`;
  }
}
function physical(shop,name,color,roughness=.5,metalness=0,extra={}){
  const b=shop.builder;
  if(!b.materials.has(name)){
    const m=new THREE.MeshPhysicalMaterial({name,color,roughness,metalness,...extra});
    b.materials.set(name,b.exteriorMaterial(m));
  }
  return b.materials.get(name);
}
function material(shop,name,color,roughness=.8,metalness=0,surface){
  const m=shop.builder.material(name,color,roughness,metalness);
  if(surface)m.userData.streetSurface=surface;return m;
}
function panel(parent,material,points){
  const g=new THREE.BufferGeometry();
  const p=[],uv=[],idx=[];
  points.forEach((v,i)=>{p.push(...v);uv.push(i===0||i===3?0:1,i<2?0:1);});
  for(let i=1;i<points.length-1;i++)idx.push(0,i,i+1);
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
  return mesh(parent,g,material);
}
function rod(parent,material,from,to,radius=.012){
  const a=new THREE.Vector3(...from),b=new THREE.Vector3(...to),delta=b.clone().sub(a);
  const item=tube(parent,material,a.add(b).multiplyScalar(.5).toArray(),[radius,delta.length(),radius]);
  item.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return item;
}

// Swept rounded sections provide continuous highlights across the roof, hood,
// and shoulders rather than disconnected primitive boxes.
function shellSections(sections,segments=24){
  const p=[],uv=[],idx=[];
  for(let i=0;i<sections.length;i++){
    const [x,low,high,width]=sections[i],mid=(low+high)/2,ry=(high-low)/2;
    for(let j=0;j<=segments;j++){
      const angle=j/segments*TAU,s=Math.sin(angle),c=Math.cos(angle);
      const y=mid+Math.sign(s)*Math.pow(Math.abs(s),.45)*ry;
      const z=Math.sign(c)*Math.pow(Math.abs(c),.4)*width;
      p.push(x,y,z);uv.push(i/(sections.length-1),j/segments);
      if(i<sections.length-1&&j<segments){const a=i*(segments+1)+j,b=a+segments+1;idx.push(a,b,a+1,b,b+1,a+1);}
    }
  }
  for(const end of [0,sections.length-1]){
    const [x,low,high]=sections[end],center=p.length/3;p.push(x,(low+high)/2,0);uv.push(end?1:0,.5);
    for(let j=0;j<segments;j++){
      const a=end*(segments+1)+j;
      if(end)idx.push(center,a+1,a);else idx.push(center,a,a+1);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function bodyWithArches(length,width,wheels,radius,top=1){
  const h=radius+.025,r=radius+.115;
  const s=new THREE.Shape();s.moveTo(-length/2,.39);
  for(const x of wheels){s.lineTo(x-r,.39);s.absarc(x,h,r,Math.PI,0,true);}
  s.lineTo(length/2,.39);s.lineTo(length/2+.015,top-.32);s.quadraticCurveTo(length/2,top-.14,length/2-.2,top-.09);
  s.lineTo(length*.22,top-.03);s.lineTo(-length*.26,top);s.lineTo(-length/2+.16,top-.09);s.quadraticCurveTo(-length/2-.035,top-.22,-length/2,.39);
  const g=new THREE.ExtrudeGeometry(s,{depth:width-.16,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.065,bevelThickness:.08,curveSegments:12});
  g.translate(0,0,-(width-.16)/2);return g;
}
function wheel(parent,shop,x,z,radius,width=.24){
  const g=new THREE.Group();g.position.set(x,radius,z);g.name='Rolling tire and alloy rim';parent.add(g);
  const tire=material(shop,'Vehicle / textured tire rubber',0x202125,.94,0);
  const metal=physical(shop,'Vehicle / machined alloy',0xa8adb0,.28,.82);
  const brake=material(shop,'Vehicle / dark brake disc',0x42474b,.55,.78,'metal');
  const side=z<0?-1:1;
  // A rounded tire shoulder, recessed brake disc, raised rim lip and five
  // paired spokes remain visible during rotation and at grazing angles.
  const tg=geometry(`tire/${radius}/${width}`,()=>new THREE.TorusGeometry(radius-width*.36,width*.36,8,28));
  const t=mesh(g,tg,tire);t.scale.z=width/(width*.72);
  tube(g,brake,[0,0,side*width*.21],[radius*.66,.035,radius*.66],[Math.PI/2,0,0]);
  const lip=geometry(`rim/${radius}`,()=>new THREE.TorusGeometry(radius*.66,.018,5,24));
  mesh(g,lip,metal,[0,0,side*width*.51]);
  tube(g,metal,[0,0,side*width*.51],[radius*.16,.045,radius*.16],[Math.PI/2,0,0]);
  for(let i=0;i<5;i++)for(const offset of [-.08,.08]){
    const angle=i/5*TAU+offset;
    rod(g,metal,[Math.cos(angle)*radius*.12,Math.sin(angle)*radius*.12,side*width*.54],
      [Math.cos(angle+.16)*radius*.65,Math.sin(angle+.16)*radius*.65,side*width*.5],.017);
  }
  // Shallow tread cuts are dark ribs, sharing one material and draw call.
  for(let i=0;i<28;i++){
    const angle=i/28*TAU;
    box(g,brake,[Math.cos(angle)*(radius-.009),Math.sin(angle)*(radius-.009),0],[.012,.022,width*.72],.004,[0,0,angle]);
  }
  batch(g);return {group:g,radius};
}
function vehicleCabin(parent,shop,paint,glass,{suv=false}={}){
  const top=suv?1.78:1.46,shoulder=suv?1.02:.99,front=suv?1.19:1.12,rear=suv?-1.53:-1.43;
  const roofFront=suv?.74:.48,roofRear=suv?-1.38:-.9,roofWidth=suv?.75:.68;
  const roof=mesh(parent,shellSections([[roofRear-.1,top-.12,top-.06,roofWidth*.92],[roofRear,top-.06,top+.015,roofWidth],[(roofFront+roofRear)/2,top-.045,top+.03,roofWidth],[roofFront,top-.08,top-.015,roofWidth*.94]]),paint);
  roof.name='Continuous curved roof skin';
  const glassPoints=[
    [[front,shoulder, -.78],[front,shoulder,.78],[roofFront,top-.08,roofWidth],[roofFront,top-.08,-roofWidth]],
    [[rear,shoulder,.78],[rear,shoulder,-.78],[roofRear,top-.08,-roofWidth],[roofRear,top-.08,roofWidth]],
  ];
  glassPoints.forEach(v=>panel(parent,glass,v));
  const rubber=material(shop,'Vehicle / window gasket',0x171d20,.8);
  for(const side of [-1,1]){
    const z=.815*side,rz=roofWidth*side;
    panel(parent,glass,[[rear+.1,shoulder+.02,z],[front-.1,shoulder+.02,z],[roofFront-.06,top-.105,rz],[roofRear+.06,top-.105,rz]]);
    rod(parent,paint,[front,shoulder,side*.81],[roofFront,top-.08,rz],.045);
    rod(parent,paint,[rear,shoulder,side*.81],[roofRear,top-.08,rz],.055);
    rod(parent,rubber,[-.25,shoulder,z*1.003],[-.28,top-.065,rz],.033);
    rod(parent,shop.chrome,[rear,shoulder-.018,z],[front,shoulder-.018,z],.012);
    box(parent,paint,[front-.03,shoulder+.05,side*.95],[.26,.15,.19],.06);
    box(parent,glass,[front-.06,shoulder+.05,side*1.05],[.16,.09,.012],.008);
    for(const dx of [-.77,.52])box(parent,shop.chrome,[dx,.9,side*.926],[.17,.025,.025],.011);
    // Continuous door seams do not interrupt the rounded body highlight.
    rod(parent,rubber,[-.23,.46,side*.93],[-.23,shoulder,side*.93],.005);
  }
  const seat=material(shop,'Vehicle / charcoal upholstery',0x333638,.92,0,'cloth');
  for(const x of [-.85,.35])for(const side of [-1,1]){
    box(parent,seat,[x,.79,side*.39],[.44,.11,.42],.05);
    box(parent,seat,[x-.18,1.02,side*.39],[.14,.5,.42],.06,[0,0,-.1]);
    box(parent,seat,[x-.18,1.32,side*.39],[.12,.17,.23],.055);
  }
  const driver=material(shop,'Vehicle / driver coat',0x525d63,.9,0,'cloth');
  const skin=material(shop,'Vehicle / driver skin',0xb88f70,.85);
  ellipsoid(parent,driver,[.39,1.08,-.4],[.13,.2,.13]);ellipsoid(parent,skin,[.42,1.36,-.4],[.09,.12,.09]);
  const steering=geometry('steering',()=>new THREE.TorusGeometry(.14,.016,5,16));
  mesh(parent,steering,rubber,[.8,1.06,-.4],[1,1,1],[0,Math.PI/2,.3]);
}

export function buildStreetVehicle(shop,kind,index=0){
  const g=new THREE.Group();g.name=`Passing ${kind} / profiled body`;g.userData.kind=kind;
  const bus=kind.includes('bus'),truck=kind==='garbage-truck',suv=kind==='suv';
  const length=bus?8.3:truck?7.5:suv?4.7:4.3,width=bus||truck?2.35:1.86;
  const height=bus?2.94:truck?3.05:suv?1.86:1.5;
  const color={car:0x723e37,suv:0x455a51,'city-bus':0xd8dbd6,'school-bus':0xd4a128,'garbage-truck':0x4d6655}[kind]??0x4c5963;
  const paint=physical(shop,`Vehicle / ${kind} clearcoat`,color,.29,.48,{clearcoat:.8,clearcoatRoughness:.19});
  const glass=physical(shop,'Vehicle / laminated tinted glazing',0x65858e,.12,.22,{clearcoat:1,clearcoatRoughness:.07,transparent:true,opacity:.8,depthWrite:false,side:THREE.DoubleSide});
  const rubber=material(shop,'Vehicle / trim rubber',0x171b1c,.9);
  const body=new THREE.Group();body.name='Sprung vehicle body';g.add(body);
  const wheels=[];
  if(!bus&&!truck){
    const lower=mesh(body,bodyWithArches(length,width,[-1.38,1.38],.34),paint);lower.name='Bevelled body with open wheel arches';
    mesh(body,shellSections([[.92,.88,.96,.79],[1.45,.86,.94,.87],[length/2-.16,.74,.88,.82]]),paint).name='Sculpted bonnet';
    mesh(body,shellSections([[-length/2+.15,.73,.9,.82],[-1.5,.88,.98,.87],[-1.16,.89,.97,.79]]),paint);
    vehicleCabin(body,shop,paint,glass,{suv});
    if(suv)for(const side of [-1,1])rod(body,shop.iron,[-1.26,1.83,side*.61],[.55,1.83,side*.61],.022);
    for(const side of [-1,1]){
      box(body,rubber,[0,.44,side*.905],[2.05,.1,.075],.025);
      const face=side===1?length/2:-length/2;
      box(body,paint,[face,.59,0],[.13,.25,1.7],.055);
    }
    box(body,rubber,[length/2+.073,.64,0],[.018,.15,.85],.014);
    for(let i=0;i<6;i++)box(body,shop.chrome,[length/2+.085,.59+i*.025,0],[.016,.008,.77],.003);
    for(const x of [-1.38,1.38])for(const side of [-1,1])wheels.push(wheel(g,shop,x,side*(width/2-.08),.34));
  }else{
    const radius=.46;
    box(body,rubber,[0,.4,0],[length-.4,.22,width-.32],.055);
    if(bus){
      // Roof and corner radii catch broad reflections; glazing sits within
      // separate posts rather than being pasted onto an undivided box.
      mesh(body,bodyWithArches(length,width,[-2.65,2.65],radius,1.4),paint).name='Bus body with open wheel arches';
      box(body,paint,[-.1,2.77,0],[length-.18,.32,width-.04],.14);
      box(body,paint,[-length/2+.08,1.91,0],[.2,1.46,width-.02],.08);
      box(body,glass,[length/2-.015,2.05,0],[.06,1.18,width-.18],.025,[0,0,-.04]);
      for(const side of [-1,1]){
        for(let i=0;i<9;i++){
          const x=-3.65+i*.88;
          box(body,glass,[x,2.04,side*(width/2-.025)],[.75,1.12,.045],.04);
          box(body,paint,[x+.405,2.04,side*(width/2-.02)],[.065,1.45,.07],.015);
          box(body,shop.chrome,[x,2.05,side*(width/2+.005)],[.73,.028,.028],.007);
        }
        const stripe=kind==='city-bus'?material(shop,'Vehicle / transit navy stripe',0x315269,.38,.16):rubber;
        for(const y of [1.1,1.36])box(body,stripe,[0,y,side*(width/2+.015)],[length-.1,.07,.025],.01);
        rod(body,shop.chrome,[length/2-.06,2.2,side*1.16],[length/2+.24,2.24,side*1.42],.018);
        box(body,rubber,[length/2+.25,2.18,side*1.43],[.09,.3,.14],.03);
      }
      const seat=material(shop,'Vehicle / bus seat fabric',0x455b62,.92,0,'cloth');
      for(let i=0;i<7;i++)for(const side of [-1,1])box(body,seat,[-2.8+i*.85,1.47,side*.7],[.14,.65,.54],.05);
      box(body,rubber,[2.9,1.57,1.19],[.82,2.13,.04],.03);
      for(const x of [2.69,3.1])box(body,glass,[x,1.81,1.22],[.33,1.52,.025],.018);
      if(kind==='school-bus'){
        for(const y of [2.67,2.81])for(const side of [-1,1])ellipsoid(body,shop.tailLight,[length/2+.04,y,side*.82],[.026,.055,.055]);
        box(body,rubber,[-.7,1.54,-1.21],[.38,.4,.045],.05);
      }
      if(typeof shop.sign==='function')shop.sign(body,kind==='school-bus'?'SCHOOL BUS':'CITY TRANSIT',[length/2+.052,2.65,0],[1.6,.18]).rotation.y=Math.PI/2;
      for(const x of [-2.65,2.65])for(const side of [-1,1])wheels.push(wheel(g,shop,x,side*1.09,radius,.29));
    }else{
      mesh(body,bodyWithArches(2.72,width,[.25],radius,1.46),paint,[2.25,0,0]).name='Truck cab with open wheel arch';
      box(body,paint,[2.25,1.97,0],[2.72,1.03,width],.16);
      box(body,glass,[3.615,2.06,0],[.045,.83,width-.22],.025,[0,0,-.07]);
      for(const side of [-1,1]){
        box(body,glass,[2.48,2.08,side*1.188],[1.52,.78,.025],.055);
        box(body,rubber,[2.2,.72,side*1.23],[.72,.17,.24],.03);
        rod(body,shop.chrome,[2.05,1.0,side*1.2],[2.05,1.65,side*1.2],.022);
        box(body,shop.chrome,[2.35,1.49,side*1.2],[.21,.035,.035],.01);
        rod(body,shop.chrome,[3.3,2.32,side*1.19],[3.41,2.31,side*1.44],.025);
        box(body,rubber,[3.42,2.19,side*1.46],[.1,.32,.16],.035);
      }
      // Compactor hopper slopes into a rear loading lip; segmented ribs,
      // hydraulic rams and safety rails give it real mechanical thickness.
      mesh(body,shellSections([[-3.7,.63,2.3,.93],[-3.25,.75,2.88,1.17],[-2.6,.97,2.99,1.24],[.85,.97,2.99,1.24],[1.05,.97,2.86,1.15]]),paint);
      for(let x=-2.9;x<.9;x+=.73)for(const side of [-1,1])box(body,paint,[x,1.98,side*1.253],[.065,1.8,.055],.02);
      box(body,rubber,[-3.72,1.14,0],[.05,.82,1.72],.03);
      box(body,shop.chrome,[-3.78,.66,0],[.19,.13,2.01],.035);
      for(const side of [-1,1]){
        rod(body,shop.chrome,[-2.98,.83,side*1.28],[-2.51,2.63,side*1.28],.055);
        rod(body,paint,[-3.7,.78,side*.96],[-3.47,2.66,side*1.07],.044);
      }
      for(const x of [-2.5,-1.5,2.5])for(const side of [-1,1])wheels.push(wheel(g,shop,x,side*1.1,radius,.31));
    }
  }
  for(const side of [-1,1]){
    box(body,shop.headlight,[length/2+.07,.89,side*width*.35],[.035,.16,bus||truck?.27:.37],.025);
    box(body,shop.tailLight,[-length/2-.06,.88,side*width*.37],[.035,.2,.25],.025);
  }
  box(body,shop.cream,[-length/2-.082,.64,0],[.022,.13,.33],.006);
  if(bus||truck)for(const side of [-1,1])for(let x=-length/2+.4;x<length/2;x+=1.2)box(body,shop.yellow,[x,.74,side*(width/2+.025)],[.12,.055,.018],.008);
  batch(body);g.userData.length=length;g.userData.height=height;
  g.userData.actorRig={type:'vehicle',body,wheels,index};return g;
}

function joint(parent,name,position){const g=new THREE.Group();g.name=name;g.position.fromArray(position);parent.add(g);return g;}
// Anatomical/garment profiles run vertically. Interpolated rings give the jaw,
// shoulders and waist one continuous surface instead of stacked spheres.
function verticalSections(sections,{segments=24,subdivisions=3,power=1,relief}={}){
  const p=[],uv=[],idx=[],rings=[];
  const smooth=(a,b,c,d,t)=>b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
  for(let i=0;i<sections.length-1;i++)for(let step=0;step<subdivisions;step++){
    const t=step/subdivisions,row=[THREE.MathUtils.lerp(sections[i][0],sections[i+1][0],t)];
    for(let k=1;k<4;k++)row.push(smooth(sections[Math.max(0,i-1)][k],sections[i][k],sections[i+1][k],sections[Math.min(sections.length-1,i+2)][k],t));
    rings.push(row);
  }
  rings.push(sections.at(-1));
  for(let i=0;i<rings.length;i++){
    const [y,back,front,width]=rings[i],middle=(front+back)/2,depth=(front-back)/2;
    for(let j=0;j<=segments;j++){
      const angle=j/segments*TAU,c=Math.cos(angle),s=Math.sin(angle);
      const z=Math.sign(s)*Math.pow(Math.abs(s),power)*Math.max(.001,width);
      const x=middle+Math.sign(c)*Math.pow(Math.abs(c),power)*Math.max(.001,depth)+(relief?relief(y,z,Math.max(0,c)):0);
      p.push(x,y,z);uv.push(j/segments,i/(rings.length-1));
      if(i<rings.length-1&&j<segments){const a=i*(segments+1)+j,b=a+segments+1;idx.push(a,b,a+1,b,b+1,a+1);}
    }
  }
  for(const end of [0,rings.length-1]){
    const [y,back,front]=rings[end],center=p.length/3;p.push((back+front)/2,y,0);uv.push(.5,end?1:0);
    for(let j=0;j<segments;j++){const a=end*(segments+1)+j;idx.push(center,end?a+1:a,end?a:a+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function limbSegment(parent,material,length,top,bottom){
  const points=[new THREE.Vector2(bottom*.25,0),new THREE.Vector2(bottom,.035),new THREE.Vector2(top,length-.04),new THREE.Vector2(top*.5,length)];
  const geo=new THREE.LatheGeometry(points,12);geo.translate(0,-length,0);return mesh(parent,geo,material);
}
function clothLimb(parent,material,length,top,bottom){
  // Cloth extends through the pivot. A bent elbow/knee must never expose an
  // empty seam between two separately animated rigid segments.
  const points=[[0,-length-.035],[bottom*.8,-length-.028],[bottom,-length+.02],
    [top*.94,-length*.44],[top,-.035],[top*.85,.025],[top*.4,.045],[0,.05]];
  return mesh(parent,new THREE.LatheGeometry(points.map(([r,y])=>new THREE.Vector2(r,y)),12),material);
}
function humanLeg(root,cloth,shoe,side){
  const hip=joint(root,'Articulated hip',[0,.91,side*.095]);
  clothLimb(hip,cloth,.42,.078,.055);
  const knee=joint(hip,'Articulated knee',[0,-.42,0]);clothLimb(knee,cloth,.45,.055,.039);
  ellipsoid(knee,cloth,[0,0,0],[.055,.061,.055]);
  const ankle=joint(knee,'Level planted foot',[0,-.45,0]);
  mesh(ankle,shellSections([[-.075,-.078,-.008,.035],[-.035,-.079,.007,.05],[.06,-.079,-.015,.054],[.145,-.079,-.034,.046],[.175,-.075,-.043,.022]],12),shoe);
  mesh(ankle,shellSections([[-.077,-.09,-.076,.035],[-.035,-.09,-.076,.052],[.07,-.09,-.076,.056],[.15,-.09,-.076,.047],[.179,-.087,-.075,.021]],12),shoe);
  batch(hip);batch(knee);batch(ankle);return {hip,knee,ankle,side,upper:.42,lower:.45};
}
function humanArm(root,cloth,skin,side){
  const shoulder=joint(root,'Articulated shoulder',[0,1.395,side*.185]);clothLimb(shoulder,cloth,.29,.054,.04);
  const elbow=joint(shoulder,'Articulated elbow',[0,-.29,0]);clothLimb(elbow,cloth,.26,.04,.03);
  ellipsoid(elbow,cloth,[0,0,0],[.04,.043,.04]);
  const hand=joint(elbow,'Hand / leash anchor',[0,-.292,0]);
  ellipsoid(hand,skin,[.006,-.008,0],[.026,.052,.019]);ellipsoid(hand,skin,[.024,.01,-side*.014],[.012,.027,.012]);
  batch(shoulder);batch(elbow);batch(hand);return {shoulder,elbow,hand,side};
}
function dogRig(root,shop,index){
  const dog=joint(root,'Walking dog',[.82,0,.52]);
  const fur=material(shop,`Dog / coat ${index}`,index%2?0x866545:0x625047,.91);
  const muzzle=material(shop,`Dog / muzzle ${index}`,0xae967b,.94);
  const dark=material(shop,'Dog / nose and eyes',0x1e1b1b,.5);
  const body=joint(dog,'Canine torso',[0,0,0]);
  ellipsoid(body,fur,[0,.43,0],[.34,.17,.14]);ellipsoid(body,fur,[.22,.48,0],[.13,.2,.13]);
  ellipsoid(body,fur,[.32,.62,0],[.14,.15,.12]);ellipsoid(body,muzzle,[.445,.57,0],[.14,.069,.086]);
  ellipsoid(body,dark,[.56,.58,0],[.035,.029,.052]);
  for(const side of [-1,1]){
    ellipsoid(body,fur,[.26,.66,side*.116],[.069,.125,.028]);
    ellipsoid(body,dark,[.407,.661,side*.091],[.019,.018,.012]);
  }
  const collar=physical(shop,'Dog / oxblood collar',0x793e2e,.66,0);
  tube(body,collar,[.24,.51,0],[.135,.045,.135],[0,0,-.42]);
  const legs=[];
  for(const x of [-.22,.23])for(const side of [-1,1]){
    const hip=joint(dog,'Canine hip',[x,.36,side*.105]);limbSegment(hip,fur,.16,.044,.03);
    const knee=joint(hip,'Canine hock',[0,-.16,0]);limbSegment(knee,fur,.18,.027,.018);
    const ankle=joint(knee,'Canine paw',[0,-.18,0]);ellipsoid(ankle,fur,[.02,-.024,0],[.065,.029,.036]);
    batch(hip);batch(knee);batch(ankle);legs.push({hip,knee,ankle,side:x*side>0?1:-1,upper:.16,lower:.18,baseX:x,bend:x>0?-1:1});
  }
  const tail=joint(body,'Dog tail',[-.29,.46,0]);
  const curve=new THREE.CatmullRomCurve3([new THREE.Vector3(),new THREE.Vector3(-.13,.13,0),new THREE.Vector3(-.25,.2,0),new THREE.Vector3(-.3,.16,0)]);
  mesh(tail,new THREE.TubeGeometry(curve,10,.024,6,false),fur);
  batch(body);return {group:dog,body,legs,tail};
}

export function buildStreetPerson(shop,kind,index=0){
  const g=new THREE.Group();g.name=`Passing ${kind} / articulated anatomy`;g.userData.kind=kind;
  const palettes=[0x6d5144,0x405e70,0x777050,0x765160,0x425b4b,0x876149];
  const shirt=material(shop,`Walker / woven outerwear ${index}`,palettes[index%palettes.length],.91,0,'cloth');
  const inner=material(shop,`Walker / layered shirt ${index}`,index%2?0xbeb7a6:0x89979d,.94,0,'cloth');
  const skin=physical(shop,`Walker / skin ${index}`,[0xbe9475,0x8d654e,0xd2ad8c][index%3],.83,0,{sheen:.12,sheenRoughness:.8,sheenColor:0xd1ae97});
  const trousers=material(shop,`Walker / twill trousers ${index}`,index%2?0x354954:0x41403b,.95,0,'cloth');
  const hair=material(shop,`Walker / hair ${index}`,index%3?0x302923:0x726455,.97);
  const shoe=material(shop,`Walker / shoes ${index}`,kind==='jogger'?0x9caaa5:0x302e2b,.82);
  const faceDark=material(shop,'Walker / facial details',0x332822,.8);
  const torso=joint(g,'Torso and layered clothes',[0,0,0]);
  const trunk=mesh(torso,verticalSections([
    [.895,-.105,.09,.145],[.96,-.12,.115,.162],[1.075,-.11,.12,.15],
    [1.23,-.115,.135,.171],[1.355,-.105,.13,.194],[1.405,-.085,.105,.184],
    [1.455,-.045,.045,.065]
  ],{segments:20,power:.78}),shirt);trunk.name='Continuous fitted garment';
  mesh(torso,verticalSections([[.855,-.09,.075,.145],[.92,-.105,.085,.155],[.965,-.09,.08,.145]],{segments:16,subdivisions:1,power:.75}),trousers);
  // Small collar and seams read as everyday clothing at street distance. Flat
  // triangular lapels and an opaque chest insert looked like a robot harness.
  mesh(torso,verticalSections([[1.438,-.047,.048,.058],[1.467,-.045,.045,.053]],{segments:16,subdivisions:1}),inner);
  if(index%2===0&&kind!=='jogger'){
    rod(torso,inner,[.125,.98,0],[.135,1.28,0],.0025);
    rod(torso,inner,[.135,1.28,0],[.052,1.444,0],.0025);
    for(const side of [-1,1])rod(torso,shirt,[.111,1.02,side*.085],[.122,1.105,side*.11],.004);
  }
  mesh(torso,verticalSections([[1.448,-.04,.04,.043],[1.51,-.04,.039,.041],[1.57,-.034,.042,.038]],{segments:16,subdivisions:2}),skin);
  const head=joint(torso,'Head and face',[0,1.641,0]);
  const face=geometry('adult anatomical head',()=>verticalSections([
    [-.116,.019,.06,.023],[-.101,-.025,.075,.045],[-.074,-.065,.077,.06],
    [-.04,-.084,.077,.071],[-.005,-.09,.075,.074],[.027,-.092,.068,.073],
    [.061,-.088,.074,.071],[.093,-.072,.064,.06],[.117,-.035,.035,.034],[.126,-.003,.008,.004]
  ],{segments:32,subdivisions:2,relief:(y,z,front)=>{
    // Integrated bridge and tip, with only 22 mm of relief from the face.
    // This produces a nasal profile without a detached spherical nose.
    const bridge=.013*Math.exp(-Math.pow((y-.013)/.032,2));
    const tip=.014*Math.exp(-Math.pow((y+.011)/.013,2));
    return (bridge+tip)*Math.exp(-Math.pow(z/.014,2))*Math.pow(front,8);
  }}));
  mesh(head,face,skin).name='Adult jaw, cheek and nasal profile';
  for(const side of [-1,1]){
    ellipsoid(head,skin,[-.021,-.006,side*.073],[.012,.024,.009]);
    ellipsoid(head,faceDark,[.063,.025,side*.034],[.004,.003,.009]);
    rod(head,hair,[.067,.041,side*.023],[.058,.041,side*.046],.002);
  }
  rod(head,faceDark,[.078,-.057,-.018],[.078,-.057,.018],.0011);
  const cap=geometry('close fitted hair',()=>new THREE.SphereGeometry(1,20,10,0,TAU,0,Math.PI*.54));
  mesh(head,cap,hair,[-.015,.037,0],[.082,.094,.076]);
  // Rear hair follows the occipital curve rather than adding a second ball.
  mesh(head,geometry('rear hair',()=>new THREE.SphereGeometry(1,16,8,-Math.PI/2,Math.PI,0,Math.PI*.76)),hair,[-.012,.017,0],[.084,.098,.075]);
  if(kind==='jogger'){
    mesh(head,cap,shirt,[-.01,.045,0],[.084,.09,.079]);
    box(head,shirt,[.094,.084,0],[.115,.012,.153],.01,[0,0,-.08]);
  }else if(index%3===0){
    const glasses=physical(shop,'Walker / spectacles',0x363a3b,.35,.55);
    for(const side of [-1,1]){
      const z=side*.034;
      const points=[];
      for(let i=0;i<=16;i++){
        const a=i/16*TAU;points.push(new THREE.Vector3(.076,.026+Math.sin(a)*.011,z+Math.cos(a)*.022));
      }
      mesh(head,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),16,.0016,4,false),glasses);
      rod(head,glasses,[.075,.031,side*.056],[-.018,.013,side*.078],.0015);
    }
    rod(head,glasses,[.077,.029,-.013],[.077,.029,.013],.0015);
  }
  const legs=[-1,1].map(side=>humanLeg(g,trousers,shoe,side));
  const arms=[-1,1].map(side=>humanArm(torso,shirt,skin,side));
  if(kind==='pedestrian'&&index%2===0){
    const bag=material(shop,'Walker / worn canvas satchel',0x70533c,.93,0,'cloth');
    box(torso,bag,[-.13,1.04,.24],[.13,.34,.23],.045);
    rod(torso,bag,[.04,1.4,-.13],[.1,1.07,.23],.013);
  }
  batch(head);batch(torso);
  const rig={type:'person',torso,head,legs,arms,index,kind,dog:null,leash:null};
  if(kind==='dog-walker'){
    rig.dog=dogRig(g,shop,index);
    const lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(17*3),3));
    const leash=new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({name:'Dog / slack leather lead',color:0x4c3928,fog:false}));
    leash.name='Hand-to-collar lead';leash.frustumCulled=false;g.add(leash);rig.leash=leash;
  }
  g.userData.height=1.81;g.userData.actorRig=rig;
  animateStreetActor({group:g,kind,index},{phase:index,x:0,direction:1,speed:1},{gentle:true,nowMs:0});
  return g;
}

// Two-bone inverse kinematics keeps the sole planted during the support phase.
// In particular, rotating the entire leg as one rod would slide toes through
// the pavement and was the main visual weakness of the earlier pedestrians.
function solveLeg(leg,x,ankleY,hipY){
  const l1=leg.upper,l2=leg.lower,dy=hipY-ankleY,d=clamp(Math.hypot(x,dy),Math.abs(l1-l2)+.0001,l1+l2-.0001);
  const a=Math.atan2(x,dy),alpha=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));
  const flex=Math.PI-Math.acos(clamp((l1*l1+l2*l2-d*d)/(2*l1*l2),-1,1));
  const bend=leg.bend??1;
  leg.hip.position.y=hipY;leg.hip.rotation.z=a+alpha*bend;leg.knee.rotation.z=-flex*bend;leg.ankle.rotation.z=-(a+(alpha-flex)*bend);
}
function footPath(phase,stride,lift){
  const cycle=fract(phase/TAU),support=.62;
  if(cycle<support)return {x:stride*(.5-cycle/support),y:.09};
  const t=(cycle-support)/(1-support),smooth=t*t*(3-2*t);
  return {x:stride*(smooth-.5),y:.09+Math.sin(t*Math.PI)*lift};
}
const handPoint=new THREE.Vector3();
function updateLeash(g,rig){
  if(!rig.leash)return;
  g.updateMatrixWorld(true);rig.arms[1].hand.getWorldPosition(handPoint);g.worldToLocal(handPoint);
  const end=new THREE.Vector3(.82+.24,.52,.52),positions=rig.leash.geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const t=i/(positions.count-1),x=THREE.MathUtils.lerp(handPoint.x,end.x,t),z=THREE.MathUtils.lerp(handPoint.z,end.z,t);
    const y=THREE.MathUtils.lerp(handPoint.y,end.y,t)-Math.sin(t*Math.PI)*.11;
    positions.setXYZ(i,x,y,z);
  }
  positions.needsUpdate=true;rig.leash.geometry.computeBoundingSphere();
}
export function animateStreetActor(actor,pose,{gentle=false,nowMs=0}={}){
  const g=actor.group,rig=g.userData.actorRig;if(!rig)return;
  let phase=Number.isFinite(pose.phase)?pose.phase:nowMs*.0053+actor.index;
  if(rig.type==='vehicle'){
    // Rolling distance, not frame count, determines tire angle. Sampling after
    // a hidden interval immediately restores the physically matching rotation.
    for(const wheel of rig.wheels)wheel.group.rotation.z=-((pose.x*(pose.direction||1))/wheel.radius)%TAU;
    rig.body.position.y=gentle?0:.006*Math.sin(phase*2.9)+.002*Math.sin(phase*7.1);
    rig.body.rotation.z=gentle?0:.0025*Math.sin(phase*2.9+.7);
    return;
  }
  const running=actor.kind==='jogger',stride=running?.76:.62,speed=Math.max(.01,Number.isFinite(pose.speed)?pose.speed:1.2);
  // During support, d(footX)/dt = -stride / .62 * cadence = -speed.
  // This matches world travel exactly instead of skating on a fixed cadence.
  phase=nowMs*.001*(speed*.62/stride)*TAU+rig.index*1.1;
  const bounce=gentle?0:(running?.012:.006)*(1-Math.cos(phase*2));
  // The sidewalk's top is 7 cm above world zero. The feet solve relative to it.
  g.position.y=.075;rig.torso.position.y=bounce-(running?.07:.025);
  rig.torso.rotation.z=running?-.09:0;
  rig.head.rotation.y=gentle?0:Math.sin(phase*.23+rig.index)*.055;
  for(const leg of rig.legs){
    const p=gentle?{x:0,y:.09}:footPath(phase+(leg.side===1?Math.PI:0),stride,running?.19:.085);
    solveLeg(leg,p.x,p.y,(running?.84:.885)+bounce);
  }
  for(const arm of rig.arms){
    const swing=gentle?0:Math.sin(phase+(arm.side===1?Math.PI:0));
    arm.shoulder.rotation.z=-swing*(running?.6:.3)+(running?.14:0);
    arm.elbow.rotation.z=running?1.25:.2+Math.max(0,swing)*.12;
    if(rig.dog&&arm.side===1){arm.shoulder.rotation.z=.13;arm.elbow.rotation.z=.5;}
  }
  if(rig.dog){
    const dog=rig.dog;dog.body.position.y=gentle?0:.006*(1-Math.cos(phase*2.8));
    dog.tail.rotation.x=gentle?0:Math.sin(phase*1.1)*.3;
    const dogPhase=nowMs*.001*(speed*.62/.27)*TAU+rig.index*1.1;
    for(const leg of dog.legs){
      const p=gentle?{x:0,y:.052}:footPath(dogPhase+(leg.side===1?Math.PI:0),.27,.045);
      solveLeg(leg,p.x,gentle?p.y:p.y-.038,.36);
    }
    updateLeash(g,rig);
  }
}
