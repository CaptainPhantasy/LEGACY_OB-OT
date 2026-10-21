import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { ShopSound } from './sound.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const key='sundays-bookshop-v1';
let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
let canSave=true;
const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved));}catch{canSave=false;}};
const announce=t=>{$('#announcement').textContent=t;};
let gentle=saved.gentle??matchMedia('(prefers-reduced-motion: reduce)').matches;
let bright=!!saved.bright, simple=false, place='entrance', busy=false, hasOpened=!!saved.opened;
let scene,renderer,camera,room,dust,stars,hinge,hingeStart,mixer,openAction,magicLight,burst;
const burstVelocities=[];
let revealAt=0,renderReady=false,move=null,lastFrame=performance.now(),time=0,dragging=false,dragX=0,lookOffset=0,openingToken=0,pointerTravel=0;
let pose=new THREE.Vector3(0,1.6,6.6),focus=new THREE.Vector3(0,1.25,-5.4);
const audio=new ShopSound();
const poses={entrance:[[0,1.6,6.6],[0,1.25,-5.4]],aisle:[[0,1.6,1.6],[0,1.3,-5.1]],table:[[.35,1.82,-3.48],[0,1.06,-4.92]],shelves:[[.55,1.55,.6],[2.01,1.18,-.82]],chair:[[-.55,1.5,1],[-2.17,1,-.1]],leave:[[0,1.6,6.6],[0,1.35,-3]]};
const spots={shelves:new THREE.Vector3(1.7,1.4,-.82),table:new THREE.Vector3(0,1.14,-4.92),chair:new THREE.Vector3(-1.7,1.3,-.1)};
const warmLights=[];

function applyComfort(){
  document.body.classList.toggle('gentle',gentle);$('#motion-setting').checked=gentle;$('#brightness-setting').checked=bright;
  if(renderer)renderer.toneMappingExposure=bright?1.8:.94;
  saved.gentle=gentle;saved.bright=bright;persist();
}
applyComfort();
$('#resume').hidden=!hasOpened;
$('#note').value=saved.note||'';
$('#music-box').onclick=async()=>{await toggleSound(true);[659.25,783.99,987.77,783.99].forEach((f,i)=>audio.tone(f,1.8,.09,i*.65));$('#music-box-status').textContent='Four notes. Then the room is quiet again.';};
$('#note').addEventListener('input',()=>{saved.note=$('#note').value;persist();$('#note-status').textContent=canSave?'Kept here, in this browser on this device.':'This browser cannot save your note. Copy it before leaving.';});

function radialTexture(){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d'),g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,244,211,1)');g.addColorStop(.1,'rgba(255,228,171,.8)');g.addColorStop(.45,'rgba(242,195,116,.15)');g.addColorStop(1,'rgba(232,180,92,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
function makeDust(){
  const g=new THREE.BufferGeometry(),n=780,p=new Float32Array(n*3);for(let i=0;i<n;i++){p[i*3]=(Math.random()-.5)*7;p[i*3+1]=Math.random()*4;p[i*3+2]=Math.random()*15-8;}
  g.setAttribute('position',new THREE.BufferAttribute(p,3));dust=new THREE.Points(g,new THREE.PointsMaterial({size:.027,map:radialTexture(),transparent:true,opacity:.34,depthWrite:false,color:0xcdb38b,blending:THREE.AdditiveBlending}));scene.add(dust);
  const sg=new THREE.BufferGeometry(),sp=new Float32Array(1200*3);for(let i=0;i<1200;i++){sp[i*3]=(Math.random()-.5)*24;sp[i*3+1]=Math.random()*11+.8;sp[i*3+2]=Math.random()*25-20;}
  sg.setAttribute('position',new THREE.BufferAttribute(sp,3));stars=new THREE.Points(sg,new THREE.PointsMaterial({size:.03,map:radialTexture(),transparent:true,opacity:0,depthWrite:false,color:0xfce2a0,blending:THREE.AdditiveBlending}));scene.add(stars);
  const bg=new THREE.BufferGeometry(),bp=new Float32Array(420*3);for(let i=0;i<420;i++){burstVelocities.push([(Math.random()-.5)*1.2,.2+Math.random()*.8,(Math.random()-.5)*1.2]);}bg.setAttribute('position',new THREE.BufferAttribute(bp,3));burst=new THREE.Points(bg,new THREE.PointsMaterial({size:.035,map:radialTexture(),transparent:true,opacity:0,depthWrite:false,color:0xf9d8a0,blending:THREE.AdditiveBlending}));scene.add(burst);
}
function surfaceTexture(wood=false){
  const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d'),im=ctx.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4,n=Math.random()*34;const k=wood?120+22*Math.sin(x*.4+Math.sin(y*.035)*2)+12*Math.sin(x*1.2+y*.012)+n:95+Math.random()*100;im.data[i]=im.data[i+1]=im.data[i+2]=k;im.data[i+3]=255;}
  ctx.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(wood?2:4,wood?1:4);return t;
}
function lamp(x,y,z,intensity=30){const l=new THREE.PointLight(0xffd3a0,intensity,8,2);l.position.set(x,y,z);scene.add(l);warmLights.push({light:l,power:intensity});return l;}
async function initScene(){
  try{
    renderer=new THREE.WebGLRenderer({canvas:$('#world'),antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    scene=new THREE.Scene();scene.background=new THREE.Color(0x17120e);scene.fog=new THREE.FogExp2(0x18120d,.035);
    camera=new THREE.PerspectiveCamera(innerWidth<600?58:52,innerWidth/innerHeight,.04,60);
    scene.add(new THREE.HemisphereLight(0x9aa39a,0x241a13,.2));scene.add(new THREE.AmbientLight(0xaaa08c,.055));
    lamp(-1.55,2.402,4.47,24);lamp(1.46,2.485,-.63,20);lamp(-1.3,2.403,-6.65,12);lamp(-.86,1.31,-5.66,10);
    const top=new THREE.SpotLight(0xffd8a7,15,7,.9,.8,1.5);top.position.set(-1.3,2.4,-6.65);top.target.position.set(0,0,-5);top.castShadow=true;top.shadow.mapSize.set(1024,1024);top.shadow.bias=-.0005;scene.add(top,top.target);
    magicLight=new THREE.PointLight(0xffd893,0,12,1.5);magicLight.position.set(0,1.45,-5);scene.add(magicLight);makeDust();applyComfort();
    const gltf=await new GLTFLoader().loadAsync('./assets/bookstore.glb');room=gltf.scene;scene.add(room);
    const woodGrain=surfaceTexture(true),leatherGrain=surfaceTexture(false);
    room.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m.metalness>.8)m.metalness=.65;if(/walnut|joinery/i.test(m.name)){m.bumpMap=woodGrain;m.bumpScale=.018;m.roughness=.8;}if(/leather|cloth|plaster/i.test(m.name)){m.bumpMap=leatherGrain;m.bumpScale=.009;m.roughness=.92;}}}}});
    hinge=room.getObjectByName('BookCoverHinge');if(hinge)hingeStart=hinge.quaternion.clone();
    if(gltf.animations.length){mixer=new THREE.AnimationMixer(room);const clip=gltf.animations.find(a=>/open/i.test(a.name))||gltf.animations[0];openAction=mixer.clipAction(clip);openAction.setLoop(THREE.LoopOnce,1);openAction.clampWhenFinished=true;}
    renderReady=true;document.body.classList.add('scene-ready');$('#load-note').textContent='Take your time. The shelves don’t mind.';$('#load-note').classList.add('ready');
    const hint=room.getObjectByName('BookCoverHinge');if(hint){hint.userData.interactive='book';}
    requestAnimationFrame(frame);
  }catch(e){console.error('The 3D shop could not load.',e);useSimpleView('The moving room could not load. You can still explore every place below.');}
}

function useSimpleView(message='A still room, with all the same choices.'){
  simple=true;document.body.classList.add('simple-mode','scene-ready');if(!$('.fallback-scene')){const el=document.createElement('div');el.className='fallback-scene';document.body.prepend(el);}
  $('#load-note').textContent=message;$('#simple-view').textContent='Simple shop view is on';$('#settings-panel').hidden=true;$('#settings-toggle').setAttribute('aria-expanded','false');
  if(place!=='entrance')$('#waypoints').hidden=false;announce(message);
}
$('#simple-view').onclick=()=>useSimpleView();
function frame(now){
  const dt=Math.min((now-lastFrame)/1000,.06);lastFrame=now;time+=dt;
  if(!document.hidden&&!simple){
    if(move){const p=Math.min((now-move.start)/move.duration,1),t=p*p*(3-2*p);pose.lerpVectors(move.from,move.to,t);focus.lerpVectors(move.lookFrom,move.lookTo,t);if(p===1){move=null;busy=false;}}
    camera.position.copy(pose);const target=focus.clone();target.x+=lookOffset;camera.lookAt(target);
    if(!gentle){dust.rotation.y=Math.sin(time*.022)*.025;dust.position.y=Math.sin(time*.12)*.055;warmLights.forEach((l,i)=>l.light.intensity=l.power*(1+.016*Math.sin(time*1.7+i)));}
    if(mixer)mixer.update(dt);
    if(revealAt){const elapsed=(now-revealAt)/1000;const wave=Math.max(0,Math.sin(Math.min(elapsed/6,1)*Math.PI));magicLight.intensity=gentle?3:wave*160;stars.material.opacity=gentle?0:Math.min(elapsed/7,.7);if(!gentle)stars.rotation.y+=dt*.004;
      if(burst&&!gentle){const t=Math.max(0,elapsed-.45),p=burst.geometry.attributes.position.array;burst.material.opacity=t<7?Math.max(0,.8-t*.1):0;burstVelocities.forEach((v,i)=>{p[i*3]=v[0]*(1-Math.exp(-t*.6))+.08*Math.sin(t+i);p[i*3+1]=1.13+v[1]*t*.6-t*t*.025;p[i*3+2]=-4.92+v[2]*(1-Math.exp(-t*.6));});burst.geometry.attributes.position.needsUpdate=true;}
      if(hinge&&!openAction){const angle=Math.min(elapsed/3,1)*2.75;hinge.quaternion.copy(hingeStart).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle));}
    }
    renderer.render(scene,camera);updateWaypoints();
  }
  requestAnimationFrame(frame);
}
function updateWaypoints(){if($('#waypoints').hidden)return;for(const b of $$('.waypoint')){const v=spots[b.dataset.place].clone().project(camera);b.style.left=`${(v.x*.5+.5)*innerWidth}px`;b.style.top=`${(-v.y*.5+.5)*innerHeight}px`;b.style.opacity=(v.z<1&&Math.abs(v.x)<.95&&Math.abs(v.y)<.9)?'1':'0';b.style.pointerEvents=b.style.opacity==='0'?'none':'auto';}}
function glide(name){const pair=poses[name]||poses.aisle;lookOffset=0;if(gentle||simple||!renderReady){pose.fromArray(pair[0]);focus.fromArray(pair[1]);busy=false;return;}busy=true;move={from:pose.clone(),to:new THREE.Vector3(...pair[0]),lookFrom:focus.clone(),lookTo:new THREE.Vector3(...pair[1]),start:performance.now(),duration:name==='table'?3200:2600};audio.footsteps();}
function closePanels(){for(const id of ['explore-menu','settings-panel','shelf-panel','chair-panel','leave-panel'])$('#'+id).hidden=true;$('#explore-toggle').setAttribute('aria-expanded','false');$('#settings-toggle').setAttribute('aria-expanded','false');}
function setCaption(label,title,description,buttons=[]){$('#place-label').textContent=label;$('#place-title').textContent=title;$('#place-description').textContent=description;$('#place-actions').replaceChildren();for(const b of buttons){const el=document.createElement('button');el.className=b.primary?'brass-button':'quiet-button';el.textContent=b.label;el.onclick=()=>b.action();$('#place-actions').append(el);}$('#scene-caption').hidden=false;}
function go(name){
  openingToken++;$('#opening-caption').hidden=true;$('#revelation').classList.remove('active');
  if(revealAt&&!$('#book-reader').open){revealAt=0;if(magicLight)magicLight.intensity=0;if(burst)burst.material.opacity=0;if(hinge&&hingeStart)hinge.quaternion.copy(hingeStart);}
  if($('#book-reader').open)closeBook();closePanels();place=name;$('#intro').hidden=name!=='entrance';$('#waypoints').hidden=name!=='aisle';$('#scene-caption').hidden=true;document.body.classList.toggle('inside',name!=='entrance');
  if(name==='entrance'){document.title='Sunday’s — Old books & odd things';glide(name);return;}
  if(name==='aisle'){glide(name);setCaption('BETWEEN THE SHELVES','Follow your curiosity.','There is no right way to look around.',[{label:'Choose a direction ↗',action:()=>togglePanel('explore-menu','explore-toggle')}]);}
  if(name==='table'){glide(name);setCaption('THE BACK TABLE',hasOpened?'An old friend, now.':'Someone left a book here.',hasOpened?'The cover has settled. Your place is still waiting.':'Brown leather. Worn corners. No price tag. It looks as though it has been here a very long time.',[{label:hasOpened?'Open to your bookmark →':'Open the book →',primary:true,action:openBook},{label:'Keep looking',action:()=>go('aisle')}]);}
  if(name==='shelves'){glide(name);$('#shelf-panel').hidden=false;announce('Among the shelves. Four doors into the wider internet.');}
  if(name==='chair'){glide(name);$('#chair-panel').hidden=false;announce('A cabinet of oddities. Wind a little music box, or leave yourself a note on a blank postcard.');}
  if(name==='leave'){glide(name);audio.bell();$('#leave-panel').hidden=false;announce('You have left the shop. Your place is kept here.');}
  if(simple&&['aisle','table'].includes(name))$('#waypoints').hidden=name!=='aisle';
}
$('#enter').onclick=async()=>{await toggleSound(true);audio.bell();go('aisle');};$('#enter-quietly').onclick=async()=>{await toggleSound(false);go('aisle');};$('#home').onclick=()=>go('entrance');$('#return-shop').onclick=()=>go('aisle');$('#resume').onclick=()=>{go('table');openBook(true);};
$$('[data-go]').forEach(el=>el.onclick=()=>go(el.dataset.go));$$('.waypoint').forEach(el=>el.onclick=()=>go(el.dataset.place));
$$('[data-close]').forEach(el=>el.onclick=()=>{go('aisle');$('#explore-toggle').focus();});
function togglePanel(id,button){const next=$('#'+id).hidden;closePanels();$('#'+id).hidden=!next;$('#'+button).setAttribute('aria-expanded',String(next));}
$('#explore-toggle').onclick=()=>togglePanel('explore-menu','explore-toggle');$('#settings-toggle').onclick=()=>togglePanel('settings-panel','settings-toggle');
async function toggleSound(value){try{await audio.setEnabled(value);$('#sound-toggle').setAttribute('aria-pressed',String(value));$('#sound-toggle span').textContent=value?'Sound on':'Sound off';$('#sound-setting').checked=value;announce(value?'Shop sounds are on.':'Shop sounds are off.');}catch{announce('Sound could not start. The whole shop is still available without it.');}}
$('#sound-toggle').onclick=()=>toggleSound(!audio.enabled);$('#sound-setting').onchange=e=>toggleSound(e.target.checked);
$('#motion-setting').onchange=e=>{gentle=e.target.checked;applyComfort();if(move){pose.copy(move.to);focus.copy(move.lookTo);move=null;busy=false;}};
$('#brightness-setting').onchange=e=>{bright=e.target.checked;applyComfort();};
$('#world').addEventListener('pointerdown',e=>{if(busy||$('#book-reader').open)return;dragging=true;dragX=e.clientX;pointerTravel=0;$('#world').setPointerCapture(e.pointerId);});
$('#world').addEventListener('pointermove',e=>{if(dragging){pointerTravel+=Math.abs(e.clientX-dragX);lookOffset=THREE.MathUtils.clamp(lookOffset+(e.clientX-dragX)*.006,-1.7,1.7);dragX=e.clientX;}});
$('#world').addEventListener('pointerup',e=>{if(!dragging)return;dragging=false;if(pointerTravel>7||!room||!hinge||busy)return;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);if(ray.intersectObject(hinge,true).length){if(place==='table')openBook();else go('table');}});
$('#world').addEventListener('webglcontextlost',e=>{e.preventDefault();useSimpleView('The moving room paused. The simple shop keeps every place available.');});
addEventListener('resize',()=>{if(renderer){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.fov=innerWidth<600?58:52;camera.updateProjectionMatrix();}renderPages();});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#book-reader').open){closePanels();if(place!=='entrance')go('aisle');}if($('#book-reader').open&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){if(e.key==='ArrowRight'){e.preventDefault();turnPage(1);}if(e.key==='ArrowLeft'){e.preventDefault();turnPage(-1);}}});

const escapeHTML=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function inline(s){return escapeHTML(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');}
let sections=[],pages=[],pageIndex=Math.max(0,Number(saved.page)||0),plain=false,oathText='';
function markdown(raw){return raw.replace(/^---\s*$/gm,'').split(/\n\s*\n/).map(block=>{const s=block.trim();if(!s||s==='---')return '';const h=s.match(/^(#{1,3})\s+(.+)$/);if(h)return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;return `<p>${inline(s.replace(/\n/g,' ').replace(/^\*(?!\*)/,''))}</p>`;}).join('');}
const contentReady=fetch('./content/oath.txt').then(r=>{if(!r.ok)throw Error('The book text did not arrive.');return r.text();}).then(raw=>{
  oathText=raw;
  const blocks=raw.split(/\n(?=#{2,3} )/);const first=blocks.shift();
  const lines=first.split('\n');const title=lines.shift().replace(/^# /,'');const dedication=lines.join('\n').replace(/^\s*\*/,'').replace(/\n---\s*$/,'').trim();
  pages=[{title,body:dedication,titlePage:true}];
  let sectionHeader='';for(const block of blocks){const ls=block.trim().split('\n'),heading=ls.shift().replace(/^#{2,3} /,'');const body=ls.join('\n').replace(/\n---\s*$/,'').trim();if(!body){sectionHeader=heading;continue;}pages.push({title:heading,body,sectionHeader});sectionHeader='';}
  if(pages.length%2)pages.push({title:'There is room for what comes next.',body:'The first entry ends here.\n\nYou can return to any promise, keep a copy, or close the book and take your time.',endPage:true});
  pageIndex=Math.min(pageIndex,pages.length-1);$('#plain-reading').innerHTML=markdown(raw);
  $('#contents').replaceChildren();pages.forEach((p,i)=>{if(p.endPage)return;const b=document.createElement('button');b.textContent=p.title;b.onclick=()=>{pageIndex=i;plain=false;$('#plain-reading').hidden=true;$('#spread').hidden=false;$('.reader-bottom').hidden=false;$('#contents').hidden=true;$('#contents-toggle').setAttribute('aria-expanded','false');$('#reading-mode').textContent='Plain reading';renderPages();$('#book-reader').scrollTo({top:0,behavior:gentle?'instant':'smooth'});};$('#contents').append(b);});
  renderPages();
}).catch(e=>{console.error(e);$('#left-page').innerHTML='<p class="reader-error">The text could not load. You can <a href="./content/oath.txt">open the original entry here</a>, or close the book and try again.</p>';});
function pageHTML(p,i){return `<div class="running-head"><span>${p.titlePage?'ENTRY I':'WHAT SOFTWARE OWES YOU'}</span><span>${p.endPage?'':'LEGACY AI'}</span></div>${p.titlePage?'<div class="title-ornament" aria-hidden="true">✧</div>':''}${p.sectionHeader?`<p class="section-heading">${inline(p.sectionHeader)}</p>`:''}<h3>${inline(p.titlePage?p.title.split(' or,')[0]:p.title)}</h3>${p.titlePage?'<p class="dedication">or, Douglas’s Oath To This Work</p>':''}${markdown(p.body)}<div class="page-number">${i+1}</div>`;}
function renderPages(){
  if(!pages.length)return;const one=innerWidth<=600;
  if(!one)pageIndex=Math.floor(pageIndex/2)*2;
  pageIndex=THREE.MathUtils.clamp(pageIndex,0,pages.length-1);
  const left=pages[pageIndex],right=pages[pageIndex+1];$('#left-page').innerHTML=pageHTML(left,pageIndex);$('#left-page').classList.toggle('title-page',!!left.titlePage);
  if(right){$('#right-page').innerHTML=pageHTML(right,pageIndex+1);$('#right-page').classList.toggle('title-page',!!right.titlePage);}
  $('#page-status').textContent=one?`PAGE ${pageIndex+1} OF ${pages.length}`:`PAGES ${pageIndex+1}–${Math.min(pageIndex+2,pages.length)} OF ${pages.length}`;
  $('#prev-page').disabled=pageIndex===0;$('#next-page').disabled=pageIndex+(one?1:2)>=pages.length;
  saved.page=pageIndex;persist();$('#bookmark-status').textContent=canSave?'Your place is kept in this browser.':'This browser cannot keep your place between visits.';
}
function turnPage(direction){if(plain)return;const step=innerWidth<=600?1:2;const next=pageIndex+direction*step;if(next<0||next>=pages.length)return;pageIndex=next;audio.page();renderPages();$('#spread').classList.remove('turning');void $('#spread').offsetWidth;$('#spread').classList.add('turning');}
async function openBook(resume=false){
  const token=++openingToken;
  if(busy&&!resume){move=null;pose.fromArray(poses.table[0]);focus.fromArray(poses.table[1]);busy=false;}
  $('#waypoints').hidden=true;$('#scene-caption').hidden=true;closePanels();hasOpened=true;saved.opened=true;persist();$('#resume').hidden=false;
  document.title='The Book of Immutable Truths — Legacy AI Solutions';
  if(!resume){audio.open();revealAt=performance.now();if(openAction){openAction.reset().play();}if(!gentle){$('#revelation').classList.remove('active');void $('#revelation').offsetWidth;$('#revelation').classList.add('active');}$('#opening-caption').hidden=false;announce('You lift the cover. Leather creaks. Dust rises. Light blooms from the pages in a room without windows.');await new Promise(r=>setTimeout(r,gentle?800:6400));}
  await contentReady;if(token!==openingToken)return;$('#opening-caption').hidden=true;$('#book-reader').showModal();document.body.classList.add('reading');renderPages();$('#close-book').focus();
}
function closeBook(){
  $('#book-reader').close();document.body.classList.remove('reading');audio.page();$('#footer-note').textContent='YOUR PLACE IS KEPT. THE REST OF THE AFTERNOON IS YOURS.';
  if(openAction)openAction.stop();if(hinge&&hingeStart)hinge.quaternion.copy(hingeStart);revealAt=0;if(magicLight)magicLight.intensity=0;if(burst)burst.material.opacity=0;
  place='table';setCaption('THE BACK TABLE','An old friend, now.','The cover has settled. Your place is still waiting.',[{label:'Open to your bookmark →',primary:true,action:()=>openBook(true)},{label:'Keep looking',action:()=>go('aisle')}]);$('#place-actions button').focus();
}
$('#close-book').onclick=closeBook;$('#book-reader').addEventListener('cancel',e=>{e.preventDefault();closeBook();});
$('#next-page').onclick=()=>turnPage(1);$('#prev-page').onclick=()=>turnPage(-1);
$('#reading-mode').onclick=()=>{plain=!plain;$('#plain-reading').hidden=!plain;$('#spread').hidden=plain;$('.reader-bottom').hidden=plain;$('#reading-mode').textContent=plain?'Return to the pages':'Plain reading';};
$('#contents-toggle').onclick=()=>{const next=$('#contents').hidden;$('#contents').hidden=!next;$('#contents-toggle').setAttribute('aria-expanded',String(next));if(next)$('#contents').scrollIntoView({behavior:gentle?'instant':'smooth',block:'start'});};

initScene();
