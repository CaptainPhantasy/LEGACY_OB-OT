import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import { RoomLook } from '../dist/room-look.js';
import { RoomMovement } from '../dist/room-movement.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const controlStart=source.indexOf('function canExplore(){'),controlEnd=source.indexOf('function finishMove(){',controlStart);
const inputStart=source.indexOf('// Room input is deliberately separate'),inputEnd=source.indexOf("$('#world').addEventListener('webglcontextlost'",inputStart);
assert.ok(controlStart>0&&controlEnd>controlStart&&inputEnd>inputStart);
function classes(initial=[]){
  const set=new Set(initial);
  return {add(...v){v.forEach(x=>set.add(x));},remove(...v){v.forEach(x=>set.delete(x));},contains(v){return set.has(v);},toggle(v,on){if(on??!set.has(v))set.add(v);else set.delete(v);}};
}
function element(id){
  const events={};
  return {id,events,hidden:false,open:false,dataset:{},classList:classes(),attributes:{},
    addEventListener(name,fn){(events[name]??=[]).push(fn);},setAttribute(name,value){this.attributes[name]=value;},
    setPointerCapture(){},focus(){},closest(){return null;}};
}
function harness(){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  const buttons=['forward','left','back','right'].map(name=>Object.assign(element(name),{dataset:{walk:name}}));
  const windowEvents={},documentEvents={};
  const pose=new THREE.Vector3(-1.1,1.48,1.5),focus=new THREE.Vector3(-.205,1.34,1.5);
  const camera=new THREE.PerspectiveCamera(68,390/844,.04,60);
  camera.position.copy(pose);camera.lookAt(focus);camera.setViewOffset(390,844,0,130,390,844);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const roomLook=new RoomLook(),movement=new RoomMovement();
  const context=vm.createContext({THREE,roomLook,movement,pose,focus,camera,
    lookTarget:new THREE.Vector3(),walkPoint:[0,0,0],walkingKeys:new Set(),touchDirections:new Map(),
    freeExploring:false,dragging:false,dragPointer:null,dragTurning:false,dragX:0,dragY:0,pointerTravel:0,
    walkedDistance:0,lastWalkingStep:0,renderReady:true,simple:false,gentle:false,busy:true,move:null,
    openingToken:0,revealAt:0,magicLight:null,atmosphere:null,hinge:null,hingeStart:null,renderer:null,
    place:'crypto-museum',room:{},curiosities:[],shelfItemAtHit(){return null;},go(){},openCuriosityWebsite(){},openBook(){},
    innerWidth:390,innerHeight:844,performance:{now:()=>1000},
    $:el,$$:selector=>selector==='[data-walk]'?buttons:[],
    audio:{stopFootsteps(){},stopActive(){},step(){}},
    document:{hidden:false,body:{classList:classes(['inside','inspecting-shelf'])},
      addEventListener(name,fn){(documentEvents[name]??=[]).push(fn);}},
    addEventListener(name,fn){(windowEvents[name]??=[]).push(fn);},
    closePanels(){for(const id of ['#shelf-panel','#chair-panel','#explore-menu','#settings-panel'])el(id).hidden=true;context.document.body.classList.remove('inspecting-shelf');camera.clearViewOffset();camera.fov=52;camera.updateProjectionMatrix();},
  });
  vm.runInContext(source.slice(controlStart,controlEnd),context);
  vm.runInContext(source.slice(inputStart,inputEnd),context);
  return {context,el,buttons,windowEvents,documentEvents};
}
const keyEvent=(code,target={closest:()=>null})=>({code,key:code,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
const direction=c=>new THREE.Vector3(0,0,.5).unproject(c.camera).sub(c.camera.position).normalize();

test('looking away releases inspection and a pending approach without moving or snapping the view',()=>{
  const {context:c,el}=harness();
  const beforePosition=c.pose.clone(),beforeDirection=direction(c),arrivals=[];
  c.move={onArrive:value=>arrivals.push(value)};
  el('#world').events.pointerdown[0]({pointerId:7,pointerType:'touch',isPrimary:true,clientX:220,clientY:260});
  // A sub-threshold tap is still a tap, not a navigation cancellation.
  el('#world').events.pointermove[0]({pointerId:7,clientX:223,clientY:260});
  assert.deepEqual(arrivals,[]);
  el('#world').events.pointermove[0]({pointerId:7,clientX:232,clientY:260});
  assert.deepEqual(arrivals,[false]);
  assert.equal(c.move,null);assert.equal(c.busy,false);assert.equal(c.place,'free');
  assert.ok(c.pose.distanceTo(beforePosition)<1e-10);
  assert.equal(el('#shelf-panel').hidden,true);assert.equal(el('#waypoints').hidden,false);
  assert.equal(c.camera.view.enabled,false);
  // The only directional change is the user's nine-pixel drag, not a reset to the object.
  const desired=new THREE.Vector3().copy(c.focus).sub(c.pose).normalize();
  assert.ok(beforeDirection.dot(desired)>.999999999);
  c.releaseExploration();assert.deepEqual(arrivals,[false],'The interrupted book wait is resolved once');
});

test('manual walking moves relative to the current view and carries that view with the visitor',()=>{
  const {context:c}=harness();
  c.releaseExploration();const before=c.pose.clone();
  c.roomLook.turn(-Math.PI/2/.0045,0,c.pose,c.focus);
  const heading=c.roomLook.heading(c.pose,c.focus),expected=new THREE.Vector3(Math.sin(heading),0,-Math.cos(heading));
  const directionBefore=c.roomLook.target(c.pose,c.focus,new THREE.Vector3()).sub(c.pose).normalize();
  c.handleRoomKeyDown(keyEvent('KeyW'));c.updateManualMovement(.1);
  const delta=c.pose.clone().sub(before);delta.y=0;
  assert.ok(delta.length()>.05);assert.ok(delta.clone().normalize().dot(expected)>.999);
  const directionAfter=c.roomLook.target(c.pose,c.focus,new THREE.Vector3()).sub(c.pose).normalize();
  assert.ok(directionBefore.dot(directionAfter)>.999999999);
  c.walkingKeys.clear();c.handleRoomKeyDown(keyEvent('KeyC'));c.updateManualMovement(.1);
  assert.ok(c.pose.y<before.y,'Crouching lowers the viewpoint');
});

test('walking keys never take over text, controls, the reader, or modifier shortcuts',()=>{
  const {context:c,el}=harness();
  for(const tag of ['input','textarea','select','button','a','summary','dialog','contenteditable']){
    const e=keyEvent('KeyW',{closest:()=>({tag})});c.handleRoomKeyDown(e);
    assert.equal(c.walkingKeys.size,0);assert.equal(e.defaultPrevented,false);
  }
  for(const modifier of ['ctrlKey','metaKey','altKey']){
    const e=Object.assign(keyEvent('KeyW'),{[modifier]:true});c.handleRoomKeyDown(e);
    assert.equal(c.walkingKeys.size,0);
  }
  el('#book-reader').open=true;c.handleRoomKeyDown(keyEvent('ArrowRight'));assert.equal(c.walkingKeys.size,0);
  el('#book-reader').open=false;const e=keyEvent('ArrowRight');c.handleRoomKeyDown(e);
  assert.ok(c.walkingKeys.has('ArrowRight'));assert.equal(e.defaultPrevented,true);
});

test('touch walking and a second-finger look work together and every release path stops input',()=>{
  const {context:c,el,buttons,windowEvents,documentEvents}=harness();
  const forward=buttons[0];
  forward.events.pointerdown[0]({pointerId:10,pointerType:'touch',isPrimary:true,preventDefault(){}});
  assert.equal(c.touchDirections.get(10),'forward');
  // The looking finger is not primary when another finger already holds Walk.
  el('#world').events.pointerdown[0]({pointerId:11,pointerType:'touch',isPrimary:false,clientX:270,clientY:300});
  assert.equal(c.dragPointer,11);
  el('#world').events.pointermove[0]({pointerId:11,clientX:300,clientY:300});
  assert.ok(Math.abs(c.roomLook.yaw)>.1);
  forward.events.pointercancel[0]({pointerId:10});assert.equal(c.touchDirections.size,0);
  c.walkingKeys.add('KeyW');c.touchDirections.set(12,'right');
  windowEvents.blur[0]();assert.equal(c.walkingKeys.size,0);assert.equal(c.touchDirections.size,0);assert.equal(c.dragPointer,null);
  c.walkingKeys.add('KeyA');c.document.hidden=true;documentEvents.visibilitychange[0]();assert.equal(c.walkingKeys.size,0);
});

test('click-to-walk on clear floor keeps heading and reduced motion avoids an automatic glide',()=>{
  const {context:c}=harness();
  c.releaseExploration();const heading=c.focus.clone().sub(c.pose).normalize();
  c.walkToFloor(new THREE.Vector3(-1.1,0,2.4));
  assert.ok(c.move&&c.move.freeHeading);assert.ok(c.move.freeHeading.clone().normalize().dot(heading)>.999999999);
  let interrupted;c.move.onArrive=value=>interrupted=value;
  c.handleRoomKeyDown(keyEvent('KeyA'));assert.equal(interrupted,false);assert.equal(c.move,null);
  c.walkingKeys.clear();c.gentle=true;c.walkToFloor(new THREE.Vector3(-1.1,0,2.6));
  assert.equal(c.move,null);assert.ok(c.pose.distanceTo(new THREE.Vector3(-1.1,1.48,2.6))<1e-9);
});

test('pointer entry and destination choices return focus to walking, while keyboard choices keep UI focus',async()=>{
  const {context:c,el,buttons}=harness();
  let active=null;
  const world=el('#world');world.focus=()=>{active=world;};
  const enter=el('#enter');enter.focus=()=>{active=enter;};enter.closest=()=>enter;
  const menu=el('#menu-item');menu.dataset.go='priyom';menu.closest=()=>menu;
  const waypoint=el('#waypoint');waypoint.dataset.place='priyom';waypoint.closest=()=>waypoint;
  c.$$=selector=>selector==='[data-go]'?[menu]:selector==='.waypoint'?[waypoint]:selector==='[data-walk]'?buttons:[];
  c.audio.bell=()=>{};c.toggleSound=async()=>{};c.curiosities=[{id:'priyom',shelf:true,website:'Priyom'}];
  c.go=id=>{c.place=id;c.busy=true;};
  const start=source.indexOf('function focusRoomAfterPointer('),end=source.indexOf("$$('[data-close]')",start);
  assert.ok(end>start);vm.runInContext(source.slice(start,end),c);
  active=enter;await enter.onclick({detail:1});
  assert.equal(active,world,'A mouse/touch entry should immediately leave WASD ready');
  c.handleRoomKeyDown(keyEvent('KeyW',active));assert.ok(c.walkingKeys.has('KeyW'));c.walkingKeys.clear();
  active=menu;menu.onclick({detail:1});assert.equal(active,world);
  c.handleRoomKeyDown(keyEvent('KeyA',active));assert.ok(c.walkingKeys.has('KeyA'));c.walkingKeys.clear();
  c.place='aisle';active=waypoint;waypoint.onclick({detail:1,preventDefault(){}});
  assert.equal(active,world,'Clicking a destination label does not trap focus on the anchor');
  c.handleRoomKeyDown(keyEvent('KeyD',active));assert.ok(c.walkingKeys.has('KeyD'));c.walkingKeys.clear();
  active=enter;await enter.onclick({detail:0});
  assert.equal(active,enter,'Keyboard activation keeps intentional UI navigation focus');
});
