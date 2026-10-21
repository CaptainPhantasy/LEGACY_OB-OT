import * as THREE from 'three';
import { PaperDynamics } from './paper-dynamics.js';

// Capture the actual laid-out words, including line breaks and the user's font
// metrics. Text remains in the accessible DOM; this canvas exists only mid-turn.
function photographPage(element){
  const box=element.getBoundingClientRect(),scale=2,canvas=document.createElement('canvas');
  canvas.width=Math.ceil(box.width*scale);canvas.height=Math.ceil(box.height*scale);
  const ctx=canvas.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='#d7c29b';ctx.fillRect(0,0,box.width,box.height);
  const shade=ctx.createLinearGradient(0,0,box.width,0);shade.addColorStop(0,'#78502438');shade.addColorStop(.09,'#a4773020');shade.addColorStop(.55,'#f3e2b200');shade.addColorStop(1,'#77502a38');ctx.fillStyle=shade;ctx.fillRect(0,0,box.width,box.height);
  let seed=83;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  for(let i=0;i<4000;i++){ctx.fillStyle=`rgba(96,60,27,${random()*.06})`;ctx.fillRect(random()*box.width,random()*box.height,random()*1.3+.2,random()*1.3+.2);}
  for(let i=0;i<46;i++){const x=random()<.5?random()*box.width*.08:box.width*(.9+random()*.1);ctx.fillStyle=`rgba(100,59,21,${random()*.11})`;ctx.beginPath();ctx.arc(x,random()*box.height,random()*2+.3,0,Math.PI*2);ctx.fill();}
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
    if(!node.textContent.trim())continue;const style=getComputedStyle(node.parentElement);if(style.display==='none'||style.visibility==='hidden')continue;
    ctx.font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;ctx.fillStyle=style.color;ctx.textBaseline='alphabetic';
    const range=document.createRange();
    for(let i=0;i<node.length;i++){
      const letter=node.textContent[i];if(/\s/.test(letter))continue;
      range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect();if(!r.width||!r.height)continue;
      const metrics=ctx.measureText(letter),size=parseFloat(style.fontSize),ascent=metrics.fontBoundingBoxAscent||size*.8,descent=metrics.fontBoundingBoxDescent||size*.2;
      const baseline=r.top-box.top+(r.height-ascent-descent)/2+ascent;
      ctx.fillText(letter,r.left-box.left,baseline);
    }
  }
  const head=element.querySelector('.running-head');if(head){const h=head.getBoundingClientRect();ctx.fillStyle='#95774660';ctx.fillRect(h.left-box.left,h.bottom-box.top-1,h.width,1);}
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}

export class PhysicalPageTurn {
  constructor(spread){this.spread=spread;this.running=false;this.cancelCurrent=null;}
  cancel(){this.cancelCurrent?.();}
  async turn({direction,front,back,leftUnder,rightUnder,single=false,duration=3.1}){
    if(this.running)return false;this.running=true;
    const left=this.spread.querySelector('#left-page').getBoundingClientRect(),right=this.spread.querySelector('#right-page').getBoundingClientRect(),box=this.spread.getBoundingClientRect();
    const width=single?left.width:left.width+right.width,height=Math.max(left.height,single?0:right.height),paperWidth=single?width:width/2,ratio=height/paperWidth;
    const canvas=document.createElement('canvas');canvas.className='physical-page';canvas.setAttribute('aria-hidden','true');
    Object.assign(canvas.style,{left:`${left.left-box.left}px`,top:`${left.top-box.top}px`,width:`${width}px`,height:`${height}px`});
    const textures=[front,back,leftUnder,rightUnder].map(el=>el?photographPage(el):null);
    let renderer;
    try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});}catch(e){textures.forEach(t=>t?.dispose());this.running=false;throw e;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(width,height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    const scene=new THREE.Scene(),center=single?.5:0;
    const camera=new THREE.OrthographicCamera(single?0:-1,1,ratio/2,-ratio/2,.01,20);camera.position.set(center,0,8);camera.lookAt(center,0,0);
    // Camera bounds are relative to its center, so a single visible leaf uses
    // symmetric bounds about x=.5; the spine stays at the visible page edge.
    if(single){camera.left=-.5;camera.right=.5;camera.updateProjectionMatrix();}
    scene.add(new THREE.AmbientLight(0xffffff,2));
    const lamp=new THREE.DirectionalLight(0xfff1d9,1.3);lamp.position.set(-1.5,3,5);lamp.castShadow=true;lamp.shadow.mapSize.set(1024,1024);lamp.shadow.camera.left=-2;lamp.shadow.camera.right=2;lamp.shadow.camera.top=2;lamp.shadow.camera.bottom=-2;lamp.shadow.bias=-.001;lamp.shadow.normalBias=.012;scene.add(lamp);
    const materials=[],geometries=[];
    const flat=(map,x)=>{if(!map)return;const g=new THREE.PlaneGeometry(1,ratio),m=new THREE.MeshBasicMaterial({map,toneMapped:false});geometries.push(g);materials.push(m);const mesh=new THREE.Mesh(g,m);mesh.position.set(x,0,0);scene.add(mesh);const shadowMaterial=new THREE.ShadowMaterial({opacity:.23});materials.push(shadowMaterial);const shadow=new THREE.Mesh(g,shadowMaterial);shadow.position.copy(mesh.position);shadow.position.z=.001;shadow.receiveShadow=true;scene.add(shadow);};
    if(single)flat(textures[2],.5);else{flat(textures[2],-.5);flat(textures[3],.5);}
    const simulation=new PaperDynamics({height:ratio,direction,duration}),geometry=new THREE.BufferGeometry(),uv=[],indices=[];
    const c=simulation.columns,r=simulation.rows;
    for(let y=0;y<=r;y++)for(let x=0;x<=c;x++)uv.push(direction>0?x/c:1-x/c,1-y/r);
    for(let y=0;y<r;y++)for(let x=0;x<c;x++){const a=y*(c+1)+x,b=a+1,d=a+c+1,e=d+1;if(direction>0)indices.push(a,d,b,b,d,e);else indices.push(a,b,d,b,e,d);}
    geometry.setIndex(indices);geometry.setAttribute('position',new THREE.BufferAttribute(simulation.positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeVertexNormals();
    const reverse=geometry.clone(),reverseUV=reverse.attributes.uv.array;for(let i=0;i<reverseUV.length;i+=2)reverseUV[i]=1-reverseUV[i];reverse.attributes.uv.needsUpdate=true;
    geometries.push(geometry,reverse);
    for(const [g,map,side]of[[geometry,textures[0],THREE.FrontSide],[reverse,textures[1],THREE.BackSide]]){
      const material=new THREE.MeshStandardMaterial({map,roughness:.92,side,color:0xffffff});materials.push(material);const sheet=new THREE.Mesh(g,material);sheet.castShadow=true;sheet.receiveShadow=true;
      if(single&&direction<0)sheet.position.x=1;scene.add(sheet);
    }
    this.spread.append(canvas);this.spread.classList.add('physical-turn-active');this.spread.setAttribute('aria-busy','true');
    return new Promise(resolve=>{
      let frame,previous=performance.now(),accumulator=0,ended=false;
      const finish=success=>{if(ended)return;ended=true;cancelAnimationFrame(frame);canvas.remove();this.spread.classList.remove('physical-turn-active');this.spread.removeAttribute('aria-busy');delete this.spread.dataset.turnProgress;renderer.dispose();renderer.forceContextLoss();textures.forEach(t=>t?.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());this.running=false;this.cancelCurrent=null;resolve(success);};
      this.cancelCurrent=()=>finish(false);
      const tick=now=>{
        if(document.hidden){previous=now;frame=requestAnimationFrame(tick);return;}
        accumulator+=Math.min((now-previous)/1000,.055);previous=now;
        while(accumulator>=1/120){simulation.step(1/120);accumulator-=1/120;}
        geometry.attributes.position.needsUpdate=true;geometry.computeVertexNormals();reverse.attributes.position.array.set(simulation.positions);reverse.attributes.position.needsUpdate=true;reverse.computeVertexNormals();
        this.spread.dataset.turnProgress=(Math.min(simulation.elapsed/duration,1)).toFixed(2);renderer.render(scene,camera);
        if(simulation.done)finish(true);else frame=requestAnimationFrame(tick);
      };frame=requestAnimationFrame(tick);
    });
  }
}
