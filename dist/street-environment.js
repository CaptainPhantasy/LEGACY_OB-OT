import * as THREE from 'three';

const fract=n=>n-Math.floor(n);
const random=n=>fract(Math.sin(n*127.1+311.7)*43758.5453123);

function rod(b,parent,material,from,to,radius=.025){
  const a=new THREE.Vector3(...from),z=new THREE.Vector3(...to),delta=z.clone().sub(a);
  const mesh=b.cylinder(parent,material,a.add(z).multiplyScalar(.5).toArray(),[radius,delta.length(),radius]);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return mesh;
}

function awning(shop,parent,width,index){
  const b=shop.builder,cloth=b.material(`Street / striped canvas ${index%3}`,[0x68705a,0x75564b,0x536a73][index%3],.91,0,{side:THREE.DoubleSide});
  cloth.userData.streetSurface='cloth';
  const pale=b.material('Street / faded canvas stripe',0xc7bfa5,.96);pale.userData.streetSurface='cloth';
  const segments=14,positions=[],uv=[],indices=[];
  for(let i=0;i<=segments;i++){
    const theta=i/segments*Math.PI*.47;
    const y=3.12-Math.sin(theta)*.46,z=-.05-(1-Math.cos(theta))*.94;
    positions.push(-width/2,y,z,width/2,y,z);uv.push(0,i/segments,1,i/segments);
    if(i<segments){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
  const canopy=new THREE.Mesh(geo,cloth);canopy.castShadow=true;canopy.receiveShadow=true;parent.add(canopy);
  // Open-bottom fabric has real thickness at its valance and metal support rods.
  b.box(parent,cloth,[0,2.55,-.91],[width,.28,.035]);
  for(let x=-width/2+.12;x<width/2;x+=.4)b.box(parent,pale,[x,2.55,-.934],[.095,.28,.012]);
  for(const x of [-width/2+.1,width/2-.1])rod(b,parent,shop.iron,[x,2.7,-.08],[x,2.57,-.9],.015);
}

function recessedWindow(shop,parent,x,y,width,height,seed,ground=false){
  const b=shop.builder,trim=shop.cream;
  const dark=b.material('Street / window recess',0x252b2b,.92);
  const inside=b.material(`Street / room plaster ${seed%3}`,[0x9d8c70,0xaca28d,0x83938d][seed%3],.96);inside.userData.streetSurface='plaster';
  const warm=b.material('Street / occupied window interior',0xc5ad88,.93,0,{emissive:0xd4aa62,emissiveIntensity:.025});
  const back=seed%4===0?warm:inside;
  const roomDepth=ground?1.3:.74;
  for(const side of [-1,1])b.box(parent,dark,[x+side*(width/2+.035),y,.24],[.1,height+.19,.38]);
  for(const side of [-1,1])b.box(parent,dark,[x,y+side*(height/2+.035),.24],[width+.19,.1,.38]);
  // The opening contains an actual small room; the glazing sits forward of its
  // walls, curtains and sill, so moving along the shop reveals real parallax.
  b.box(parent,back,[x,y,roomDepth],[width-.08,height-.08,.055]);
  for(const side of [-1,1])b.box(parent,inside,[x+side*(width/2-.035),y,.6],[.055,height,.9]);
  for(const sy of [-1,1])b.box(parent,inside,[x,y+sy*(height/2-.035),.6],[width,.055,.9]);
  if(ground){
    const display=b.material(`Street / display paint ${seed%3}`,[0x67513b,0x5b6855,0x7e5b48][seed%3],.82);
    b.box(parent,shop.wood,[x,y-height*.31,.62],[width*.9,.14,.64]);
    for(let k=0;k<5;k++){
      const h=.14+random(seed+k)*.24,xx=x-width*.38+k*width*.18;
      b.box(parent,display,[xx,y-height*.28+h/2,.5],[.11+random(seed+k+4)*.1,h,.16], [0,(random(seed+k+5)-.5)*.3,0]);
    }
    b.box(parent,shop.lampGlass,[x,y+height*.32,.72],[width*.35,.028,.18]);
  }else{
    const curtain=b.material(`Street / linen curtain ${seed%3}`,[0xc4bba3,0xa6ac99,0xc0a997][seed%3],.97);curtain.userData.streetSurface='cloth';
    const blind=seed%5===0;
    if(blind){
      for(let k=0;k<13;k++)b.box(parent,curtain,[x,y+height*.42-k*height*.063,.32],[width*.88,.035,.024],[.17,0,0]);
    }else for(const side of [-1,1]){
      const coverage=.18+random(seed+side)*.14;
      for(let k=0;k<7;k++)b.box(parent,curtain,[x+side*(width*.46-k*width*coverage/7),y,.38+Math.sin(k*2)*.035],[width*coverage/7+.012,height*.93,.03]);
    }
    if(seed%4===0){
      b.box(parent,shop.wood,[x+width*.16,y-height*.3,.6],[width*.44,.055,.27]);
      const shade=b.material('Street / cream lampshade',0xc9b386,.95,0,{emissive:0xffcb8b,emissiveIntensity:.1});
      b.cylinder(parent,shade,[x+width*.16,y-height*.1,.58],[.12,.17,.12]);
    }
  }
  const glass=b.box(parent,shop.windowMat,[x,y,.08],[width-.08,height-.08,.018]);glass.castShadow=false;
  for(const side of [-1,1]){
    b.box(parent,trim,[x+side*(width/2+.035),y,-.035],[.115,height+.24,.18]);
    b.box(parent,shop.iron,[x+side*(width/2-.045),y,.01],[.035,height-.02,.07]);
  }
  b.box(parent,trim,[x,y-height/2-.07,-.11],[width+.38,.14,.39]);
  b.box(parent,trim,[x,y+height/2+.07,-.05],[width+.27,.14,.25]);
  b.box(parent,shop.iron,[x,y,.025],[.045,height,.065]);
  if(!ground)b.box(parent,shop.iron,[x,y+.08,.022],[width,.04,.07]);
}

function building(shop,parent,{x,z,width,height,index,facing=-1}){
  const b=shop.builder,g=new THREE.Group();g.name=`Recessed masonry frontage ${index}`;
  g.position.set(x,0,z);if(facing===1)g.rotation.y=Math.PI;parent.add(g);
  const colors=[0x886047,0x897c6b,0x794e3e,0x867354,0x68726d];
  const brick=b.material(`Street / brickwork ${index%5}`,colors[index%5],.94);brick.userData.streetSurface='brick';
  const roof=b.material('Street / roof flashing',0x48504e,.7,.55);
  const sides=b.material('Street / old plaster sidewall',0x9c9685,.98);sides.userData.streetSurface='plaster';
  // Solid side walls, roof and back wall; the front is built around apertures.
  b.box(g,sides,[0,height/2,3.9],[width,height,.3]);
  for(const side of [-1,1])b.box(g,brick,[side*(width/2-.17),height/2,1.95],[.34,height,4]);
  b.box(g,roof,[0,height+.08,1.9],[width,.16,4.1]);
  b.box(g,brick,[0,.24,.08],[width,.48,.35]);
  b.box(g,brick,[0,3.27,.13],[width,.64,.45]);
  for(const px of [-width/2+.22,-1.19,1.19,width/2-.22]){
    b.box(g,shop.cream,[px,1.66,.04],[.32,2.85,.32]);
    b.box(g,shop.cream,[px,.42,-.05],[.43,.2,.45]);
    b.box(g,shop.cream,[px,2.97,-.03],[.41,.14,.4]);
  }
  for(const wx of [-2.35,0,2.35])recessedWindow(shop,g,wx,1.69,1.94,2.35,index*13+Math.round(wx+3),true);
  const floors=Math.max(2,Math.floor((height-3.7)/2.5));
  for(let floor=0;floor<floors;floor++){
    const y=4.75+floor*2.5;
    for(const wx of [-2.3,0,2.3])recessedWindow(shop,g,wx,y,1.3,1.72,index*17+floor*3+Math.round(wx+3));
    for(const px of [-width/2+.28,-1.15,1.15,width/2-.28])b.box(g,brick,[px,y,.19],[px===-1.15||px===1.15?.92:.5,2.5,.5]);
    b.box(g,brick,[0,y-1.05,.17],[width,.42,.44]);
    b.box(g,brick,[0,y+1.06,.17],[width,.4,.44]);
    // Soldier courses, lintels and low-relief corner blocks create grazing detail.
    for(const wx of [-2.3,0,2.3])for(let j=-3;j<=3;j++)b.box(g,shop.cream,[wx+j*.22,y+.99,-.095],[.205,.19,.12]);
  }
  const lastY=4.75+(floors-1)*2.5;
  b.box(g,brick,[0,(lastY+1.25+height)/2,.17],[width,Math.max(.1,height-lastY-1.25),.44]);
  for(const [y,depth,h]of [[3.48,.38,.12],[height-.24,.4,.16],[height-.05,.64,.13],[height+.13,.78,.15]])
    b.box(g,shop.cream,[0,y,-depth/2+.06],[width+.24,h,depth]);
  for(let xx=-width/2+.26;xx<width/2;xx+=.42)b.box(g,shop.cream,[xx,height-.34,-.18],[.13,.2,.25]);
  // Downpipes, utility covers and roof details give the building a credible scale.
  b.cylinder(g,roof,[width/2-.16,height/2,-.23],[.045,height,.045]);
  for(let y=1;y<height;y+=2)b.box(g,shop.iron,[width/2-.16,y,-.23],[.13,.045,.13]);
  b.box(g,shop.iron,[-width/2+.46,.78,-.14],[.32,.55,.15]);
  b.box(g,roof,[width*.21,height+.38,2.1],[1.2,.62,.9]);
  b.cylinder(g,roof,[-width*.23,height+.53,2.5],[.11,1,.11]);
  awning(shop,g,width-.55,index);
  const names=['CAFÉ & BAKERY','CENTRAL HARDWARE','FLOWERS','CITY BOOKBINDERS','CORNER MARKET','STUDIO 14','TAILOR & ALTERATIONS'];
  shop.sign(g,names[index%names.length],[0,3.3,-.13],[width-.85,.36],{background:['#38473f','#58433b','#344951'][index%3]});
  // Preserve per-building frustum bounds, while merging its many repeated details.
  b.batch(g);return g;
}

function leafGeometry(){
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute([0,-.12,0,-.055,-.035,.008,-.043,.045,.007,0,.13,0,.043,.045,.007,.055,-.035,.008,0,0,.014],3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute([.5,0,0,.34,.1,.67,.5,1,.9,.67,1,.34,.5,.5],2));
  g.setIndex([0,1,6,1,2,6,2,3,6,3,4,6,4,5,6,5,0,6]);g.computeVertexNormals();return g;
}

function tree(shop,parent,x,z,index){
  const b=shop.builder,g=new THREE.Group();g.name=`Branching street tree ${index}`;g.position.set(x,0,z);parent.add(g);
  const bark=b.material('Street / ridged bark',0x675346,.98);bark.userData.streetSurface='wood';
  rod(b,g,bark,[0,.07,0],[.08,3.38,-.04],.15);
  const tips=[];
  for(let branch=0;branch<7;branch++){
    const angle=branch*2.39996+index,length=1.05+random(branch+index*17)*.65;
    const from=[.06,2.25+branch*.11,-.035],to=[Math.cos(angle)*length,3.7+random(branch+4)*.7,Math.sin(angle)*length];
    rod(b,g,bark,from,to,.045);tips.push(to);
    for(let k=0;k<3;k++){
      const fork=[to[0]+Math.cos(angle+k*1.8)*.48,to[1]+.2+random(k+branch)*.3,to[2]+Math.sin(angle+k*1.8)*.48];
      rod(b,g,bark,to,fork,.018);tips.push(fork);
    }
  }
  b.batch(g);
  const leaves=b.material('Street / individual leaves',0x667847,.9,0,{side:THREE.DoubleSide});
  if(!leaves.userData.windBound){
    const previous=leaves.onBeforeCompile;
    leaves.onBeforeCompile=shader=>{
      previous(shader);shader.uniforms.streetWind=shop.wind;
      shader.vertexShader='uniform float streetWind;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
        #ifdef USE_INSTANCING
          float leafPhase=instanceMatrix[3].x*1.6+instanceMatrix[3].y*.9+instanceMatrix[3].z*1.2;
          transformed.x+=sin(streetWind*1.1+leafPhase)*.014*(position.y+.14);
          transformed.z+=cos(streetWind*.8+leafPhase)*.014*(position.y+.14);
        #endif`);
    };
    leaves.customProgramCacheKey=()=> 'street-leaf-wind-haze-v2';leaves.userData.windBound=true;
  }
  const count=620,mesh=new THREE.InstancedMesh(leafGeometry(),leaves,count),dummy=new THREE.Object3D(),color=new THREE.Color();
  mesh.name='Individual wind-moved leaves';mesh.castShadow=true;mesh.receiveShadow=true;
  for(let i=0;i<count;i++){
    const tip=tips[i%tips.length],r=Math.cbrt(random(i*5+index*3))*.72,angle=random(i*7+index)*Math.PI*2,u=random(i*9+2)*2-1;
    dummy.position.set(tip[0]+Math.cos(angle)*Math.sqrt(1-u*u)*r,tip[1]+u*r*.85,tip[2]+Math.sin(angle)*Math.sqrt(1-u*u)*r);
    dummy.rotation.set(random(i+22)*Math.PI,random(i+37)*Math.PI,random(i+51)*Math.PI);
    const scale=.9+random(i+4)*1.4;dummy.scale.set(scale,scale,scale);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    color.setHSL(.19+random(i+13)*.065,.21+random(i+14)*.18,.2+random(i+19)*.15);mesh.setColorAt(i,color);
  }
  mesh.computeBoundingBox();mesh.computeBoundingSphere();g.add(mesh);
  b.box(parent,shop.iron,[x,.075,z],[1.7,.035,1.7]);
  const mulch=b.material('Street / tree soil',0x493e32,.99);
  b.box(parent,mulch,[x,.096,z],[1.34,.028,1.34]);
  for(let k=-6;k<=6;k++)for(const side of [-1,1])b.box(parent,shop.iron,[x+k*.13,.12,z+side*.67],[.035,.025,.3]);
}

function batchFrontages(shop,street){
  const banks=[new THREE.Group(),new THREE.Group()];
  banks[0].name='Opposite masonry block';banks[1].name='Neighbouring masonry block';
  const matrix=new THREE.Matrix4();
  for(const building of [...street.children]){
    if(!building.name.startsWith('Recessed masonry frontage'))continue;
    const bank=banks[building.position.z>15?0:1];building.updateMatrix();
    for(const mesh of [...building.children]){
      if(!mesh.isMesh)continue;mesh.updateMatrix();matrix.multiplyMatrices(building.matrix,mesh.matrix);
      mesh.geometry.applyMatrix4(matrix);mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);bank.add(mesh);
    }
    street.remove(building);
  }
  for(const bank of banks){shop.builder.batch(bank);street.add(bank);}
}

export function buildStreetEnvironment(shop){
  const b=shop.builder,street=new THREE.Group();street.name='Indiana city block';shop.root.add(street);shop.street=street;
  shop.wind={value:0};shop.streetLights=[];
  const ground=new THREE.Group();ground.name='Textured pavement and street furniture';street.add(ground);
  b.box(ground,shop.cream,[0,-.04,7.7],[6.6,.14,1]);
  b.box(ground,shop.asphalt,[0,-.12,15.6],[200,.16,8.5]);
  const gutter=b.material('Street / gutter concrete',0x75766f,.96);gutter.userData.streetSurface='concrete';
  const slabMaterials=Array.from({length:4},(_,i)=>{const m=b.material(`Street / sidewalk slab ${i}`,[0xb1aca0,0xa9a598,0xb6afa1,0xa29f93][i],.95);m.userData.streetSurface='concrete';return m;});
  for(const z of [9.7,20.8]){
    b.box(ground,shop.mortar,[0,-.035,z],[200,.16,3.4]);
    for(let i=-50;i<50;i++)for(const row of [-1,1]){
      const material=slabMaterials[(i+50+(row===1?2:0))%4];
      b.box(ground,material,[i*2+1,.034,z+row*.83],[1.974,.1,1.638]);
    }
  }
  for(const z of [11.43,19.12]){
    b.box(ground,gutter,[0,-.018,z+(z<15?.21:-.21)],[200,.075,.36]);
    for(let x=-98;x<100;x+=2)b.box(ground,shop.cream,[x,.015,z],[1.985,.22,.18]);
  }
  for(const x of [-19,8,24])for(const z of [11.64,18.91]){
    b.box(ground,shop.iron,[x,.024,z],[.8,.025,.34]);
    for(let k=0;k<11;k++)b.box(ground,shop.black,[x-.34+k*.065,.038,z],[.035,.008,.26]);
  }
  // Patches, sealant, manhole and scuffed markings make the road a surface.
  const repair=b.material('Street / repaired asphalt',0x353b3b,.97);repair.userData.streetSurface='asphalt';
  for(const [x,z,w,d]of [[-7,14,2.8,1.4],[15,17.5,1.5,2],[26,13.3,3.4,1.1],[-21,17.3,1.8,2.5]])b.box(ground,repair,[x,-.031,z],[w,.009,d],[0,random(x)*.2,0]);
  b.cylinder(ground,shop.iron,[3.4,-.014,16.8],[.42,.025,.42]);
  for(let k=-3;k<=3;k++)b.box(ground,shop.black,[3.4+k*.1,.001,16.8],[.018,.008,Math.sqrt(.16-k*k*.01)*1.85]);
  for(const z of [15.38,15.57])for(let x=-97;x<98;x+=6)b.box(ground,shop.yellow,[x,-.024,z],[2.9,.008,.065]);
  for(const z of [12.1,18.5])b.box(ground,shop.paintWhite,[0,-.023,z],[200,.008,.065]);
  for(let x=12;x<17;x+=.65)b.box(ground,shop.paintWhite,[x,-.019,15.6],[.34,.008,6.8]);
  for(let i=-4;i<=4;i++)building(shop,street,{x:i*7.4,z:22.62,width:7.1,height:9.45+random(i+shop.seed)*4.4,index:i+5});
  for(const i of [-3,-2,-1,1,2,3])building(shop,street,{x:i*7.4,z:7.5,width:7.12,height:9.3+random(i+shop.seed+80)*3.4,index:i+11,facing:1});
  for(const [index,x]of [-21,-10,10,23].entries()){
    const z=19.65;
    b.cylinder(ground,shop.iron,[x,2.15,z],[.05,4.3,.05]);
    rod(b,ground,shop.iron,[x,4.14,z],[x,4.12,z-.74],.035);
    b.box(ground,shop.iron,[x,4.08,z-.78],[.37,.08,.5]);
    b.box(ground,shop.lampGlass,[x,4.03,z-.78],[.29,.035,.38]);
    b.cylinder(ground,shop.iron,[x,.14,z],[.16,.28,.16]);
    const lamp=new THREE.PointLight(0xffd9a9,0,7.5,2);lamp.position.set(x,3.95,z-.78);lamp.userData.exteriorLight=true;lamp.name='Street practical lamp';shop.scene.add(lamp);shop.streetLights.push({light:lamp,power:index===1||index===2?14:9});
  }
  for(const [index,x]of [-16,5.4,27].entries())tree(shop,street,x,20.85,index);
  for(const x of [-5,18]){
    for(let i=0;i<5;i++)b.box(ground,shop.woodEdge,[x,.56,21.0+i*.095],[1.7,.065,.072]);
    for(let i=0;i<4;i++)b.box(ground,shop.woodEdge,[x,.78+i*.105,21.43],[1.7,.076,.065],[.08,0,0]);
    for(const dx of [-.64,.64]){
      rod(b,ground,shop.iron,[x+dx,.1,20.95],[x+dx,.57,21.07],.027);
      rod(b,ground,shop.iron,[x+dx,.1,21.45],[x+dx,.57,21.3],.027);
      rod(b,ground,shop.iron,[x+dx,.59,21.4],[x+dx,1.16,21.45],.025);
    }
  }
  for(const x of [-7,21]){
    b.cylinder(ground,shop.iron,[x,.48,20.5],[.25,.9,.25]);
    b.cylinder(ground,shop.iron,[x,.96,20.5],[.3,.06,.3]);
    for(let i=0;i<18;i++){const a=i/18*Math.PI*2;b.box(ground,shop.black,[x+Math.cos(a)*.254,.5,20.5+Math.sin(a)*.254],[.018,.66,.018]);}
  }
  b.cylinder(ground,shop.iron,[11,1.4,20.3],[.032,2.8,.032]);
  shop.sign(ground,'BUS STOP',[11,2.7,20.26],[.57,.44],{background:'#314c60'});
  // A small hydrant with actual fittings, scale cues and readable worn paint.
  const hydrant=b.material('Street / hydrant paint',0x9a4b39,.7,.15);
  b.cylinder(ground,hydrant,[-2.8,.46,19.7],[.14,.69,.14]);
  b.sphere(ground,hydrant,[-2.8,.83,19.7],[.15,.11,.15]);
  for(const dx of [-.2,.2])b.cylinder(ground,shop.chrome,[-2.8+dx,.62,19.7],[.08,.16,.08],[0,0,Math.PI/2]);
  b.batch(ground);
  b.batch(street);
  batchFrontages(shop,street);
  street.userData.quality={recessedFacades:15,physicalWindowRooms:true,instancedLeaves:1860,realSunShadows:true};
  return street;
}
