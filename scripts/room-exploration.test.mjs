import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from '../dist/vendor/three.module.js';
import { RoomLook } from '../dist/room-look.js';
import { RoomMovement } from '../dist/room-movement.js';
import { RoomTouchStick } from '../dist/room-touch.js';

const source=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const controlStart=source.indexOf('function canExplore(){'),controlEnd=source.indexOf('function finishMove(){',controlStart);
const inputStart=source.indexOf('// Room input is deliberately separate'),inputEnd=source.indexOf("$('#world').addEventListener('webglcontextlost'",inputStart);
assert.ok(controlStart>0&&controlEnd>controlStart&&inputEnd>inputStart);
function classes(initial=[]){
  const set=new Set(initial);
  return {add(...v){v.forEach(x=>set.add(x));},remove(...v){v.forEach(x=>set.delete(x));},contains(v){return set.has(v);},toggle(v,on){if(on??!set.has(v))set.add(v);else set.delete(v);}};
}
function element(id,stickSize=180,thumbSize=50){
  const events={},captures=new Set(),styles={};
  return {id,events,hidden:false,open:false,dataset:{},classList:classes(),attributes:{},
    style:{setProperty(name,value){styles[name]=value;},getPropertyValue(name){return styles[name]??'';}},
    addEventListener(name,fn){(events[name]??=[]).push(fn);},setAttribute(name,value){this.attributes[name]=value;},
    getBoundingClientRect(){return id==='#walk-stick-thumb'?{left:0,top:0,width:thumbSize,height:thumbSize}:{left:16,top:620,width:stickSize,height:stickSize};},
    setPointerCapture(id){captures.add(id);},hasPointerCapture(id){return captures.has(id);},releasePointerCapture(id){captures.delete(id);},
    focus(){},closest(){return null;}};
}
function harness({stickSize=180,thumbSize=50}={}){
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,element(id,stickSize,thumbSize));return elements.get(id);};
  const windowEvents={},documentEvents={};
  const pose=new THREE.Vector3(-1.1,1.48,1.5),focus=new THREE.Vector3(-.205,1.34,1.5);
  const camera=new THREE.PerspectiveCamera(68,390/844,.04,60);
  camera.position.copy(pose);camera.lookAt(focus);camera.setViewOffset(390,844,0,130,390,844);camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const roomLook=new RoomLook(),movement=new RoomMovement(),touchStick=new RoomTouchStick();
  const context=vm.createContext({THREE,roomLook,movement,touchStick,pose,focus,camera,
    lookTarget:new THREE.Vector3(),walkPoint:[0,0,0],walkingKeys:new Set(),
    stickPointer:null,stickCenterX:0,stickCenterY:0,stickRadius:1,dragTouch:false,
    freeExploring:false,dragging:false,dragPointer:null,dragTurning:false,dragX:0,dragY:0,pointerTravel:0,
    walkedDistance:0,lastWalkingStep:0,renderReady:true,simple:false,gentle:false,busy:true,move:null,
    openingToken:0,revealAt:0,magicLight:null,atmosphere:null,hinge:null,hingeStart:null,renderer:null,
    tickShop(){},immersive:{enter(){}},entryPending:false,
    place:'crypto-museum',room:{},curiosities:[],shelfItemAtHit(){return null;},go(){},openCuriosityWebsite(){},openBook(){},
    innerWidth:390,innerHeight:844,performance:{now:()=>1000},
    $:el,$$:()=>[],
    audio:{stopFootsteps(){},stopActive(){},step(){}},
    document:{hidden:false,body:{classList:classes(['inside','inspecting-shelf'])},
      addEventListener(name,fn){(documentEvents[name]??=[]).push(fn);}},
    addEventListener(name,fn){(windowEvents[name]??=[]).push(fn);},
    closePanels(){for(const id of ['#shelf-panel','#chair-panel','#explore-menu','#settings-panel'])el(id).hidden=true;context.document.body.classList.remove('inspecting-shelf');camera.clearViewOffset();camera.fov=52;camera.updateProjectionMatrix();},
  });
  vm.runInContext(source.slice(controlStart,controlEnd),context);
  vm.runInContext(source.slice(inputStart,inputEnd),context);
  context.enterShop=(destination='aisle')=>{context.go(destination);return true;};
  return {context,el,windowEvents,documentEvents};
}
const keyEvent=(code,target={closest:()=>null})=>({code,key:code,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
const direction=c=>new THREE.Vector3(0,0,.5).unproject(c.camera).sub(c.camera.position).normalize();
const near=(actual,expected,message='')=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}. ${message}`);
const pointerEvent=(pointerId,clientX=0,clientY=0,extra={})=>({pointerId,clientX,clientY,pointerType:'touch',isPrimary:true,preventDefault(){this.defaultPrevented=true;},...extra});
function dispatch(element,name,event){for(const handler of element.events[name]??[])handler(event);}
function stickEvent(h,pointerId,x=0,y=0,extra={}){
  const rect=h.el('#walk-stick').getBoundingClientRect(),thumb=h.el('#walk-stick-thumb').getBoundingClientRect();
  const radius=(rect.width-thumb.width)/2-5;
  return pointerEvent(pointerId,rect.left+rect.width/2+x*radius,rect.top+rect.height/2+y*radius,extra);
}
function beginTwoThumbs(h){
  dispatch(h.el('#walk-stick'),'pointerdown',stickEvent(h,10,0,-.8));
  dispatch(h.el('#world'),'pointerdown',pointerEvent(11,270,300,{isPrimary:false}));
  dispatch(h.el('#world'),'pointermove',pointerEvent(11,300,285,{isPrimary:false}));
}
const planarDelta=(from,to)=>new THREE.Vector3(to.x-from.x,0,to.z-from.z);

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
    const e=keyEvent('KeyW',{closest:selector=>selector==='#walk-stick'?null:{tag}});c.handleRoomKeyDown(e);
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

test('two thumbs move and look together, with gentler look applied smoothly over frames',()=>{
  const h=harness(),c=h.context,before=c.pose.clone();beginTwoThumbs(h);
  assert.equal(c.stickPointer,10);assert.equal(c.dragPointer,11);
  assert.equal(c.touchStick.active,true);assert.ok(c.touchStick.forward>0);
  assert.equal(c.roomLook.yaw,0,'touch events queue movement instead of snapping the camera');
  c.updateManualMovement(1/60);c.roomLook.update(1/60);
  assert.ok(planarDelta(before,c.pose).length()>.005,'walking continues while looking');
  assert.ok(c.roomLook.yaw<0&&c.roomLook.yaw>-.03,'first frame eases toward the requested angle');
  const first=c.roomLook.yaw;c.roomLook.update(1/60);
  assert.ok(c.roomLook.yaw<first&&c.roomLook.yaw>-.03,'later frames approach without overshooting');
  assert.ok(Math.abs(c.roomLook.yaw)<30*.0045,'touch sensitivity is below desktop sensitivity');
});

test('the larger stick doubles usable pointer travel and gives smaller speed changes per pixel',async()=>{
  const css=await readFile(new URL('../dist/style.css',import.meta.url),'utf8');
  const pixels=pattern=>{const match=css.match(pattern);assert.ok(match,'the shipped control must expose its layout dimensions');return Number(match[1]);};
  const thumb=pixels(/\.walk-stick-thumb\{[^}]*?width:(\d+)px/);
  const layouts=[
    [120,pixels(/@media\(any-pointer:coarse\) and \(max-width:600px\)\{[^}]*?--stick-size:(\d+)px/),thumb],
    [132,pixels(/:root\{--stick-size:(\d+)px;--footer-height:/),thumb],
    [104,pixels(/@media\(any-pointer:coarse\) and \(max-height:450px\)\{[^}]*?--stick-size:(\d+)px/),
      pixels(/@media\(any-pointer:coarse\) and \(max-height:450px\)\{[\s\S]*?\.walk-stick-thumb\{width:(\d+)px/)],
  ];
  for(const [previousSize,stickSize,thumbSize] of layouts){
    const h=harness({stickSize,thumbSize}),c=h.context;
    dispatch(h.el('#walk-stick'),'pointerdown',stickEvent(h,10));
    const previousRadius=(previousSize-thumbSize)/2-5;
    near(c.stickRadius,previousRadius*2,'each layout provides twice the previous center-to-rim travel');
    const center=stickEvent(h,10),travel=c.stickRadius*.5;
    dispatch(h.el('#walk-stick'),'pointermove',pointerEvent(10,center.clientX,center.clientY-travel));
    const first=c.touchStick.forward;
    dispatch(h.el('#walk-stick'),'pointermove',pointerEvent(10,center.clientX,center.clientY-travel-1));
    const previousPerPixel=1/(.88*previousRadius);
    near(c.touchStick.forward-first,previousPerPixel*.25,
      'twice the physical range plus half speed makes a pixel adjustment one quarter as large');
    dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,0,-1));
    const before=c.pose.clone();c.updateManualMovement(.1);
    near(planarDelta(before,c.pose).length(),.0675,'the full rim walks at half the previous 1.35 units per second');
    dispatch(h.el('#walk-stick'),'pointerup',stickEvent(h,10));
    const stopped=c.pose.clone();c.updateManualMovement(.1);
    near(planarDelta(stopped,c.pose).length(),0,'the larger pad still stops on release');
  }
});

test('lifting either thumb first leaves the other working, and released looking never drifts',()=>{
  for(const releaseFirst of ['look','stick']){
    const h=harness(),c=h.context;beginTwoThumbs(h);c.roomLook.update(1/60);
    if(releaseFirst==='look'){
      dispatch(h.el('#world'),'pointerup',pointerEvent(11,300,285));
      assert.equal(c.dragPointer,null);assert.equal(c.touchStick.active,true);
      const target=c.roomLook.targetYaw,before=c.pose.clone();c.updateManualMovement(.05);c.roomLook.update(.1);
      near(c.roomLook.yaw,target,'released look finishes the requested swipe within 100 ms');
      c.roomLook.update(1);near(c.roomLook.yaw,target,'finished looking has no continuing drift');
      assert.ok(planarDelta(before,c.pose).length()>.01,'the remaining walking thumb still moves');
      dispatch(h.el('#walk-stick'),'pointerup',stickEvent(h,10));
    }else{
      dispatch(h.el('#walk-stick'),'pointerup',stickEvent(h,10));
      assert.equal(c.touchStick.active,false);assert.equal(c.dragPointer,11);
      const before=c.pose.clone(),yaw=c.roomLook.yaw;
      dispatch(h.el('#world'),'pointermove',pointerEvent(11,330,285));
      c.updateManualMovement(.05);c.roomLook.update(.05);
      near(planarDelta(before,c.pose).length(),0,'released walking stops immediately');
      assert.ok(c.roomLook.yaw<yaw,'the remaining looking thumb still turns');
      dispatch(h.el('#world'),'pointerup',pointerEvent(11,330,285));
      c.roomLook.update(.1);near(c.roomLook.yaw,c.roomLook.targetYaw);
    }
    const yaw=c.roomLook.yaw,before=c.pose.clone();c.updateManualMovement(.1);c.roomLook.update(2);
    near(c.roomLook.yaw,yaw);near(planarDelta(before,c.pose).length(),0);
    assert.equal(c.stickPointer,null);assert.equal(c.dragPointer,null);
    assert.equal(h.el('#walk-stick').style.getPropertyValue('--stick-x'),'0px');
    assert.equal(h.el('#walk-stick').style.getPropertyValue('--stick-y'),'0px');
    assert.equal(h.el('#walk-stick').hasPointerCapture(10),false);
  }
});

test('a quick swipe ending before the next frame still completes and then stops exactly',()=>{
  const h=harness(),c=h.context;
  dispatch(h.el('#world'),'pointerdown',pointerEvent(11,270,300));
  dispatch(h.el('#world'),'pointermove',pointerEvent(11,320,280));
  const target=c.roomLook.targetYaw,targetPitch=c.roomLook.targetPitch;
  dispatch(h.el('#world'),'pointerup',pointerEvent(11,320,280));
  near(c.roomLook.yaw,0,'the event itself does not snap the view');
  c.roomLook.update(.05);assert.ok(c.roomLook.yaw<0&&c.roomLook.yaw>target);
  c.roomLook.update(.05);near(c.roomLook.yaw,target);near(c.roomLook.pitch,targetPitch);
  c.roomLook.update(10);near(c.roomLook.yaw,target);near(c.roomLook.pitch,targetPitch);
});

test('an unrelated finger cannot move, release, or replace either active control',()=>{
  const h=harness(),c=h.context;beginTwoThumbs(h);
  const forward=c.touchStick.forward,target=c.roomLook.targetYaw;
  dispatch(h.el('#walk-stick'),'pointerdown',stickEvent(h,99,1,1));
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,99,-1,1));
  for(const name of ['pointerup','pointercancel','lostpointercapture'])dispatch(h.el('#walk-stick'),name,stickEvent(h,99));
  dispatch(h.el('#world'),'pointerdown',pointerEvent(99,0,0));
  dispatch(h.el('#world'),'pointermove',pointerEvent(99,500,500));
  for(const name of ['pointerup','pointercancel','lostpointercapture'])dispatch(h.el('#world'),name,pointerEvent(99));
  assert.equal(c.stickPointer,10);assert.equal(c.dragPointer,11);
  near(c.touchStick.forward,forward);near(c.roomLook.targetYaw,target);
});

test('pointer cancellation and lost capture stop the affected control without stopping the other thumb',()=>{
  for(const eventName of ['pointercancel','lostpointercapture']){
    for(const control of ['look','stick']){
      const h=harness(),c=h.context;beginTwoThumbs(h);c.roomLook.update(.02);
      if(control==='look'){
        dispatch(h.el('#world'),eventName,pointerEvent(11));
        assert.equal(c.dragPointer,null);assert.equal(c.touchStick.active,true);
        const yaw=c.roomLook.yaw;c.roomLook.update(1);near(c.roomLook.yaw,yaw);
      }else{
        dispatch(h.el('#walk-stick'),eventName,stickEvent(h,10));
        assert.equal(c.stickPointer,null);assert.equal(c.touchStick.active,false);assert.equal(c.dragPointer,11);
        near(c.touchStick.forward,0);near(c.touchStick.right,0);
      }
    }
  }
});

test('leaving the app or hiding the page clears both thumbs, keyboard movement, and queued camera motion',()=>{
  for(const kind of ['blur','hidden']){
    const h=harness(),c=h.context;beginTwoThumbs(h);c.roomLook.update(.02);c.walkingKeys.add('KeyW');
    if(kind==='blur')h.windowEvents.blur[0]();
    else{c.document.hidden=true;h.documentEvents.visibilitychange[0]();c.document.hidden=false;}
    assert.equal(c.walkingKeys.size,0);assert.equal(c.touchStick.active,false);
    assert.equal(c.stickPointer,null);assert.equal(c.dragPointer,null);assert.equal(c.dragging,false);
    assert.equal(c.roomLook.autoTurn,null);assert.equal(c.roomLook.touchPending,false);
    const yaw=c.roomLook.yaw,before=c.pose.clone();c.updateManualMovement(.1);c.roomLook.update(1);
    near(c.roomLook.yaw,yaw);near(planarDelta(before,c.pose).length(),0);
  }
});

test('a lower-half stick crossing turns once while walking remains on the original straight path',()=>{
  const h=harness(),c=h.context;let turns=0;
  const faceHeading=c.roomLook.faceHeading.bind(c.roomLook);c.roomLook.faceHeading=(...args)=>{turns++;return faceHeading(...args);};
  dispatch(h.el('#walk-stick'),'pointerdown',stickEvent(h,10,.4,-.8));
  const anchor=c.touchStick.heading;
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,.4,.8));
  assert.equal(turns,1);assert.ok(c.roomLook.autoTurn);
  const forward=c.touchStick.forward,right=c.touchStick.right;
  const expected=new THREE.Vector3(Math.sin(anchor)*forward+Math.cos(anchor)*right,0,-Math.cos(anchor)*forward+Math.sin(anchor)*right).normalize();
  for(let i=0;i<8;i++){
    dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,.4,.8));
    const before=c.pose.clone();c.updateManualMovement(.05);c.roomLook.update(.05);
    const delta=planarDelta(before,c.pose);assert.ok(delta.length()>.01);
    assert.ok(delta.normalize().dot(expected)>.999999,'turning the view cannot curve the walking path');
    near(c.touchStick.heading,anchor);
  }
  c.roomLook.update(2);const heading=c.roomLook.heading(c.pose,c.focus);
  near(Math.cos(heading-anchor),-1,'the view finishes facing the opposite direction');
  const yaw=c.roomLook.yaw;c.roomLook.update(2);near(c.roomLook.yaw,yaw);assert.equal(turns,1);
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,.4,-.8));
  assert.equal(turns,2);c.roomLook.update(2.4);near(Math.cos(c.roomLook.heading(c.pose,c.focus)-anchor),1);
});

test('explicit looking cancels an automatic turn and wins over later stick crossings',()=>{
  const h=harness(),c=h.context;
  dispatch(h.el('#walk-stick'),'pointerdown',stickEvent(h,10,0,.8));
  assert.ok(c.roomLook.autoTurn);c.roomLook.update(.1);
  dispatch(h.el('#world'),'pointerdown',pointerEvent(11,270,300,{isPrimary:false}));
  dispatch(h.el('#world'),'pointermove',pointerEvent(11,300,300));
  assert.equal(c.roomLook.autoTurn,null);assert.equal(c.roomLook.touchPending,true);
  const target=c.roomLook.targetYaw;
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,0,-.8));
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,0,.8));
  assert.equal(c.roomLook.autoTurn,null);near(c.roomLook.targetYaw,target);
  c.roomLook.update(.1);dispatch(h.el('#world'),'pointerup',pointerEvent(11,300,300));
  const targetAfterRelease=c.roomLook.targetYaw;c.roomLook.update(.1);near(c.roomLook.yaw,targetAfterRelease);
  c.roomLook.update(1);near(c.roomLook.yaw,targetAfterRelease);
  dispatch(h.el('#walk-stick'),'pointermove',stickEvent(h,10,0,-.8));
  assert.ok(c.roomLook.autoTurn,'automatic facing becomes available again after looking ends');
  c.roomLook.update(.1);dispatch(h.el('#walk-stick'),'pointerup',stickEvent(h,10));
  const stoppedYaw=c.roomLook.yaw;c.roomLook.update(1);near(c.roomLook.yaw,stoppedYaw,'releasing the stick also stops an unfinished turn');
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
  const {context:c,el}=harness();
  let active=null;
  const world=el('#world');world.focus=()=>{active=world;};
  const enter=el('#enter');enter.focus=()=>{active=enter;};enter.closest=()=>enter;
  const menu=el('#menu-item');menu.dataset.go='priyom';menu.closest=()=>menu;
  const waypoint=el('#waypoint');waypoint.dataset.place='priyom';waypoint.closest=()=>waypoint;
  c.$$=selector=>selector==='[data-go]'?[menu]:selector==='.waypoint'?[waypoint]:[];
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
