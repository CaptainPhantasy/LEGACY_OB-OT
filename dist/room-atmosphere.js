import * as THREE from 'three';

// Airborne dust follows drag, gravity, weak convection, and the visitor's wake.
// Light is evaluated at each mote, so dust appears within shafts, not as a flat overlay.
export class RoomAtmosphere {
  constructor(scene){
    this.count=1800;this.burstCount=480;this.age=-1;this.previousVisitor=new THREE.Vector3();this.first=true;
    this.positions=new Float32Array((this.count+this.burstCount)*3);this.velocity=new Float32Array(this.positions.length);this.sizes=new Float32Array(this.count+this.burstCount);
    this.lamps=[new THREE.Vector3(-1.55,2.402,4.47),new THREE.Vector3(1.46,2.485,-.63),new THREE.Vector3(-1.3,2.403,-6.65),new THREE.Vector3(-.86,1.31,-5.66)];
    for(let i=0;i<this.count;i++)this.reset(i);for(let i=this.count;i<this.count+this.burstCount;i++){this.positions[i*3+1]=-10;this.sizes[i]=.7+Math.random()*1.2;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(this.positions,3));geometry.setAttribute('moteSize',new THREE.BufferAttribute(this.sizes,1));
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,uniforms:{lampPositions:{value:this.lamps},revelation:{value:0},pixelRatio:{value:Math.min(devicePixelRatio,1.7)}},vertexShader:`
      attribute float moteSize;uniform vec3 lampPositions[4];uniform float revelation;uniform float pixelRatio;varying float brightness;
      void main(){
        vec3 p=position;float light=.012;
        for(int i=0;i<4;i++){vec3 d=p-lampPositions[i];float down=-d.y;float cone=1.-smoothstep(.16,.76,length(d.xz)/max(down,.05));light+=cone*step(.04,down)*exp(-length(d)*.52)*.75;}
        vec3 b=p-vec3(0.,1.15,-4.92);float rays=pow(max(0.,sin(atan(b.z,b.x)*7.+b.y*.9)),8.);
        light+=revelation*(.2+rays*.9)*exp(-length(b)*.8);brightness=min(light,.85);
        vec4 view=modelViewMatrix*vec4(p,1.);gl_PointSize=clamp(moteSize*9.*pixelRatio/max(1.,-view.z),.65,6.);gl_Position=projectionMatrix*view;
      }`,fragmentShader:`varying float brightness;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float edge=pow(1.-d,1.8);gl_FragColor=vec4(1.,.78,.45,edge*brightness);}`});
    this.points=new THREE.Points(geometry,this.material);this.points.frustumCulled=false;scene.add(this.points);this.beams=[];
    for(const p of this.lamps)this.beams.push(this.beam(scene,p,new THREE.Vector3(p.x*.7,.1,p.z+.2),.75,.020));
    this.bookRays=[];
    for(let i=0;i<7;i++){const angle=i*Math.PI*2/7;const source=new THREE.Vector3(Math.cos(angle)*.08,1.15,-4.92+Math.sin(angle)*.1),target=new THREE.Vector3(Math.cos(angle)*1.5,3.6,-4.92+Math.sin(angle)*1.7);this.bookRays.push(this.beam(scene,source,target,.42,0));}
  }
  reset(i){const p=i*3;this.positions[p]=(Math.random()-.5)*4.7;this.positions[p+1]=.2+Math.random()*2.6;this.positions[p+2]=Math.random()*14-7.2;this.velocity[p]=(Math.random()-.5)*.015;this.velocity[p+1]=-Math.random()*.015;this.velocity[p+2]=(Math.random()-.5)*.015;this.sizes[i]=.5+Math.random()*1.5;}
  beam(scene,from,to,radius,opacity){
    const length=from.distanceTo(to),geometry=new THREE.CylinderGeometry(.018,radius,length,32,1,true);
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,uniforms:{strength:{value:opacity}},vertexShader:'varying vec2 vUv;varying vec3 vWorld;varying vec3 vNormal;void main(){vUv=uv;vWorld=(modelMatrix*vec4(position,1.)).xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 vUv;varying vec3 vWorld;varying vec3 vNormal;uniform float strength;void main(){float fade=sin(vUv.y*3.14159)*smoothstep(0.,.15,vUv.y);float facing=pow(abs(dot(normalize(cameraPosition-vWorld),normalize(vNormal))),1.7);gl_FragColor=vec4(1.,.79,.51,fade*facing*strength);}'});
    const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(from).add(to).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),to.clone().sub(from).normalize());scene.add(mesh);return mesh;
  }
  open(){
    this.age=0;for(let i=this.count;i<this.count+this.burstCount;i++){const p=i*3,angle=Math.random()*Math.PI*2,speed=.12+Math.random()*.48;
      this.positions[p]=(Math.random()-.5)*.75;this.positions[p+1]=1.15+Math.random()*.025;this.positions[p+2]=-4.92+(Math.random()-.5)*.55;
      this.velocity[p]=Math.cos(angle)*speed-.16;this.velocity[p+1]=.18+Math.random()*.4;this.velocity[p+2]=Math.sin(angle)*speed;
    }
  }
  close(){this.age=-1;this.material.uniforms.revelation.value=0;for(const beam of this.bookRays)beam.material.uniforms.strength.value=0;for(let i=this.count;i<this.count+this.burstCount;i++)this.positions[i*3+1]=-10;}
  update(dt,time,visitor,gentle=false){
    const step=Math.min(dt,.035);let vx=0,vz=0;
    if(!this.first&&dt>0){vx=(visitor.x-this.previousVisitor.x)/dt;vz=(visitor.z-this.previousVisitor.z)/dt;}this.first=false;this.previousVisitor.copy(visitor);
    if(this.age>=0)this.age+=step;const bloom=this.age<0?0:Math.sin(Math.min(this.age/8,1)*Math.PI);
    this.material.uniforms.revelation.value=gentle?.12:Math.max(0,bloom)*2.3;
    this.bookRays.forEach((ray,i)=>ray.material.uniforms.strength.value=gentle?0:Math.max(0,bloom)*(.027+i*.003));
    if(gentle)return;
    const p=this.positions,v=this.velocity,drag=Math.exp(-.46*step),end=this.age<0?this.count:this.count+this.burstCount;
    for(let i=0;i<end;i++){
      const j=i*3,x=p[j],y=p[j+1],z=p[j+2],distance=(x-visitor.x)**2+(z-visitor.z)**2+(y-visitor.y)**2,wake=Math.exp(-distance*2.8);
      const driftX=Math.sin(z*2.7+time*.24)*.009,driftZ=Math.cos(x*3.1+time*.19)*.009;
      v[j]=(v[j]+(driftX+vx*wake*.12)*step)*drag;
      v[j+1]=(v[j+1]+(-.008+Math.sin(x*2.2+z*1.3+time*.33)*.009+Math.hypot(vx,vz)*wake*.024)*step)*drag;
      v[j+2]=(v[j+2]+(driftZ+vz*wake*.12)*step)*drag;
      p[j]+=v[j]*step;p[j+1]+=v[j+1]*step;p[j+2]+=v[j+2]*step;
      // The cellar bounds and the table are physical settling surfaces.
      if(i>=this.count&&y<1.125&&Math.abs(x)<.72&&Math.abs(z+4.92)<.52){p[j+1]=1.125;v[j+1]=0;v[j]*=.95;v[j+2]*=.95;}
      if(p[j+1]<.06){if(i<this.count)this.reset(i);else{p[j+1]=.06;v[j+1]=0;}}
      if(Math.abs(p[j])>2.45){p[j]=Math.sign(p[j])*2.45;v[j]*=-.2;}
      if(p[j+2]>7||p[j+2]<-7.6)v[j+2]*=-.2;
    }
    this.points.geometry.attributes.position.needsUpdate=true;
  }
}
