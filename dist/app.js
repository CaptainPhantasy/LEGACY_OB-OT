import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { ShopSound } from './sound.js';
import { PhysicalPageTurn } from './page-physics.js';
import { RoomAtmosphere } from './room-atmosphere.js';
import { RoomLook } from './room-look.js';
import { RoomRadiance } from './room-radiance.js';
import { enhanceMaterials } from './room-materials.js?depth=1';
import { applyRoomLightmap, updateRoomRevelation } from './room-lightmap.js';
import { curiosities } from './curiosities.js';
import { escapeHTML, inline, markdown, loadBook } from './book-content.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const key='legacy-bookshop-v1';
let saved={};try{saved=JSON.parse(localStorage.getItem(key)||localStorage.getItem('sundays-bookshop-v1')||'{}');}catch{}
let canSave=true;
const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved));}catch{canSave=false;}};
const announce=t=>{$('#announcement').textContent=t;};
let gentle=saved.gentle??matchMedia('(prefers-reduced-motion: reduce)').matches;
let bright=!!saved.bright, simple=false, place='entrance', busy=false, hasOpened=!!saved.opened;
let scene,renderer,camera,room,hinge,hingeStart,mixer,openAction,magicLight,atmosphere,radiance;
let revealAt=0,renderReady=false,move=null,closing=null,lastFrame=performance.now(),time=0,dragging=false,dragPointer=null,dragX=0,dragY=0,openingToken=0,pointerTravel=0;
let pose=new THREE.Vector3(0,1.6,6.6),focus=new THREE.Vector3(0,1.25,-5.4);
const roomLook=new RoomLook(),lookTarget=new THREE.Vector3();
const audio=new ShopSound();
const listenerDirection=new THREE.Vector3();
let soundCaptions=!!saved.soundCaptions,captionTimer;
$('#captions-setting').checked=soundCaptions;
$('#captions-setting').onchange=e=>{soundCaptions=e.target.checked;saved.soundCaptions=soundCaptions;persist();$('#sound-caption').hidden=!soundCaptions;$('#sound-caption').textContent=soundCaptions?'Sounds will be described here when they happen.':'';};
document.addEventListener('shop-sound',e=>{const name=e.detail.name;const words={steps:'Your footsteps on the worn boards.',page:'A dry leaf of paper turns.',leather:'The old leather creaks.',bus:'A city bus sounds far away, above the cellar.'};const el=$('#book-reader').open?$('#reader-sound-caption'):$('#sound-caption');el.dataset.lastSound=name;el.dataset.soundTime=String(Date.now());if(!soundCaptions)return;clearTimeout(captionTimer);el.textContent=words[name]||'';el.hidden=false;captionTimer=setTimeout(()=>el.hidden=true,name==='bus'?6000:3500);});
const poses={entrance:[[0,1.6,6.6],[0,1.25,-5.4]],aisle:[[0,1.6,1.6],[0,1.3,-5.1]],table:[[.35,1.82,-3.48],[0,1.06,-4.92]],shelves:[[.55,1.55,.6],[2.01,1.18,-.82]],chair:[[-.55,1.5,1],[-2.17,1,-.1]],leave:[[0,1.6,6.6],[0,1.35,-3]]};
const spots={table:new THREE.Vector3(0,1.14,-4.92)};
for(const c of curiosities){poses[c.id]=c.pose;spots[c.id]=new THREE.Vector3(...c.position);}
let currentCuriosity='maps';
let frameCost=0,frameSamples=0,qualitySettled=false;

for(const c of [...curiosities,{id:'table',name:'Farther into the back',mark:'·'}]){
  const b=document.createElement('button');b.className='waypoint';b.dataset.place=c.id;
  b.innerHTML=`<span class="point" aria-hidden="true"></span><span>${escapeHTML(c.name)}</span>`;
  $('#waypoints').append(b);
}
for(const c of curiosities){const b=document.createElement('button');b.dataset.go=c.id;b.innerHTML=`<span aria-hidden="true">${c.mark}</span>${escapeHTML(c.name)}<b aria-hidden="true">↗</b>`;$('#curiosity-menu').append(b);}
function showCuriosity(id){
  const c=curiosities.find(c=>c.id===id);if(!c)return;currentCuriosity=id;
  glide(id);$('#curiosity-eyebrow').textContent=c.eyebrow;$('#curiosity-mark').textContent=c.mark;$('#shelf-title').textContent=c.title;$('#curiosity-description').textContent=c.description;
  $('#curiosity-links').replaceChildren();
  for(const [title,description,url] of c.links){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.innerHTML=`<span class="shelf-number" aria-hidden="true">${c.mark}</span><span>${escapeHTML(title)}<small>${escapeHTML(description)}</small></span><span aria-hidden="true">↗</span>`;$('#curiosity-links').append(a);}
  $('#shelf-panel').hidden=false;$('#shelf-panel').scrollTop=0;announce(`${c.name}. Three paths into the wider internet. Each opens a new tab.`);
}
function rummage(){const others=curiosities.filter(c=>c.id!==currentCuriosity);go(others[Math.floor(Math.random()*others.length)].id);$('#rummage').focus();}
$('#rummage').onclick=rummage;

function applyComfort(){
  document.body.classList.toggle('gentle',gentle);$('#motion-setting').checked=gentle;$('#reader-motion').textContent=gentle?'Allow slow page turns':'Keep the pages still';$('#brightness-setting').checked=bright;
  if(renderer)renderer.toneMappingExposure=bright?1.75:1.12;
  saved.gentle=gentle;saved.bright=bright;persist();
}
applyComfort();
$('#resume').hidden=!hasOpened;
$('#note').value=saved.note||'';
$('#music-box').onclick=async()=>{await toggleSound(true);[659.25,783.99,987.77,783.99].forEach((f,i)=>audio.tone(f,1.8,.09,i*.65));$('#music-box-status').textContent='Four notes. Then the room is quiet again.';};
$('#note').addEventListener('input',()=>{saved.note=$('#note').value;persist();$('#note-status').textContent=canSave?'Kept here, in this browser on this device.':'This browser cannot save your note. Copy it before leaving.';});

async function initScene(){
  try{
    renderer=new THREE.WebGLRenderer({canvas:$('#world'),antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer: coarse)').matches?1.5:1.85));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
    scene=new THREE.Scene();scene.background=new THREE.Color(0x17120e);scene.fog=new THREE.FogExp2(0x24201a,.024);
    camera=new THREE.PerspectiveCamera(innerWidth<600?58:52,innerWidth/innerHeight,.04,60);
    radiance=new RoomRadiance(scene,renderer);
    magicLight=new THREE.PointLight(0xffd893,0,12,1.5);magicLight.position.set(0,1.45,-5);scene.add(magicLight);atmosphere=new RoomAtmosphere(scene);applyComfort();
    $('#load-note').textContent='The lamps are warming. The room is coming into view…';
    const gltf=await new GLTFLoader().loadAsync('./assets/bookstore-depth.glb');room=gltf.scene;scene.add(room);
    room.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    await enhanceMaterials(room,renderer);
    try{await applyRoomLightmap(room,renderer);}catch(error){console.warn('Baked room lighting unavailable; live lighting remains active.',error);}
    room.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.every(m=>m.emissiveIntensity>0&&m.emissive?.getHex()>0))o.castShadow=false;});
    try{radiance.capture(room,atmosphere);}catch(error){console.warn('Room reflections unavailable; direct lighting remains active.',error);}
    renderer.shadowMap.needsUpdate=true;
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
  if(place!=='entrance')$('#waypoints').hidden=false;$$('.waypoint').forEach(b=>b.tabIndex=0);announce(message);
}
$('#simple-view').onclick=()=>{audio.stopFootsteps();if(move){pose.copy(move.to);focus.copy(move.lookTo);move.onArrive?.(true);}move=null;busy=false;useSimpleView();};
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{announce('This browser keeps the room in its window. You can still explore every part of it.');}};
addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Return to the window ↙':'Fill the screen with the room ↗';});
addEventListener('visibilitychange',()=>{if(document.hidden&&move){move.hiddenAt=performance.now();}else if(move?.hiddenAt){move.start+=performance.now()-move.hiddenAt;delete move.hiddenAt;}});
function frame(now){
  const elapsedFrame=now-lastFrame,dt=Math.min(elapsedFrame/1000,.05);lastFrame=now;time+=dt;
  if(!document.hidden&&!simple){
    let bob=0,sway=0;
    if(move){
      const p=Math.min((now-move.start)/move.duration,1),t=p*p*(3-2*p);
      pose.lerpVectors(move.from,move.to,t);focus.lerpVectors(move.lookFrom,move.lookTo,t);
      const distance=move.distance*t,stepIndex=Math.floor(distance/.62),envelope=Math.sin(Math.PI*p);
      bob=-Math.abs(Math.sin(distance/.62*Math.PI))*.025*envelope;sway=Math.sin(distance/.62*Math.PI)*.012*envelope;
      if(stepIndex>move.lastStep){audio.step(stepIndex);move.lastStep=stepIndex;}
      if(p===1){const arrival=move.onArrive;move=null;busy=false;audio.stopFootsteps();arrival?.(true);}
    }
    camera.position.copy(pose);if(!gentle){camera.position.y+=bob;camera.position.x+=sway;}
    camera.lookAt(roomLook.target(camera.position,focus,lookTarget));
    audio.setPosition(camera.position,camera.getWorldDirection(listenerDirection));
    atmosphere.update(dt,time,camera.position,gentle);
    radiance.update(time,gentle,!!closing||!!(revealAt&&now-revealAt<5000));
    if(mixer)mixer.update(dt);
    if(closing&&hinge){const progress=Math.min((now-closing.start)/2200,1),eased=progress*progress*(3-2*progress);hinge.quaternion.slerpQuaternions(closing.from,hingeStart,eased);if(progress===1)closing=null;}
    if(revealAt){const elapsed=(now-revealAt)/1000,wave=Math.max(0,Math.sin(Math.min(elapsed/8,1)*Math.PI));magicLight.intensity=gentle?3:wave*95;
      if(hinge&&!openAction){const p=Math.min(elapsed/4.8,1),angle=p*p*(3-2*p)*2.75;hinge.quaternion.copy(hingeStart).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),angle));}
    }
    updateRoomRevelation(room,magicLight.intensity);
    renderer.render(scene,camera);updateWaypoints();
    // Count whole active frames, including GPU waits, and ignore tab-resume gaps.
    if(!qualitySettled&&time>3&&!move&&elapsedFrame<1000){frameCost+=Math.min(elapsedFrame,100);frameSamples++;
      if(frameSamples===90){qualitySettled=true;if(frameCost/frameSamples>24){renderer.setPixelRatio(Math.min(devicePixelRatio,1.15));renderer.setSize(innerWidth,innerHeight);}}
    }
  }
  requestAnimationFrame(frame);
}
function updateWaypoints(){if($('#waypoints').hidden)return;for(const b of $$('.waypoint')){const v=spots[b.dataset.place].clone().project(camera);const visible=v.z>-1&&v.z<1&&Math.abs(v.x)<.86&&Math.abs(v.y)<.72;b.style.left=`${(v.x*.5+.5)*innerWidth}px`;b.style.top=`${(-v.y*.5+.5)*innerHeight}px`;b.style.opacity=visible?'1':'0';b.style.pointerEvents=visible?'auto':'none';b.tabIndex=visible?0:-1;}}
function glide(name){
  const pair=poses[name]||poses.aisle;roomLook.reset();audio.stopFootsteps();move?.onArrive?.(false);
  if(gentle||simple||!renderReady){pose.fromArray(pair[0]);focus.fromArray(pair[1]);busy=false;move=null;audio.setPosition(pose,focus.clone().sub(pose).normalize());return;}
  const destination=new THREE.Vector3(...pair[0]),distance=pose.distanceTo(destination);
  busy=distance>.1;move={from:pose.clone(),to:destination,lookFrom:focus.clone(),lookTo:new THREE.Vector3(...pair[1]),start:performance.now(),duration:THREE.MathUtils.clamp(distance*930,2100,6800),distance,lastStep:0};
}
function closePanels(){for(const id of ['explore-menu','settings-panel','shelf-panel','chair-panel','leave-panel'])$('#'+id).hidden=true;$('#explore-toggle').setAttribute('aria-expanded','false');$('#settings-toggle').setAttribute('aria-expanded','false');}
function setCaption(label,title,description,buttons=[]){$('#place-label').textContent=label;$('#place-title').textContent=title;$('#place-description').textContent=description;$('#place-actions').replaceChildren();for(const b of buttons){const el=document.createElement('button');el.className=b.primary?'brass-button':'quiet-button';el.textContent=b.label;el.onclick=()=>b.action();$('#place-actions').append(el);}$('#scene-caption').hidden=false;}
function go(name){
  openingToken++;audio.stopActive('book-open');$('#opening-caption').hidden=true;$('#revelation').classList.remove('active');
  if(revealAt&&!$('#book-reader').open){revealAt=0;if(magicLight)magicLight.intensity=0;atmosphere?.close();if(hinge&&hingeStart&&!closing){hinge.quaternion.copy(hingeStart);if(renderer)renderer.shadowMap.needsUpdate=true;}}
  if($('#book-reader').open)closeBook();closePanels();place=name;$('#intro').hidden=name!=='entrance';$('#waypoints').hidden=name!=='aisle';$('#scene-caption').hidden=true;document.body.classList.toggle('inside',name!=='entrance');
  if(name==='entrance'){document.title='Legacy — Old books & odd things';glide(name);return;}
  if(name==='aisle'){glide(name);setCaption('SOMETHING, EVERYWHERE','This way. Or that.','Choose a tag for a closer look. There is no right order.',[{label:'Let something catch my eye ↝',action:rummage},{label:'Look around',action:()=>togglePanel('explore-menu','explore-toggle')}]);}
  if(name==='table'){glide(name);setCaption('UNDER THE DUST',hasOpened?'It remembers where you were.':'No price. No date.',hasOpened?'The old leather settles beneath your hand. Your place is waiting.':'The leather has worn soft around its old repairs. The page edges are dark and uneven. Someone has kept this for a very long time.',[{label:hasOpened?'Open to your bookmark →':'Lift the cover →',primary:true,action:openBook},{label:'Leave it be',action:()=>go('aisle')}]);}
  if(curiosities.some(c=>c.id===name))showCuriosity(name);
  if(name==='shelves')showCuriosity('paper');
  if(name==='chair'){glide(name);$('#chair-panel').hidden=false;announce('A cabinet of oddities. Wind a little music box, or leave yourself a note on a blank postcard.');}
  if(name==='leave'){glide(name);audio.bell();$('#leave-panel').hidden=false;announce('You have left the shop. Your place is kept here.');}
  if(simple&&['aisle','table'].includes(name))$('#waypoints').hidden=name!=='aisle';
}
$('#enter').onclick=async()=>{await toggleSound(true);audio.bell();go('aisle');};$('#enter-quietly').onclick=async()=>{await toggleSound(false);go('aisle');};$('#home').onclick=()=>go('entrance');$('#return-shop').onclick=()=>go('aisle');$('#resume').onclick=()=>{go('table');openBook(true);};
$$('[data-go]').forEach(el=>el.onclick=()=>go(el.dataset.go));$$('.waypoint').forEach(el=>el.onclick=()=>go(el.dataset.place));
$$('[data-close]').forEach(el=>el.onclick=()=>{$('#'+el.dataset.close).hidden=true;$('#waypoints').hidden=false;$('#explore-toggle').focus();});
function togglePanel(id,button){const next=$('#'+id).hidden;closePanels();$('#'+id).hidden=!next;$('#'+button).setAttribute('aria-expanded',String(next));if(next)$('#'+id).scrollTop=0;}
$('#explore-toggle').onclick=()=>togglePanel('explore-menu','explore-toggle');$('#settings-toggle').onclick=()=>togglePanel('settings-panel','settings-toggle');
async function toggleSound(value){
  $('#sound-status').textContent=value?'The room’s sounds are settling in…':'The room is quiet.';
  try{
    const status=await audio.setEnabled(value),on=value&&status.running;
    $('#sound-toggle').setAttribute('aria-pressed',String(on));$('#sound-toggle span').textContent=on?'Sound on':'Sound off';$('#sound-setting').checked=on;$('#reader-sound').setAttribute('aria-pressed',String(on));$('#reader-sound').textContent=on?'Sound on':'Sound off';
    const message=!value?'The room is quiet.':!on?'Sound could not start. Try the sound switch again, or explore quietly.':status.recordedReady?'Paper, leather, footsteps and the distant street are ready.':'Some recorded sounds could not load. The room is still open; switch sound off and on to try again.';
    $('#sound-status').textContent=message;announce(message);
    $('#sound-status').dataset.recordings=status.recordedReady?'ready':'unavailable';
  }catch{const message='Sound could not start. Try the sound switch again, or explore quietly.';$('#sound-status').textContent=message;announce(message);}
}
$('#sound-toggle').onclick=()=>toggleSound(!audio.enabled);$('#reader-sound').onclick=()=>toggleSound(!audio.enabled);$('#sound-setting').onchange=e=>toggleSound(e.target.checked);
function setGentle(value){gentle=value;stopPageTurn();applyComfort();if(move){pose.copy(move.to);focus.copy(move.lookTo);move.onArrive?.(true);move=null;busy=false;audio.stopFootsteps();}}
$('#motion-setting').onchange=e=>setGentle(e.target.checked);$('#reader-motion').onclick=()=>setGentle(!gentle);
$('#brightness-setting').onchange=e=>{bright=e.target.checked;applyComfort();};
$('#world').addEventListener('pointerdown',e=>{if($('#book-reader').open||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;dragging=true;dragPointer=e.pointerId;dragX=e.clientX;dragY=e.clientY;pointerTravel=0;$('#world').focus({preventScroll:true});$('#world').setPointerCapture(e.pointerId);});
$('#world').addEventListener('pointermove',e=>{if(dragging&&e.pointerId===dragPointer){const dx=e.clientX-dragX,dy=e.clientY-dragY;pointerTravel+=Math.abs(dx)+Math.abs(dy);roomLook.turn(dx,dy,pose,focus);dragX=e.clientX;dragY=e.clientY;}});
$('#world').addEventListener('pointerup',e=>{if(!dragging||e.pointerId!==dragPointer)return;dragging=false;dragPointer=null;if(pointerTravel>7||!room||!hinge||busy)return;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);if(ray.intersectObject(hinge,true).length){if(place==='table')openBook();else go('table');}});
const stopLooking=e=>{if(e.pointerId===dragPointer){dragging=false;dragPointer=null;}};
$('#world').addEventListener('pointercancel',stopLooking);
$('#world').addEventListener('lostpointercapture',stopLooking);
$('#world').addEventListener('keydown',e=>{const directions={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};const delta=directions[e.key];if(delta){e.preventDefault();roomLook.turn(...delta,pose,focus);}});
$('#world').addEventListener('webglcontextlost',e=>{e.preventDefault();useSimpleView('The moving room paused. The simple shop keeps every place available.');});
addEventListener('resize',()=>{stopPageTurn();if(renderer){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.fov=innerWidth<600?58:52;camera.updateProjectionMatrix();}renderPages();});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#book-reader').open){const guideOpen=['shelf-panel','chair-panel'].some(id=>!$('#'+id).hidden);closePanels();if(guideOpen)$('#waypoints').hidden=false;$('#explore-toggle').focus();}if($('#book-reader').open&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){if(e.key==='ArrowRight'){e.preventDefault();turnPage(1);}if(e.key==='ArrowLeft'){e.preventDefault();turnPage(-1);}}});

let pages=[],basePages=[],chapters=[],pageIndex=Math.max(0,Number(saved.page)||0),plain=false,contentReady;
const pageTurn=new PhysicalPageTurn($('#spread'));
let turning=false,measuredWidth=0,phoneLayout=null;
function stopPageTurn(){pageTurn.cancel();turning=false;$('#spread').style.minHeight='';}

function jumpToPage(index){stopPageTurn();pageIndex=index;plain=false;$('#plain-reading').hidden=true;$('#spread').hidden=false;$('.reader-bottom').hidden=false;$('#contents').hidden=true;$('#contents-toggle').setAttribute('aria-expanded','false');$('#reading-mode').textContent='Plain reading';renderPages();$('#book-reader').scrollTo({top:0,behavior:gentle?'instant':'smooth'});}
async function readBook(){
  try{
    const book=await loadBook();basePages=book.pages;pages=basePages;chapters=book.chapters;adaptPages();$('#book-load-status').hidden=true;
    const anchor=saved.pageAnchor?pages.findIndex(p=>p.id===saved.pageAnchor):-1;pageIndex=anchor>=0?anchor:Math.min(pageIndex,pages.length-1);
    $('#chapter-select').replaceChildren();for(const c of chapters){const option=document.createElement('option');option.value=c.id;option.textContent=`Chapter ${c.number} · ${c.title}`;$('#chapter-select').append(option);}
    $('#chapter-count').textContent=chapters.length===1?'One chapter. Many pages still unwritten.':`${chapters.length} chapters. Still being written.`;
    fillContents();
    renderPages();return true;
  }catch(e){
    console.error(e);$('#book-load-status').hidden=false;$('#book-load-status').replaceChildren();
    const message=document.createElement('p');message.textContent='The chapter could not be opened. You can retry, read the original text, or close the book and return later.';
    const retry=document.createElement('button');retry.textContent='Try opening the chapter again';retry.className='underlined';retry.onclick=()=>{contentReady=readBook();};
    const original=document.createElement('a');original.href='./content/oath.txt';original.textContent='Read the original first chapter';original.className='underlined';
    $('#book-load-status').append(message,retry,original);return false;
  }
}
contentReady=readBook();
$('#chapter-select').onchange=e=>{const index=pages.findIndex(p=>p.chapterId===e.target.value);if(index>=0)jumpToPage(index);};
function fillContents(){
  $('#contents').replaceChildren();pages.forEach((p,i)=>{if(p.endPage||p.continued)return;const b=document.createElement('button');b.textContent=p.titlePage?`Chapter ${p.chapterNumber} · ${p.title}`:p.title;b.classList.toggle('chapter-heading',!!p.titlePage);b.onclick=()=>jumpToPage(i);$('#contents').append(b);});
}
function adaptPages(){
  const phone=innerWidth<=600;if(phone===phoneLayout||!basePages.length)return;
  const anchor=pages[pageIndex]?.id||saved.pageAnchor;phoneLayout=phone;measuredWidth=0;
  pages=phone?basePages.flatMap(p=>{
    if(p.titlePage||p.endPage||!p.body)return[p];
    const paragraphs=p.body.split(/\n\s*\n/),groups=[];let group=[],words=0;
    for(const paragraph of paragraphs){const count=paragraph.trim().split(/\s+/).length;if(group.length&&words+count>90){groups.push(group.join('\n\n'));group=[];words=0;}group.push(paragraph);words+=count;}
    if(group.length)groups.push(group.join('\n\n'));
    return groups.map((body,i)=>({...p,body,id:i?`${p.id}~${i+1}`:p.id,continued:i>0}));
  }):basePages;
  const found=pages.findIndex(p=>p.id===anchor),parent=pages.findIndex(p=>p.id===anchor?.split('~')[0]);pageIndex=found>=0?found:parent>=0?parent:0;
  fillContents();
}
function pageHTML(p,i){return `<div class="running-head"><span>${p.chapterNumber?`CHAPTER ${p.chapterNumber}`:'THE UNWRITTEN PAGES'}</span><span>${p.endPage?'':escapeHTML(p.chapterTitle)}</span></div>${p.titlePage?'<div class="title-ornament" aria-hidden="true">✧</div>':''}${p.sectionHeader?`<p class="section-heading">${inline(p.sectionHeader)}</p>`:''}<h3>${inline(p.title)}</h3>${p.continued?'<p class="continued">continued from the previous page</p>':''}${p.subtitle?`<p class="dedication">${inline(p.subtitle)}</p>`:''}${markdown(p.body)}<div class="page-number">${i+1}</div>`;}
function sizeLeaves(){
  const source=$('#left-page'),width=source.getBoundingClientRect().width;
  if(!$('#book-reader').open||!width||Math.abs(width-measuredWidth)<1)return;measuredWidth=width;
  let height=innerWidth<=600?460:480;
  const probes=pages.map((p,i)=>{const leaf=source.cloneNode(false);leaf.removeAttribute('id');leaf.className='paper left-paper page-probe'+(p.titlePage?' title-page':'');leaf.setAttribute('aria-hidden','true');leaf.style.width=`${width}px`;leaf.style.height='auto';leaf.innerHTML=pageHTML(p,i);$('#spread').append(leaf);return leaf;});
  for(const leaf of probes)height=Math.max(height,leaf.scrollHeight+18);probes.forEach(p=>p.remove());
  $('#spread').style.setProperty('--leaf-height',`${Math.ceil(height)}px`);
}
function renderPages(){
  if(!pages.length)return;adaptPages();const one=innerWidth<=600;
  if(!one)pageIndex=Math.floor(pageIndex/2)*2;
  pageIndex=THREE.MathUtils.clamp(pageIndex,0,pages.length-1);
  const left=pages[pageIndex],right=pages[pageIndex+1];$('#left-page').innerHTML=pageHTML(left,pageIndex);$('#left-page').classList.toggle('title-page',!!left.titlePage);
  if(right){$('#right-page').innerHTML=pageHTML(right,pageIndex+1);$('#right-page').classList.toggle('title-page',!!right.titlePage);}
  $('#page-status').textContent=one?`PAGE ${pageIndex+1} OF ${pages.length}`:`PAGES ${pageIndex+1}–${Math.min(pageIndex+2,pages.length)} OF ${pages.length}`;
  $('#prev-page').disabled=pageIndex===0;$('#next-page').disabled=pageIndex+(one?1:2)>=pages.length;
  const chapter=chapters.find(c=>c.id===left.chapterId)||chapters.at(-1);
  if(chapter){$('#chapter-select').value=chapter.id;$('#plain-reading').innerHTML=markdown(chapter.raw);$('#chapter-download').href=chapter.url.href;$('#chapter-download').download=`Chapter ${chapter.number} - ${chapter.title}.txt`;}
  sizeLeaves();saved.page=pageIndex;saved.pageAnchor=left.id;persist();$('#bookmark-status').textContent=canSave?'Your place is kept in this browser.':'This browser cannot keep your place between visits.';
}
async function turnPage(direction){
  if(plain||turning)return;const single=innerWidth<=600,step=single?1:2,next=pageIndex+direction*step;
  if(next<0||next>=pages.length)return;
  if(gentle||simple){pageIndex=next;audio.page();renderPages();if(single)$('#spread').scrollIntoView({behavior:'instant',block:'start'});return;}
  turning=true;$('#prev-page').disabled=true;$('#next-page').disabled=true;$('#spread').style.minHeight=`${$('#spread').offsetHeight}px`;
  const probes=[];
  const leaf=index=>{
    const original=$('#left-page'),clone=original.cloneNode(false);clone.removeAttribute('id');clone.setAttribute('aria-hidden','true');clone.classList.add('page-probe');
    clone.classList.toggle('title-page',!!pages[index]?.titlePage);clone.innerHTML=pages[index]?pageHTML(pages[index],index):'';
    const size=original.getBoundingClientRect();clone.style.width=`${size.width}px`;clone.style.height=`${size.height}px`;$('#spread').append(clone);probes.push(clone);return clone;
  };
  let completed=false;
  try{
    const front=single?$('#left-page'):direction>0?$('#right-page'):$('#left-page');
    const back=leaf(single?next:direction>0?next:next+1);
    const leftUnder=single?leaf(next):direction>0?$('#left-page'):leaf(next);
    const rightUnder=single?null:direction>0?leaf(next+1):$('#right-page');
    audio.page({duration:3.1,direction});
    const pending=pageTurn.turn({direction,front,back,leftUnder,rightUnder,single,duration:3.1});
    probes.forEach(p=>p.remove());completed=await pending;
  }catch(e){console.warn('The moving page is unavailable.',e);announce('The page has opened without movement. You can keep reading.');completed=true;}
  finally{probes.forEach(p=>p.remove());turning=false;$('#spread').style.minHeight='';}
  if(completed)pageIndex=next;renderPages();if(completed&&single)$('#spread').scrollIntoView({behavior:gentle?'instant':'smooth',block:'start'});if(completed)announce(`Page ${pageIndex+1}. ${pages[pageIndex].title}`);
}
async function openBook(resume=false){
  const token=++openingToken;
  if(move){announce('You make your way to the back table.');const arrived=await new Promise(resolve=>move.onArrive=resolve);if(!arrived||token!==openingToken)return;}
  closing=null;
  $('#waypoints').hidden=true;$('#scene-caption').hidden=true;closePanels();hasOpened=true;saved.opened=true;persist();$('#resume').hidden=false;
  document.title='The Book of Immutable Truths — Legacy AI Solutions';
  if(!resume){audio.stopFootsteps();audio.open();atmosphere?.open();revealAt=performance.now();if(openAction){openAction.reset().setEffectiveTimeScale(.65).play();}if(!gentle){$('#revelation').classList.remove('active');void $('#revelation').offsetWidth;$('#revelation').classList.add('active');}$('#opening-caption').hidden=false;announce('You lift the cover. Leather creaks. Dust rises. Light blooms from the pages in a room without windows.');await new Promise(r=>setTimeout(r,gentle?600:8000));}
  await contentReady;if(token!==openingToken)return;$('#opening-caption').hidden=true;$('#book-reader').showModal();document.body.classList.add('reading');renderPages();$('#close-book').focus();
}
function closeBook(){
  stopPageTurn();
  $('#book-reader').close();document.body.classList.remove('reading');audio.close();$('#footer-note').textContent='YOUR PLACE IS KEPT. THE REST OF THE AFTERNOON IS YOURS.';
  if(openAction)openAction.stop();if(hinge&&hingeStart){if(gentle||simple){hinge.quaternion.copy(hingeStart);if(renderer)renderer.shadowMap.needsUpdate=true;}else closing={start:performance.now(),from:hinge.quaternion.clone()};}revealAt=0;if(magicLight)magicLight.intensity=0;atmosphere?.close();
  place='table';setCaption('THE BACK TABLE','A place held for you.','The old cover settles. Your place is kept for you.',[{label:'Open to your bookmark →',primary:true,action:()=>openBook(true)},{label:'Keep looking',action:()=>go('aisle')}]);$('#place-actions button').focus();
}
$('#close-book').onclick=closeBook;$('#book-reader').addEventListener('cancel',e=>{e.preventDefault();closeBook();});
$('#next-page').onclick=()=>turnPage(1);$('#prev-page').onclick=()=>turnPage(-1);
$('#reading-mode').onclick=()=>{stopPageTurn();plain=!plain;$('#plain-reading').hidden=!plain;$('#spread').hidden=plain;$('.reader-bottom').hidden=plain;$('#reading-mode').textContent=plain?'Return to the pages':'Plain reading';};
$('#contents-toggle').onclick=()=>{const next=$('#contents').hidden;$('#contents').hidden=!next;$('#contents-toggle').setAttribute('aria-expanded',String(next));if(next)$('#contents').scrollIntoView({behavior:gentle?'instant':'smooth',block:'start'});};

document.body.dataset.appReady='true';
initScene();
