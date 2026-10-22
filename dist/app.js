import * as THREE from 'three';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { ShopSound } from './sound.js';
import { PhysicalPageTurn } from './page-physics.js';
import { RoomAtmosphere } from './room-atmosphere.js';
import { RoomLook } from './room-look.js?scene=natural-motion-1';
import { RoomMovement, createRoomCollision } from './room-movement.js?scene=natural-motion-1';
import { RoomRadiance } from './room-radiance.js?scene=rabbit-holes-1';
import { enhanceMaterials } from './room-materials.js?scene=rabbit-holes-1';
import { applyRoomLightmap, updateRoomRevelation } from './room-lightmap.js?scene=rabbit-holes-1';
import { ROOM_POSES, sampleRoomPath } from './room-path.js?scene=rabbit-holes-1';
import { curiosities } from './curiosities.js?scene=rabbit-holes-1';
import { shelfNavigation, shelfItemAtHit, shelfFraming } from './shelf-navigation.js?scene=rabbit-holes-1';
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
const roomLook=new RoomLook(),lookTarget=new THREE.Vector3(),walkPoint=[0,0,0];
const movement=new RoomMovement(),walkingKeys=new Set(),touchDirections=new Map();
let freeExploring=false,dragTurning=false,walkedDistance=0,lastWalkingStep=0;
const audio=new ShopSound();
const listenerDirection=new THREE.Vector3();
let soundCaptions=!!saved.soundCaptions,captionTimer;
$('#captions-setting').checked=soundCaptions;
$('#captions-setting').onchange=e=>{soundCaptions=e.target.checked;saved.soundCaptions=soundCaptions;persist();$('#sound-caption').hidden=!soundCaptions;$('#sound-caption').textContent=soundCaptions?'Sounds will be described here when they happen.':'';};
document.addEventListener('shop-sound',e=>{const name=e.detail.name;const words={steps:'Your footsteps on the worn boards.',page:'A dry leaf of paper turns.',leather:'The old leather creaks.',bus:'A city bus sounds far away, above the cellar.'};const el=$('#book-reader').open?$('#reader-sound-caption'):$('#sound-caption');el.dataset.lastSound=name;el.dataset.soundTime=String(Date.now());if(!soundCaptions)return;clearTimeout(captionTimer);el.textContent=words[name]||'';el.hidden=false;captionTimer=setTimeout(()=>el.hidden=true,name==='bus'?6000:3500);});
const poses={...ROOM_POSES};
const spots={table:new THREE.Vector3(0,1.14,-4.92)};
for(const c of curiosities){poses[c.id]=c.pose;spots[c.id]=new THREE.Vector3(...c.position);}
let currentCuriosity='maps';
let frameCost=0,frameSamples=0,qualitySettled=false;

for(const c of [...curiosities,{id:'table',name:'Farther into the back',mark:'·'}]){
  const b=document.createElement(c.shelf?'a':'button');b.className=`waypoint${c.shelf?' shelf-waypoint':''}`;b.dataset.place=c.id;
  if(c.shelf){b.href=c.url;b.target='_blank';b.rel='noopener noreferrer';b.setAttribute('aria-label',`Inspect ${c.name} — ${c.website}`);}
  b.innerHTML=`<span class="point" aria-hidden="true"></span><span class="waypoint-label">${escapeHTML(c.website||c.name)}</span>`;
  $('#waypoints').append(b);
}
for(const [label,items] of [['Middle shelf · first side',curiosities.filter(c=>c.shelf&&c.side===-1)],['Middle shelf · other side',curiosities.filter(c=>c.shelf&&c.side===1)],['Around the room',curiosities.filter(c=>!c.shelf)]]){
  const heading=document.createElement('h3');heading.className='curiosity-group';heading.textContent=label;$('#curiosity-menu').append(heading);
  for(const c of items){const b=document.createElement('button');b.dataset.go=c.id;b.innerHTML=`<span aria-hidden="true">${c.mark}</span><span class="menu-object">${escapeHTML(c.name)}${c.shelf?`<small>${escapeHTML(c.website)}</small>`:''}</span><b aria-hidden="true">↗</b>`;$('#curiosity-menu').append(b);}
}
function showCuriosity(id,route){
  const c=curiosities.find(c=>c.id===id);if(!c||!glide(id,route))return;currentCuriosity=id;
  const shelf=!!c.shelf,panel=$('#shelf-panel');panel.classList.toggle('shelf-inspection',shelf);document.body.classList.toggle('inspecting-shelf',shelf);
  $('#curiosity-eyebrow').textContent=c.eyebrow;$('#curiosity-mark').textContent=c.mark;$('#shelf-title').textContent=c.title;$('#curiosity-description').textContent=c.description;
  $('#curiosity-links').replaceChildren();
  for(const [title,description,url,kind] of c.links){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.innerHTML=shelf?`<span>Open ${escapeHTML(c.website)} <span aria-hidden="true">↗</span></span>`:`<span class="shelf-number" aria-hidden="true">${c.mark}</span><span>${kind?`<span class="source-kind">${escapeHTML(kind)}</span>`:''}${escapeHTML(title)}<small>${escapeHTML(description)}</small></span><span aria-hidden="true">↗</span>`;a.setAttribute('aria-label',`${shelf?'Open ':''}${title} — opens in a new tab`);$('#curiosity-links').append(a);}
  $('#shelf-details').hidden=!shelf;$('#shelf-details').open=false;$('#shelf-trail').textContent=c.trail||'';$('#shelf-evidence').textContent=c.evidence||'';$('#shelf-object-note').textContent=c.description;
  $('#shelf-related-links').replaceChildren();
  for(const [title,description,url,kind] of c.relatedLinks||[]){const destination=new URL(url,location.href);if(!['https:','http:'].includes(destination.protocol))continue;const item=document.createElement('li'),link=document.createElement('a');link.href=destination.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`${title} ↗`;link.title=description;link.setAttribute('aria-label',`${title}${kind?` — ${kind}`:''}, opens in a new tab`);item.append(link);$('#shelf-related-links').append(item);}
  $('#shelf-related').hidden=!shelf||!$('#shelf-related-links').children.length;
  $('#shelf-navigation').hidden=!shelf;$('#shelf-website-note').textContent=shelf?'The website opens in a new tab. The shop stays here.':'These doors open other websites in a new tab. The shop stays here.';
  if(shelf){
    const nav=shelfNavigation(curiosities,id);$('#shelf-progress').textContent=`${c.side===-1?'First side':'Other side'} · ${nav.index+1} of ${nav.count}`;
    for(const [button,item] of [['shelf-previous',nav.previous],['shelf-next',nav.next],['shelf-opposite',nav.opposite]]){const el=$('#'+button);el.disabled=!item;el.dataset.destination=item?.id||'';el.setAttribute('aria-label',item?`${button==='shelf-opposite'?'Walk around to':button==='shelf-next'?'Next object:':'Previous object:'} ${item.name}`:button==='shelf-next'?'Last object on this side':'First object on this side');}
    $('#waypoints').hidden=false;
  }
  panel.hidden=false;panel.scrollTop=0;
  for(const label of $$('.shelf-waypoint')){const item=curiosities.find(value=>value.id===label.dataset.place),selected=item.id===id;label.classList.toggle('selected',selected);label.setAttribute('aria-label',selected?`Open ${item.website} — opens in a new tab`:`Inspect ${item.name} — ${item.website}`);}
  updateShelfFraming();
  announce(shelf?`${c.name}. ${c.question} Open ${c.website}, inspect the next object, or walk around to the other side.`:`${c.name}. ${c.links.length} paths into the wider internet. Each opens a new tab.`);
}
function updateShelfFraming(){
  if(!camera)return;
  const c=curiosities.find(c=>c.id===place&&c.shelf),panel=$('#shelf-panel');
  if(c&&!panel.hidden){
    const card=panel.getBoundingClientRect(),landscape=innerHeight<600&&innerWidth>600,walkButton=$('.walk-forward').getBoundingClientRect();
    // The compact touch control stays beside, never over, the miniature and plaque.
    const framing=shelfFraming(c,{width:innerWidth,height:innerHeight,top:$('.shop-header').getBoundingClientRect().bottom+14,bottom:landscape?$('.shop-footer').getBoundingClientRect().top-12:card.top-20,left:walkButton.width?Math.max(20,walkButton.right+12):20,right:landscape?card.left-20:innerWidth-20});
    camera.fov=framing.fov;camera.setViewOffset(innerWidth,innerHeight,framing.offsetX,framing.offsetY,innerWidth,innerHeight);
  }else{camera.fov=innerWidth<600?58:52;camera.clearViewOffset();}
  camera.updateProjectionMatrix();
}
function openCuriosityWebsite(c){window.open(c.url,'_blank','noopener,noreferrer');announce(`${c.website} opened in a new tab. Your place in the shop is kept here.`);}
for(const id of ['shelf-previous','shelf-next','shelf-opposite'])$('#'+id).onclick=e=>{const button=$('#'+id),destination=button.dataset.destination,heldFocus=document.activeElement===button;if(destination){go(destination);if(e.detail>0)focusRoomAfterPointer(e);else if(heldFocus&&button.disabled)$('#'+(id==='shelf-previous'?'shelf-next':'shelf-previous')).focus({preventScroll:true});}};
$('#shelf-head-on').onclick=e=>{if(glide(currentCuriosity)){updateShelfFraming();announce('Looking straight at the object again.');focusRoomAfterPointer(e);}};
$('#shelf-details').addEventListener('toggle',updateShelfFraming);
if('ResizeObserver' in window){const framingObserver=new ResizeObserver(updateShelfFraming);for(const selector of ['#shelf-panel','.shop-header','.shop-footer'])framingObserver.observe($(selector));}
function rummage(e){const others=curiosities.filter(c=>c.id!==currentCuriosity);go(others[Math.floor(Math.random()*others.length)].id);if(e?.detail>0)focusRoomAfterPointer(e);else $('#rummage').focus();}
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
    const sceneFiles=new THREE.LoadingManager();
    sceneFiles.setURLModifier(url=>/^(blob:|data:)/.test(url)?url:`${url}${url.includes('?')?'&':'?'}scene=rabbit-holes-1`);
    const [gltf,layout]=await Promise.all([new GLTFLoader(sceneFiles).loadAsync('./assets/bookstore-depth.gltf'),fetch('./assets/rabbit-hole-layout.json?scene=rabbit-holes-1').then(response=>{if(!response.ok)throw new Error('Shelf layout could not load.');return response.json();})]);room=gltf.scene;scene.add(room);
    for(const item of layout.items){const c=curiosities.find(c=>c.id===item.id&&c.shelf);if(c){c.pickBounds=item.pickBounds;c.labelBounds=item.labelBounds;if(item.labelBounds)spots[c.id].fromArray(item.labelBounds[0].map((value,axis)=>(value+item.labelBounds[1][axis])/2));}}
    if(curiosities.filter(c=>c.shelf&&c.pickBounds).length!==20)throw new Error('The twenty shelf objects could not be matched to their displays.');
    room.updateMatrixWorld(true);movement.setCollision(createRoomCollision(room));
    room.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    await enhanceMaterials(room,renderer);
    try{await applyRoomLightmap(room,renderer);}catch(error){console.warn('Baked room lighting unavailable; live lighting remains active.',error);}
    room.traverse(o=>{if(!o.isMesh)return;const mats=Array.isArray(o.material)?o.material:[o.material];if(mats.every(m=>m.emissiveIntensity>0&&m.emissive?.getHex()>0))o.castShadow=false;});
    try{radiance.capture(room,atmosphere);}catch(error){console.warn('Room reflections unavailable; direct lighting remains active.',error);}
    renderer.shadowMap.needsUpdate=true;
    hinge=room.getObjectByName('BookCoverHinge');if(hinge)hingeStart=hinge.quaternion.clone();
    if(gltf.animations.length){mixer=new THREE.AnimationMixer(room);const clip=gltf.animations.find(a=>/open/i.test(a.name))||gltf.animations[0];openAction=mixer.clipAction(clip);openAction.setLoop(THREE.LoopOnce,1);openAction.clampWhenFinished=true;}
    renderReady=true;updateShelfFraming();document.body.classList.add('scene-ready');$('#load-note').textContent='Take your time. The shelves don’t mind.';$('#load-note').classList.add('ready');
    const hint=room.getObjectByName('BookCoverHinge');if(hint){hint.userData.interactive='book';}
    requestAnimationFrame(frame);
  }catch(e){console.error('The 3D shop could not load.',e);useSimpleView('The moving room could not load. You can still explore every place below.');}
}

function useSimpleView(message='A still room, with all the same choices.'){
  resetManualInput();finishMove();simple=true;document.body.classList.add('simple-mode','scene-ready');if(!$('.fallback-scene')){const el=document.createElement('div');el.className='fallback-scene';document.body.prepend(el);}
  $('#load-note').textContent=message;$('#simple-view').textContent='Simple shop view is on';$('#settings-panel').hidden=true;$('#settings-toggle').setAttribute('aria-expanded','false');
  if(place!=='entrance')$('#waypoints').hidden=false;$$('.waypoint').forEach(b=>{b.tabIndex=0;b.setAttribute('aria-hidden','false');});announce(message);
}
$('#simple-view').onclick=()=>useSimpleView();
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{announce('This browser keeps the room in its window. You can still explore every part of it.');}};
addEventListener('fullscreenchange',()=>{$('#fullscreen').textContent=document.fullscreenElement?'Return to the window ↙':'Fill the screen with the room ↗';});
addEventListener('visibilitychange',()=>{if(document.hidden&&move){move.hiddenAt=performance.now();}else if(move?.hiddenAt){move.start+=performance.now()-move.hiddenAt;delete move.hiddenAt;}});
function frame(now){
  const elapsedFrame=now-lastFrame,dt=Math.min(elapsedFrame/1000,.05);lastFrame=now;time+=dt;
  if(!document.hidden&&!simple){
    let bob=0,sway=0;
    if(move){
      const p=Math.min((now-move.start)/move.duration,1),t=p*p*(3-2*p);
      pose.fromArray(sampleRoomPath(move.path,t,walkPoint));if(move.freeHeading)focus.copy(pose).add(move.freeHeading);else focus.lerpVectors(move.lookFrom,move.lookTo,t);
      const distance=move.distance*t,stepIndex=Math.floor(distance/.62),envelope=Math.sin(Math.PI*p);
      bob=-Math.abs(Math.sin(distance/.62*Math.PI))*.025*envelope;sway=Math.sin(distance/.62*Math.PI)*.012*envelope;
      if(stepIndex>move.lastStep){audio.step(stepIndex);move.lastStep=stepIndex;}
      if(p===1)finishMove();
    }
    updateManualMovement(dt);
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
function updateWaypoints(){
  if($('#waypoints').hidden)return;
  const mobile=innerWidth<600,placed=[],limit=mobile?2:3,inspecting=curiosities.some(c=>c.id===place&&c.shelf)&&!$('#shelf-panel').hidden;
  const candidates=$$('.waypoint').map(b=>{
    const point=spots[b.dataset.place],c=curiosities.find(c=>c.id===b.dataset.place);
    if(c?.labelBounds)point.fromArray(c.labelBounds[0].map((value,axis)=>(value+c.labelBounds[1][axis])/2));
    const v=point.clone().project(camera);
    return {b,c,v,distance:point.distanceToSquared(camera.position),x:(v.x*.5+.5)*innerWidth,y:(-v.y*.5+.5)*innerHeight};
  }).sort((a,b)=>a.distance-b.distance);
  const landscape=innerHeight<600&&innerWidth>600;
  const bottom=inspecting?(landscape?$('.shop-footer').getBoundingClientRect().top-12:$('#shelf-panel').getBoundingClientRect().top-24):innerHeight*(mobile?.57:.69);
  for(const {b,c,v,x,y} of candidates){
    const selected=!!c?.shelf&&place===c.id,facing=!c?.shelf||camera.position.x*c.side>.52;
    const clear=placed.every(p=>Math.abs(p.x-x)>(mobile?100:150)||Math.abs(p.y-y)>72);
    const eligible=inspecting?selected:true;
    const clearOfCard=!inspecting||!landscape||x<$('#shelf-panel').getBoundingClientRect().left-20;
    const visible=eligible&&clearOfCard&&facing&&clear&&placed.length<limit&&v.z>-1&&v.z<1&&Math.abs(v.x)<.84&&y>112&&y<bottom;
    if(visible)placed.push({x,y});
    b.classList.toggle('selected',selected);if(c?.shelf)b.setAttribute('aria-label',selected?`Open ${c.website} — opens in a new tab`:`Inspect ${c.name} — ${c.website}`);
    b.style.left=`${x}px`;b.style.top=`${y}px`;b.style.opacity=visible?'1':'0';b.style.pointerEvents=visible?'auto':'none';b.tabIndex=visible?0:-1;b.setAttribute('aria-hidden',String(!visible));
  }
}
// A glance is an invitation, never a mode the visitor must close.
function canExplore(){
  return renderReady&&!simple&&!document.hidden&&!$('#book-reader').open&&document.body.classList.contains('inside');
}
function preserveHeading(){
  if(camera){
    camera.updateMatrixWorld();
    const direction=new THREE.Vector3(0,0,.5).unproject(camera).sub(camera.position).normalize();
    focus.copy(pose).addScaledVector(direction,4);
  }else focus.copy(roomLook.target(pose,focus,lookTarget));
  roomLook.reset();
}
function releaseExploration(){
  if(!canExplore())return;
  if(freeExploring&&!move)return;
  preserveHeading();
  const interrupted=move;move=null;busy=false;interrupted?.onArrive?.(false);
  openingToken++;audio.stopFootsteps();audio.stopActive('book-open');
  $('#opening-caption').hidden=true;$('#revelation').classList.remove('active');
  if(revealAt){revealAt=0;if(magicLight)magicLight.intensity=0;atmosphere?.close();if(hinge&&hingeStart){hinge.quaternion.copy(hingeStart);if(renderer)renderer.shadowMap.needsUpdate=true;}}
  freeExploring=true;place='free';closePanels();$('#scene-caption').hidden=true;$('#waypoints').hidden=false;
  document.body.classList.add('free-exploring');
}
function resetManualInput(){
  walkingKeys.clear();touchDirections.clear();dragging=false;dragPointer=null;dragTurning=false;
  for(const button of $$('[data-walk]')){button.classList.remove('held');button.setAttribute('aria-pressed','false');}
  audio.stopFootsteps();
}
function roomKeyAllowed(e){
  if(!canExplore()||e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return false;
  return !e.target?.closest?.('input,textarea,select,button,a,summary,dialog,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]');
}
function handleRoomKeyDown(e){
  const code=e.code,keys=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','KeyR','KeyF','KeyC','ShiftLeft','ShiftRight'];
  if(!keys.includes(code)||!roomKeyAllowed(e))return;
  e.preventDefault();walkingKeys.add(code);releaseExploration();
}
function updateManualMovement(dt){
  if(!canExplore())return;
  const held=code=>walkingKeys.has(code),touch=[...touchDirections.values()];
  const forward=(held('KeyW')||held('ArrowUp')?1:0)-(held('KeyS')||held('ArrowDown')?1:0)+touch.filter(v=>v==='forward').length-touch.filter(v=>v==='back').length;
  const right=(held('KeyD')||held('ArrowRight')?1:0)-(held('KeyA')||held('ArrowLeft')?1:0)+touch.filter(v=>v==='right').length-touch.filter(v=>v==='left').length;
  const turn=(held('KeyQ')?1:0)-(held('KeyE')?1:0),tilt=(held('KeyR')?1:0)-(held('KeyF')?1:0),crouch=held('KeyC')||touch.includes('crouch');
  if(forward||right||turn||tilt||crouch){
    releaseExploration();
    if(turn||tilt)roomLook.turn(turn*390*dt,tilt*250*dt,pose,focus);
    const before=pose.clone(),heading=roomLook.heading(pose,focus);
    movement.step(pose.toArray(),heading,{forward,right,sprint:held('ShiftLeft')||held('ShiftRight')},dt,walkPoint);
    pose.fromArray(walkPoint);focus.add(pose.clone().sub(before));
    walkedDistance+=movement.distance;
    const step=Math.floor(walkedDistance/.62);if(step>lastWalkingStep){audio.step(step);lastWalkingStep=step;}
  }
  if(freeExploring&&!move){
    const height=crouch?1.06:1.6,change=(height-pose.y)*(gentle?1:1-Math.exp(-dt*7));
    pose.y+=change;focus.y+=change;
  }
}
function walkToFloor(point){
  if(!canExplore())return;
  releaseExploration();
  const destination=[point.x,pose.y,point.z];
  let path;try{path=movement.planPath(pose.toArray(),destination);}catch{return;}
  const direction=focus.clone().sub(pose),to=new THREE.Vector3(...destination);
  if(gentle){pose.copy(to);focus.copy(to).add(direction);return;}
  if(path.length<.05)return;
  busy=true;move={path,to,lookFrom:focus.clone(),lookTo:to.clone().add(direction),freeHeading:direction,start:performance.now(),duration:THREE.MathUtils.clamp(path.length*930,900,6800),distance:path.length,lastStep:0};
}
function finishMove(){
  const completed=move;move=null;busy=false;audio.stopFootsteps();
  if(!completed)return;
  pose.copy(completed.to);focus.copy(completed.lookTo);completed.onArrive?.(true);
}
function glide(name,preparedPath){
  const pair=poses[name]||poses.aisle;
  let path;
  if(!(gentle||simple||!renderReady)){
    try{path=preparedPath||movement.planPath(pose.toArray(),pair[0]);}
    catch{const interrupted=move;move=null;busy=false;audio.stopFootsteps();interrupted?.onArrive?.(false);announce('There is no clear way to that spot. You can keep walking or choose another object.');return false;}
  }
  roomLook.reset();audio.stopFootsteps();const interrupted=move;move=null;interrupted?.onArrive?.(false);
  if(gentle||simple||!renderReady){pose.fromArray(pair[0]);focus.fromArray(pair[1]);busy=false;audio.setPosition(pose,focus.clone().sub(pose).normalize());return true;}
  const destination=new THREE.Vector3(...pair[0]),distance=path.length;
  busy=distance>.1;move={path,to:destination,lookFrom:focus.clone(),lookTo:new THREE.Vector3(...pair[1]),start:performance.now(),duration:THREE.MathUtils.clamp(distance*930,2100,6800),distance,lastStep:0};
  return true;
}
function closePanels(){for(const id of ['explore-menu','settings-panel','shelf-panel','chair-panel','leave-panel'])$('#'+id).hidden=true;document.body.classList.remove('inspecting-shelf');$('#explore-toggle').setAttribute('aria-expanded','false');$('#settings-toggle').setAttribute('aria-expanded','false');updateShelfFraming();}
function setCaption(label,title,description,buttons=[]){$('#place-label').textContent=label;$('#place-title').textContent=title;$('#place-description').textContent=description;$('#place-actions').replaceChildren();for(const b of buttons){const el=document.createElement('button');el.className=b.primary?'brass-button':'quiet-button';el.textContent=b.label;el.onclick=e=>{b.action();focusRoomAfterPointer(e);};$('#place-actions').append(el);}$('#scene-caption').hidden=false;}
function go(name){
  let route;
  if(!(gentle||simple||!renderReady)){
    const pair=poses[name==='shelves'?'paper':name]||poses.aisle;
    try{route=movement.planPath(pose.toArray(),pair[0]);}
    catch{releaseExploration();announce('There is no clear way to that spot. You can keep walking or choose another object.');return false;}
  }
  resetManualInput();freeExploring=false;document.body.classList.remove('free-exploring');
  openingToken++;audio.stopActive('book-open');$('#opening-caption').hidden=true;$('#revelation').classList.remove('active');
  if(revealAt&&!$('#book-reader').open){revealAt=0;if(magicLight)magicLight.intensity=0;atmosphere?.close();if(hinge&&hingeStart&&!closing){hinge.quaternion.copy(hingeStart);if(renderer)renderer.shadowMap.needsUpdate=true;}}
  if($('#book-reader').open)closeBook();closePanels();place=name;$('#intro').hidden=name!=='entrance';$('#waypoints').hidden=name!=='aisle';$('#scene-caption').hidden=true;document.body.classList.toggle('inside',name!=='entrance');
  if(name==='entrance'){document.title='Legacy — Old books & odd things';glide(name,route);return;}
  if(name==='aisle'){glide(name,route);setCaption('SOMETHING, EVERYWHERE','This way. Or that.','Walk with W A S D or the arrow keys. Drag to turn all the way around. On touch screens, hold a walking arrow while you look. You can leave any object just by turning or walking away.',[{label:'Explore the first side →',action:()=>go(curiosities.find(c=>c.shelf&&c.side===-1).id)},{label:'Explore the other side →',action:()=>go(curiosities.find(c=>c.shelf&&c.side===1).id)},{label:'Look around',action:()=>togglePanel('explore-menu','explore-toggle')}]);}
  if(name==='table'){glide(name,route);setCaption('UNDER THE DUST',hasOpened?'It remembers where you were.':'No price. No date.',hasOpened?'The old leather settles beneath your hand. Your place is waiting.':'The leather has worn soft around its old repairs. The page edges are dark and uneven. Someone has kept this for a very long time.',[{label:hasOpened?'Open to your bookmark →':'Lift the cover →',primary:true,action:openBook},{label:'Leave it be',action:()=>go('aisle')}]);}
  if(curiosities.some(c=>c.id===name))showCuriosity(name,route);
  if(name==='shelves')showCuriosity('paper',route);
  if(name==='chair'){glide(name,route);$('#chair-panel').hidden=false;announce('A cabinet of oddities. Wind a little music box, or leave yourself a note on a blank postcard.');}
  if(name==='leave'){glide(name,route);audio.bell();$('#leave-panel').hidden=false;announce('You have left the shop. Your place is kept here.');}
  if(simple&&['aisle','table'].includes(name))$('#waypoints').hidden=name!=='aisle';
}
function focusRoomAfterPointer(e){if(e?.detail>0&&!simple&&!$('#book-reader').open)$('#world').focus({preventScroll:true});}
$('#enter').onclick=async e=>{await toggleSound(true);audio.bell();go('aisle');focusRoomAfterPointer(e);};
$('#enter-quietly').onclick=async e=>{await toggleSound(false);go('aisle');focusRoomAfterPointer(e);};
$('#home').onclick=e=>{go('entrance');focusRoomAfterPointer(e);};
$('#return-shop').onclick=e=>{go('aisle');focusRoomAfterPointer(e);};
$('#resume').onclick=e=>{if(go('table')!==false)openBook(true);focusRoomAfterPointer(e);};
$$('[data-go]').forEach(el=>el.onclick=e=>{go(el.dataset.go);if(e.detail===0&&!$('#shelf-panel').hidden)$('#curiosity-links a')?.focus({preventScroll:true});else focusRoomAfterPointer(e);});$$('.waypoint').forEach(el=>el.onclick=e=>{const c=curiosities.find(item=>item.id===el.dataset.place);if(c?.shelf&&place===c.id&&!busy){announce(`${c.website} opens in a new tab. Your place stays here.`);return;}e.preventDefault();go(el.dataset.place);if(e.detail===0&&!$('#shelf-panel').hidden)$('#curiosity-links a')?.focus({preventScroll:true});else focusRoomAfterPointer(e);});
$$('[data-close]').forEach(el=>el.onclick=()=>{if(canExplore()){releaseExploration();$('#world').focus({preventScroll:true});}else{$('#'+el.dataset.close).hidden=true;document.body.classList.remove('inspecting-shelf');$('#waypoints').hidden=false;updateShelfFraming();$('#explore-toggle').focus();}});
function togglePanel(id,button){resetManualInput();const next=$('#'+id).hidden;closePanels();$('#'+id).hidden=!next;$('#'+button).setAttribute('aria-expanded',String(next));if(next)$('#'+id).scrollTop=0;}
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
function setGentle(value){gentle=value;stopPageTurn();applyComfort();finishMove();}
$('#motion-setting').onchange=e=>setGentle(e.target.checked);$('#reader-motion').onclick=()=>setGentle(!gentle);
$('#brightness-setting').onchange=e=>{bright=e.target.checked;applyComfort();};
// Room input is deliberately separate from controls, forms and the book reader.
$('#world').addEventListener('pointerdown',e=>{
  if($('#book-reader').open||dragPointer!==null||(e.pointerType==='mouse'&&e.button!==0))return;
  dragging=true;dragTurning=false;dragPointer=e.pointerId;dragX=e.clientX;dragY=e.clientY;pointerTravel=0;
  $('#world').focus({preventScroll:true});$('#world').setPointerCapture(e.pointerId);
});
$('#world').addEventListener('pointermove',e=>{
  if(!dragging||e.pointerId!==dragPointer)return;
  const dx=e.clientX-dragX,dy=e.clientY-dragY;pointerTravel+=Math.abs(dx)+Math.abs(dy);
  if(pointerTravel>7){
    if(!dragTurning){if(canExplore())releaseExploration();dragTurning=true;}
    roomLook.turn(dx,dy,pose,focus);
  }
  dragX=e.clientX;dragY=e.clientY;
});
$('#world').addEventListener('pointerup',e=>{
  if(!dragging||e.pointerId!==dragPointer)return;dragging=false;dragPointer=null;if(pointerTravel>7||!room||place==='entrance')return;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);
  const hit=ray.intersectObject(room,true)[0];if(!hit)return;
  const c=shelfItemAtHit(curiosities,hit.point.toArray(),camera.position.x);
  if(c){if(place===c.id&&!busy)openCuriosityWebsite(c);else go(c.id);return;}
  for(let object=hit.object;object;object=object.parent)if(object===hinge){if(place==='table'&&!busy)openBook();else go('table');return;}
  if(hit.point.y<.15&&hit.point.y>-.2&&hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).y>.75)walkToFloor(hit.point);
});
const stopLooking=e=>{if(e.pointerId===dragPointer){dragging=false;dragPointer=null;dragTurning=false;}};
$('#world').addEventListener('pointercancel',stopLooking);
$('#world').addEventListener('lostpointercapture',stopLooking);
addEventListener('keydown',handleRoomKeyDown);
addEventListener('keyup',e=>walkingKeys.delete(e.code));
addEventListener('blur',resetManualInput);
document.addEventListener('visibilitychange',()=>{if(document.hidden)resetManualInput();});
for(const button of $$('[data-walk]')){
  button.addEventListener('pointerdown',e=>{
    if(!canExplore()||(e.pointerType==='mouse'&&e.button!==0))return;
    e.preventDefault();releaseExploration();touchDirections.set(e.pointerId,button.dataset.walk);
    button.setPointerCapture(e.pointerId);button.classList.add('held');button.setAttribute('aria-pressed','true');
  });
  const release=e=>{touchDirections.delete(e.pointerId);touchDirections.delete(button);button.classList.remove('held');button.setAttribute('aria-pressed','false');};
  for(const name of ['pointerup','pointercancel','lostpointercapture','blur'])button.addEventListener(name,release);
  button.addEventListener('keydown',e=>{if((e.key===' '||e.key==='Enter')&&canExplore()){e.preventDefault();releaseExploration();touchDirections.set(button,button.dataset.walk);button.classList.add('held');button.setAttribute('aria-pressed','true');}});
  button.addEventListener('keyup',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();release(e);}});
}
$('#world').addEventListener('webglcontextlost',e=>{e.preventDefault();useSimpleView('The moving room paused. The simple shop keeps every place available.');});
addEventListener('resize',()=>{stopPageTurn();if(renderer){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;updateShelfFraming();}renderPages();});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#book-reader').open){const guideOpen=['shelf-panel','chair-panel'].some(id=>!$('#'+id).hidden);if(canExplore())releaseExploration();closePanels();if(guideOpen)$('#waypoints').hidden=false;(canExplore()?$('#world'):$('#explore-toggle')).focus({preventScroll:true});}if($('#book-reader').open&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){if(e.key==='ArrowRight'){e.preventDefault();turnPage(1);}if(e.key==='ArrowLeft'){e.preventDefault();turnPage(-1);}}});

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
  resetManualInput();
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
$('#close-book').onclick=e=>{closeBook();focusRoomAfterPointer(e);};$('#book-reader').addEventListener('cancel',e=>{e.preventDefault();closeBook();});
$('#next-page').onclick=()=>turnPage(1);$('#prev-page').onclick=()=>turnPage(-1);
$('#reading-mode').onclick=()=>{stopPageTurn();plain=!plain;$('#plain-reading').hidden=!plain;$('#spread').hidden=plain;$('.reader-bottom').hidden=plain;$('#reading-mode').textContent=plain?'Return to the pages':'Plain reading';};
$('#contents-toggle').onclick=()=>{const next=$('#contents').hidden;$('#contents').hidden=!next;$('#contents-toggle').setAttribute('aria-expanded',String(next));if(next)$('#contents').scrollIntoView({behavior:gentle?'instant':'smooth',block:'start'});};

document.body.dataset.appReady='true';
initScene();
